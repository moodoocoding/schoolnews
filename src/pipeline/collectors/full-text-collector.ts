import { createHash } from "node:crypto";

import { load } from "cheerio";
import robotsParser from "robots-parser";

import { normalizedArticleSchema, type NormalizedArticle } from "../../contracts";
import {
  assertSafeRequestUrl,
  lookupPublicAddresses,
  type DnsLookup,
} from "./network-safety";
import {
  FULL_TEXT_COLLECTOR_USER_AGENT,
  fullTextSourcePolicySchema,
  FULL_TEXT_SOURCE_POLICIES,
  type FullTextSourcePolicy,
} from "./full-text-policy";

const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FullTextCollectionErrorCode =
  | "FULL_TEXT_NOT_ALLOWED"
  | "UNSAFE_SOURCE_URL"
  | "ROBOTS_DISALLOWED"
  | "AUTHENTICATION_REQUIRED"
  | "PAYWALL_DETECTED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "REDIRECT_LIMIT_EXCEEDED"
  | "ARTICLE_BODY_NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "COLLECTION_TIMEOUT";

export class FullTextCollectionError extends Error {
  constructor(readonly code: FullTextCollectionErrorCode) {
    super(code);
    this.name = "FullTextCollectionError";
  }
}

export type CollectedArticleFullText = Readonly<{
  articleId: string;
  sourceId: string;
  canonicalUrl: string;
  finalUrl: string;
  bodyText: string;
  bodySha256: string;
  responseBytes: number;
  collectedAt: string;
  retentionUntil: string;
  permission: Readonly<{
    accessReviewedAt: string;
    policyReferenceUrls: readonly string[];
    fullTextUseAllowed: true;
  }>;
}>;

type FetchLike = typeof globalThis.fetch;

export type FullTextCollectorDependencies = Readonly<{
  fetch?: FetchLike;
  lookup?: DnsLookup;
  now?: () => Date;
  signal?: AbortSignal;
  userAgent?: string;
}>;

async function readLimitedBytes(
  response: Response,
  maximumBytes: number,
): Promise<{ text: string; byteLength: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new FullTextCollectionError("RESPONSE_TOO_LARGE");
  }
  if (!response.body) return { text: "", byteLength: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      throw new FullTextCollectionError("RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), byteLength };
  } catch {
    throw new FullTextCollectionError("UNSUPPORTED_CONTENT_TYPE");
  }
}

const NAVER_BODY_ELEMENT_IDS = [
  "dic_area",
  "newsct_article",
  "articleBodyContents",
] as const;

export function extractNaverHostedArticleBodyText(
  html: string,
  maximumCharacters: number,
): string {
  const $ = load(html, { xml: false });
  const article = NAVER_BODY_ELEMENT_IDS
    .map((id) => $(`#${id}`).first())
    .find((candidate) => candidate.length > 0);
  if (!article) throw new FullTextCollectionError("ARTICLE_BODY_NOT_FOUND");
  article.find("script,style,nav,aside,form,noscript").remove();
  article.find("br,p,div,section,h1,h2,h3,h4,h5,h6,li,blockquote").each((_, element) => {
    $(element).append("\n");
  });
  const text = article
    .text()
    .normalize("NFKC")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 1_000) throw new FullTextCollectionError("ARTICLE_BODY_NOT_FOUND");
  if (text.length > maximumCharacters) {
    throw new FullTextCollectionError("RESPONSE_TOO_LARGE");
  }
  return text;
}

function rejectGatedHtml(html: string): void {
  const lower = html.toLowerCase();
  if (
    /<(?:form)[^>]+(?:login|signin)|로그인\s*(?:후|필요)|회원만\s*이용/.test(lower)
  ) {
    throw new FullTextCollectionError("AUTHENTICATION_REQUIRED");
  }
  if (
    /(?:paywall|subscribe-wall|premium-content)|유료\s*(?:회원|구독)|구독자만/.test(lower)
  ) {
    throw new FullTextCollectionError("PAYWALL_DETECTED");
  }
}

async function safeFetch(
  urlValue: string,
  policy: FullTextSourcePolicy,
  dependencies: Required<Pick<FullTextCollectorDependencies, "fetch" | "lookup" | "userAgent">>,
  signal: AbortSignal,
  accept: string,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = urlValue;
  for (let redirects = 0; redirects <= policy.maxRedirects; redirects += 1) {
    const safeUrl = await assertSafeRequestUrl(current, dependencies.lookup, signal);
    if (!policy.allowedOrigins.includes(safeUrl.origin)) {
      throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
    }
    let response: Response;
    try {
      response = await dependencies.fetch(safeUrl, {
        method: "GET",
        headers: { Accept: accept, "User-Agent": dependencies.userAgent },
        redirect: "manual",
        signal,
      });
    } catch {
      throw new FullTextCollectionError(
        signal.aborted ? "COLLECTION_TIMEOUT" : "SOURCE_UNAVAILABLE",
      );
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new FullTextCollectionError("SOURCE_UNAVAILABLE");
      if (redirects === policy.maxRedirects) {
        throw new FullTextCollectionError("REDIRECT_LIMIT_EXCEEDED");
      }
      current = new URL(location, safeUrl).toString();
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new FullTextCollectionError("AUTHENTICATION_REQUIRED");
    }
    if (!response.ok) throw new FullTextCollectionError("SOURCE_UNAVAILABLE");
    return { response, finalUrl: safeUrl };
  }
  throw new FullTextCollectionError("REDIRECT_LIMIT_EXCEEDED");
}

