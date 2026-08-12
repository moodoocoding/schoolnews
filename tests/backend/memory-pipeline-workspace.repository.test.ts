import { describe, expect, it } from "vitest";

import type {
  NewsIngestionResult,
} from "../../src/pipeline/orchestrator/run-news-ingestion";
import type { PostGenerationResult } from "../../src/pipeline/orchestrator/run-post-generation";
import {
  MemoryPipelineWorkspaceRepository,
  PipelineWorkspaceError,
  type PipelineWorkspaceArtifact,
} from "../../src/repositories/memory-pipeline-workspace.repository";
import {
  evidenceItemsFixture,
  topicCandidateFixture,
} from "../fixtures/contracts";

const RUN_ID = "daily-20260813";
const CONFIG_FINGERPRINT = "c".repeat(64);

function ingestionResult(): NewsIngestionResult {
  return {
    status: "succeeded",
    outcomes: [
      {
        sourceId: "source-msit",
        status: "succeeded",
        startedAt: "2026-08-13T06:00:00+09:00",
        finishedAt: "2026-08-13T06:00:01+09:00",
        items: [],
        issues: [],
      },
    ],
    collectedCount: 0,
    normalizedCount: 0,
    deduplicatedCount: 0,
    storage: { insertedCount: 0, duplicateCount: 0, totalCount: 0 },
    articles: [],
    evidenceItems: [],
    candidates: [],
    runIssues: [],
  };
}

function generationResult(): PostGenerationResult {
  return {
    status: "withheld",
    post: null,
    qualityResult: null,
    audits: [],
    attempts: [],
    usage: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      hasUnpricedCalls: false,
    },
    failureCode: "BUDGET_EXCEEDED",
    providerErrorCode: null,
    pipelineVersion: "post-generation-v1",
  };
}

async function expectWorkspaceError(
  operation: Promise<unknown>,
  code: PipelineWorkspaceError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("작업공간 오류가 발생해야 합니다.");
  } catch (error) {
    expect(error).toBeInstanceOf(PipelineWorkspaceError);
    expect((error as PipelineWorkspaceError).code).toBe(code);
  }
}

