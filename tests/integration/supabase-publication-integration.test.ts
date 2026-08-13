import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublishedPostDetail } from "../../src/contracts";

import type {
  DailyStageContext,
  DailyStageDefinition,
} from "../../src/pipeline/orchestrator";
import {
  createSupabasePublicationStages,
  mapValidatedGenerationToPublishedPost,
} from "../../src/pipeline/orchestrator";
import {
  SupabasePublisherError,
  createSupabasePipelineArtifactDescriptor,
  type SupabasePipelineWorkspaceArtifact,
  type SupabasePipelineWorkspaceStoredArtifact,
} from "../../src/repositories";
import {
  evidenceItemsFixture,
  generatedPostFixture,
  topicCandidateFixture,
} from "../fixtures/contracts";

const qualityResult = {
  passed: true as const,
  checks: [
    {
      type: "publication-contract",
      passed: true,
      reasons: [],
      checkerVersion: "publication-contract-v1",
    },
  ],
  blockingReasons: [],
};

const postGeneration = {
  status: "validated" as const,
  post: structuredClone(generatedPostFixture),
  qualityResult: structuredClone(qualityResult),
  audits: [],
  attempts: [],
  usage: {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    hasUnpricedCalls: false,
  },
  failureCode: null,
  providerErrorCode: null,
  pipelineVersion: "post-generation-v1" as const,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

class FakePublicationWorkspace {
  private readonly artifacts = new Map<
    string,
    SupabasePipelineWorkspaceStoredArtifact
  >();
  readonly putAuthorities: unknown[] = [];

  constructor() {
    const scoreReference = this.reference(
      "score",
      "topic_selection",
      hash("score-output"),
    );
    const generateReference = this.reference(
      "generate",
      "post_generation",
      hash("generate-output"),
    );
    this.add("score", "topic_selection", {
      kind: "topic_selection",
      value: {
        outcome: "eligible",
        candidate: structuredClone(topicCandidateFixture),
        evidenceItems: structuredClone(evidenceItemsFixture),
      },
    }, scoreReference);
    this.add("generate", "post_generation", {
      kind: "post_generation",
      value: structuredClone(postGeneration),
    }, generateReference);
  }

  private reference(stage: string, kind: string, fingerprint: string) {
    return [
      "memws1",
      Buffer.from("run-20260813", "utf8").toString("base64url"),
      stage,
      kind,
      fingerprint,
    ].join(".");
  }

  private add(
    stage: "score" | "generate" | "validate",
    kind: "topic_selection" | "post_generation" | "publication",
    artifact: SupabasePipelineWorkspaceArtifact,
    outputReference = `${stage}-${kind}-reference`,
  ) {
    this.artifacts.set(stage, {
      runId: "run-20260813",
      stage,
      kind,
      artifact,
      outputReference,
      payloadFingerprint: hash(`${stage}-payload`),
      configurationFingerprint: hash(`${stage}-configuration`),
      parentOutputReferences:
        stage === "score"
          ? ["collect-reference"]
          : stage === "generate"
            ? ["score-topic_selection-reference"]
            : ["generate-post_generation-reference"],
    });
  }

  async getArtifactForStage(input: { stage: string }) {
    return structuredClone(this.artifacts.get(input.stage) ?? null);
  }

  async getArtifact(reference: string) {
    const found = [...this.artifacts.values()].find(
      (artifact) => artifact.outputReference === reference,
    );
    if (!found) throw new Error("not found");
    return structuredClone(found.artifact);
  }

  async validateOutputReference(
    reference: string | null,
    scope: { stage?: string } = {},
  ) {
    if (reference === null) return false;
    return [...this.artifacts.values()].some(
      (artifact) =>
        artifact.outputReference === reference &&
        (scope.stage === undefined || artifact.stage === scope.stage),
    );
  }

  async putArtifactWithAuthority(
    input: {
      runId: string;
      stage: "validate";
      configurationFingerprint: string;
      parentOutputReferences: readonly string[];
      artifact: SupabasePipelineWorkspaceArtifact;
    },
    authority: unknown,
  ) {
    this.putAuthorities.push(structuredClone(authority));
    const descriptor = createSupabasePipelineArtifactDescriptor(input);
    this.add(
      "validate",
      "publication",
      structuredClone(input.artifact),
      descriptor.outputReference,
    );
    return {
      outputReference: descriptor.outputReference,
      payloadFingerprint: descriptor.payloadFingerprint,
      created: true,
    };
  }
}

function context(stage: "validate" | "publish"): DailyStageContext {
  return {
    runId: "run-20260813",
    runDate: "2026-08-13",
    stage,
    attemptNumber: 1,
    signal: new AbortController().signal,
    limits: {
      maxModelCalls: 4,
      maxInputTokens: 10_000,
      maxOutputTokens: 4_000,
      maxEstimatedCostUsd: 1,
      maxRunSeconds: 900,
    },
    usage: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      hasUnpricedCalls: false,
    },
    leaseToken: "lease-token-1",
    leaseFence: 2,
    journalRevision: stage === "validate" ? 7 : 9,
  };
}

