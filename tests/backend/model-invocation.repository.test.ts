import { describe, expect, it } from "vitest";

import {
  SupabaseModelInvocationError,
  SupabaseModelInvocationRepository,
  type SupabaseModelInvocationRpcDataSource,
  type SupabaseModelInvocationRpcName,
  type SupabaseModelInvocationRpcResult,
} from "../../src/repositories/supabase-model-invocation.repository";

const FINGERPRINT = "a".repeat(64);
const RESERVED_AT = "2026-08-13T00:00:00.000Z";
const identity = {
  runId: "daily-20260813",
  callId: "call-draft-1",
  purpose: "draft" as const,
  attemptNumber: 1,
  routeAttempt: 1,
  requestFingerprint: FINGERPRINT,
};
const authority = {
  runDate: "2026-08-13",
  runId: identity.runId,
  leaseToken: "lease-token-1",
  fence: 2,
  expectedRevision: 4,
};
const audit = {
  callId: identity.callId,
  attemptNumber: 1,
  purpose: "draft" as const,
  providerId: "gemini",
  modelId: "gemini-3.6-flash",
  promptVersion: "generated-post-v2",
  startedAt: "2026-08-13T00:00:01.000Z",
  finishedAt: "2026-08-13T00:00:02.000Z",
  evidenceIds: ["evidence-1"],
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  estimatedCostUsd: 0.01,
  finishReason: "stop",
  responseId: "response-1",
};

