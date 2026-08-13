import { createHash } from "node:crypto";

import { z } from "zod";

import {
  dailyRunStoreErrorCodes,
  DailyRunStoreError,
  type DailyRunStoreErrorCode,
} from "../pipeline/orchestrator/daily-run-store";
import {
  identifierSchema,
  pipelineStageSchema,
  publicationDateKstSchema,
  publishedPostDetailSchema,
  qualityResultSchema,
  sha256Schema,
  type GeneratedPost,
  type PipelineStage,
  type PublishedPostDetail,
  type QualityResult,
} from "../contracts";
import type {
  SupabasePipelineWorkspaceDataSource,
  SupabasePipelineWorkspaceDataError,
  SupabasePipelineWorkspaceDataResult,
} from "../db/supabase/pipeline-workspace.data-source";
import {
  MemoryPipelineWorkspaceRepository,
  PipelineWorkspaceError,
  type PipelineWorkspaceArtifact,
  type PipelineWorkspaceArtifactMetadata,
  type PipelineWorkspaceErrorCode,
  type PipelineWorkspaceReferenceScope,
  type PipelineWorkspaceStoredArtifact,
  type PutPipelineWorkspaceArtifactInput,
  type PutPipelineWorkspaceArtifactResult,
} from "./memory-pipeline-workspace.repository";

const WORKSPACE_REFERENCE_VERSION = "memws1";

export interface PublicationWorkspaceArtifactValue {
  post: PublishedPostDetail;
  qualityResult: QualityResult;
  generationOutputReference: string;
}

export interface PublicationWorkspaceArtifact {
  kind: "publication";
  value: PublicationWorkspaceArtifactValue;
}

export type SupabasePipelineWorkspaceArtifact =
  | PipelineWorkspaceArtifact
  | PublicationWorkspaceArtifact;

export type SupabasePipelineWorkspaceArtifactKind =
  SupabasePipelineWorkspaceArtifact["kind"];

export interface PutSupabasePipelineWorkspaceArtifactInput
  extends Omit<PutPipelineWorkspaceArtifactInput, "artifact"> {
  artifact: SupabasePipelineWorkspaceArtifact;
}

export interface SupabasePipelineWorkspaceReferenceScope
  extends Omit<PipelineWorkspaceReferenceScope, "kind"> {
  kind?: SupabasePipelineWorkspaceArtifactKind;
}

export interface SupabasePipelineWorkspaceArtifactMetadata
  extends Omit<PipelineWorkspaceArtifactMetadata, "kind"> {
  kind: SupabasePipelineWorkspaceArtifactKind;
}

export interface SupabasePipelineWorkspaceStoredArtifact
  extends SupabasePipelineWorkspaceArtifactMetadata {
  artifact: SupabasePipelineWorkspaceArtifact;
  outputReference: string;
}

export interface SupabasePipelineArtifactDescriptor {
  outputReference: string;
  payloadFingerprint: string;
  configurationFingerprint: string;
  parentOutputReferences: string[];
  payload: SupabasePipelineWorkspaceArtifact;
}

export interface SupabasePipelineWorkspaceWriteAuthority {
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
}

export interface SupabasePipelineWorkspaceStageAuthority
  extends SupabasePipelineWorkspaceWriteAuthority {
  stage: PipelineStage;
}

export type SupabasePipelineWorkspaceWriteAuthorityProvider = (
  input: Readonly<{ runId: string; stage: PipelineStage }>,
) =>
  | SupabasePipelineWorkspaceWriteAuthority
  | Promise<SupabasePipelineWorkspaceWriteAuthority>;

/** Builds the exact public projection allowed for a validated generation. */
export type SupabasePublicationPostMapper = (
  input: Readonly<{
    runDate: string;
    runId: string;
    generationOutputReference: string;
    generatedPost: GeneratedPost;
    qualityResult: QualityResult;
  }>,
) => PublishedPostDetail | Promise<PublishedPostDetail>;

export type SupabasePipelineWorkspaceRepositoryErrorCode =
  | "DATA_API_ERROR"
  | "INVALID_RESPONSE";

