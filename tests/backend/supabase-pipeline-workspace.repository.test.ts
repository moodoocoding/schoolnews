import { describe, expect, it, vi } from "vitest";

import type {
  SupabasePipelineWorkspaceDataResult,
  SupabasePipelineWorkspaceDataSource,
  SupabasePipelineWorkspacePutRequest,
} from "../../src/db/supabase/pipeline-workspace.data-source";
import { DailyRunStoreError } from "../../src/pipeline/orchestrator/daily-run-store";
import type { NewsIngestionResult } from "../../src/pipeline/orchestrator/run-news-ingestion";
import type { PostGenerationResult } from "../../src/pipeline/orchestrator/run-post-generation";
import {
  MemoryPipelineWorkspaceRepository,
  PipelineWorkspaceError,
} from "../../src/repositories/memory-pipeline-workspace.repository";
import {
  SupabasePipelineWorkspaceRepository,
  SupabasePipelineWorkspaceRepositoryError,
  type SupabasePublicationPostMapper,
} from "../../src/repositories/supabase-pipeline-workspace.repository";
import {
  generatedPostFixture,
  publishedPostDetailFixture,
} from "../fixtures/contracts";

const RUN_ID = "daily-20260813";
const CONFIGURATION_FINGERPRINT = "c".repeat(64);
const PASSED_QUALITY = {
  passed: true as const,
  checks: [
    {
      type: "evidence",
      passed: true,
      reasons: [],
      checkerVersion: "quality-v1",
    },
  ],
  blockingReasons: [],
};

type ArtifactRow = Readonly<{
  runId: string;
  stage: string;
  kind: string;
  outputReference: string;
  payloadFingerprint: string;
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
  payload: Readonly<Record<string, unknown>>;
}>;

function ingestionResult(): NewsIngestionResult {
  return {
    status: "succeeded",
    outcomes: [
      {
        sourceId: "source-test",
        status: "succeeded",
        startedAt: "2026-08-13T05:59:00+09:00",
        finishedAt: "2026-08-13T05:59:01+09:00",
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
  const audit = {
    callId: "call-draft-1",
    attemptNumber: 1 as const,
    purpose: "draft" as const,
    providerId: "provider-test",
    modelId: "model-test",
    promptVersion: "prompt-v1",
    startedAt: "2026-08-13T06:00:00+09:00",
    finishedAt: "2026-08-13T06:00:01+09:00",
    evidenceIds: ["evidence-1"],
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    estimatedCostUsd: 0.01,
    finishReason: "stop",
    responseId: "response-1",
  };
  return {
    status: "validated",
    post: structuredClone(generatedPostFixture),
    qualityResult: structuredClone(PASSED_QUALITY),
    audits: [audit],
    attempts: [
      {
        attemptNumber: 1,
        purpose: "draft",
        status: "succeeded",
        audit,
        errorCode: null,
      },
    ],
    usage: {
      modelCalls: 1,
      inputTokens: 20,
      outputTokens: 10,
      estimatedCostUsd: 0.01,
      hasUnpricedCalls: false,
    },
    failureCode: null,
    providerErrorCode: null,
    pipelineVersion: "post-generation-v1",
  };
}

async function seedRows(options: { includeGeneration?: boolean } = {}): Promise<{
  rows: ArtifactRow[];
  collectReference: string;
  scoreReference: string;
  generationReference: string | null;
}> {
  const memory = new MemoryPipelineWorkspaceRepository();
  const collect = await memory.putArtifact({
    runId: RUN_ID,
    stage: "collect",
    configurationFingerprint: CONFIGURATION_FINGERPRINT,
    parentOutputReferences: [],
    artifact: { kind: "news_ingestion", value: ingestionResult() },
  });
  const score = await memory.putArtifact({
    runId: RUN_ID,
    stage: "score",
    configurationFingerprint: CONFIGURATION_FINGERPRINT,
    parentOutputReferences: [collect.outputReference],
    artifact: {
      kind: "topic_selection",
      value: { outcome: "none", candidate: null, evidenceItems: [] },
    },
  });
  const references = [collect.outputReference, score.outputReference];
  let generationReference: string | null = null;
  if (options.includeGeneration) {
    const generation = await memory.putArtifact({
      runId: RUN_ID,
      stage: "generate",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [score.outputReference],
      artifact: { kind: "post_generation", value: generationResult() },
    });
    generationReference = generation.outputReference;
    references.push(generation.outputReference);
  }
  const rows: ArtifactRow[] = [];
  for (const outputReference of references) {
    const metadata = await memory.getArtifactMetadata(outputReference);
    const payload = await memory.getArtifact(outputReference);
    rows.push({
      ...metadata,
      outputReference,
      payload: payload as unknown as Readonly<Record<string, unknown>>,
    });
  }
  return {
    rows,
    collectReference: collect.outputReference,
    scoreReference: score.outputReference,
    generationReference,
  };
}

class FakeDataSource implements SupabasePipelineWorkspaceDataSource {
  readonly rows = new Map<string, ArtifactRow>();
  readonly putRequests: SupabasePipelineWorkspacePutRequest[] = [];
  nextPutResult: SupabasePipelineWorkspaceDataResult | null = null;
  nextGetResult: SupabasePipelineWorkspaceDataResult | null = null;
  throwOnGet = false;

  constructor(rows: readonly ArtifactRow[] = []) {
    for (const row of rows) this.rows.set(row.outputReference, structuredClone(row));
  }

  async putArtifact(
    input: Readonly<SupabasePipelineWorkspacePutRequest>,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    this.putRequests.push(structuredClone(input));
    if (this.nextPutResult !== null) return this.nextPutResult;
    const row: ArtifactRow = {
      runId: input.runId,
      stage: input.stage,
      kind: input.kind,
      outputReference: input.outputReference,
      payloadFingerprint: input.payloadFingerprint,
      configurationFingerprint: input.configurationFingerprint,
      parentOutputReferences: [...input.parentOutputReferences],
      payload: structuredClone(input.payload),
    };
    const existing = [...this.rows.values()].find(
      (candidate) =>
        candidate.runId === input.runId && candidate.stage === input.stage,
    );
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(row)) {
        return {
          data: null,
          error: { code: "P0001", message: "OUTPUT_CONFLICT" },
        };
      }
      return { data: { created: false, artifact: existing }, error: null };
    }
    this.rows.set(row.outputReference, row);
    return { data: { created: true, artifact: row }, error: null };
  }

  async getArtifactByReference(
    outputReference: string,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    if (this.throwOnGet) throw new Error("secret-payload-must-not-leak");
    if (this.nextGetResult !== null) return this.nextGetResult;
    return {
      data: structuredClone(this.rows.get(outputReference) ?? null),
      error: null,
    };
  }

  async getArtifactForStage(
    runId: string,
    stage: string,
  ): Promise<SupabasePipelineWorkspaceDataResult> {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.runId === runId && candidate.stage === stage,
    );
    return { data: structuredClone(row ?? null), error: null };
  }
}

