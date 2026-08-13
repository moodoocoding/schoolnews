import { createHash } from "node:crypto";

import { z } from "zod";

import {
  articleModelDocumentSchema,
  identifierSchema,
  publicationDateKstSchema,
  type ArticleModelDocument,
  type EvidenceItem,
} from "../contracts";
import type { CollectedArticleFullText } from "../pipeline/collectors/full-text-collector";

export const SUPABASE_ARTICLE_FULL_TEXT_RPC_NAMES = [
  "persist_article_full_texts",
  "get_selected_article_full_texts",
  "purge_expired_article_full_texts",
] as const;
export type SupabaseArticleFullTextRpcName =
  (typeof SUPABASE_ARTICLE_FULL_TEXT_RPC_NAMES)[number];

export type SupabaseArticleFullTextRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export interface SupabaseArticleFullTextRpcDataSource {
  rpc(
    functionName: SupabaseArticleFullTextRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseArticleFullTextRpcResult>;
}

const permissionSchema = z
  .object({
    accessReviewedAt: z.string().datetime({ offset: true }),
    policyReferenceUrls: z.array(z.string().url().startsWith("https://")).min(1).max(5),
    fullTextUseAllowed: z.literal(true),
  })
  .strict();

const collectedFullTextBaseSchema = z.object({
    articleId: identifierSchema,
    sourceId: identifierSchema,
    canonicalUrl: z.string().url().startsWith("https://"),
    finalUrl: z.string().url().startsWith("https://"),
    bodyText: z.string().min(1_000).max(100_000),
    bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
    responseBytes: z.number().int().min(1).max(500_000),
    collectedAt: z.string().datetime({ offset: true }),
    retentionUntil: z.string().datetime({ offset: true }),
    permission: permissionSchema,
  }).strict();

const collectedFullTextSchema = collectedFullTextBaseSchema
  .refine((value) => Date.parse(value.retentionUntil) > Date.parse(value.collectedAt))
  .refine(
    (value) =>
      createHash("sha256").update(value.bodyText).digest("hex") ===
      value.bodySha256,
  );

const storedFullTextSchema = collectedFullTextBaseSchema
  .pick({
    articleId: true,
    sourceId: true,
    canonicalUrl: true,
    bodyText: true,
    bodySha256: true,
    collectedAt: true,
    retentionUntil: true,
    finalUrl: true,
    responseBytes: true,
    permission: true,
  })
  .strict();

const persistInputSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
    collectOutputReference: z.string().trim().min(1).max(500),
    fullTexts: z.array(collectedFullTextSchema).min(1).max(20),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = input.fullTexts.map((item) => item.articleId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["fullTexts"], message: "duplicate" });
    }
  });

const receiptSchema = z
  .object({
    createdCount: z.number().int().min(0).max(20),
    articleIds: z.array(identifierSchema).max(20),
  })
  .strict();

const readRowsSchema = z.array(storedFullTextSchema).max(20);
const selectedReadInputSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
    scoreOutputReference: z.string().trim().min(1).max(500),
    evidenceIds: z.array(identifierSchema).min(1).max(20),
    articleIds: z.array(identifierSchema).min(1).max(20),
  })
  .strict();
const purgeReceiptSchema = z
  .object({
    deletedCount: z.number().int().min(0).max(1_000),
    articleIds: z.array(identifierSchema).max(1_000),
  })
  .strict();

export type StoredArticleFullText = z.infer<typeof storedFullTextSchema>;
export type PersistArticleFullTextsInput = Omit<
  z.input<typeof persistInputSchema>,
  "fullTexts"
> & { fullTexts: readonly CollectedArticleFullText[] };

