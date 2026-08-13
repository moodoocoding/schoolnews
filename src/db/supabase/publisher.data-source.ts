import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  SupabasePublishRpcName,
  SupabasePublisherRpcDataSource,
  SupabasePublisherRpcResult,
} from "../../repositories/supabase-publisher.repository";

const PUBLISH_RPC_TIMEOUT_MS = 15_000;

const publisherConfigSchema = z
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
        { message: "Supabase project URL must be an HTTPS origin." },
      ),
    secretKey: z
      .string()
      .min(20)
      .max(512)
      .regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

type RpcCall = (
  functionName: SupabasePublishRpcName,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabasePublisherRpcResult>;

export class SupabasePublisherConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabasePublisherConfigurationError";
  }
}

export class SupabaseClientPublisherRpcDataSource
  implements SupabasePublisherRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: SupabasePublishRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublisherRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabasePublisherRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabasePublisherRpcDataSource {
  const parsed = publisherConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupabasePublisherConfigurationError();
  }
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientPublisherRpcDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(PUBLISH_RPC_TIMEOUT_MS);
      try {
        const result = await client
          .rpc(functionName, parameters)
          .abortSignal(signal);
        if (signal.aborted) {
          return {
            data: null,
            error: { code: "PUBLISH_TIMEOUT_AMBIGUOUS" },
          };
        }
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
      } catch {
        return {
          data: null,
          error: {
            code: signal.aborted
              ? "PUBLISH_TIMEOUT_AMBIGUOUS"
              : "PUBLISH_STATE_AMBIGUOUS",
          },
        };
      }
    },
  );
}