export class SupabasePipelineWorkspaceRepositoryError extends Error {
  constructor(readonly code: SupabasePipelineWorkspaceRepositoryErrorCode) {
    super(code);
    this.name = "SupabasePipelineWorkspaceRepositoryError";
  }
}

const artifactKindSchema = z.enum([
  "news_ingestion",
  "topic_selection",
  "post_generation",
  "publication",
]);

const publicationArtifactSchema = z
  .object({
    kind: z.literal("publication"),
    value: z
      .object({
        post: publishedPostDetailSchema,
        qualityResult: qualityResultSchema,
        generationOutputReference: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (!artifact.value.qualityResult.passed) {
      context.addIssue({
        code: "custom",
        path: ["value", "qualityResult", "passed"],
        message: "발행 산출물에는 통과한 품질 결과가 필요합니다.",
      });
    }
  });

const rowSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    stage: pipelineStageSchema,
    kind: artifactKindSchema,
    outputReference: z.string().trim().min(1).max(500),
    payloadFingerprint: sha256Schema,
    configurationFingerprint: sha256Schema,
    parentOutputReferences: z.array(z.string().trim().min(1).max(500)),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const putResponseSchema = z
  .object({
    created: z.boolean(),
    artifact: rowSchema,
  })
  .strict();

const authoritySchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

const stageAuthoritySchema = authoritySchema
  .extend({ stage: pipelineStageSchema })
  .strict();

type ArtifactRow = z.infer<typeof rowSchema>;
type ParsedReference = {
  runId: string;
  stage: PipelineStage;
  kind: SupabasePipelineWorkspaceArtifactKind;
  outputFingerprint: string;
};

const STAGE_BY_KIND: Readonly<
  Record<SupabasePipelineWorkspaceArtifactKind, PipelineStage>
> = {
  news_ingestion: "collect",
  topic_selection: "score",
  post_generation: "generate",
  publication: "validate",
};

const workspaceErrorCodes = new Set<PipelineWorkspaceErrorCode>([
  "INVALID_ARTIFACT",
  "INVALID_OUTPUT_REFERENCE",
  "OUTPUT_NOT_FOUND",
  "OUTPUT_SCOPE_MISMATCH",
  "INVALID_ARTIFACT_LINEAGE",
  "OUTPUT_CONFLICT",
]);
const dailyRunErrorCodes = new Set<string>(dailyRunStoreErrorCodes);

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new PipelineWorkspaceError("INVALID_ARTIFACT");
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

/**
 * Computes the canonical payload fingerprint used by every Supabase pipeline
 * persistence boundary. Keeping this in one place prevents domain RPC callers
 * from deriving a different identity for the same immutable artifact.
 */
export function fingerprintSupabasePipelineArtifactPayload(value: unknown): string {
  return sha256(value);
}

function parseReference(outputReference: string): ParsedReference {
  try {
    const parts = outputReference.split(".");
    if (parts.length !== 5 || parts[0] !== WORKSPACE_REFERENCE_VERSION) {
      throw new Error("invalid reference");
    }
    const [, encodedRunId, unsafeStage, unsafeKind, unsafeFingerprint] = parts;
    if (!/^[A-Za-z0-9_-]+$/.test(encodedRunId)) {
      throw new Error("invalid run encoding");
    }
    const runId = identifierSchema.parse(
      Buffer.from(encodedRunId, "base64url").toString("utf8"),
    );
    if (Buffer.from(runId, "utf8").toString("base64url") !== encodedRunId) {
      throw new Error("non-canonical run encoding");
    }
    return {
      runId,
      stage: pipelineStageSchema.parse(unsafeStage),
      kind: artifactKindSchema.parse(unsafeKind),
      outputFingerprint: sha256Schema.parse(unsafeFingerprint),
    };
  } catch {
    throw new PipelineWorkspaceError("INVALID_OUTPUT_REFERENCE");
  }
}

function createReference(input: {
  runId: string;
  stage: PipelineStage;
  kind: SupabasePipelineWorkspaceArtifactKind;
  outputFingerprint: string;
}): string {
  return [
    WORKSPACE_REFERENCE_VERSION,
    Buffer.from(input.runId, "utf8").toString("base64url"),
    input.stage,
    input.kind,
    input.outputFingerprint,
  ].join(".");
}

/**
 * Derives the exact immutable identity shared by the collect/score domain RPCs
 * and the generic generate/validate workspace RPC. It performs no I/O.
 */
export function createSupabasePipelineArtifactDescriptor(input: Readonly<{
  runId: string;
  stage: PipelineStage;
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
  artifact: SupabasePipelineWorkspaceArtifact;
}>): SupabasePipelineArtifactDescriptor {
  let runId: string;
  let stage: PipelineStage;
  let configurationFingerprint: string;
  let kind: SupabasePipelineWorkspaceArtifactKind;
  try {
    runId = identifierSchema.parse(input.runId);
    stage = pipelineStageSchema.parse(input.stage);
    configurationFingerprint = sha256Schema.parse(
      input.configurationFingerprint,
    );
    kind = artifactKindSchema.parse(input.artifact.kind);
  } catch {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT");
  }
  if (STAGE_BY_KIND[kind] !== stage) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
  }

  const parentOutputReferences = [...input.parentOutputReferences].sort();
  if (
    new Set(parentOutputReferences).size !== parentOutputReferences.length ||
    (stage === "collect" && parentOutputReferences.length !== 0) ||
    (stage !== "collect" && parentOutputReferences.length === 0)
  ) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
  }
  const requiredParentStage: PipelineStage | null =
    stage === "score"
      ? "collect"
      : stage === "generate"
        ? "score"
        : stage === "validate"
          ? "generate"
          : null;
  const stageIndex = pipelineStageSchema.options.indexOf(stage);
  let hasRequiredParent = requiredParentStage === null;
  for (const reference of parentOutputReferences) {
    let parent: ParsedReference;
    try {
      parent = parseReference(reference);
    } catch {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    if (
      parent.runId !== runId ||
      pipelineStageSchema.options.indexOf(parent.stage) >= stageIndex
    ) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    if (parent.stage === requiredParentStage) hasRequiredParent = true;
  }
  if (!hasRequiredParent) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
  }

  const payload = structuredClone(input.artifact);
  const payloadFingerprint = fingerprintSupabasePipelineArtifactPayload(payload);
  const outputFingerprint = sha256({
    configurationFingerprint,
    kind,
    parentOutputReferences,
    payloadFingerprint,
  });
  return {
    outputReference: createReference({
      runId,
      stage,
      kind,
      outputFingerprint,
    }),
    payloadFingerprint,
    configurationFingerprint,
    parentOutputReferences,
    payload,
  };
}

