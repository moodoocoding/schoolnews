import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  SupabaseModelInvocationRpcDataSource,
  SupabaseModelInvocationRpcName,
  SupabaseModelInvocationRpcResult,
} from "../../repositories/supabase-model-invocation.repository";

const MODEL_INVOCATION_RPC_TIMEOUT_MS = 15_000;

const configSchema = z
  .object({
    projectUrl: z
      .string()
      .url()
      .transform((value) => new URL(value))
      .refine((url) => {
        const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(
          url.hostname,
        );
        return (
          (url.protocol === "https:" ||
            (url.protocol === "http:" && isLoopback)) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
    secretKey: z
      .string()
      .min(20)
      .max(512)
      .regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

type RpcCall = (
  functionName: SupabaseModelInvocationRpcName,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabaseModelInvocationRpcResult>;

export class SupabaseModelInvocationConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabaseModelInvocationConfigurationError";
  }
}

export class SupabaseClientModelInvocationRpcDataSource
  implements SupabaseModelInvocationRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: SupabaseModelInvocationRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseModelInvocationRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabaseModelInvocationRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseModelInvocationRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupabaseModelInvocationConfigurationError();
  }
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientModelInvocationRpcDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(MODEL_INVOCATION_RPC_TIMEOUT_MS);
      try {
        const result = await client.rpc(functionName, parameters).abortSignal(signal);
        if (signal.aborted) {
          return {
            data: null,
            error: { code: "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS" },
          };
        }
        return {
          data: result.data,
          error:
            result.error === null
              ? null
              : { code: result.error.code, message: result.error.message },
        };
      } catch {
        return {
          data: null,
          error: {
            code: signal.aborted
              ? "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS"
              : "MODEL_INVOCATION_STATE_AMBIGUOUS",
          },
        };
      }
    },
  );
}
