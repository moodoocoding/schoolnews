import { createHash } from "node:crypto";

import { createGoogle } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

import { publishedPostDetailSchema } from "../src/contracts";
import { parseEnvironment } from "../src/lib/config/env";
import {
  collectNaverNewsSources,
  createNaverPublisherSources,
} from "../src/pipeline/collectors";

const RUN_DATE = "2026-08-14";
const WINDOW_START = "2026-08-07T00:00:00+09:00";
const WINDOW_END = "2026-08-14T03:00:00+09:00";
const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3.5-flash-lite"] as const;

if (process.env.ALLOW_AI_SELECTED_AUGUST14 !== "true") {
  throw new Error("ALLOW_AI_SELECTED_AUGUST14_REQUIRED");
}
if (process.env.AI_SELECTED_AUGUST14_CONFIRM_DATE !== RUN_DATE) {
  throw new Error("AI_SELECTED_AUGUST14_CONFIRM_DATE_REQUIRED");
}
const environment = parseEnvironment({
  ...process.env,
  NODE_ENV: "production",
  DATASTORE_PROVIDER: "supabase",
  AUTOMATION_MODE: "disabled",
  LLM_ENABLED: "true",
});
if (
  environment.SUPABASE_URL !== "https://vrjuvozmnaufzvrzzbnd.supabase.co" ||
  environment.GOOGLE_GENERATIVE_AI_API_KEY === undefined
) {
  throw new Error("AI_EDITORIAL_CONFIGURATION_INVALID");
}

const sources = createNaverPublisherSources();
const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
const outcomes = await collectNaverNewsSources({ sources });
const candidates = [...outcomes.values()]
  .flatMap((outcome) => outcome.items)
  .filter((item) => {
    const source = sourceById.get(item.sourceId);
    return (
      source?.sourceRole === "independent" &&
      item.excerpt !== null &&
      item.publishedAt >= new Date(WINDOW_START).toISOString() &&
      item.publishedAt < new Date(WINDOW_END).toISOString()
    );
  })
  .map((item, index) => ({
    candidateId: `candidate-${index + 1}`,
    sourceId: item.sourceId,
    publisher: item.publisher,
    publisherGroupId: sourceById.get(item.sourceId)!.publisherGroupId,
    title: item.title,
    publishedAt: item.publishedAt,
    url: item.originalUrl,
    summary: item.excerpt!,
  }));
if (candidates.length < 2) throw new Error("NOT_ENOUGH_CANDIDATES");

const selectionSchema = z.object({
  selectedCandidateIds: z.array(z.string()).min(2).max(3),
  title: z.string().min(1).max(36),
  summary: z.string().min(1).max(100),
  oneLineSummary: z.string().min(1).max(180),
  paragraphs: z.array(z.string().min(80).max(280)).length(3),
  question: z.string().min(1).max(180),
});

const prompt = [
  "당신은 국내 AI·디지털 기술이 교육과 사회에 던지는 생각거리를 쓰는 편집자입니다.",
  "아래는 2026-08-07 00:00부터 2026-08-14 03:00 KST 직전까지 네이버 뉴스 검색 API가 반환한 국내 기사 제목과 공식 요약입니다.",
  "후보 전체를 비교해 서로 다른 언론사 2~3곳이 다룬 하나의 공통 주제를 직접 선택하세요.",
  "단순 행사·홍보·제품 출시보다 교사와 독자가 AI·디지털 변화의 의미를 고민할 수 있는 주제를 우선하세요.",
  "선택하지 않은 후보의 사실을 쓰지 말고, 선택한 요약이 말하지 않은 수치·사건·인과관계를 만들지 마세요.",
  "본문은 한국어 3문단이며 전체 약 450~600자로, 사실 요약→의미와 긴장→독자에게 남는 질문의 흐름으로 작성하세요.",
  "수업 방법을 억지로 제안하지 말고 AI·디지털 기반 교육에 대한 생각할 거리를 만드세요.",
  JSON.stringify(candidates),
].join("\n\n");

let generated:
  | { output: z.infer<typeof selectionSchema>; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; response: { id?: string }; finishReason?: string; modelId: string }
  | undefined;
