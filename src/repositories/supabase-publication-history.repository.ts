import { z } from "zod";

import { sha256Schema } from "../contracts";

export const SUPABASE_PUBLICATION_HISTORY_RPC_NAME =
  "get_publication_history" as const;

export type SupabasePublicationHistoryRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export interface SupabasePublicationHistoryRpcDataSource {
  rpc(
    functionName: typeof SUPABASE_PUBLICATION_HISTORY_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublicationHistoryRpcResult>;
}

const historySchema = z
  .object({
    titles: z.array(z.string().trim().min(1).max(500)).max(365),
    contentFingerprints: z.array(sha256Schema).max(365),
  })
  .strict()
  .superRefine((history, context) => {
    if (
      new Set(history.contentFingerprints).size !==
      history.contentFingerprints.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["contentFingerprints"],
        message: "Publication history fingerprints must be unique.",
      });
    }
  });

export type SupabasePublicationHistory = z.infer<typeof historySchema>;
export type SupabasePublicationHistoryErrorCode =
  | "INVALID_HISTORY_LIMIT"
  | "RPC_PERMISSION_DENIED"
  | "HISTORY_LOOKUP_UNAVAILABLE"
  | "INVALID_HISTORY_RESPONSE";

export class SupabasePublicationHistoryError extends Error {
  constructor(readonly code: SupabasePublicationHistoryErrorCode) {
    super(code);
    this.name = "SupabasePublicationHistoryError";
  }
}

const permissionCodes = new Set(["401", "403", "42501", "PGRST301", "PGRST302"]);

export class SupabasePublicationHistoryRepository {
  constructor(
    private readonly dataSource: SupabasePublicationHistoryRpcDataSource,
  ) {}

  async getRecent(limit = 365): Promise<SupabasePublicationHistory> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 365) {
      throw new SupabasePublicationHistoryError("INVALID_HISTORY_LIMIT");
    }
    let result: SupabasePublicationHistoryRpcResult;
    try {
      result = await this.dataSource.rpc(
        SUPABASE_PUBLICATION_HISTORY_RPC_NAME,
        { p_limit: limit },
      );
    } catch {
      throw new SupabasePublicationHistoryError("HISTORY_LOOKUP_UNAVAILABLE");
    }
    if (result.error !== null) {
      throw new SupabasePublicationHistoryError(
        result.error.code !== undefined && permissionCodes.has(result.error.code)
          ? "RPC_PERMISSION_DENIED"
          : "HISTORY_LOOKUP_UNAVAILABLE",
      );
    }
    const parsed = historySchema.safeParse(result.data);
    if (
      !parsed.success ||
      parsed.data.titles.length > limit ||
      parsed.data.contentFingerprints.length > limit
    ) {
      throw new SupabasePublicationHistoryError("INVALID_HISTORY_RESPONSE");
    }
    return structuredClone(parsed.data);
  }
}
