import { createHash } from "node:crypto";

import type {
  GenerationUsage,
  PublishedPostDetail,
  QualityResult,
} from "../../contracts";
import {
  SupabasePipelineWorkspaceRepositoryError,
  SupabasePublisherError,
  type SupabasePipelineWorkspaceRepository,
  type SupabasePublishReceiptRepository,
  type SupabasePublisherRepository,
} from "../../repositories";
import { mapValidatedGenerationToPublishedPost } from "./publication-mapping";
import {
  DailyStepError,
  DailyStageCommitUncertainError,
  type DailyStageContext,
  type DailyStageDefinition,
  type DailyStageFingerprintContext,
} from "./run-daily-pipeline";

export const SUPABASE_PUBLICATION_INTEGRATION_VERSION =
  "supabase-publication-integration-v1";

const EMPTY_USAGE: GenerationUsage = Object.freeze({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  hasUnpricedCalls: false,
});

type PublicationWorkspace = Pick<
  SupabasePipelineWorkspaceRepository,
  | "getArtifactForStage"
  | "getExactArtifactForStage"
  | "getArtifact"
  | "validateOutputReference"
  | "putArtifactWithAuthority"
>;

export interface CreateSupabasePublicationStagesOptions {
  workspace: PublicationWorkspace;
  publisher: Pick<SupabasePublisherRepository, "publish">;
  publishReceipt: Pick<SupabasePublishReceiptRepository, "get">;
  configurationId?: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function createDeterministicPublicationIdentity(input: {
  runDate: string;
  runId: string;
  generationOutputReference: string;
}) {
  const suffix = fingerprint(input).slice(0, 20);
  const compactDate = input.runDate.replaceAll("-", "");
  const placeholderTime = `${input.runDate}T07:00:00+09:00`;
  return {
    postId: `post-${compactDate}-${suffix}`,
    revisionId: `revision-${compactDate}-${suffix}`,
    slug: `ai-digital-education-${input.runDate}-${suffix.slice(0, 8)}`,
    publishedAt: placeholderTime,
    modifiedAt: placeholderTime,
    visual: {
      kind: "pattern" as const,
      seed: `visual-${suffix}`,
      templateVersion: "gallery-v1",
    },
  };
}

async function getSelectedTopic(
  workspace: PublicationWorkspace,
  runId: string,
) {
  const stored = await workspace.getArtifactForStage({
    runId,
    stage: "score",
    kind: "topic_selection",
  });
  if (
    stored === null ||
    stored.artifact.kind !== "topic_selection" ||
    stored.artifact.value.outcome !== "eligible" ||
    stored.artifact.value.candidate === null
  ) {
    throw new DailyStepError("INVALID_SOURCE_DATA", false);
  }
  return stored;
}

async function getValidatedGeneration(
  workspace: PublicationWorkspace,
  runId: string,
) {
  const stored = await workspace.getArtifactForStage({
    runId,
    stage: "generate",
    kind: "post_generation",
  });
  if (
    stored === null ||
    stored.artifact.kind !== "post_generation" ||
    stored.artifact.value.status !== "validated" ||
    stored.artifact.value.post === null ||
    stored.artifact.value.qualityResult?.passed !== true
  ) {
    throw new DailyStepError("INVALID_SOURCE_DATA", false);
  }
  return stored;
}

export async function mapSupabasePublicationForGeneration(input: {
  workspace: PublicationWorkspace;
  runDate: string;
  runId: string;
  generationOutputReference: string;
  generatedPost: Parameters<typeof mapValidatedGenerationToPublishedPost>[0]["generatedPost"];
  qualityResult: QualityResult;
}): Promise<PublishedPostDetail> {
  const selected = await getSelectedTopic(input.workspace, input.runId);
  if (
    selected.artifact.kind !== "topic_selection" ||
    selected.artifact.value.candidate === null
  ) {
    throw new DailyStepError("INVALID_SOURCE_DATA", false);
  }
  const identity = createDeterministicPublicationIdentity({
    runDate: input.runDate,
    runId: input.runId,
    generationOutputReference: input.generationOutputReference,
  });
  return mapValidatedGenerationToPublishedPost({
    identity: {
      id: identity.postId,
      slug: identity.slug,
      publicationDateKst: input.runDate,
      publishedAt: identity.publishedAt,
      modifiedAt: identity.modifiedAt,
      visual: identity.visual,
    },
    generatedPost: input.generatedPost,
    qualityResult: input.qualityResult,
    evidenceItems: selected.artifact.value.evidenceItems,
  });
}

async function publicationForRun(
  workspace: PublicationWorkspace,
  context: Readonly<Pick<DailyStageFingerprintContext, "runId" | "runDate">>,
): Promise<{
  post: PublishedPostDetail;
  revisionId: string;
  topicId: string;
  generationOutputReference: string;
  validationOutputReference: string | null;
  qualityResult: QualityResult;
}> {
  const [selected, generated, validation] = await Promise.all([
    getSelectedTopic(workspace, context.runId),
    getValidatedGeneration(workspace, context.runId),
    workspace.getArtifactForStage({
      runId: context.runId,
      stage: "validate",
      kind: "publication",
    }),
  ]);
  if (
    selected.artifact.kind !== "topic_selection" ||
    selected.artifact.value.candidate === null ||
    generated.artifact.kind !== "post_generation" ||
    generated.artifact.value.post === null ||
    generated.artifact.value.qualityResult === null
  ) {
    throw new DailyStepError("INVALID_SOURCE_DATA", false);
  }
  const identity = createDeterministicPublicationIdentity({
    runDate: context.runDate,
    runId: context.runId,
    generationOutputReference: generated.outputReference,
  });
  const post = await mapSupabasePublicationForGeneration({
    workspace,
    runDate: context.runDate,
    runId: context.runId,
    generationOutputReference: generated.outputReference,
    generatedPost: generated.artifact.value.post,
    qualityResult: generated.artifact.value.qualityResult,
  });
  return {
    post,
    revisionId: identity.revisionId,
    topicId: selected.artifact.value.candidate.topicId,
    generationOutputReference: generated.outputReference,
    validationOutputReference: validation?.outputReference ?? null,
    qualityResult: generated.artifact.value.qualityResult,
  };
}

function authority(context: Readonly<DailyStageContext>) {
  return {
    runDate: context.runDate,
    runId: context.runId,
    leaseToken: context.leaseToken,
    fence: context.leaseFence,
    expectedRevision: context.journalRevision,
    stage: context.stage,
  } as const;
}

function samePublishedContent(
  expected: PublishedPostDetail,
  actual: PublishedPostDetail,
): boolean {
  const withoutServerTimes = (post: PublishedPostDetail) => ({
    id: post.id,
    slug: post.slug,
    publicationDateKst: post.publicationDateKst,
    title: post.title,
    summary: post.summary,
    visual: post.visual,
    oneLineSummary: post.oneLineSummary,
    body: post.body,
    questions: post.questions,
    sources: post.sources,
  });
  return stableJson(withoutServerTimes(expected)) === stableJson(withoutServerTimes(actual));
}

export function createSupabasePublicationStages(
  options: Readonly<CreateSupabasePublicationStagesOptions>,
): DailyStageDefinition[] {
  const configurationFingerprint = fingerprint({
    version: SUPABASE_PUBLICATION_INTEGRATION_VERSION,
    configurationId: options.configurationId ?? "publication-v1",
  });
  const verifiedReceiptKeys = new Set<string>();
  const verifiedValidationReferences = new Set<string>();

  const validate: DailyStageDefinition = {
    stage: "validate",
    inputFingerprint: null,
    resolveInputFingerprint: async (context) => {
      const generated = await getValidatedGeneration(
        options.workspace,
        context.runId,
      );
      return fingerprint({ configurationFingerprint, parent: generated.outputReference });
    },
    retryPolicy: {
      // Attempt two can only reuse an exact committed validation artifact.
      maxAttempts: 2,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 60_000,
    },
    validateOutputReference: async (reference, _signal, context) => {
      if (reference === null || context === undefined) return false;
      if (verifiedValidationReferences.has(reference)) return true;
      const publication = await publicationForRun(options.workspace, context);
      const expected = {
        runId: context.runId,
        stage: "validate" as const,
        configurationFingerprint,
        parentOutputReferences: [publication.generationOutputReference],
        artifact: {
          kind: "publication" as const,
          value: {
            post: publication.post,
            qualityResult: publication.qualityResult,
            generationOutputReference: publication.generationOutputReference,
          },
        },
      };
      const stored = await options.workspace.getExactArtifactForStage(expected);
      return stored?.outputReference === reference;
    },
    execute: async (context) => {
      const publication = await publicationForRun(options.workspace, context);
      const inputFingerprint = fingerprint({
        configurationFingerprint,
        parent: publication.generationOutputReference,
      });
      const writeInput = {
        runId: context.runId,
        stage: "validate" as const,
        configurationFingerprint,
        parentOutputReferences: [publication.generationOutputReference],
        artifact: {
          kind: "publication" as const,
          value: {
            post: publication.post,
            qualityResult: publication.qualityResult,
            generationOutputReference: publication.generationOutputReference,
          },
        },
      };
      const existing =
        await options.workspace.getExactArtifactForStage(writeInput);
      if (existing !== null) {
        verifiedValidationReferences.add(existing.outputReference);
        return {
          outcome: "succeeded",
          inputFingerprint,
          outputReference: existing.outputReference,
          usage: EMPTY_USAGE,
        };
      }
      let stored;
      try {
        stored = await options.workspace.putArtifactWithAuthority(
          writeInput,
          authority(context),
        );
      } catch (error) {
        if (
          !(error instanceof SupabasePipelineWorkspaceRepositoryError) ||
          error.code !== "DATA_API_ERROR"
        ) {
          throw error;
        }
        try {
          const reconciled =
            await options.workspace.getExactArtifactForStage(writeInput);
          if (reconciled === null) {
            throw new DailyStageCommitUncertainError({ cause: error });
          }
          stored = {
            outputReference: reconciled.outputReference,
            payloadFingerprint: reconciled.payloadFingerprint,
            created: false,
          };
        } catch (reconcileError) {
          if (reconcileError instanceof DailyStageCommitUncertainError) {
            throw reconcileError;
          }
          throw new DailyStageCommitUncertainError({
            cause: reconcileError,
          });
        }
      }
      verifiedValidationReferences.add(stored.outputReference);
      return {
        outcome: "succeeded",
        inputFingerprint,
        outputReference: stored.outputReference,
        usage: EMPTY_USAGE,
      };
    },
  };

  const receiptResult = async (
    context: Readonly<DailyStageFingerprintContext>,
    expectedReference: string | null,
  ) => {
    const publication = await publicationForRun(options.workspace, context);
    const validationOutputReference =
      publication.validationOutputReference ?? expectedReference;
    if (
      validationOutputReference === null ||
      (expectedReference !== null && validationOutputReference !== expectedReference)
    ) {
      return null;
    }
    const receiptKey = fingerprint({
      runDate: context.runDate,
      runId: context.runId,
      revisionId: publication.revisionId,
      validationOutputReference,
    });
    if (verifiedReceiptKeys.has(receiptKey)) {
      return {
        outcome: "succeeded" as const,
        inputFingerprint: fingerprint({
          configurationFingerprint,
          validationOutputReference,
          topicId: publication.topicId,
        }),
        outputReference: validationOutputReference,
        usage: EMPTY_USAGE,
      };
    }
    const receipt = await options.publishReceipt.get({
      runDate: context.runDate,
      runId: context.runId,
      revisionId: publication.revisionId,
      validationOutputReference,
    });
    if (
      receipt === null ||
      receipt.runDate !== context.runDate ||
      receipt.runId !== context.runId ||
      receipt.revisionId !== publication.revisionId ||
      receipt.validationOutputReference !== validationOutputReference ||
      !samePublishedContent(publication.post, receipt.post)
    ) {
      return null;
    }
    verifiedReceiptKeys.add(receiptKey);
    return {
      outcome: "succeeded" as const,
      inputFingerprint: fingerprint({
        configurationFingerprint,
        validationOutputReference,
        topicId: publication.topicId,
      }),
      outputReference: validationOutputReference,
      usage: EMPTY_USAGE,
    };
  };

  const publish: DailyStageDefinition = {
    stage: "publish",
    inputFingerprint: null,
    resolveInputFingerprint: async (context) => {
      const publication = await publicationForRun(options.workspace, context);
      if (publication.validationOutputReference === null) {
        throw new DailyStepError("INVALID_SOURCE_DATA", false);
      }
      return fingerprint({
        configurationFingerprint,
        validationOutputReference: publication.validationOutputReference,
        topicId: publication.topicId,
      });
    },
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 60_000,
    },
    validateOutputReference: async (reference, _signal, context) =>
      context !== undefined &&
      (await receiptResult(context, reference)) !== null,
    reconcileInterrupted: (context) => receiptResult(context, null),
    execute: async (context) => {
      const publication = await publicationForRun(options.workspace, context);
      if (publication.validationOutputReference === null) {
        throw new DailyStepError("INVALID_SOURCE_DATA", false);
      }
      const inputFingerprint = fingerprint({
        configurationFingerprint,
        validationOutputReference: publication.validationOutputReference,
        topicId: publication.topicId,
      });
      try {
        const receipt = await options.publisher.publish({
          runDate: context.runDate,
          runId: context.runId,
          leaseToken: context.leaseToken,
          fence: context.leaseFence,
          expectedRevision: context.journalRevision,
          validationOutputReference: publication.validationOutputReference,
          revisionId: publication.revisionId,
          topicId: publication.topicId,
          post: publication.post,
          qualityResult: publication.qualityResult,
        });
        if (
          receipt.runDate !== context.runDate ||
          receipt.runId !== context.runId ||
          receipt.revisionId !== publication.revisionId ||
          receipt.validationOutputReference !==
            publication.validationOutputReference ||
          !samePublishedContent(publication.post, receipt.post)
        ) {
          throw new DailyStepError("PUBLISH_TIMEOUT_AMBIGUOUS", false);
        }
        verifiedReceiptKeys.add(
          fingerprint({
            runDate: context.runDate,
            runId: context.runId,
            revisionId: publication.revisionId,
            validationOutputReference:
              publication.validationOutputReference,
          }),
        );
      } catch (error) {
        if (!(error instanceof SupabasePublisherError) || !error.ambiguous) {
          throw error;
        }
        const reconciled = await receiptResult(
          context,
          publication.validationOutputReference,
        );
        if (reconciled === null) {
          throw new DailyStepError("PUBLISH_TIMEOUT_AMBIGUOUS", false);
        }
        return reconciled;
      }
      return {
        outcome: "succeeded",
        inputFingerprint,
        outputReference: publication.validationOutputReference,
        usage: EMPTY_USAGE,
      };
    },
  };

  return [validate, publish];
}
