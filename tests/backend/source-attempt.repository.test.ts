import { describe, expect, it } from "vitest";

import {
  SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
  SupabaseSourceAttemptError,
  SupabaseSourceAttemptRepository,
  type SupabaseSourceAttemptRpcDataSource,
  type SupabaseSourceAttemptRpcResult,
} from "../../src/repositories/supabase-source-attempt.repository";

class FakeDataSource implements SupabaseSourceAttemptRpcDataSource {
  response: SupabaseSourceAttemptRpcResult = { data: null, error: null };
  thrown: unknown = null;
  calls: Array<{
    name: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];

  async rpc(
    name: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseSourceAttemptRpcResult> {
    this.calls.push({ name, parameters });
    if (this.thrown !== null) {
      throw this.thrown;
    }
    return this.response;
  }
}

describe("Supabase source attempt repository", () => {
  it("sourceId와 minIntervalMs를 RPC에 전달하고 allowed receipt를 검증한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.response = {
      data: {
        status: "allowed",
        sourceId: "msit-press-release",
        lastAttemptAt: "2026-08-13T01:00:00+00:00",
        nextAllowedAt: "2026-08-14T01:00:00+00:00",
      },
      error: null,
    };
    const repository = new SupabaseSourceAttemptRepository(dataSource);

    await expect(
      repository.reserve({
        sourceId: "msit-press-release",
        minIntervalMs: 86_400_000,
      }),
    ).resolves.toEqual(dataSource.response.data);
    expect(dataSource.calls).toEqual([
      {
        name: "reserve_source_collection_attempt",
        parameters: {
          p_source_id: "msit-press-release",
          p_min_interval_ms: 86_400_000,
        },
      },
    ]);
  });

  it("TOO_SOON 결과를 예외나 추가 호출 없이 반환한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.response = {
      data: {
        status: "too_soon",
        code: "TOO_SOON",
        sourceId: "msit-press-release",
        lastAttemptAt: "2026-08-13T01:00:00+00:00",
        nextAllowedAt: "2026-08-14T01:00:00+00:00",
      },
      error: null,
    };
    const repository = new SupabaseSourceAttemptRepository(dataSource);

    await expect(
      repository.reserve({
        sourceId: "msit-press-release",
        minIntervalMs: 86_400_000,
      }),
    ).resolves.toMatchObject({ status: "too_soon", code: "TOO_SOON" });
    expect(dataSource.calls).toHaveLength(1);
  });

  it.each([
    { sourceId: "../secret", minIntervalMs: 1 },
    { sourceId: "msit", minIntervalMs: 0 },
    { sourceId: "msit", minIntervalMs: 604_800_001 },
    { sourceId: "msit", minIntervalMs: 1.5 },
  ])("잘못된 입력을 원격 호출 전에 거부한다: $sourceId", async (input) => {
    const dataSource = new FakeDataSource();
    const repository = new SupabaseSourceAttemptRepository(dataSource);

    await expect(repository.reserve(input)).rejects.toEqual(
      new SupabaseSourceAttemptError("INVALID_INPUT"),
    );
    expect(dataSource.calls).toHaveLength(0);
  });

  it("malformed·scope 불일치·RPC 실패를 payload 없는 stable 오류로 바꾼다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new SupabaseSourceAttemptRepository(dataSource);
    const input = { sourceId: "msit", minIntervalMs: 60_000 };

    dataSource.response = { data: { status: "allowed", secret: "raw" }, error: null };
    await expect(repository.reserve(input)).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });

    dataSource.response = {
      data: {
        status: "allowed",
        sourceId: "msit",
        lastAttemptAt: "2026-08-13T01:00:00+00:00",
        nextAllowedAt: "2026-08-13T01:02:00+00:00",
      },
      error: null,
    };
    await expect(repository.reserve(input)).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });

    dataSource.response = {
      data: {
        status: "allowed",
        sourceId: "other",
        lastAttemptAt: "2026-08-13T01:00:00+00:00",
        nextAllowedAt: "2026-08-13T01:01:00+00:00",
      },
      error: null,
    };
    await expect(repository.reserve(input)).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });

    dataSource.response = {
      data: null,
      error: { code: "42501", message: "secret database details" },
    };
    const rpcError = await repository.reserve(input).catch((error: unknown) => error);
    expect(rpcError).toBeInstanceOf(SupabaseSourceAttemptError);
    expect(String(rpcError)).not.toContain("secret database details");

    dataSource.thrown = new Error("network credentials");
    const networkError = await repository
      .reserve(input)
      .catch((error: unknown) => error);
    expect(String(networkError)).not.toContain("network credentials");
  });
});