describe("MemoryPipelineWorkspaceRepository", () => {
  it("같은 실행·단계·payload를 같은 참조로 멱등 저장한다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const artifact = {
      kind: "news_ingestion" as const,
      value: ingestionResult(),
    };

    const first = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact,
    });
    const second = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: structuredClone(artifact),
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(first.outputReference).toContain(".collect.news_ingestion.");
    expect(first.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("같은 실행·단계에 다른 payload를 덮어쓰지 않는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });
    const changed = ingestionResult();
    changed.storage.totalCount = 1;

    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "collect",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [],
        artifact: { kind: "news_ingestion", value: changed },
      }),
      "OUTPUT_CONFLICT",
    );
  });

  it("같은 payload라도 실행 ID가 다르면 별도 참조를 만든다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const artifact = {
      kind: "news_ingestion" as const,
      value: ingestionResult(),
    };
    const collect = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact,
    });
    const anotherRun = await repository.putArtifact({
      runId: "daily-20260814",
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact,
    });

    expect(anotherRun.outputReference).not.toBe(collect.outputReference);
    expect(anotherRun.payloadFingerprint).toBe(collect.payloadFingerprint);
  });

  it("없는 참조와 변조된 참조를 fail-closed 처리한다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const stored = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });
    const otherRepository = new MemoryPipelineWorkspaceRepository();
    const missing = await otherRepository.putArtifact({
      runId: "missing-run",
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });
    const replacement = stored.outputReference.endsWith("0") ? "1" : "0";
    const tampered = `${stored.outputReference.slice(0, -1)}${replacement}`;

    expect(await repository.validateOutputReference("not-a-reference")).toBe(false);
    expect(
      await repository.validateOutputReference(missing.outputReference),
    ).toBe(false);
    expect(await repository.validateOutputReference(tampered)).toBe(false);
    await expectWorkspaceError(
      repository.getArtifact("not-a-reference"),
      "INVALID_OUTPUT_REFERENCE",
    );
  });

  it("다른 runId·stage·kind로 참조를 해석하지 않는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const collected = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });
    const stored = await repository.putArtifact({
      runId: RUN_ID,
      stage: "score",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [collected.outputReference],
      artifact: {
        kind: "topic_selection",
        value: {
          candidate: topicCandidateFixture,
          outcome: "eligible",
          evidenceItems: evidenceItemsFixture,
        },
      },
    });

    for (const expected of [
      { runId: "another-run" },
      { stage: "generate" as const },
      { kind: "post_generation" as const },
    ]) {
      await expectWorkspaceError(
        repository.getArtifact(stored.outputReference, expected),
        "OUTPUT_SCOPE_MISMATCH",
      );
      expect(
        await repository.validateOutputReference(stored.outputReference, expected),
      ).toBe(false);
    }
  });

  it("저장 입력과 반환 객체의 변조가 내부 값을 바꾸지 않는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const input = ingestionResult();
    const stored = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: input },
    });
    input.storage.totalCount = 99;

    const first = await repository.getArtifact(stored.outputReference, {
      runId: RUN_ID,
      stage: "collect",
      kind: "news_ingestion",
    });
    expect(first.kind).toBe("news_ingestion");
    if (first.kind === "news_ingestion") {
      first.value.storage.totalCount = 88;
    }

    const second = await repository.getArtifact(stored.outputReference);
    expect(second.kind).toBe("news_ingestion");
    if (second.kind === "news_ingestion") {
      expect(second.value.storage.totalCount).toBe(0);
    }
  });

  it("후보와 저장 근거가 정확히 일치하지 않으면 저장을 거부한다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const invalidCandidate = structuredClone(topicCandidateFixture);
    invalidCandidate.evidenceIds = ["evidence-1"];

    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "score",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [],
        artifact: {
          kind: "topic_selection",
          value: {
            outcome: "eligible",
            candidate: invalidCandidate,
            evidenceItems: evidenceItemsFixture,
          },
        },
      }),
      "INVALID_ARTIFACT",
    );
  });

  it("모순된 생성 상태를 저장하지 않는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const invalid = generationResult();
    invalid.status = "validated";

    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [],
        artifact: { kind: "post_generation", value: invalid },
      }),
      "INVALID_ARTIFACT",
    );
  });

  it("알 수 없는 artifact kind를 저장하지 않는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const invalid = {
      kind: "raw_secret",
      value: { token: "should-not-be-stored" },
    } as unknown as PipelineWorkspaceArtifact;

    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "collect",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [],
        artifact: invalid,
      }),
      "INVALID_ARTIFACT",
    );
  });

  it("단계-kind 매핑과 같은 실행의 선행 참조를 강제한다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const collected = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });

    await expectWorkspaceError(
      repository.putArtifact({
        runId: "daily-20260814",
        stage: "score",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [collected.outputReference],
        artifact: {
          kind: "topic_selection",
          value: { outcome: "none", candidate: null, evidenceItems: [] },
        },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "score",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [collected.outputReference],
        artifact: { kind: "news_ingestion", value: ingestionResult() },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIG_FINGERPRINT,
        parentOutputReferences: [collected.outputReference],
        artifact: { kind: "post_generation", value: generationResult() },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
  });

  it("설정 지문과 부모 참조를 메타데이터로 보존하고 충돌에 포함한다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const collected = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });
    const metadata = await repository.getArtifactMetadata(
      collected.outputReference,
    );
    expect(metadata).toMatchObject({
      runId: RUN_ID,
      stage: "collect",
      kind: "news_ingestion",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
    });
    metadata.parentOutputReferences.push("mutated");
    expect(
      (await repository.getArtifactMetadata(collected.outputReference))
        .parentOutputReferences,
    ).toEqual([]);

    await expectWorkspaceError(
      repository.putArtifact({
        runId: RUN_ID,
        stage: "collect",
        configurationFingerprint: "d".repeat(64),
        parentOutputReferences: [],
        artifact: { kind: "news_ingestion", value: ingestionResult() },
      }),
      "OUTPUT_CONFLICT",
    );
  });

  it("참조가 checkpoint되기 전에도 실행 단계에서 기존 산출물을 찾는다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    const collected = await repository.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestionResult() },
    });

    const found = await repository.getArtifactForStage({
      runId: RUN_ID,
      stage: "collect",
      kind: "news_ingestion",
    });
    expect(found).toMatchObject({
      outputReference: collected.outputReference,
      payloadFingerprint: collected.payloadFingerprint,
      configurationFingerprint: CONFIG_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion" },
    });
    if (found?.artifact.kind === "news_ingestion") {
      found.artifact.value.storage.totalCount = 99;
      found.parentOutputReferences.push("mutated");
    }

    const reread = await repository.getArtifactForStage({
      runId: RUN_ID,
      stage: "collect",
      kind: "news_ingestion",
    });
    expect(reread?.parentOutputReferences).toEqual([]);
    if (reread?.artifact.kind === "news_ingestion") {
      expect(reread.artifact.value.storage.totalCount).toBe(0);
    }
  });

  it("stage 조회의 없는 실행은 null, stage-kind 불일치는 stable error다", async () => {
    const repository = new MemoryPipelineWorkspaceRepository();
    expect(
      await repository.getArtifactForStage({
        runId: "missing-run",
        stage: "collect",
        kind: "news_ingestion",
      }),
    ).toBeNull();

    await expectWorkspaceError(
      repository.getArtifactForStage({
        runId: RUN_ID,
        stage: "score",
        kind: "news_ingestion",
      }),
      "OUTPUT_SCOPE_MISMATCH",
    );
  });
});