export async function collectNaverHostedArticleFullText(
  input: Readonly<{
    article: NormalizedArticle;
    hostedArticleUrl?: string;
    /** Test-only registry override. Production callers use the reviewed registry. */
    policyRegistry?: ReadonlyMap<string, FullTextSourcePolicy>;
  }>,
  dependencies: FullTextCollectorDependencies = {},
): Promise<CollectedArticleFullText> {
  const article = normalizedArticleSchema.parse(input.article);
  const policyRegistry = input.policyRegistry ?? FULL_TEXT_SOURCE_POLICIES;
  const registeredPolicy = policyRegistry.get(article.sourceId);
  if (!registeredPolicy) {
    throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
  }
  const policy = fullTextSourcePolicySchema.parse(registeredPolicy);
  if (article.sourceId !== policy.sourceId || !policy.fullTextUseAllowed) {
    throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
  }
  let hostedArticleUrl: URL;
  try {
    hostedArticleUrl = new URL(
      input.hostedArticleUrl ?? article.hostedArticleUrl ?? "",
    );
  } catch {
    throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
  }
  if (
    hostedArticleUrl.protocol !== "https:" ||
    hostedArticleUrl.hostname !== "n.news.naver.com" ||
    !/^\/(?:mnews\/)?article\//.test(hostedArticleUrl.pathname) ||
    hostedArticleUrl.username !== "" ||
    hostedArticleUrl.password !== "" ||
    hostedArticleUrl.hash !== ""
  ) {
    throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
  const abort = () => controller.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  const required = {
    fetch: dependencies.fetch ?? fetch,
    lookup: dependencies.lookup ?? lookupPublicAddresses,
    userAgent: dependencies.userAgent ?? FULL_TEXT_COLLECTOR_USER_AGENT,
  };
  try {
    if (!policy.allowedOrigins.includes(hostedArticleUrl.origin)) {
      throw new FullTextCollectionError("FULL_TEXT_NOT_ALLOWED");
    }
    const robotsUrl = new URL("/robots.txt", hostedArticleUrl.origin).toString();
    const robotsResponse = await safeFetch(
      robotsUrl,
      policy,
      required,
      controller.signal,
      "text/plain",
    );
    const robotsContentType = robotsResponse.response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (robotsContentType !== "text/plain") {
      throw new FullTextCollectionError("ROBOTS_DISALLOWED");
    }
    const robots = await readLimitedBytes(robotsResponse.response, 128_000);
    if (!/^\s*(?:#.*\n\s*)*user-agent\s*:/imu.test(robots.text)) {
      throw new FullTextCollectionError("ROBOTS_DISALLOWED");
    }
    const robotsRules = robotsParser(robotsUrl, robots.text);
    if (
      robotsRules.isAllowed(hostedArticleUrl.toString(), required.userAgent) !==
      true
    ) {
      throw new FullTextCollectionError("ROBOTS_DISALLOWED");
    }
    const fetched = await safeFetch(
      hostedArticleUrl.toString(),
      policy,
      required,
      controller.signal,
      "text/html,application/xhtml+xml;q=0.9",
    );
    const contentType = fetched.response.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType || !HTML_CONTENT_TYPES.has(contentType)) {
      throw new FullTextCollectionError("UNSUPPORTED_CONTENT_TYPE");
    }
    if (/attachment/i.test(fetched.response.headers.get("content-disposition") ?? "")) {
      throw new FullTextCollectionError("UNSUPPORTED_CONTENT_TYPE");
    }
    const payload = await readLimitedBytes(fetched.response, policy.maxResponseBytes);
    rejectGatedHtml(payload.text);
    const bodyText = extractNaverHostedArticleBodyText(
      payload.text,
      policy.maxTextCharacters,
    );
    const collectedAt = (dependencies.now ?? (() => new Date()))();
    const retentionUntil = new Date(
      collectedAt.getTime() + policy.retentionDays * 86_400_000,
    );
    return {
      articleId: article.articleId,
      sourceId: article.sourceId,
      canonicalUrl: article.canonicalUrl,
      finalUrl: fetched.finalUrl.toString(),
      bodyText,
      bodySha256: createHash("sha256").update(bodyText).digest("hex"),
      responseBytes: payload.byteLength,
      collectedAt: collectedAt.toISOString(),
      retentionUntil: retentionUntil.toISOString(),
      permission: {
        accessReviewedAt: policy.accessReviewedAt,
        policyReferenceUrls: policy.policyReferenceUrls,
        fullTextUseAllowed: true,
      },
    };
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", abort);
  }
}