export function buildArticleModelDocuments(input: {
  evidenceItems: readonly EvidenceItem[];
  fullTexts: readonly StoredArticleFullText[];
}): ArticleModelDocument[] {
  const fullTextByArticle = new Map(
    input.fullTexts.map((fullText) => [fullText.articleId, fullText]),
  );
  if (
    fullTextByArticle.size !== input.fullTexts.length ||
    new Set(input.evidenceItems.map((item) => item.evidenceId)).size !==
      input.evidenceItems.length
  ) {
    throw new SupabaseArticleFullTextError("INVALID_INPUT");
  }
  const documents = input.evidenceItems.map((evidence) => {
    const fullText = fullTextByArticle.get(evidence.articleId);
    if (
      !fullText ||
      fullText.sourceId !== evidence.sourceId ||
      fullText.permission.policyReferenceUrls.length === 0
    ) {
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    return articleModelDocumentSchema.parse({
      documentId: `document:${fullText.bodySha256.slice(0, 32)}`,
      articleId: evidence.articleId,
      sourceId: evidence.sourceId,
      evidenceId: evidence.evidenceId,
      sourceName: evidence.sourceName,
      title: evidence.title,
      publishedAt: evidence.publishedAt,
      contentText: fullText.bodyText,
      contentHash: fullText.bodySha256,
      fetchedAt: fullText.collectedAt,
      retentionExpiresAt: fullText.retentionUntil,
      rightsBasisUrl: [...fullText.permission.policyReferenceUrls].sort()[0],
      termsReviewedAt: fullText.permission.accessReviewedAt,
    });
  });
  if (documents.length !== input.fullTexts.length) {
    throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
  }
  return documents;
}

export class SupabaseArticleFullTextError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "PERMISSION_DENIED" | "STATE_AMBIGUOUS") {
    super(code);
    this.name = "SupabaseArticleFullTextError";
  }
}

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export class SupabaseArticleFullTextRepository {
  constructor(private readonly dataSource: SupabaseArticleFullTextRpcDataSource) {}

  async persist(input: PersistArticleFullTextsInput): Promise<{
    createdCount: number;
    articleIds: string[];
  }> {
    const parsed = persistInputSchema.safeParse(input);
    if (!parsed.success) throw new SupabaseArticleFullTextError("INVALID_INPUT");
    const result = await this.#rpc("persist_article_full_texts", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_collect_output_reference: parsed.data.collectOutputReference,
      p_full_texts: parsed.data.fullTexts,
    });
    const receipt = receiptSchema.safeParse(result);
    if (
      !receipt.success ||
      receipt.data.createdCount > parsed.data.fullTexts.length ||
      !exactIds(
        receipt.data.articleIds,
        parsed.data.fullTexts.map((item) => item.articleId),
      )
    ) {
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    return structuredClone(receipt.data);
  }

  async getSelected(
    input: z.input<typeof selectedReadInputSchema>,
    now: Date = new Date(),
  ): Promise<StoredArticleFullText[]> {
    const parsed = selectedReadInputSchema.safeParse(input);
    if (
      !parsed.success ||
      new Set(parsed.data.evidenceIds).size !== parsed.data.evidenceIds.length ||
      new Set(parsed.data.articleIds).size !== parsed.data.articleIds.length ||
      parsed.data.evidenceIds.length !== parsed.data.articleIds.length
    ) {
      throw new SupabaseArticleFullTextError("INVALID_INPUT");
    }
    const result = await this.#rpc("get_selected_article_full_texts", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_score_output_reference: parsed.data.scoreOutputReference,
      p_evidence_ids: parsed.data.evidenceIds,
    });
    const rows = readRowsSchema.safeParse(result);
    if (
      !rows.success ||
      rows.data.some((row) => !parsed.data.articleIds.includes(row.articleId)) ||
      rows.data.length !== parsed.data.articleIds.length ||
      rows.data.some(
        (row) =>
          Date.parse(row.retentionUntil) <= now.getTime() ||
          createHash("sha256").update(row.bodyText).digest("hex") !==
            row.bodySha256,
      ) ||
      new Set(rows.success ? rows.data.map((row) => row.articleId) : []).size !==
        (rows.success ? rows.data.length : 0)
    ) {
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    return structuredClone(rows.data);
  }

  async purgeExpired(limit = 500): Promise<{ deletedCount: number; articleIds: string[] }> {
    const parsedLimit = z.number().int().min(1).max(1_000).safeParse(limit);
    if (!parsedLimit.success) throw new SupabaseArticleFullTextError("INVALID_INPUT");
    const result = await this.#rpc("purge_expired_article_full_texts", {
      p_limit: parsedLimit.data,
    });
    const receipt = purgeReceiptSchema.safeParse(result);
    if (
      !receipt.success ||
      receipt.data.deletedCount !== receipt.data.articleIds.length ||
      new Set(receipt.success ? receipt.data.articleIds : []).size !==
        (receipt.success ? receipt.data.articleIds.length : 0)
    ) {
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    return structuredClone(receipt.data);
  }

  async #rpc(
    name: SupabaseArticleFullTextRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let result: SupabaseArticleFullTextRpcResult;
    try {
      result = await this.dataSource.rpc(name, parameters);
    } catch {
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    if (result.error) {
      if (["401", "403", "42501"].includes(result.error.code ?? "")) {
        throw new SupabaseArticleFullTextError("PERMISSION_DENIED");
      }
      throw new SupabaseArticleFullTextError("STATE_AMBIGUOUS");
    }
    return result.data;
  }
}
