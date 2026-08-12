import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  SupabaseContentPersistenceRpcDataSource,
  SupabaseContentPersistenceRpcName,
  SupabaseContentPersistenceRpcResult,
} from "../../repositories/supabase-content-persistence.repository";

const CONTENT_PERSISTENCE_RPC_TIMEOUT_MS = 15_000;

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
      },
      ),
    secretKey: z
      .string()
      .min(20)
      .max(512)
      .regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

type RpcCall = (
  functionName: SupabaseContentPersistenceRpcName,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabaseContentPersistenceRpcResult>;

export class SupabaseContentPersistenceConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabaseContentPersistenceConfigurationError";
  }
}

export class SupabaseClientContentPersistenceRpcDataSource
  implements SupabaseContentPersistenceRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: SupabaseContentPersistenceRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseContentPersistenceRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabaseContentPersistenceRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseContentPersistenceRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupabaseContentPersistenceConfigurationError();
  }
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientContentPersistenceRpcDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(CONTENT_PERSISTENCE_RPC_TIMEOUT_MS);
      try {
        const result = await client.rpc(functionName, parameters).abortSignal(signal);
        if (signal.aborted) {
          return {
            data: null,
            error: { code: "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS" },
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
              ? "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS"
              : "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
          },
        };
      }
    },
  );
}