function assertScope(
  actual: ParsedReference,
  expected: Readonly<SupabasePipelineWorkspaceReferenceScope>,
): void {
  if (
    (expected.runId !== undefined && actual.runId !== expected.runId) ||
    (expected.stage !== undefined && actual.stage !== expected.stage) ||
    (expected.kind !== undefined && actual.kind !== expected.kind)
  ) {
    throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
  }
}

function parsePublication(
  artifact: SupabasePipelineWorkspaceArtifact,
): PublicationWorkspaceArtifact {
  const parsed = publicationArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT");
  }
  return structuredClone(parsed.data);
}

function artifactFromRow(row: ArtifactRow): SupabasePipelineWorkspaceArtifact {
  if (row.payload.kind !== row.kind || !("value" in row.payload)) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT");
  }
  return structuredClone(row.payload) as SupabasePipelineWorkspaceArtifact;
}

function mappedDataError(error: SupabasePipelineWorkspaceDataError): Error {
  const candidate = workspaceErrorCodes.has(error.message as PipelineWorkspaceErrorCode)
    ? (error.message as PipelineWorkspaceErrorCode)
    : workspaceErrorCodes.has(error.code as PipelineWorkspaceErrorCode)
      ? (error.code as PipelineWorkspaceErrorCode)
      : undefined;
  if (candidate !== undefined) return new PipelineWorkspaceError(candidate);

  const dailyCandidate = dailyRunErrorCodes.has(error.message ?? "")
    ? error.message
    : dailyRunErrorCodes.has(error.code ?? "")
      ? error.code
      : undefined;
  if (dailyCandidate !== undefined) {
    return new DailyRunStoreError(dailyCandidate as DailyRunStoreErrorCode);
  }
  return new SupabasePipelineWorkspaceRepositoryError("DATA_API_ERROR");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Persistent counterpart of the memory workspace. All writes pass through a
 * fenced server-only RPC; reads also use server-only RPCs so the private schema
 * does not need to be exposed through the Data API.
 */
export class SupabasePipelineWorkspaceRepository {
  constructor(
    private readonly dataSource: SupabasePipelineWorkspaceDataSource,
    private readonly writeAuthority: SupabasePipelineWorkspaceWriteAuthorityProvider,
    private readonly publicationPostMapper: SupabasePublicationPostMapper,
  ) {}

  async putArtifact(
    input: Readonly<PutSupabasePipelineWorkspaceArtifactInput>,
  ): Promise<PutPipelineWorkspaceArtifactResult> {
    let runId: string;
    let stage: PipelineStage;
    try {
      runId = identifierSchema.parse(input.runId);
      stage = pipelineStageSchema.parse(input.stage);
    } catch {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT");
    }

    let authority: SupabasePipelineWorkspaceWriteAuthority;
    try {
      authority = authoritySchema.parse(
        await this.writeAuthority({ runId, stage }),
      );
    } catch (error) {
      if (error instanceof DailyRunStoreError) throw error;
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    return this.putArtifactWithAuthority(input, { ...authority, stage });
  }

  async putArtifactWithAuthority(
    input: Readonly<PutSupabasePipelineWorkspaceArtifactInput>,
    unsafeAuthority: Readonly<SupabasePipelineWorkspaceStageAuthority>,
  ): Promise<PutPipelineWorkspaceArtifactResult> {
    let runId: string;
    let stage: PipelineStage;
    let configurationFingerprint: string;
    let authority: SupabasePipelineWorkspaceStageAuthority;
    try {
      runId = identifierSchema.parse(input.runId);
      stage = pipelineStageSchema.parse(input.stage);
      configurationFingerprint = sha256Schema.parse(input.configurationFingerprint);
    } catch {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT");
    }
    try {
      authority = stageAuthoritySchema.parse(unsafeAuthority);
    } catch {
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    if (authority.runId !== runId) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (authority.stage !== stage) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }

    const kind = artifactKindSchema.safeParse(input.artifact.kind);
    if (!kind.success || STAGE_BY_KIND[kind.data] !== stage) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    // collect/score are persisted only by their dedicated domain RPCs, which
    // atomically write article/evidence/topic rows with the artifact. The
    // generic workspace RPC must not create lineage without those domain rows.
    if (stage === "collect" || stage === "score") {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    const parentOutputReferences = [...input.parentOutputReferences].sort();
    if (new Set(parentOutputReferences).size !== parentOutputReferences.length) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }

    const artifact = await this.#validateCandidate({
      runDate: authority.runDate,
      runId,
      stage,
      configurationFingerprint,
      parentOutputReferences,
      artifact: input.artifact,
    });
    const descriptor = createSupabasePipelineArtifactDescriptor({
      runId,
      stage,
      configurationFingerprint,
      parentOutputReferences,
      artifact,
    });
    const response = await this.#query(() =>
      this.dataSource.putArtifact({
        runDate: authority.runDate,
        runId: authority.runId,
        leaseToken: authority.leaseToken,
        fence: authority.fence,
        expectedRevision: authority.expectedRevision,
        stage,
        kind: artifact.kind,
        outputReference: descriptor.outputReference,
        payloadFingerprint: descriptor.payloadFingerprint,
        configurationFingerprint,
        parentOutputReferences,
        payload: structuredClone(artifact) as unknown as Readonly<
          Record<string, unknown>
        >,
      }),
    );
    const parsed = putResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    this.#validateRow(parsed.data.artifact, {
      runDate: authority.runDate,
      runId,
      stage,
      kind: artifact.kind,
      outputReference: descriptor.outputReference,
      payloadFingerprint: descriptor.payloadFingerprint,
      configurationFingerprint,
      parentOutputReferences,
      artifact,
    });
    return {
      outputReference: descriptor.outputReference,
      payloadFingerprint: descriptor.payloadFingerprint,
      created: parsed.data.created,
    };
  }

  async getArtifact(
    outputReference: string,
    expected: Readonly<SupabasePipelineWorkspaceReferenceScope> = {},
  ): Promise<SupabasePipelineWorkspaceArtifact> {
    const parsedReference = parseReference(outputReference);
    assertScope(parsedReference, expected);
    const row = await this.#getRowByReference(outputReference);
    if (row === null) throw new PipelineWorkspaceError("OUTPUT_NOT_FOUND");
    const validated = await this.#validateStoredRow(row, new Set());
    assertScope(parsedReference, {
      runId: validated.runId,
      stage: validated.stage,
      kind: validated.kind,
    });
    return structuredClone(validated.artifact);
  }

  async getArtifactMetadata(
    outputReference: string,
    expected: Readonly<SupabasePipelineWorkspaceReferenceScope> = {},
  ): Promise<SupabasePipelineWorkspaceArtifactMetadata> {
    const artifact = await this.getArtifact(outputReference, expected);
    const row = await this.#getRowByReference(outputReference);
    if (row === null) throw new PipelineWorkspaceError("OUTPUT_NOT_FOUND");
    return structuredClone({
      runId: row.runId,
      stage: row.stage,
      kind: artifact.kind,
      payloadFingerprint: row.payloadFingerprint,
      configurationFingerprint: row.configurationFingerprint,
      parentOutputReferences: row.parentOutputReferences,
    });
  }

  async getArtifactForStage(input: {
    runId: string;
    stage: PipelineStage;
    kind: SupabasePipelineWorkspaceArtifactKind;
  }): Promise<SupabasePipelineWorkspaceStoredArtifact | null> {
    let runId: string;
    let stage: PipelineStage;
    let kind: SupabasePipelineWorkspaceArtifactKind;
    try {
      runId = identifierSchema.parse(input.runId);
      stage = pipelineStageSchema.parse(input.stage);
      kind = artifactKindSchema.parse(input.kind);
    } catch {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }
    if (STAGE_BY_KIND[kind] !== stage) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }
    const response = await this.#query(() =>
      this.dataSource.getArtifactForStage(runId, stage),
    );
    if (response === null) return null;
    const parsed = rowSchema.safeParse(response);
    if (!parsed.success) {
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    if (
      parsed.data.runId !== runId ||
      parsed.data.stage !== stage ||
      parsed.data.kind !== kind
    ) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }
    return this.#validateStoredRow(parsed.data, new Set());
  }

  /**
   * Reconciles an ambiguous write without retrying it. `null` means no row was
   * visible; any existing but non-exact row fails closed as OUTPUT_CONFLICT.
   */
  async getExactArtifactForStage(
    expected: Readonly<PutSupabasePipelineWorkspaceArtifactInput>,
  ): Promise<SupabasePipelineWorkspaceStoredArtifact | null> {
    const descriptor = createSupabasePipelineArtifactDescriptor(expected);
    const stored = await this.getArtifactForStage({
      runId: expected.runId,
      stage: expected.stage,
      kind: expected.artifact.kind,
    });
    if (stored === null) return null;
    if (
      stored.outputReference !== descriptor.outputReference ||
      stored.payloadFingerprint !== descriptor.payloadFingerprint ||
      stored.configurationFingerprint !== descriptor.configurationFingerprint ||
      !sameStrings(
        stored.parentOutputReferences,
        descriptor.parentOutputReferences,
      ) ||
      JSON.stringify(canonicalize(stored.artifact)) !==
        JSON.stringify(canonicalize(descriptor.payload))
    ) {
      throw new PipelineWorkspaceError("OUTPUT_CONFLICT");
    }
    return structuredClone(stored);
  }

  async validateOutputReference(
    outputReference: string | null,
    expected: Readonly<SupabasePipelineWorkspaceReferenceScope> = {},
  ): Promise<boolean> {
    if (outputReference === null) return false;
    try {
      await this.getArtifact(outputReference, expected);
      return true;
    } catch {
      return false;
    }
  }

  async #validateCandidate(
    input: Readonly<PutSupabasePipelineWorkspaceArtifactInput> & {
      runDate: string;
    },
  ): Promise<SupabasePipelineWorkspaceArtifact> {
    if (input.artifact.kind === "publication") {
      const publication = parsePublication(input.artifact);
      if (input.parentOutputReferences.length !== 1) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      const parentReference = input.parentOutputReferences[0];
      if (publication.value.generationOutputReference !== parentReference) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      let parent: SupabasePipelineWorkspaceArtifact;
      try {
        parent = await this.getArtifact(parentReference, {
          runId: input.runId,
          stage: "generate",
          kind: "post_generation",
        });
      } catch (error) {
        if (error instanceof PipelineWorkspaceError) {
          throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
        }
        throw error;
      }
      if (parent.kind !== "post_generation") {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      if (
        parent.value.status !== "validated" ||
        parent.value.post === null ||
        parent.value.qualityResult === null ||
        !parent.value.qualityResult.passed ||
        JSON.stringify(canonicalize(parent.value.qualityResult)) !==
          JSON.stringify(canonicalize(publication.value.qualityResult))
      ) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      let expectedPost: PublishedPostDetail;
      try {
        expectedPost = publishedPostDetailSchema.parse(
          await this.publicationPostMapper({
            runDate: input.runDate,
            runId: input.runId,
            generationOutputReference: parentReference,
            generatedPost: structuredClone(parent.value.post),
            qualityResult: structuredClone(parent.value.qualityResult),
          }),
        );
      } catch {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      if (
        JSON.stringify(canonicalize(expectedPost)) !==
        JSON.stringify(canonicalize(publication.value.post))
      ) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      return publication;
    }

    const shadow = new MemoryPipelineWorkspaceRepository();
    const replayed = new Set<string>();
    const visiting = new Set<string>();
    for (const parent of input.parentOutputReferences) {
      await this.#replayMemoryParent(
        parent,
        input.runId,
        shadow,
        replayed,
        visiting,
      );
    }
    try {
      const result = await shadow.putArtifact({
        ...input,
        artifact: input.artifact,
      });
      const artifact = await shadow.getArtifact(result.outputReference);
      return structuredClone(artifact);
    } catch (error) {
      if (error instanceof PipelineWorkspaceError) {
        throw new PipelineWorkspaceError(error.code);
      }
      throw error;
    }
  }

  async #replayMemoryParent(
    outputReference: string,
    runId: string,
    shadow: MemoryPipelineWorkspaceRepository,
    replayed: Set<string>,
    visiting: Set<string>,
  ): Promise<void> {
    if (replayed.has(outputReference)) return;
    if (visiting.has(outputReference)) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    visiting.add(outputReference);
    const row = await this.#getRowByReference(outputReference);
    if (row === null || row.runId !== runId || row.kind === "publication") {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    for (const parent of row.parentOutputReferences) {
      await this.#replayMemoryParent(
        parent,
        runId,
        shadow,
        replayed,
        visiting,
      );
    }
    const artifact = artifactFromRow(row);
    if (artifact.kind === "publication") {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    let stored: PutPipelineWorkspaceArtifactResult;
    try {
      stored = await shadow.putArtifact({
        runId: row.runId,
        stage: row.stage,
        configurationFingerprint: row.configurationFingerprint,
        parentOutputReferences: row.parentOutputReferences,
        artifact,
      });
    } catch (error) {
      if (error instanceof PipelineWorkspaceError) {
        throw new PipelineWorkspaceError(error.code);
      }
      throw error;
    }
    if (
      stored.outputReference !== row.outputReference ||
      stored.payloadFingerprint !== row.payloadFingerprint
    ) {
      throw new PipelineWorkspaceError("INVALID_OUTPUT_REFERENCE");
    }
    replayed.add(outputReference);
    visiting.delete(outputReference);
  }

  async #validateStoredRow(
    row: ArtifactRow,
    visiting: Set<string>,
  ): Promise<SupabasePipelineWorkspaceStoredArtifact> {
    if (visiting.has(row.outputReference)) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    visiting.add(row.outputReference);
    try {
      const artifact = artifactFromRow(row);
      const expectedArtifact = await this.#validateCandidate({
        runDate: row.runDate,
        runId: row.runId,
        stage: row.stage,
        configurationFingerprint: row.configurationFingerprint,
        parentOutputReferences: row.parentOutputReferences,
        artifact,
      });
      this.#validateRow(row, {
        runDate: row.runDate,
        runId: row.runId,
        stage: row.stage,
        kind: expectedArtifact.kind,
        outputReference: row.outputReference,
        payloadFingerprint: sha256(expectedArtifact),
        configurationFingerprint: row.configurationFingerprint,
        parentOutputReferences: row.parentOutputReferences,
        artifact: expectedArtifact,
      });
      return structuredClone({
        artifact: expectedArtifact,
        outputReference: row.outputReference,
        runId: row.runId,
        stage: row.stage,
        kind: row.kind,
        payloadFingerprint: row.payloadFingerprint,
        configurationFingerprint: row.configurationFingerprint,
        parentOutputReferences: row.parentOutputReferences,
      });
    } finally {
      visiting.delete(row.outputReference);
    }
  }

  #validateRow(
    row: ArtifactRow,
    expected: {
      runDate: string;
      runId: string;
      stage: PipelineStage;
      kind: SupabasePipelineWorkspaceArtifactKind;
      outputReference: string;
      payloadFingerprint: string;
      configurationFingerprint: string;
      parentOutputReferences: readonly string[];
      artifact: SupabasePipelineWorkspaceArtifact;
    },
  ): void {
    const parsedReference = parseReference(row.outputReference);
    const outputFingerprint = sha256({
      configurationFingerprint: row.configurationFingerprint,
      kind: row.kind,
      parentOutputReferences: row.parentOutputReferences,
      payloadFingerprint: row.payloadFingerprint,
    });
    if (
      row.runDate !== expected.runDate ||
      row.runId !== expected.runId ||
      row.stage !== expected.stage ||
      row.kind !== expected.kind ||
      row.outputReference !== expected.outputReference ||
      row.payloadFingerprint !== expected.payloadFingerprint ||
      row.configurationFingerprint !== expected.configurationFingerprint ||
      !sameStrings(row.parentOutputReferences, expected.parentOutputReferences) ||
      JSON.stringify(canonicalize(row.payload)) !==
        JSON.stringify(canonicalize(expected.artifact)) ||
      parsedReference.runId !== row.runId ||
      parsedReference.stage !== row.stage ||
      parsedReference.kind !== row.kind ||
      parsedReference.outputFingerprint !== outputFingerprint
    ) {
      throw new PipelineWorkspaceError("INVALID_OUTPUT_REFERENCE");
    }
  }

  async #getRowByReference(
    outputReference: string,
  ): Promise<ArtifactRow | null> {
    const response = await this.#query(() =>
      this.dataSource.getArtifactByReference(outputReference),
    );
    if (response === null) return null;
    const parsed = rowSchema.safeParse(response);
    if (!parsed.success) {
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    return structuredClone(parsed.data);
  }

  async #query(
    operation: () => Promise<SupabasePipelineWorkspaceDataResult>,
  ): Promise<unknown> {
    let result: SupabasePipelineWorkspaceDataResult;
    try {
      result = await operation();
    } catch {
      throw new SupabasePipelineWorkspaceRepositoryError("DATA_API_ERROR");
    }
    if (
      result === null ||
      typeof result !== "object" ||
      !("data" in result) ||
      !("error" in result)
    ) {
      throw new SupabasePipelineWorkspaceRepositoryError("INVALID_RESPONSE");
    }
    if (result.error !== null) throw mappedDataError(result.error);
    return result.data;
  }
}

export type {
  PipelineWorkspaceArtifact,
  PipelineWorkspaceStoredArtifact,
};