async function validateAndGetPost(
  workspace: FakePublicationWorkspace,
  validate: DailyStageDefinition,
) {
  const result = await validate.execute(context("validate"));
  const artifact = await workspace.getArtifact(result.outputReference!);
  if (artifact.kind !== "publication") throw new Error("publication expected");
  return { result, artifact };
}

describe("Supabase publication stage integration", () => {
  it("validated generation을 publication으로 변환하고 context authority를 그대로 전달한다", async () => {
    const workspace = new FakePublicationWorkspace();
    const [validate] = createSupabasePublicationStages({
      workspace,
      publisher: { publish: async () => { throw new Error("not called"); } },
      publishReceipt: { get: async () => null },
    });
    const { artifact } = await validateAndGetPost(workspace, validate);

    expect(workspace.putAuthorities).toEqual([
      {
        runDate: "2026-08-13",
        runId: "run-20260813",
        leaseToken: "lease-token-1",
        fence: 2,
        expectedRevision: 7,
        stage: "validate",
      },
    ]);
    expect(artifact.value.post).toEqual(
      mapValidatedGenerationToPublishedPost({
        identity: {
          id: artifact.value.post.id,
          slug: artifact.value.post.slug,
          publicationDateKst: artifact.value.post.publicationDateKst,
          publishedAt: artifact.value.post.publishedAt,
          modifiedAt: artifact.value.post.modifiedAt,
          visual: artifact.value.post.visual,
        },
        generatedPost: generatedPostFixture,
        qualityResult,
        evidenceItems: evidenceItemsFixture,
      }),
    );
  });

  it("publish는 한 번만 호출하고 exact receipt로 출력 참조를 검증한다", async () => {
    const workspace = new FakePublicationWorkspace();
    const publishInputs: Array<Record<string, unknown>> = [];
    let receiptInput: Record<string, unknown> | null = null;
    let publishedPost: PublishedPostDetail | null = null;
    const stages = createSupabasePublicationStages({
      workspace,
      publisher: {
        publish: async (input) => {
          publishInputs.push(structuredClone(input));
          publishedPost = structuredClone(input.post);
          return { ...input, post: input.post };
        },
      },
      publishReceipt: {
        get: async (input) => {
          receiptInput = structuredClone(input);
          return publishedPost === null ? null : { ...input, post: publishedPost };
        },
      },
    });
    await validateAndGetPost(workspace, stages[0]);
    const result = await stages[1].execute(context("publish"));

    expect(publishInputs).toHaveLength(1);
    expect(publishInputs[0]).toMatchObject({
      runDate: "2026-08-13",
      runId: "run-20260813",
      leaseToken: "lease-token-1",
      fence: 2,
      expectedRevision: 9,
      topicId: topicCandidateFixture.topicId,
    });
    expect(
      await stages[1].validateOutputReference(
        result.outputReference,
        new AbortController().signal,
        { runId: "run-20260813", runDate: "2026-08-13", stage: "publish" },
      ),
    ).toBe(true);
    expect(receiptInput).toMatchObject({
      runDate: "2026-08-13",
      runId: "run-20260813",
      validationOutputReference: result.outputReference,
    });
  });

  it("모호한 publish 응답은 재호출 없이 008 receipt 한 번으로만 조정한다", async () => {
    const workspace = new FakePublicationWorkspace();
    let publishCalls = 0;
    let receiptCalls = 0;
    let validationReference = "";
    const stages = createSupabasePublicationStages({
      workspace,
      publisher: {
        publish: async (input) => {
          publishCalls += 1;
          validationReference = input.validationOutputReference;
          throw new SupabasePublisherError("PUBLISH_TIMEOUT_AMBIGUOUS");
        },
      },
      publishReceipt: {
        get: async (input) => {
          receiptCalls += 1;
          const artifact = await workspace.getArtifact(validationReference);
          if (artifact.kind !== "publication") return null;
          return { ...input, post: artifact.value.post };
        },
      },
    });
    await validateAndGetPost(workspace, stages[0]);
    const result = await stages[1].execute(context("publish"));

    expect(result.outcome).toBe("succeeded");
    expect(publishCalls).toBe(1);
    expect(receiptCalls).toBe(1);
    expect(
      await stages[1].validateOutputReference(
        result.outputReference,
        new AbortController().signal,
        { runId: "run-20260813", runDate: "2026-08-13", stage: "publish" },
      ),
    ).toBe(true);
    expect(receiptCalls).toBe(1);
  });

  it("receipt identity나 공개 본문이 결정론적 publication과 다르면 거부한다", async () => {
    const workspace = new FakePublicationWorkspace();
    const stages = createSupabasePublicationStages({
      workspace,
      publisher: { publish: async () => { throw new Error("not called"); } },
      publishReceipt: {
        get: async (input) => {
          const artifact = await workspace.getArtifact(
            input.validationOutputReference,
          );
          if (artifact.kind !== "publication") return null;
          return {
            ...input,
            post: { ...artifact.value.post, title: "변조된 공개 제목" },
          };
        },
      },
    });
    const { result } = await validateAndGetPost(workspace, stages[0]);

    expect(
      await stages[1].validateOutputReference(
        result.outputReference,
        new AbortController().signal,
        { runId: "run-20260813", runDate: "2026-08-13", stage: "publish" },
      ),
    ).toBe(false);
  });
});