class FakeDataSource implements SupabaseModelInvocationRpcDataSource {
  readonly calls: Array<{
    name: SupabaseModelInvocationRpcName;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  nextResult: SupabaseModelInvocationRpcResult = { data: null, error: null };
  shouldThrow = false;

  async rpc(
    name: SupabaseModelInvocationRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseModelInvocationRpcResult> {
    this.calls.push({ name, parameters: structuredClone(parameters) });
    if (this.shouldThrow) throw new Error("secret payload");
    return this.nextResult;
  }
}

function prepareInput() {
  return {
    ...authority,
    ...identity,
    providerId: audit.providerId,
    modelId: audit.modelId,
    promptVersion: audit.promptVersion,
    evidenceIds: audit.evidenceIds,
    scoreOutputReference: "score-output-1",
    reservedInputTokens: 200,
    reservedOutputTokens: 100,
    reservedCostUsd: 0.02,
  };
}

describe("SupabaseModelInvocationRepository", () => {
  it("fresh prepared만 물리 모델 호출을 허용하고 정확한 예약 상한을 전달한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.nextResult = {
      data: { status: "prepared", ...identity, reservedAt: RESERVED_AT },
      error: null,
    };
    const repository = new SupabaseModelInvocationRepository(dataSource);

    await expect(repository.prepare(prepareInput())).resolves.toMatchObject({
      status: "prepared",
      mayInvoke: true,
      ...identity,
    });
    expect(dataSource.calls).toEqual([
      {
        name: "prepare_model_invocation",
        parameters: {
          p_run_date: authority.runDate,
          p_run_id: authority.runId,
          p_lease_token: authority.leaseToken,
          p_fence: authority.fence,
          p_expected_revision: authority.expectedRevision,
          p_purpose: identity.purpose,
          p_attempt_number: identity.attemptNumber,
          p_route_attempt: identity.routeAttempt,
          p_call_id: identity.callId,
          p_provider_id: audit.providerId,
          p_model_id: audit.modelId,
          p_prompt_version: audit.promptVersion,
          p_evidence_ids: audit.evidenceIds,
          p_request_fingerprint: FINGERPRINT,
          p_score_output_reference: "score-output-1",
          p_reserved_input_tokens: 200,
          p_reserved_output_tokens: 100,
          p_reserved_cost_usd: 0.02,
        },
      },
    ]);
  });

  it("기존 reserved는 crash 후 재호출을 허용하지 않는다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.nextResult = {
      data: { status: "reserved", ...identity, reservedAt: RESERVED_AT },
      error: null,
    };
    const repository = new SupabaseModelInvocationRepository(dataSource);

    await expect(repository.prepare(prepareInput())).resolves.toMatchObject({
      status: "reserved",
      mayInvoke: false,
    });
  });

  it("completed prepare는 exact audit만 재사용하고 호출을 허용하지 않는다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.nextResult = {
      data: {
        status: "completed",
        ...identity,
        audit: { ...audit, routeAttempt: 1 },
      },
      error: null,
    };
    const repository = new SupabaseModelInvocationRepository(dataSource);

    await expect(repository.prepare(prepareInput())).resolves.toMatchObject({
      status: "completed",
      mayInvoke: false,
      audit: { callId: identity.callId, routeAttempt: 1 },
    });
  });

  it("finalize는 optional routeAttempt를 identity로 정규화하고 exact 응답을 검증한다", async () => {
    const dataSource = new FakeDataSource();
    const normalizedAudit = { ...audit, routeAttempt: 1 };
    dataSource.nextResult = {
      data: {
        status: "completed",
        created: true,
        ...identity,
        audit: normalizedAudit,
      },
      error: null,
    };
    const repository = new SupabaseModelInvocationRepository(dataSource);

    await expect(
      repository.finalize({ ...authority, ...identity, audit }),
    ).resolves.toEqual({
      status: "completed",
      created: true,
      ...identity,
      audit: normalizedAudit,
    });
    expect(dataSource.calls[0]).toMatchObject({
      name: "finalize_model_invocation",
      parameters: { p_audit: normalizedAudit },
    });
  });

  it("read는 reserved/completed/null만 반환하고 completed audit identity를 재검증한다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new SupabaseModelInvocationRepository(dataSource);
    dataSource.nextResult = { data: null, error: null };
    await expect(
      repository.get({
        runId: identity.runId,
        purpose: identity.purpose,
        attemptNumber: 1,
        routeAttempt: 1,
      }),
    ).resolves.toBeNull();

    dataSource.nextResult = {
      data: {
        status: "completed",
        ...identity,
        reservedAt: RESERVED_AT,
        completedAt: "2026-08-13T00:00:02.000Z",
        audit: { ...audit, routeAttempt: 1 },
      },
      error: null,
    };
    await expect(
      repository.get({
        runId: identity.runId,
        purpose: identity.purpose,
        attemptNumber: 1,
        routeAttempt: 1,
      }),
    ).resolves.toMatchObject({ status: "completed", callId: identity.callId });
  });

  it("malformed 응답, timeout/unknown, 권한 오류를 fail-closed 안정 코드로 바꾼다", async () => {
    const cases: Array<{
      result: SupabaseModelInvocationRpcResult;
      code: string;
    }> = [
      { result: { data: { status: "prepared" }, error: null }, code: "MODEL_INVOCATION_STATE_AMBIGUOUS" },
      { result: { data: null, error: { code: "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS" } }, code: "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS" },
      { result: { data: null, error: { code: "42501", message: "secret" } }, code: "RPC_PERMISSION_DENIED" },
      { result: { data: null, error: { code: "P0001", message: "INVOCATION_BUDGET_EXCEEDED" } }, code: "INVOCATION_BUDGET_EXCEEDED" },
    ];
    for (const testCase of cases) {
      const dataSource = new FakeDataSource();
      dataSource.nextResult = testCase.result;
      const repository = new SupabaseModelInvocationRepository(dataSource);
      await expect(repository.prepare(prepareInput())).rejects.toMatchObject({
        name: "SupabaseModelInvocationError",
        code: testCase.code,
        retryable: false,
      });
    }
  });

  it("입력 evidence 중복과 audit identity 차이는 RPC 전에 거부한다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new SupabaseModelInvocationRepository(dataSource);
    await expect(
      repository.prepare({ ...prepareInput(), evidenceIds: ["evidence-1", "evidence-1"] }),
    ).rejects.toBeInstanceOf(SupabaseModelInvocationError);
    await expect(
      repository.finalize({
        ...authority,
        ...identity,
        audit: { ...audit, callId: "different-call" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_INVOCATION_INPUT" });
    expect(dataSource.calls).toHaveLength(0);
  });

  it("DataSource throw의 cause/payload를 노출하지 않는다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.shouldThrow = true;
    const repository = new SupabaseModelInvocationRepository(dataSource);
    await expect(repository.prepare(prepareInput())).rejects.toEqual(
      expect.objectContaining({
        message: "MODEL_INVOCATION_STATE_AMBIGUOUS",
        code: "MODEL_INVOCATION_STATE_AMBIGUOUS",
      }),
    );
  });
});
