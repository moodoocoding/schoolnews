import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SUPABASE_PUBLICATION_HISTORY_RPC_NAME,
  type SupabasePublicationHistoryRpcDataSource,
  type SupabasePublicationHistoryRpcResult,
} from "../../repositories/supabase-publication-history.repository";

const LOOKUP_TIMEOUT_MS = 10_000;
const configSchema = z
  .object({
    projectUrl: z
      .string()
      .url()
      .transform((value) => new URL(value))
      .refine((url) => {
        const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
        return (
          (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
          url.username === "" && url.password === "" && url.pathname === "/" &&
          url.search === "" && url.hash === ""
        );
      }),
    secretKey: z.string().min(20).max(512).regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

type RpcCall = (
  functionName: typeof SUPABASE_PUBLICATION_HISTORY_RPC_NAME,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabasePublicationHistoryRpcResult>;

export class SupabasePublicationHistoryConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";
  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabasePublicationHistoryConfigurationError";
  }
}

export class SupabaseClientPublicationHistoryRpcDataSource
  implements SupabasePublicationHistoryRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}
  rpc(
    functionName: typeof SUPABASE_PUBLICATION_HISTORY_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublicationHistoryRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabasePublicationHistoryRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabasePublicationHistoryRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new SupabasePublicationHistoryConfigurationError();
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return new SupabaseClientPublicationHistoryRpcDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      try {
        const result = await client.rpc(functionName, parameters).abortSignal(signal);
        return signal.aborted
          ? { data: null, error: { code: "HISTORY_LOOKUP_TIMEOUT" } }
          : {
              data: result.data,
              error: result.error === null
                ? null
                : { code: result.error.code, message: result.error.message },
            };
      } catch {
        return {
          data: null,
          error: { code: signal.aborted ? "HISTORY_LOOKUP_TIMEOUT" : "HISTORY_LOOKUP_FAILED" },
        };
      }
    },
  );
}
