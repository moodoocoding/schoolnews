import { z } from "zod";

import {
  identifierSchema,
  publicationDateKstSchema,
  publishedPostDetailSchema,
  type PublishedPostDetail,
} from "../contracts";

export const SUPABASE_PUBLISH_RECEIPT_RPC_NAME =
  "get_publish_receipt" as const;

export type SupabasePublishReceiptRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export interface SupabasePublishReceiptRpcDataSource {
  rpc(
    functionName: typeof SUPABASE_PUBLISH_RECEIPT_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublishReceiptRpcResult>;
}

const inputSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    revisionId: identifierSchema,
    validationOutputReference: z.string().trim().min(1).max(500),
  })
  .strict();

const receiptSchema = inputSchema
  .extend({
    post: publishedPostDetailSchema,
  })
  .strict();

export type SupabasePublishReceiptLookup = z.infer<typeof inputSchema>;
export type SupabaseReconciledPublishReceipt = Readonly<{
  runDate: string;
  runId: string;
  revisionId: string;
  validationOutputReference: string;
  post: PublishedPostDetail;
}>;

export type SupabasePublishReceiptErrorCode =
  | "INVALID_RECEIPT_INPUT"
  | "PUBLISH_RECEIPT_CONFLICT"
  | "RPC_PERMISSION_DENIED"
  | "RECEIPT_LOOKUP_UNAVAILABLE";

export class SupabasePublishReceiptError extends Error {
  constructor(readonly code: SupabasePublishReceiptErrorCode) {
    super(code);
    this.name = "SupabasePublishReceiptError";
  }
}

const permissionCodes = new Set(["401", "403", "42501", "PGRST301", "PGRST302"]);

function mappedError(error: Readonly<{ code?: string; message?: string }>) {
  if (
    error.code === "PUBLISH_RECEIPT_CONFLICT" ||
    error.message === "PUBLISH_RECEIPT_CONFLICT"
  ) {
    return new SupabasePublishReceiptError("PUBLISH_RECEIPT_CONFLICT");
  }
  if (error.code !== undefined && permissionCodes.has(error.code)) {
    return new SupabasePublishReceiptError("RPC_PERMISSION_DENIED");
  }
  return new SupabasePublishReceiptError("RECEIPT_LOOKUP_UNAVAILABLE");
}

export class SupabasePublishReceiptRepository {
  constructor(private readonly dataSource: SupabasePublishReceiptRpcDataSource) {}

  async get(
    input: SupabasePublishReceiptLookup,
  ): Promise<SupabaseReconciledPublishReceipt | null> {
    const parsedInput = inputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new SupabasePublishReceiptError("INVALID_RECEIPT_INPUT");
    }

    let result: SupabasePublishReceiptRpcResult;
    try {
      result = await this.dataSource.rpc(SUPABASE_PUBLISH_RECEIPT_RPC_NAME, {
        p_run_date: parsedInput.data.runDate,
        p_run_id: parsedInput.data.runId,
        p_revision_id: parsedInput.data.revisionId,
        p_validation_output_reference:
          parsedInput.data.validationOutputReference,
      });
    } catch {
      throw new SupabasePublishReceiptError("RECEIPT_LOOKUP_UNAVAILABLE");
    }

    if (result.error !== null) {
      throw mappedError(result.error);
    }
    if (result.data === null) {
      return null;
    }

    const receipt = receiptSchema.safeParse(result.data);
    if (
      !receipt.success ||
      receipt.data.runDate !== parsedInput.data.runDate ||
      receipt.data.runId !== parsedInput.data.runId ||
      receipt.data.revisionId !== parsedInput.data.revisionId ||
      receipt.data.validationOutputReference !==
        parsedInput.data.validationOutputReference ||
      receipt.data.post.publicationDateKst !== parsedInput.data.runDate
    ) {
      throw new SupabasePublishReceiptError("PUBLISH_RECEIPT_CONFLICT");
    }

    return structuredClone(receipt.data);
  }
}
