import "server-only";

import { createClient } from "@supabase/supabase-js";

import type {
  SupabaseDailyRunRpcDataSource,
  SupabaseDailyRunRpcName,
  SupabaseDailyRunRpcResult,
} from "../../repositories/supabase-daily-run.repository";

type RpcCall = (
  functionName: SupabaseDailyRunRpcName,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabaseDailyRunRpcResult>;

export class SupabaseClientDailyRunRpcDataSource
  implements SupabaseDailyRunRpcDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  rpc(
    functionName: SupabaseDailyRunRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseDailyRunRpcResult> {
    return this.rpcCall(functionName, parameters);
  }
}

export function createSupabaseDailyRunRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseDailyRunRpcDataSource {
  const client = createClient(input.projectUrl, input.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientDailyRunRpcDataSource(
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