const authority = vi.fn(async () => ({
  runDate: "2026-08-13",
  runId: RUN_ID,
  leaseToken: "lease-token-1",
  fence: 2,
  expectedRevision: 4,
}));
const publicationMapper: SupabasePublicationPostMapper = async () =>
  structuredClone(publishedPostDetailFixture);

function repository(
  source: FakeDataSource,
  mapper: SupabasePublicationPostMapper = publicationMapper,
): SupabasePipelineWorkspaceRepository {
  authority.mockClear();
  return new SupabasePipelineWorkspaceRepository(source, authority, mapper);
}

async function expectWorkspaceError(
  operation: Promise<unknown>,
  code: PipelineWorkspaceError["code"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: "PipelineWorkspaceError",
    code,
  });
}

describe("SupabasePipelineWorkspaceRepository", () => {
  it("stage context authority를 closure 없이 exact fenced put에 사용한다", async () => {
    const seeded = await seedRows();
    const source = new FakeDataSource(seeded.rows);
    const workspace = repository(source);

    const stored = await workspace.putArtifactWithAuthority(
      {
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [seeded.scoreReference],
        artifact: { kind: "post_generation", value: generationResult() },
      },
      {
        runDate: "2026-08-13",
        runId: RUN_ID,
        stage: "generate",
        leaseToken: "context-lease-token",
        fence: 7,
        expectedRevision: 12,
      },
    );

    expect(stored.created).toBe(true);
    expect(authority).not.toHaveBeenCalled();
    expect(source.putRequests).toHaveLength(1);
    expect(source.putRequests[0]).toMatchObject({
      runDate: "2026-08-13",
      runId: RUN_ID,
      stage: "generate",
      leaseToken: "context-lease-token",
      fence: 7,
      expectedRevision: 12,
    });
  });

  it("explicit authority의 runId·stage·runtime 계약 불일치를 RPC 전에 거부한다", async () => {
    const seeded = await seedRows();
    const input = {
      runId: RUN_ID,
      stage: "generate" as const,
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [seeded.scoreReference],
      artifact: { kind: "post_generation" as const, value: generationResult() },
    };

    for (const explicitAuthority of [
      {
        runDate: "2026-08-13",
        runId: "different-run",
        stage: "generate" as const,
        leaseToken: "lease-token-1",
        fence: 2,
        expectedRevision: 4,
      },
      {
        runDate: "2026-08-13",
        runId: RUN_ID,
        stage: "validate" as const,
        leaseToken: "lease-token-1",
        fence: 2,
        expectedRevision: 4,
      },
      {
        runDate: "2026-08-13",
        runId: RUN_ID,
        stage: "generate" as const,
        leaseToken: "lease-token-1",
        fence: 0,
        expectedRevision: 4,
      },
    ]) {
      const source = new FakeDataSource(seeded.rows);
      await expect(
        repository(source).putArtifactWithAuthority(input, explicitAuthority),
      ).rejects.toMatchObject({
        code:
          explicitAuthority.runId !== RUN_ID
            ? "RUN_ID_MISMATCH"
            : explicitAuthority.stage !== "generate"
              ? "INVALID_ARTIFACT_LINEAGE"
              : "INVALID_RESPONSE",
      });
      expect(source.putRequests).toHaveLength(0);
      expect(authority).not.toHaveBeenCalled();
    }
  });

  it("fenced generate put과 crash lookup에서 AI usage·audit를 보존한다", async () => {
    const seeded = await seedRows();
    const source = new FakeDataSource(seeded.rows);
    const workspace = repository(source);
    const generated = generationResult();

    const stored = await workspace.putArtifact({
      runId: RUN_ID,
      stage: "generate",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [seeded.scoreReference],
      artifact: { kind: "post_generation", value: generated },
    });

    expect(source.putRequests[0]).toMatchObject({
      runDate: "2026-08-13",
      runId: RUN_ID,
      leaseToken: "lease-token-1",
      fence: 2,
      expectedRevision: 4,
      stage: "generate",
      kind: "post_generation",
    });
    expect(stored.created).toBe(true);
    await expect(
      workspace.putArtifact({
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [seeded.scoreReference],
        artifact: { kind: "post_generation", value: structuredClone(generated) },
      }),
    ).resolves.toEqual({ ...stored, created: false });
    const recovered = await workspace.getArtifactForStage({
      runId: RUN_ID,
      stage: "generate",
      kind: "post_generation",
    });
    expect(recovered?.artifact).toEqual({
      kind: "post_generation",
      value: generated,
    });
    expect(
      recovered?.artifact.kind === "post_generation"
        ? recovered.artifact.value.audits[0]?.callId
        : null,
    ).toBe("call-draft-1");
  });

  it("publication은 validated generation의 exact quality와 mapper 결과만 저장한다", async () => {
    const seeded = await seedRows({ includeGeneration: true });
    const source = new FakeDataSource(seeded.rows);
    const workspace = repository(source);
    const generationReference = seeded.generationReference!;

    const stored = await workspace.putArtifact({
      runId: RUN_ID,
      stage: "validate",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [generationReference],
      artifact: {
        kind: "publication",
        value: {
          post: publishedPostDetailFixture,
          qualityResult: PASSED_QUALITY,
          generationOutputReference: generationReference,
        },
      },
    });
    expect(stored.created).toBe(true);
    await expect(
      workspace.getArtifact(stored.outputReference, {
        runId: RUN_ID,
        stage: "validate",
        kind: "publication",
      }),
    ).resolves.toMatchObject({ kind: "publication" });

    const changedQuality = structuredClone(PASSED_QUALITY);
    changedQuality.checks[0]!.checkerVersion = "quality-v2";
    await expectWorkspaceError(
      workspace.putArtifact({
        runId: RUN_ID,
        stage: "validate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [generationReference],
        artifact: {
          kind: "publication",
          value: {
            post: publishedPostDetailFixture,
            qualityResult: changedQuality,
            generationOutputReference: generationReference,
          },
        },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
  });

  it("publication의 parent·generation ref·결정론적 post가 다르면 닫힌 채 실패한다", async () => {
    const seeded = await seedRows({ includeGeneration: true });
    const source = new FakeDataSource(seeded.rows);
    const workspace = repository(source, async () => ({
      ...publishedPostDetailFixture,
      title: "다른 게시물 제목",
    }));
    const generationReference = seeded.generationReference!;

    await expectWorkspaceError(
      workspace.putArtifact({
        runId: RUN_ID,
        stage: "validate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [generationReference],
        artifact: {
          kind: "publication",
          value: {
            post: publishedPostDetailFixture,
            qualityResult: PASSED_QUALITY,
            generationOutputReference: generationReference,
          },
        },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
    expect(source.putRequests).toHaveLength(0);

    const missingParentSource = new FakeDataSource(
      seeded.rows.filter(
        (row) => row.outputReference !== generationReference,
      ),
    );
    await expectWorkspaceError(
      repository(missingParentSource).putArtifact({
        runId: RUN_ID,
        stage: "validate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [generationReference],
        artifact: {
          kind: "publication",
          value: {
            post: publishedPostDetailFixture,
            qualityResult: PASSED_QUALITY,
            generationOutputReference: generationReference,
          },
        },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
  });

  it("collect·score generic put을 거부해 domain RPC를 우회하지 않는다", async () => {
    const source = new FakeDataSource();
    const workspace = repository(source);
    await expectWorkspaceError(
      workspace.putArtifact({
        runId: RUN_ID,
        stage: "collect",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [],
        artifact: { kind: "news_ingestion", value: ingestionResult() },
      }),
      "INVALID_ARTIFACT_LINEAGE",
    );
    expect(source.putRequests).toHaveLength(0);
  });

  it("RPC conflict와 stale·expired lease 오류를 stable 오류로 매핑한다", async () => {
    const seeded = await seedRows();
    for (const [message, expectedName] of [
      ["OUTPUT_CONFLICT", "PipelineWorkspaceError"],
      ["STALE_JOURNAL_REVISION", "DailyRunStoreError"],
      ["LEASE_EXPIRED", "DailyRunStoreError"],
    ] as const) {
      const source = new FakeDataSource(seeded.rows);
      source.nextPutResult = {
        data: null,
        error: { code: "P0001", message },
      };
      const workspace = repository(source);
      await expect(
        workspace.putArtifact({
          runId: RUN_ID,
          stage: "generate",
          configurationFingerprint: CONFIGURATION_FINGERPRINT,
          parentOutputReferences: [seeded.scoreReference],
          artifact: { kind: "post_generation", value: generationResult() },
        }),
      ).rejects.toMatchObject({ name: expectedName, code: message });
    }
  });

  it("malformed·다른 scope·network 응답은 payload 없이 stable fail-closed 처리한다", async () => {
    const seeded = await seedRows({ includeGeneration: true });
    const generationReference = seeded.generationReference!;

    const malformedSource = new FakeDataSource(seeded.rows);
    malformedSource.nextGetResult = { data: { runId: RUN_ID }, error: null };
    await expect(
      repository(malformedSource).getArtifact(generationReference),
    ).rejects.toBeInstanceOf(SupabasePipelineWorkspaceRepositoryError);

    const wrongSource = new FakeDataSource(seeded.rows);
    const wrongRow = structuredClone(seeded.rows[0]!);
    wrongSource.nextGetResult = { data: wrongRow, error: null };
    await expectWorkspaceError(
      repository(wrongSource).getArtifact(generationReference),
      "OUTPUT_SCOPE_MISMATCH",
    );

    const tamperedSource = new FakeDataSource(seeded.rows);
    const generationRow = tamperedSource.rows.get(generationReference)!;
    tamperedSource.rows.set(generationReference, {
      ...generationRow,
      payloadFingerprint: "d".repeat(64),
    });
    await expectWorkspaceError(
      repository(tamperedSource).getArtifact(generationReference),
      "INVALID_OUTPUT_REFERENCE",
    );

    const networkSource = new FakeDataSource(seeded.rows);
    networkSource.throwOnGet = true;
    try {
      await repository(networkSource).getArtifact(generationReference);
      throw new Error("network failure가 필요합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(SupabasePipelineWorkspaceRepositoryError);
      expect((error as Error).message).toBe("DATA_API_ERROR");
      expect((error as Error).message).not.toContain("secret-payload");
    }
  });

  it("authority의 다른 runId와 malformed revision을 RPC 전에 거부한다", async () => {
    const seeded = await seedRows();
    const source = new FakeDataSource(seeded.rows);
    const wrongRun = new SupabasePipelineWorkspaceRepository(
      source,
      async () => ({
        runDate: "2026-08-13",
        runId: "other-run",
        leaseToken: "lease-token-1",
        fence: 2,
        expectedRevision: 4,
      }),
      publicationMapper,
    );
    await expect(
      wrongRun.putArtifact({
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [seeded.scoreReference],
        artifact: { kind: "post_generation", value: generationResult() },
      }),
    ).rejects.toBeInstanceOf(DailyRunStoreError);

    const malformed = new SupabasePipelineWorkspaceRepository(
      source,
      async () => ({
        runDate: "2026-08-13",
        runId: RUN_ID,
        leaseToken: "lease-token-1",
        fence: 2,
        expectedRevision: -1,
      }),
      publicationMapper,
    );
    await expect(
      malformed.putArtifact({
        runId: RUN_ID,
        stage: "generate",
        configurationFingerprint: CONFIGURATION_FINGERPRINT,
        parentOutputReferences: [seeded.scoreReference],
        artifact: { kind: "post_generation", value: generationResult() },
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(source.putRequests).toHaveLength(0);
  });
});