let lastError: unknown;
for (const modelId of MODEL_CHAIN) {
  try {
    const google = createGoogle({ apiKey: environment.GOOGLE_GENERATIVE_AI_API_KEY });
    const result = await generateText({
      model: google(modelId),
      instructions: "기사 후보 선택과 글 작성을 동시에 수행하고 지정된 JSON 구조만 반환하세요.",
      prompt,
      output: Output.object({ schema: selectionSchema }),
      maxOutputTokens: 2_000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45_000),
    });
    generated = { ...result, output: result.output, modelId };
    break;
  } catch (error) {
    lastError = error;
  }
}
if (!generated) throw lastError;

const selectedIds = new Set(generated.output.selectedCandidateIds);
const selected = candidates.filter((candidate) => selectedIds.has(candidate.candidateId));
if (
  selected.length !== selectedIds.size ||
  selected.length < 2 ||
  new Set(selected.map((candidate) => candidate.publisherGroupId)).size !== selected.length
) {
  throw new Error("AI_SELECTED_SOURCES_INVALID");
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const evidence = selected.map((candidate) => ({
  id: `ai-editorial-evidence-${sha(candidate.url).slice(0, 20)}`,
  sourceId: candidate.sourceId,
  articleId: `ai-editorial-article-${sha(candidate.url).slice(0, 20)}`,
  publisher: candidate.publisher,
  publisherGroupId: candidate.publisherGroupId,
  provenanceGroupKey: `naver-search:${candidate.publisherGroupId}:${sha(candidate.url).slice(0, 16)}`,
  title: candidate.title,
  url: candidate.url,
  publishedAt: candidate.publishedAt,
  passage: candidate.summary,
  canonicalUrlHash: sha(candidate.url),
  contentFingerprint: sha(`${candidate.publisherGroupId}\n${candidate.title}`),
  passageHash: sha(candidate.summary),
}));
const evidenceIds = evidence.map((item) => item.id);
const post = publishedPostDetailSchema.parse({
  id: `post-20260814-${sha(generated.output.title).slice(0, 16)}`,
  slug: `ai-digital-editorial-2026-08-14-${sha(generated.output.title).slice(0, 8)}`,
  status: "published",
  publicationDateKst: RUN_DATE,
  publishedAt: "2026-08-14T03:00:00+09:00",
  modifiedAt: "2026-08-14T03:00:00+09:00",
  title: generated.output.title,
  summary: generated.output.summary,
  visual: { kind: "pattern", seed: sha(generated.output.title), templateVersion: "gallery-pattern-v2-calm" },
  oneLineSummary: { text: generated.output.oneLineSummary, sourceIds: evidenceIds },
  body: generated.output.paragraphs.map((text) => ({ claims: [{ text, sourceIds: evidenceIds }] })),
  questions: [generated.output.question],
  sources: evidence.map((item) => ({
    id: item.id,
    title: item.title,
    publisher: item.publisher,
    originalUrl: item.url,
    publishedDate: item.publishedAt.slice(0, 10),
  })),
});
const audit = {
  providerId: "google-gemini",
  modelId: generated.modelId,
  responseId: generated.response.id ?? null,
  finishReason: generated.finishReason ?? null,
  usage: generated.usage,
  candidateCount: candidates.length,
  selectedCandidateIds: [...selectedIds],
  windowStartKst: WINDOW_START,
  windowEndKst: WINDOW_END,
};
const response = await fetch(`${environment.SUPABASE_URL}/rest/v1/rpc/publish_ai_selected_august14`, {
  method: "POST",
  headers: {
    apikey: environment.SUPABASE_SECRET_KEY!,
    authorization: `Bearer ${environment.SUPABASE_SECRET_KEY!}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ p_post: post, p_sources: evidence, p_ai_audit: audit }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`AI_EDITORIAL_PUBLISH_FAILED_${response.status}`);
const published = publishedPostDetailSchema.parse(await response.json());
console.log(JSON.stringify({ published: true, date: published.publicationDateKst,
  slug: published.slug, modelId: generated.modelId, candidateCount: candidates.length,
  selected: selected.map((item) => ({ publisher: item.publisher, title: item.title })) }));
