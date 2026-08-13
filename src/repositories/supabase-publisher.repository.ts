import { z } from "zod";

import {
  identifierSchema,
  publicationDateKstSchema,
  publishedPostDetailSchema,
  qualityResultSchema,
  type PublishedPostDetail,
  type QualityResult,
} from "../contracts";

export const SUPABASE_PUBLISH_RPC_NAME = "publish_post" as const;
export const SUPABASE_BACKFILL_PUBLISH_RPC_NAME =
  "publish_backfill_post" as const;
export type SupabasePublishRpcName =
  | typeof SUPABASE_PUBLISH_RPC_NAME
  | typeof SUPABASE_BACKFILL_PUBLISH_RPC_NAME;

export type SupabasePublisherRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

export type SupabasePublisherRpcResult = Readonly<{
  data: unknown;
  error: SupabasePublisherRpcError | null;
}>;

export interface SupabasePublisherRpcDataSource {
  rpc(
    functionName: SupabasePublishRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublisherRpcResult>;
}

const publishInputSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
    validationOutputReference: z.string().trim().min(1).max(500),
    revisionId: identifierSchema,
    topicId: identifierSchema,
    post: publishedPostDetailSchema,
    qualityResult: qualityResultSchema,
  })
  .strict();

export type SupabasePublishInput = Readonly<{
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
  validationOutputReference: string;
  revisionId: string;
  topicId: string;
  post: PublishedPostDetail;
  qualityResult: QualityResult;
}>;

export type SupabasePublishReceipt = Readonly<{
  runDate: string;
  runId: string;
  revisionId: string;
  validationOutputReference: string;
  post: PublishedPostDetail;
}>;

export const supabasePublisherErrorCodes = [
  "INVALID_PUBLISH_INPUT",
  "QUALITY_REJECTED",
  "LEASE_NOT_FOUND",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "RUN_ID_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "LEASE_EXPIRED",
  "ACTIVE_JOURNAL_REQUIRED",
  "INVALID_SOURCE_DATA",
  "DUPLICATE_PUBLICATION_DATE",
  "BACKFILL_DATE_NOT_ALLOWED",
  "SLUG_CONFLICT",
  "RPC_PERMISSION_DENIED",
  "PUBLISH_TIMEOUT_AMBIGUOUS",
  "PUBLISH_STATE_AMBIGUOUS",
] as const;

export type SupabasePublisherErrorCode =
  (typeof supabasePublisherErrorCodes)[number];

const domainErrorCodes = new Set<SupabasePublisherErrorCode>([
  "LEASE_NOT_FOUND",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "RUN_ID_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "LEASE_EXPIRED",
  "ACTIVE_JOURNAL_REQUIRED",
  "INVALID_SOURCE_DATA",
  "DUPLICATE_PUBLICATION_DATE",
  "BACKFILL_DATE_NOT_ALLOWED",
  "SLUG_CONFLICT",
]);

const permissionErrorCodes = new Set([
  "401",
  "403",
  "42501",
  "PGRST301",
  "PGRST302",
]);

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

export class SupabasePublisherError extends Error {
  readonly retryable = false;
  readonly ambiguous: boolean;

  constructor(readonly code: SupabasePublisherErrorCode) {
    super(code);
    this.name = "SupabasePublisherError";
    this.ambiguous =
      code === "PUBLISH_TIMEOUT_AMBIGUOUS" ||
      code === "PUBLISH_STATE_AMBIGUOUS";
  }
}

function parseInput(input: SupabasePublishInput): z.infer<typeof publishInputSchema> {
  const parsed = publishInputSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.post.publicationDateKst !== parsed.data.runDate ||
    parsed.data.post.sources.some((source) => source.publishedDate === null)
  ) {
    throw new SupabasePublisherError("INVALID_PUBLISH_INPUT");
  }
  if (!parsed.data.qualityResult.passed) {
    throw new SupabasePublisherError("QUALITY_REJECTED");
  }
  return structuredClone(parsed.data);
}

function mappedRpcError(error: SupabasePublisherRpcError): SupabasePublisherError {
  const domainCandidate = [error.code, error.message].find(
    (candidate): candidate is SupabasePublisherErrorCode =>
      typeof candidate === "string" &&
      domainErrorCodes.has(candidate as SupabasePublisherErrorCode),
  );
  if (domainCandidate !== undefined) {
    return new SupabasePublisherError(domainCandidate);
  }
  if (error.code === "PUBLISH_TIMEOUT_AMBIGUOUS") {
    return new SupabasePublisherError("PUBLISH_TIMEOUT_AMBIGUOUS");
  }
  if (error.code !== undefined && permissionErrorCodes.has(error.code)) {
    return new SupabasePublisherError("RPC_PERMISSION_DENIED");
  }
  return new SupabasePublisherError("PUBLISH_STATE_AMBIGUOUS");
}

function samePublishedContent(
  expected: PublishedPostDetail,
  actual: PublishedPostDetail,
): boolean {
  const withoutServerTimes = (post: PublishedPostDetail) => ({
    id: post.id,
    slug: post.slug,
    publicationDateKst: post.publicationDateKst,
    title: post.title,
    summary: post.summary,
    visual: post.visual,
    oneLineSummary: post.oneLineSummary,
    body: post.body,
    questions: post.questions,
    sources: post.sources,
  });
  return (
    JSON.stringify(withoutServerTimes(expected)) ===
    JSON.stringify(withoutServerTimes(actual))
  );
}

/**
 * Server-only publishing boundary. The database RPC owns the transaction;
 * this adapter never retries a call whose commit state may be unknown.
 */
export class SupabasePublisherRepository {
  constructor(
    private readonly dataSource: SupabasePublisherRpcDataSource,
    private readonly rpcName: SupabasePublishRpcName = SUPABASE_PUBLISH_RPC_NAME,
  ) {}

  async publish(input: SupabasePublishInput): Promise<SupabasePublishReceipt> {
    const parsed = parseInput(input);
    let result: SupabasePublisherRpcResult;
    try {
      result = await this.dataSource.rpc(this.rpcName, {
        p_run_date: parsed.runDate,
        p_run_id: parsed.runId,
        p_lease_token: parsed.leaseToken,
        p_fence: parsed.fence,
        p_expected_revision: parsed.expectedRevision,
        p_validation_output_reference: parsed.validationOutputReference,
        p_revision_id: parsed.revisionId,
        p_topic_id: parsed.topicId,
        p_post: parsed.post,
      });
    } catch {
      throw new SupabasePublisherError("PUBLISH_STATE_AMBIGUOUS");
    }

    const parsedResult = rpcResultSchema.safeParse(result);
    if (!parsedResult.success) {
      throw new SupabasePublisherError("PUBLISH_STATE_AMBIGUOUS");
    }
    if (parsedResult.data.error !== null) {
      throw mappedRpcError(parsedResult.data.error);
    }

    const returnedPost = publishedPostDetailSchema.safeParse(
      parsedResult.data.data,
    );
    if (
      !returnedPost.success ||
      returnedPost.data.publicationDateKst !== parsed.runDate ||
      !samePublishedContent(parsed.post, returnedPost.data)
    ) {
      throw new SupabasePublisherError("PUBLISH_STATE_AMBIGUOUS");
    }

    return {
      runDate: parsed.runDate,
      runId: parsed.runId,
      revisionId: parsed.revisionId,
      validationOutputReference: parsed.validationOutputReference,
      post: structuredClone(returnedPost.data),
    };
  }
}
