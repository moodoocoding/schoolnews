import "server-only";

import { createClient } from "@supabase/supabase-js";

import type {
  SupabaseSourceAttemptRpcDataSource,
  SupabaseSourceAttemptRpcResult,
} from "../../repositories/supabase-source-attempt.repository";
import { SUPABASE_SOURCE_ATTEMPT_RPC_NAME } from "../../repositories/supabase-source-attempt.repository";

type RpcCall = (
  functionName: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabaseSourceAttemptRpcResult>;

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
  const client = createClient(input.projectUrl, input.secretKey, {
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
