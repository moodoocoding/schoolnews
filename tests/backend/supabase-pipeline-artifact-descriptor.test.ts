import { describe, expect, it } from "vitest";

import type { NewsIngestionResult } from "../../src/pipeline/orchestrator/run-news-ingestion";
import {
  MemoryPipelineWorkspaceRepository,
  PipelineWorkspaceError,
} from "../../src/repositories/memory-pipeline-workspace.repository";
import { createSupabasePipelineArtifactDescriptor } from "../../src/repositories/supabase-pipeline-workspace.repository";

const RUN_ID = "daily-20260813";
const CONFIGURATION_FINGERPRINT = "c".repeat(64);

const ingestion: NewsIngestionResult = {
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

describe("createSupabasePipelineArtifactDescriptor", () => {
  it("collect·score의 참조와 지문을 memory workspace와 동일하게 만든다", async () => {
    const memory = new MemoryPipelineWorkspaceRepository();
    const collectArtifact = {
      kind: "news_ingestion" as const,
      value: ingestion,
    };
    const collectDescriptor = createSupabasePipelineArtifactDescriptor({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [],
      artifact: collectArtifact,
    });
    const memoryCollect = await memory.putArtifact({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [],
      artifact: collectArtifact,
    });
    expect(collectDescriptor).toMatchObject({
      outputReference: memoryCollect.outputReference,
      payloadFingerprint: memoryCollect.payloadFingerprint,
    });

    const scoreArtifact = {
      kind: "topic_selection" as const,
      value: { outcome: "none" as const, candidate: null, evidenceItems: [] },
    };
    const scoreDescriptor = createSupabasePipelineArtifactDescriptor({
      runId: RUN_ID,
      stage: "score",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [collectDescriptor.outputReference],
      artifact: scoreArtifact,
    });
    const memoryScore = await memory.putArtifact({
      runId: RUN_ID,
      stage: "score",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [memoryCollect.outputReference],
      artifact: scoreArtifact,
    });
    expect(scoreDescriptor).toMatchObject({
      outputReference: memoryScore.outputReference,
      payloadFingerprint: memoryScore.payloadFingerprint,
    });
    expect(scoreDescriptor.parentOutputReferences).toEqual([
      collectDescriptor.outputReference,
    ]);
    expect(scoreDescriptor.payload).toEqual(scoreArtifact);
  });

  it("stage-kind 불일치·중복 parent·다른 run parent를 거부한다", () => {
    const collect = createSupabasePipelineArtifactDescriptor({
      runId: RUN_ID,
      stage: "collect",
      configurationFingerprint: CONFIGURATION_FINGERPRINT,
      parentOutputReferences: [],
      artifact: { kind: "news_ingestion", value: ingestion },
    });

    for (const operation of [
      () =>
        createSupabasePipelineArtifactDescriptor({
          runId: RUN_ID,
          stage: "score",
          configurationFingerprint: CONFIGURATION_FINGERPRINT,
          parentOutputReferences: [collect.outputReference],
          artifact: { kind: "news_ingestion", value: ingestion },
        }),
      () =>
        createSupabasePipelineArtifactDescriptor({
          runId: RUN_ID,
          stage: "score",
          configurationFingerprint: CONFIGURATION_FINGERPRINT,
          parentOutputReferences: [
            collect.outputReference,
            collect.outputReference,
          ],
          artifact: {
            kind: "topic_selection",
            value: { outcome: "none", candidate: null, evidenceItems: [] },
          },
        }),
      () =>
        createSupabasePipelineArtifactDescriptor({
          runId: "different-run",
          stage: "score",
          configurationFingerprint: CONFIGURATION_FINGERPRINT,
          parentOutputReferences: [collect.outputReference],
          artifact: {
            kind: "topic_selection",
            value: { outcome: "none", candidate: null, evidenceItems: [] },
          },
        }),
    ]) {
      expect(operation).toThrow(PipelineWorkspaceError);
    }
  });
});
