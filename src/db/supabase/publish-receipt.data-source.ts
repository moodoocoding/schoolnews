import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SUPABASE_PUBLISH_RECEIPT_RPC_NAME,
  type SupabasePublishReceiptRpcDataSource,
  type SupabasePublishReceiptRpcResult,
} from "../../repositories/supabase-publish-receipt.repository";

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
  functionName: typeof SUPABASE_PUBLISH_RECEIPT_RPC_NAME,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabasePublishReceiptRpcResult>;

export class SupabasePublishReceiptConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";
  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabasePublishReceiptConfigurationError";
  }
}

export class SupabaseClientPublishReceiptRpcDataSource
  implements SupabasePublishReceiptRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: typeof SUPABASE_PUBLISH_RECEIPT_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublishReceiptRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabasePublishReceiptRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabasePublishReceiptRpcDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new SupabasePublishReceiptConfigurationError();

  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientPublishReceiptRpcDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      try {
        const result = await client.rpc(functionName, parameters).abortSignal(signal);
        if (signal.aborted) {
          return { data: null, error: { code: "RECEIPT_LOOKUP_TIMEOUT" } };
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
              ? "RECEIPT_LOOKUP_TIMEOUT"
              : "RECEIPT_LOOKUP_FAILED",
          },
        };
      }
    },
  );
}
