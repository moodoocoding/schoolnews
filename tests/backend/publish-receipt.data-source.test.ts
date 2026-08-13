import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabasePublishReceiptRpcDataSource,
  SupabaseClientPublishReceiptRpcDataSource,
  SupabasePublishReceiptConfigurationError,
} from "../../src/db/supabase/publish-receipt.data-source";

describe("Supabase publish receipt RPC data source", () => {
  it("get_publish_receipt 이름과 매개변수만 주입된 호출 경계에 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const dataSource = new SupabaseClientPublishReceiptRpcDataSource(rpcCall);
    const parameters = {
      p_run_date: "2026-08-12",
      p_run_id: "run-20260812",
      p_revision_id: "revision-1",
      p_validation_output_reference: "validation-output-1",
    };

    await expect(
      dataSource.rpc("get_publish_receipt", parameters),
    ).resolves.toEqual({ data: { ok: true }, error: null });
    expect(rpcCall).toHaveBeenCalledOnce();
    expect(rpcCall).toHaveBeenCalledWith("get_publish_receipt", parameters);
  });

  it("project origin과 service-role secret 형식을 client 생성 전에 검증한다", () => {
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
        projectUrl: "https://user@example.supabase.co",
        secretKey: "sb_secret_valid-enough-placeholder",
      },
      {
        projectUrl: "https://example.supabase.co",
        secretKey: "sb_publishable_not-a-server-secret",
      },
    ]) {
      expect(() => createSupabasePublishReceiptRpcDataSource(input)).toThrow(
        SupabasePublishReceiptConfigurationError,
      );
    }
  });
});
