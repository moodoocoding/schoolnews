import { z } from "zod";

import {
  evidenceItemSchema,
  normalizedArticleSchema,
  publicationDateKstSchema,
  type EvidenceItem,
  type NormalizedArticle,
} from "../contracts";

export const SUPABASE_EDITORIAL_MATERIALS_RPC_NAME =
  "get_rolling_editorial_materials" as const;

export interface SupabaseEditorialMaterialsRpcDataSource {
  rpc(
    functionName: typeof SUPABASE_EDITORIAL_MATERIALS_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ data: unknown; error: Readonly<{ code?: string }> | null }>>;
}

const responseSchema = z
  .object({
    articles: z.array(normalizedArticleSchema).max(2_000),
    evidenceItems: z.array(evidenceItemSchema).max(2_000),
  })
  .strict();

export type SupabaseEditorialMaterials = Readonly<{
  articles: NormalizedArticle[];
  evidenceItems: EvidenceItem[];
}>;

export class SupabaseEditorialMaterialsError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "LOOKUP_UNAVAILABLE" | "INVALID_RESPONSE") {
    super(code);
    this.name = "SupabaseEditorialMaterialsError";
  }
}

export class SupabaseEditorialMaterialsRepository {
  constructor(private readonly dataSource: SupabaseEditorialMaterialsRpcDataSource) {}

  async getRolling(input: { runDate: string; windowDays: number }): Promise<SupabaseEditorialMaterials> {
    if (
      !publicationDateKstSchema.safeParse(input.runDate).success ||
      !Number.isInteger(input.windowDays) ||
      input.windowDays < 1 ||
      input.windowDays > 7
    ) {
      throw new SupabaseEditorialMaterialsError("INVALID_INPUT");
    }
    let result;
    try {
      result = await this.dataSource.rpc(SUPABASE_EDITORIAL_MATERIALS_RPC_NAME, {
        p_run_date: input.runDate,
        p_window_days: input.windowDays,
      });
    } catch {
      throw new SupabaseEditorialMaterialsError("LOOKUP_UNAVAILABLE");
    }
    if (result.error !== null) {
      throw new SupabaseEditorialMaterialsError("LOOKUP_UNAVAILABLE");
    }
    const parsed = responseSchema.safeParse(result.data);
    if (!parsed.success) throw new SupabaseEditorialMaterialsError("INVALID_RESPONSE");
    const articleIds = new Set(parsed.data.articles.map((article) => article.articleId));
    if (parsed.data.evidenceItems.some((item) => !articleIds.has(item.articleId))) {
      throw new SupabaseEditorialMaterialsError("INVALID_RESPONSE");
    }
    return structuredClone(parsed.data);
  }
}
