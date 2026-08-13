import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  SupabaseSourceAttemptRpcDataSource,
  SupabaseSourceAttemptRpcResult,
} from "../../repositories/supabase-source-attempt.repository";
import { SUPABASE_SOURCE_ATTEMPT_RPC_NAME } from "../../repositories/supabase-source-attempt.repository";

const configSchema = z
  .object({
    projectUrl: z
      .string()
      .url()
      .transform((value) => new URL(value))
      .refine((url) => {
        const loopback = ["127.0.0.1", "localhost", "::1"].includes(
          url.hostname,
        );
        return (
          (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
    secretKey: z.string().min(20).max(512).regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

type RpcCall = (
  functionName: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabaseSourceAttemptRpcResult>;

export class SupabaseSourceAttemptConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabaseSourceAttemptConfigurationError";
  }
}

export class SupabaseClientSourceAttemptRpcDataSource
  implements SupabaseSourceAttemptRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseSourceAttemptRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabaseSourceAttemptRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseSourceAttemptRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new SupabaseSourceAttemptConfigurationError();

  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientSourceAttemptRpcDataSource(
    async (functionName, parameters) => {
      const result = await client.rpc(functionName, parameters);
      return {
        data: result.data,
        error:
          result.error === null
            ? null
            : {
                code: result.error.code,
                message: result.error.message,
              },
      };
    },
  );
}
