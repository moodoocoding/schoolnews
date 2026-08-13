import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  SupabaseArticleFullTextRpcDataSource,
  SupabaseArticleFullTextRpcName,
  SupabaseArticleFullTextRpcResult,
} from "../../repositories/supabase-article-full-text.repository";

const configSchema = z
  .object({
    projectUrl: z.string().url().transform((value) => new URL(value)).refine((url) => {
      const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
      return (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
        url.username === "" && url.password === "" && url.pathname === "/" &&
        url.search === "" && url.hash === "";
    }),
    secretKey: z.string().min(20).max(512).regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

export class SupabaseArticleFullTextConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";
}
export function createSupabaseArticleFullTextRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseArticleFullTextRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new SupabaseArticleFullTextConfigurationError();
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return {
    async rpc(
      functionName: SupabaseArticleFullTextRpcName,
      parameters: Readonly<Record<string, unknown>>,
    ): Promise<SupabaseArticleFullTextRpcResult> {
      const signal = AbortSignal.timeout(15_000);
      try {
        const result = await client.rpc(functionName, parameters).abortSignal(signal);
        return {
          data: result.data,
          error: result.error
            ? { code: result.error.code, message: result.error.message }
            : null,
        };
      } catch {
        return { data: null, error: { code: "STATE_AMBIGUOUS" } };
      }
    },
  };
}
