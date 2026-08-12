import { z } from "zod";

const graphemeSegmenter = new Intl.Segmenter("ko", {
  granularity: "grapheme",
});
const kstDateFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function graphemeLength(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export function getPublicationDateKst(isoTimestamp: string): string {
  const parts = Object.fromEntries(
    kstDateFormatter
      .formatToParts(new Date(isoTimestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function graphemeTextSchema(options: {
  label: string;
  min?: number;
  max: number;
}) {
  const { label, min = 1, max } = options;

  return z
    .string()
    .trim()
    .min(1, `${label}은(는) 비어 있을 수 없습니다.`)
    .refine((value) => graphemeLength(value) >= min, {
      message: `${label}은(는) 최소 ${min}자여야 합니다.`,
    })
    .refine((value) => graphemeLength(value) <= max, {
      message: `${label}은(는) 최대 ${max}자여야 합니다.`,
    });
}

export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const publicationDateKstSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "유효한 KST 기준 날짜여야 합니다.");

export const isoTimestampSchema = z.iso.datetime({
  offset: true,
  error: "시간대가 포함된 유효한 RFC 3339 시각이어야 합니다.",
});

export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "HTTPS URL만 허용합니다.",
  });

export const opaqueCursorSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const nullableShortTextSchema = z.string().trim().max(2_000).nullable();
