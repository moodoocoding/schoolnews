import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const PIPELINE_WORKSPACE_RPC_TIMEOUT_MS = 15_000;

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
        return url.protocol === "https:" || (url.protocol === "http:" && isLoopback);
      })
      .refine(
        (url) =>
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === "",
      ),
    secretKey: z
      .string()
      .min(20)
      .max(512)
      .regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  })
  .strict();

export const supabasePipelineWorkspaceRpcNames = {
  put: "put_pipeline_artifact",
  getByReference: "get_pipeline_artifact",
  getForStage: "get_pipeline_artifact_for_stage",
} as const;

export type SupabasePipelineWorkspaceRpcName =
  (typeof supabasePipelineWorkspaceRpcNames)[keyof typeof supabasePipelineWorkspaceRpcNames];

export type SupabasePipelineWorkspaceDataError = Readonly<{
  code?: string;
  message?: string;
}>;

export type SupabasePipelineWorkspaceDataResult = Readonly<{
  data: unknown;
  error: SupabasePipelineWorkspaceDataError | null;
}>;

export interface SupabasePipelineWorkspacePutRequest {
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
  stage: string;
  kind: string;
  outputReference: string;
  payloadFingerprint: string;
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
  payload: Readonly<Record<string, unknown>>;
}

export interface SupabasePipelineWorkspaceDataSource {
  putArtifact(
    input: Readonly<SupabasePipelineWorkspacePutRequest>,
  ): Promise<SupabasePipelineWorkspaceDataResult>;
  getArtifactByReference(
    outputReference: string,
  ): Promise<SupabasePipelineWorkspaceDataResult>;
  getArtifactForStage(
    runId: string,
    stage: string,
  ): Promise<SupabasePipelineWorkspaceDataResult>;
}

export class SupabasePipelineWorkspaceConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor() {
    super("CONFIG_INVALID");
    this.name = "SupabasePipelineWorkspaceConfigurationError";
  }
}

type RpcCall = (
  functionName: SupabasePipelineWorkspaceRpcName,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<SupabasePipelineWorkspaceDataResult>;

export class SupabaseClientPipelineWorkspaceDataSource
  implements SupabasePipelineWorkspaceDataSource
{
  constructor(private readonly rpcCall: RpcCall) {}

  putArtifact(
    input: Readonly<SupabasePipelineWorkspacePutRequest>,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    return this.rpcCall(supabasePipelineWorkspaceRpcNames.put, {
      p_run_date: input.runDate,
      p_run_id: input.runId,
      p_lease_token: input.leaseToken,
      p_fence: input.fence,
      p_expected_revision: input.expectedRevision,
      p_stage: input.stage,
      p_kind: input.kind,
      p_output_reference: input.outputReference,
      p_payload_fingerprint: input.payloadFingerprint,
      p_configuration_fingerprint: input.configurationFingerprint,
      p_parent_output_references: [...input.parentOutputReferences],
      p_payload: input.payload,
    });
  }

  getArtifactByReference(
    outputReference: string,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    return this.rpcCall(supabasePipelineWorkspaceRpcNames.getByReference, {
      p_output_reference: outputReference,
    });
  }

  getArtifactForStage(
    runId: string,
    stage: string,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    return this.rpcCall(supabasePipelineWorkspaceRpcNames.getForStage, {
      p_run_id: runId,
      p_stage: stage,
    });
  }
}

export function createSupabasePipelineWorkspaceDataSource(input: {
  projectUrl: string;
  secretKey: string;
}): SupabasePipelineWorkspaceDataSource {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupabasePipelineWorkspaceConfigurationError();
  }
  const client = createClient(parsed.data.projectUrl.toString(), parsed.data.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return new SupabaseClientPipelineWorkspaceDataSource(
    async (functionName, parameters) => {
      const signal = AbortSignal.timeout(PIPELINE_WORKSPACE_RPC_TIMEOUT_MS);
      try {
        const result = await client
          .rpc(functionName, parameters)
          .abortSignal(signal);
        if (signal.aborted) {
          return {
            data: null,
            error: { code: "PIPELINE_WORKSPACE_TIMEOUT_AMBIGUOUS" },
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
              ? "PIPELINE_WORKSPACE_TIMEOUT_AMBIGUOUS"
              : "PIPELINE_WORKSPACE_STATE_AMBIGUOUS",
          },
        };
      }
    },
  );
}
