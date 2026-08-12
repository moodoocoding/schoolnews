import { createHash } from "node:crypto";

import { z } from "zod";

import {
  evidenceItemSchema,
  identifierSchema,
  normalizedArticleSchema,
  publicationDateKstSchema,
  sha256Schema,
  sourceRegistryEntrySchema,
  topicCandidateSchema,
  type EvidenceItem,
  type NormalizedArticle,
  type SourceRegistryEntry,
  type TopicCandidate,
} from "../contracts";

export const SUPABASE_CONTENT_PERSISTENCE_RPC_NAMES = [
  "persist_collected_content",
  "persist_selected_topic",
  "persist_empty_topic_selection",
] as const;
export type SupabaseContentPersistenceRpcName =
  (typeof SUPABASE_CONTENT_PERSISTENCE_RPC_NAMES)[number];

export type SupabaseContentPersistenceRpcError = Readonly<{
  code?: string;
  message?: string;
}>;
export type SupabaseContentPersistenceRpcResult = Readonly<{
  data: unknown;
  error: SupabaseContentPersistenceRpcError | null;
}>;
export interface SupabaseContentPersistenceRpcDataSource {
  rpc(
    functionName: SupabaseContentPersistenceRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseContentPersistenceRpcResult>;
}

const authorizationSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

const artifactDescriptorSchema = z
  .object({
    outputReference: z.string().trim().min(1).max(500),
    payloadFingerprint: sha256Schema,
    configurationFingerprint: sha256Schema,
    payload: z.json(),
  })
  .strict();

const articleIdMappingSchema = z
  .object({ inputArticleId: identifierSchema, storedArticleId: identifierSchema })
  .strict();
const evidenceIdMappingSchema = z
  .object({ inputEvidenceId: identifierSchema, storedEvidenceId: identifierSchema })
  .strict();

const collectInputSchema = authorizationSchema
  .extend({
    sources: z.array(sourceRegistryEntrySchema).min(1),
    articles: z.array(normalizedArticleSchema),
    evidenceItems: z.array(evidenceItemSchema),
    artifact: artifactDescriptorSchema,
  })
  .strict();

const topicInputSchema = authorizationSchema
  .extend({
    topicTitle: z.string().trim().min(1).max(500),
    candidate: topicCandidateSchema,
    articles: z.array(normalizedArticleSchema).min(1),
    articleIdMapping: z.array(articleIdMappingSchema).min(1),
    evidenceIdMapping: z.array(evidenceIdMappingSchema).min(1),
    collectOutputReference: z.string().trim().min(1).max(500),
    artifact: artifactDescriptorSchema,
  })
  .strict();

export type SupabaseCollectPersistenceInput = Readonly<{
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
  sources: readonly SourceRegistryEntry[];
  articles: readonly NormalizedArticle[];
  evidenceItems: readonly EvidenceItem[];
  artifact: Readonly<{
    outputReference: string;
    payloadFingerprint: string;
    configurationFingerprint: string;
    payload: unknown;
  }>;
}>;

export type SupabaseArticleIdMapping = z.infer<typeof articleIdMappingSchema>;
export type SupabaseEvidenceIdMapping = z.infer<typeof evidenceIdMappingSchema>;
export type SupabaseCollectPersistenceReceipt = Readonly<{
  created: boolean;
  articleIdMapping: SupabaseArticleIdMapping[];
  evidenceIdMapping: SupabaseEvidenceIdMapping[];
  artifactOutputReference: string;
}>;

export type SupabaseTopicPersistenceInput = Readonly<{
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
  topicTitle: string;
  candidate: TopicCandidate;
  articles: readonly NormalizedArticle[];
  articleIdMapping: readonly SupabaseArticleIdMapping[];
  evidenceIdMapping: readonly SupabaseEvidenceIdMapping[];
  collectOutputReference: string;
  artifact: Readonly<{
    outputReference: string;
    payloadFingerprint: string;
    configurationFingerprint: string;
    payload: unknown;
  }>;
}>;

export type SupabaseTopicPersistenceReceipt = Readonly<{
  created: boolean;
  topicId: string;
  topicTitle: string;
  articleIds: string[];
  evidenceIds: string[];
  artifactOutputReference: string;
}>;

export type SupabaseEmptyTopicPersistenceInput = Readonly<{
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
  collectOutputReference: string;
  artifact: Readonly<{
    outputReference: string;
    payloadFingerprint: string;
    configurationFingerprint: string;
    payload: unknown;
  }>;
}>;
export type SupabaseEmptyTopicPersistenceReceipt = Readonly<{
  created: boolean;
  outcome: "none";
  artifactOutputReference: string;
}>;

export const supabaseContentPersistenceErrorCodes = [
  "INVALID_CONTENT_INPUT",
  "LEASE_NOT_FOUND",
  "RUN_ID_MISMATCH",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "LEASE_EXPIRED",
  "ACTIVE_JOURNAL_REQUIRED",
  "UNKNOWN_SOURCE",
  "SOURCE_IDENTITY_CONFLICT",
  "DUPLICATE_CONTENT_IDENTITY",
  "ARTICLE_IDENTITY_CONFLICT",
  "EVIDENCE_IDENTITY_CONFLICT",
  "MISSING_CONTENT_LINEAGE",
  "OUTPUT_CONFLICT",
  "TOPIC_TITLE_MISMATCH",
  "TOPIC_IDENTITY_CONFLICT",
  "INVALID_CONTENT_PAYLOAD",
  "RPC_PERMISSION_DENIED",
  "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS",
  "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
] as const;
export type SupabaseContentPersistenceErrorCode =
  (typeof supabaseContentPersistenceErrorCodes)[number];

const domainErrorCodes = new Set<SupabaseContentPersistenceErrorCode>(
  supabaseContentPersistenceErrorCodes.filter(
    (code) =>
      ![
        "INVALID_CONTENT_INPUT",
        "RPC_PERMISSION_DENIED",
        "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS",
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      ].includes(code),
  ),
);
const permissionCodes = new Set(["401", "403", "42501", "PGRST301", "PGRST302"]);

const rpcResultSchema = z
  .object({
    data: z.unknown(),
    error: z
      .object({
        code: z.string().max(128).optional(),
        message: z.string().max(256).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const collectReceiptSchema = z
  .object({
    created: z.boolean(),
    articleIdMapping: z.array(articleIdMappingSchema),
    evidenceIdMapping: z.array(evidenceIdMappingSchema),
    artifactOutputReference: z.string().trim().min(1).max(500),
  })
  .strict();
const topicReceiptSchema = z
  .object({
    created: z.boolean(),
    topicId: identifierSchema,
    topicTitle: z.string().trim().min(1).max(500),
    articleIds: z.array(identifierSchema).min(1),
    evidenceIds: z.array(identifierSchema).min(1),
    artifactOutputReference: z.string().trim().min(1).max(500),
  })
  .strict();
const emptyTopicInputSchema = authorizationSchema
  .extend({
    collectOutputReference: z.string().trim().min(1).max(500),
    artifact: artifactDescriptorSchema,
  })
  .strict();
const emptyTopicReceiptSchema = z
  .object({
    created: z.boolean(),
    outcome: z.literal("none"),
    artifactOutputReference: z.string().trim().min(1).max(500),
  })
  .strict();

export class SupabaseContentPersistenceError extends Error {
  readonly retryable = false;
  readonly ambiguous: boolean;

  constructor(readonly code: SupabaseContentPersistenceErrorCode) {
    super(code);
    this.name = "SupabaseContentPersistenceError";
    this.ambiguous = code.endsWith("_AMBIGUOUS");
  }
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | {
  [key: string]: CanonicalJson;
};

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function fingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)), "utf8")
    .digest("hex");
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactIds(expected: readonly string[], actual: readonly string[]): boolean {
  return (
    expected.length === actual.length &&
    [...expected].sort().every((value, index) => value === [...actual].sort()[index])
  );
}

function parseArtifactPayload(payload: unknown, kind: "news_ingestion" | "topic_selection") {
  const parsed = z
    .object({ kind: z.literal(kind), value: z.record(z.string(), z.json()) })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
  return parsed.data;
}

function assertFingerprint(descriptor: z.infer<typeof artifactDescriptorSchema>): void {
  if (fingerprint(descriptor.payload) !== descriptor.payloadFingerprint) {
    throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
  }
}

function mappedRpcError(error: SupabaseContentPersistenceRpcError) {
  const candidate = [error.code, error.message].find(
    (value): value is SupabaseContentPersistenceErrorCode =>
      typeof value === "string" &&
      domainErrorCodes.has(value as SupabaseContentPersistenceErrorCode),
  );
  if (candidate) return new SupabaseContentPersistenceError(candidate);
  if (error.code === "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS") {
    return new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS");
  }
  if (error.code && permissionCodes.has(error.code)) {
    return new SupabaseContentPersistenceError("RPC_PERMISSION_DENIED");
  }
  return new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_STATE_AMBIGUOUS");
}

function validateCollectRelations(input: z.infer<typeof collectInputSchema>): void {
  const sourceById = new Map(input.sources.map((source) => [source.sourceId, source]));
  if (
    !unique(input.sources.map((source) => source.sourceId)) ||
    input.sources.some((source) => !source.enabled || source.accessStatus !== "allowed") ||
    !unique(input.articles.map((article) => article.articleId)) ||
    !unique(input.articles.map((article) => article.canonicalUrlHash)) ||
    !unique(input.articles.map((article) => article.contentFingerprint)) ||
    !unique(input.evidenceItems.map((item) => item.evidenceId))
  ) {
    throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
  }
  const articleById = new Map(input.articles.map((article) => [article.articleId, article]));
  for (const article of input.articles) {
    const source = sourceById.get(article.sourceId);
    if (
      !source ||
      article.publisherGroupId !== source.publisherGroupId ||
      article.originType !== source.originType ||
      !article.provenanceGroupKey.startsWith(`${source.provenanceGroupPrefix}:`)
    ) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
  }
  for (const evidence of input.evidenceItems) {
    const article = articleById.get(evidence.articleId);
    const source = sourceById.get(evidence.sourceId);
    if (
      !article ||
      !source ||
      article.sourceId !== evidence.sourceId ||
      evidence.publisherGroupId !== article.publisherGroupId ||
      evidence.provenanceGroupKey !== article.provenanceGroupKey ||
      evidence.title !== article.title ||
      evidence.url !== article.canonicalUrl ||
      evidence.sourceName !== source.name ||
      evidence.sourceRole !== source.sourceRole ||
      evidence.sourceType !== source.sourceType ||
      evidence.publishedAt !== article.publishedAt ||
      evidence.publishedAtPrecision !== article.publishedAtPrecision ||
      (evidence.authority === "public_authority_direct_fact" &&
        (source.authority !== "public_authority_direct_fact" ||
          evidence.locator === "RSS 요약"))
    ) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
  }
  const payload = parseArtifactPayload(input.artifact.payload, "news_ingestion");
  if (
    !sameJson(payload.value.articles, input.articles) ||
    !sameJson(payload.value.evidenceItems, input.evidenceItems)
  ) {
    throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
  }
  assertFingerprint(input.artifact);
}

function validateMappings(
  articleIds: readonly string[],
  evidenceIds: readonly string[],
  articleMapping: readonly SupabaseArticleIdMapping[],
  evidenceMapping: readonly SupabaseEvidenceIdMapping[],
): void {
  if (!mappingsAreExact(articleIds, evidenceIds, articleMapping, evidenceMapping)) {
    throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
  }
}

function mappingsAreExact(
  articleIds: readonly string[],
  evidenceIds: readonly string[],
  articleMapping: readonly SupabaseArticleIdMapping[],
  evidenceMapping: readonly SupabaseEvidenceIdMapping[],
): boolean {
  return !(
    !exactIds(articleIds, articleMapping.map((item) => item.inputArticleId)) ||
    !exactIds(evidenceIds, evidenceMapping.map((item) => item.inputEvidenceId)) ||
    articleMapping.some((item) => item.inputArticleId !== item.storedArticleId) ||
    evidenceMapping.some((item) => item.inputEvidenceId !== item.storedEvidenceId)
  );
}

async function callRpc(
  dataSource: SupabaseContentPersistenceRpcDataSource,
  name: SupabaseContentPersistenceRpcName,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  let result: SupabaseContentPersistenceRpcResult;
  try {
    result = await dataSource.rpc(name, parameters);
  } catch {
    throw new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_STATE_AMBIGUOUS");
  }
  const parsed = rpcResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_STATE_AMBIGUOUS");
  }
  if (parsed.data.error) throw mappedRpcError(parsed.data.error);
  return parsed.data.data;
}

/** Server-only boundary: only the two transactional public RPCs are callable. */
export class SupabaseContentPersistenceRepository {
  constructor(private readonly dataSource: SupabaseContentPersistenceRpcDataSource) {}

  async persistCollectedContent(
    input: SupabaseCollectPersistenceInput,
  ): Promise<SupabaseCollectPersistenceReceipt> {
    const parsed = collectInputSchema.safeParse(input);
    if (!parsed.success) throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    validateCollectRelations(parsed.data);
    const data = await callRpc(this.dataSource, "persist_collected_content", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_current_stage: "collect",
      p_sources: parsed.data.sources,
      p_articles: parsed.data.articles,
      p_evidence_items: parsed.data.evidenceItems,
      p_artifact_output_reference: parsed.data.artifact.outputReference,
      p_artifact_payload_fingerprint: parsed.data.artifact.payloadFingerprint,
      p_artifact_configuration_fingerprint:
        parsed.data.artifact.configurationFingerprint,
      p_artifact_payload: parsed.data.artifact.payload,
    });
    const receipt = collectReceiptSchema.safeParse(data);
    if (
      !receipt.success ||
      receipt.data.artifactOutputReference !== parsed.data.artifact.outputReference
    ) {
      throw new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_STATE_AMBIGUOUS");
    }
    if (
      !mappingsAreExact(
        parsed.data.articles.map((article) => article.articleId),
        parsed.data.evidenceItems.map((item) => item.evidenceId),
        receipt.data.articleIdMapping,
        receipt.data.evidenceIdMapping,
      )
    ) {
      throw new SupabaseContentPersistenceError(
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      );
    }
    return structuredClone(receipt.data);
  }

  async persistSelectedTopic(
    input: SupabaseTopicPersistenceInput,
  ): Promise<SupabaseTopicPersistenceReceipt> {
    const parsed = topicInputSchema.safeParse(input);
    if (!parsed.success || !parsed.data.candidate.independence.passed) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    if (parsed.data.candidate.selectionReason.length > 1_000) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    const candidateArticles = parsed.data.articles.filter((article) =>
      parsed.data.candidate.articleIds.includes(article.articleId),
    );
    if (!exactIds(parsed.data.candidate.articleIds, candidateArticles.map((a) => a.articleId))) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    const expectedTitle = [...candidateArticles].sort((left, right) => {
      const timeDifference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
      if (timeDifference !== 0) return timeDifference;
      return left.articleId < right.articleId ? -1 : left.articleId > right.articleId ? 1 : 0;
    })[0]?.title;
    if (expectedTitle !== parsed.data.topicTitle) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    validateMappings(
      parsed.data.candidate.articleIds,
      parsed.data.candidate.evidenceIds,
      parsed.data.articleIdMapping,
      parsed.data.evidenceIdMapping,
    );
    const payload = parseArtifactPayload(parsed.data.artifact.payload, "topic_selection");
    const artifactEvidence = z.array(evidenceItemSchema).safeParse(payload.value.evidenceItems);
    if (
      payload.value.outcome !== "eligible" ||
      !sameJson(payload.value.candidate, parsed.data.candidate) ||
      !artifactEvidence.success ||
      !exactIds(
        parsed.data.candidate.evidenceIds,
        artifactEvidence.data.map((item) => item.evidenceId),
      )
    ) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    assertFingerprint(parsed.data.artifact);
    const data = await callRpc(this.dataSource, "persist_selected_topic", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_current_stage: "score",
      p_topic_title: parsed.data.topicTitle,
      p_candidate: parsed.data.candidate,
      p_article_id_mapping: parsed.data.articleIdMapping,
      p_evidence_id_mapping: parsed.data.evidenceIdMapping,
      p_collect_output_reference: parsed.data.collectOutputReference,
      p_artifact_output_reference: parsed.data.artifact.outputReference,
      p_artifact_payload_fingerprint: parsed.data.artifact.payloadFingerprint,
      p_artifact_configuration_fingerprint:
        parsed.data.artifact.configurationFingerprint,
      p_artifact_payload: parsed.data.artifact.payload,
    });
    const receipt = topicReceiptSchema.safeParse(data);
    if (
      !receipt.success ||
      receipt.data.topicId !== parsed.data.candidate.topicId ||
      receipt.data.topicTitle !== parsed.data.topicTitle ||
      receipt.data.artifactOutputReference !== parsed.data.artifact.outputReference ||
      !exactIds(receipt.data.articleIds, parsed.data.candidate.articleIds) ||
      !exactIds(receipt.data.evidenceIds, parsed.data.candidate.evidenceIds)
    ) {
      throw new SupabaseContentPersistenceError("CONTENT_PERSISTENCE_STATE_AMBIGUOUS");
    }
    return structuredClone(receipt.data);
  }

