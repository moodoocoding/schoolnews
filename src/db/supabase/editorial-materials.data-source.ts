import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  SUPABASE_EDITORIAL_MATERIALS_RPC_NAME,
  type SupabaseEditorialMaterialsRpcDataSource,
} from "../../repositories/supabase-editorial-materials.repository";

export function createSupabaseEditorialMaterialsRpcDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabaseEditorialMaterialsRpcDataSource {
  const url = new URL(input.projectUrl);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(input.secretKey)
  ) {
    throw new TypeError("CONFIG_INVALID");
  }
  const client = createClient(url.toString(), input.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return {
    rpc: async (_name, parameters) => {
      const signal = AbortSignal.timeout(10_000);
      try {
        const result = await client
          .rpc(SUPABASE_EDITORIAL_MATERIALS_RPC_NAME, parameters)
          .abortSignal(signal);
        return {
          data: result.data,
          error: result.error ? { code: result.error.code } : null,
        };
      } catch {
        return { data: null, error: { code: "LOOKUP_UNAVAILABLE" } };
      }
    },
  };
}
