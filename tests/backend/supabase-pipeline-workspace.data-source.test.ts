import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabasePipelineWorkspaceDataSource,
  SupabaseClientPipelineWorkspaceDataSource,
  SupabasePipelineWorkspaceConfigurationError,
} from "../../src/db/supabase/pipeline-workspace.data-source";

describe("SupabaseClientPipelineWorkspaceDataSource", () => {
  it("put authority와 artifact를 정확한 snake_case RPC 인자로 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: null, error: null });
    const dataSource = new SupabaseClientPipelineWorkspaceDataSource(rpcCall);
    const fingerprint = "a".repeat(64);

    await dataSource.putArtifact({
      runDate: "2026-08-13",
      runId: "daily-20260813",
      leaseToken: "lease-1",
      fence: 3,
      expectedRevision: 4,
      stage: "generate",
      kind: "post_generation",
      outputReference: "reference-1",
      payloadFingerprint: fingerprint,
      configurationFingerprint: "b".repeat(64),
      parentOutputReferences: ["parent-1"],
      payload: { kind: "post_generation", value: {} },
    });

    expect(rpcCall).toHaveBeenCalledWith("put_pipeline_artifact", {
      p_run_date: "2026-08-13",
      p_run_id: "daily-20260813",
      p_lease_token: "lease-1",
      p_fence: 3,
      p_expected_revision: 4,
      p_stage: "generate",
      p_kind: "post_generation",
      p_output_reference: "reference-1",
      p_payload_fingerprint: fingerprint,
      p_configuration_fingerprint: "b".repeat(64),
      p_parent_output_references: ["parent-1"],
      p_payload: { kind: "post_generation", value: {} },
    });
  });

  it("참조 조회와 crash recovery 단계 조회만 허용된 RPC로 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: null, error: null });
    const dataSource = new SupabaseClientPipelineWorkspaceDataSource(rpcCall);

    await dataSource.getArtifactByReference("reference-1");
    await dataSource.getArtifactForStage("daily-20260813", "validate");

    expect(rpcCall).toHaveBeenNthCalledWith(1, "get_pipeline_artifact", {
      p_output_reference: "reference-1",
    });
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      "get_pipeline_artifact_for_stage",
      { p_run_id: "daily-20260813", p_stage: "validate" },
    );
  });

  it("RPC 오류를 payload 재가공 없이 저장소 판정 경계로 반환한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "OUTPUT_CONFLICT" },
    });
    const dataSource = new SupabaseClientPipelineWorkspaceDataSource(rpcCall);

    await expect(
      dataSource.getArtifactByReference("reference-1"),
    ).resolves.toEqual({
      data: null,
      error: { code: "P0001", message: "OUTPUT_CONFLICT" },
    });
  });

  it("project origin과 server Secret Key를 생성 전에 검증한다", () => {
    for (const input of [
      {
        projectUrl: "http://example.supabase.co",
        secretKey: "sb_secret_valid-enough-placeholder",
      },
      {
        projectUrl: "https://example.supabase.co/path",
        secretKey: "sb_secret_valid-enough-placeholder",
      },
      {
        projectUrl: "https://example.supabase.co",
        secretKey: "sb_publishable_not-a-server-secret",
      },
    ]) {
      expect(() => createSupabasePipelineWorkspaceDataSource(input)).toThrow(
        SupabasePipelineWorkspaceConfigurationError,
      );
    }
  });

  it("로컬 Supabase loopback HTTP origin은 허용한다", () => {
    expect(() =>
      createSupabasePipelineWorkspaceDataSource({
        projectUrl: "http://127.0.0.1:54321",
        secretKey: "sb_secret_valid-enough-placeholder",
      }),
    ).not.toThrow();
  });
});