  async persistEmptyTopicSelection(
    input: SupabaseEmptyTopicPersistenceInput,
  ): Promise<SupabaseEmptyTopicPersistenceReceipt> {
    const parsed = emptyTopicInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    const payload = parseArtifactPayload(parsed.data.artifact.payload, "topic_selection");
    if (
      payload.value.outcome !== "none" ||
      payload.value.candidate !== null ||
      !Array.isArray(payload.value.evidenceItems) ||
      payload.value.evidenceItems.length !== 0 ||
      Object.keys(payload.value).sort().join(",") !==
        "candidate,evidenceItems,outcome"
    ) {
      throw new SupabaseContentPersistenceError("INVALID_CONTENT_INPUT");
    }
    assertFingerprint(parsed.data.artifact);
    const data = await callRpc(this.dataSource, "persist_empty_topic_selection", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_current_stage: "score",
      p_collect_output_reference: parsed.data.collectOutputReference,
      p_artifact_output_reference: parsed.data.artifact.outputReference,
      p_artifact_payload_fingerprint: parsed.data.artifact.payloadFingerprint,
      p_artifact_configuration_fingerprint:
        parsed.data.artifact.configurationFingerprint,
      p_artifact_payload: parsed.data.artifact.payload,
    });
    const receipt = emptyTopicReceiptSchema.safeParse(data);
    if (
      !receipt.success ||
      receipt.data.artifactOutputReference !== parsed.data.artifact.outputReference
    ) {
      throw new SupabaseContentPersistenceError(
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      );
    }
    return structuredClone(receipt.data);
  }
}
