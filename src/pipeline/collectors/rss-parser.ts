import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  articleInputSchema,
  fetchableSourceUrlSchema,
  type ArticleInput,
  type CollectionIssue,
  type SourceRegistryEntry,
} from "../../contracts";
import { CollectorError } from "./collector-error";

type XmlRecord = Record<string, unknown>;

export interface ParsedRssFeed {
  items: ArticleInput[];
  issues: CollectionIssue[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true,
});

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }
  if (isRecord(value)) {
    return textValue(value["#text"]);
  }
  return null;
}

function firstText(record: XmlRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = textValue(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function decodeCharacterReferences(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, reference: string) => {
      if (reference.startsWith("#")) {
        const hexadecimal = reference[1]?.toLowerCase() === "x";
        const digits = reference.slice(hexadecimal ? 2 : 1);
        const point = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isFinite(point) ||
          point === 0 ||
          point > 0x10ffff ||
          (point >= 0xd800 && point <= 0xdfff)
        ) {
          return " ";
        }
        return String.fromCodePoint(point);
      }
      return named[reference.toLowerCase()] ?? match;
    },
  );
}

export function stripMarkupToPlainText(value: string): string {
  return decodeCharacterReferences(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(?:address|article|aside|blockquote|br|div|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("").trim();
}

function preferredExcerpt(rawExcerpt: string, source: SourceRegistryEntry): string {
  void source;
  return stripMarkupToPlainText(rawExcerpt);
}

function resolveArticleLink(item: XmlRecord, baseUrl: string): string | null {
  const rssLink = textValue(item.link);
  if (rssLink !== null) {
    try {
      return new URL(rssLink, baseUrl).toString();
    } catch {
      return null;
    }
  }

  for (const candidate of asArray(item.link)) {
    if (!isRecord(candidate)) {
      continue;
    }
    const relation = textValue(candidate["@_rel"]);
    const href = textValue(candidate["@_href"]);
    if (href !== null && (relation === null || relation === "alternate")) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface PublicationMoment {
  timestamp: string;
  precision: "date" | "instant";
}

function parsePublicationTimestamp(item: XmlRecord): PublicationMoment | null {
  const raw = firstText(item, ["pubDate", "published", "updated", "dc:date"]);
  if (raw === null) {
    return null;
  }
  const msitCalendarDate = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(raw);
  if (msitCalendarDate) {
    const [, year, month, day] = msitCalendarDate;
    const calendarDate = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    const timestamp = `${year}-${month}-${day}T00:00:00+09:00`;
    if (
      calendarDate.getUTCFullYear() === Number(year) &&
      calendarDate.getUTCMonth() + 1 === Number(month) &&
      calendarDate.getUTCDate() === Number(day)
    ) {
      return { timestamp, precision: "date" };
    }
    return null;
  }
  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.getTime())
    ? null
    : { timestamp: timestamp.toISOString(), precision: "instant" };
}

function parseAuthor(item: XmlRecord): string | null {
  const direct = firstText(item, ["author", "dc:creator"]);
  if (direct !== null) {
    return truncate(stripMarkupToPlainText(direct), 300) || null;
  }
  const author = item.author;
  if (isRecord(author)) {
    const name = textValue(author.name);
    return name === null ? null : truncate(stripMarkupToPlainText(name), 300) || null;
  }
  return null;
}

function parseItem(
  rawItem: unknown,
  source: SourceRegistryEntry,
  discoveredAt: string,
  baseUrl: string,
): ArticleInput {
  if (!isRecord(rawItem)) {
    throw new Error("항목이 XML 객체가 아닙니다.");
  }

  const rawTitle = firstText(rawItem, ["title"]);
  const title = rawTitle === null
    ? ""
    : truncate(stripMarkupToPlainText(rawTitle), 500);
  const originalUrl = resolveArticleLink(rawItem, baseUrl) ?? "";
  const publication = parsePublicationTimestamp(rawItem);
  const externalId = firstText(rawItem, ["guid", "id"]);
  const rawExcerpt = firstText(rawItem, ["description", "summary"]);
  const excerpt = rawExcerpt === null
    ? null
    : truncate(preferredExcerpt(rawExcerpt, source), 800) || null;

  if (!fetchableSourceUrlSchema.safeParse(originalUrl).success) {
    throw new Error("유효한 HTTPS 원문 링크가 없습니다.");
  }

  return articleInputSchema.parse({
    sourceId: source.sourceId,
    externalId:
      externalId === null ? null : truncate(stripMarkupToPlainText(externalId), 512),
    originalUrl,
    title,
    excerpt,
    author: parseAuthor(rawItem),
    publisher: source.name,
    publishedAt: publication?.timestamp ?? "",
    publishedAtPrecision: publication?.precision,
    discoveredAt,
  });
}

function extractFeedItems(document: unknown): unknown[] | null {
  if (!isRecord(document)) {
    return null;
  }

  const rss = document.rss;
  if (isRecord(rss) && isRecord(rss.channel)) {
    return asArray(rss.channel.item);
  }

  const rdf = document["rdf:RDF"];
  if (isRecord(rdf)) {
    return asArray(rdf.item);
  }

  const feed = document.feed;
  if (isRecord(feed)) {
    return asArray(feed.entry);
  }

  return null;
}

export function parseRssFeed(
  xml: string,
  source: SourceRegistryEntry,
  discoveredAt: string,
  baseUrl = source.feedUrl,
): ParsedRssFeed {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new CollectorError(
      "INVALID_SOURCE_DATA",
      "DTD나 외부 엔티티가 포함된 XML을 거부했습니다.",
    );
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new CollectorError(
      "INVALID_SOURCE_DATA",
      "RSS XML 구조가 올바르지 않습니다.",
    );
  }

  let document: unknown;
  try {
    document = xmlParser.parse(xml) as unknown;
  } catch (error) {
    throw new CollectorError(
      "INVALID_SOURCE_DATA",
      "RSS XML을 파싱하지 못했습니다.",
      { cause: error },
    );
  }

  const rawItems = extractFeedItems(document);
  if (rawItems === null) {
    throw new CollectorError(
      "INVALID_SOURCE_DATA",
      "RSS 2.0, RSS 1.0 또는 Atom 피드가 아닙니다.",
    );
  }

  const items: ArticleInput[] = [];
  const issues: CollectionIssue[] = [];
  for (
    let itemIndex = 0;
    itemIndex < Math.min(rawItems.length, source.requestPolicy.maxItemsPerRun);
    itemIndex += 1
  ) {
    try {
      items.push(
        parseItem(rawItems[itemIndex], source, discoveredAt, baseUrl),
      );
    } catch {
      issues.push({
        code: "ITEM_SKIPPED",
        message: "필수 메타데이터(제목, HTTPS 링크, 발행일)가 올바르지 않은 항목을 제외했습니다.",
        retryable: false,
        itemIndex,
      });
    }
  }

  return { items, issues };
}
