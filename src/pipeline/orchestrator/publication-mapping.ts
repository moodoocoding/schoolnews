import { z } from "zod";

import {
  evidenceItemSchema,
  generatedPostSchema,
  getPublicationDateKst,
  identifierSchema,
  isoTimestampSchema,
  postVisualSchema,
  publicationDateKstSchema,
  publishedPostDetailSchema,
  qualityResultSchema,
  slugSchema,
  type EvidenceItem,
  type GeneratedPost,
  type PublishedPostDetail,
  type QualityResult,
} from "../../contracts";

const publicationIdentitySchema = z
  .object({
    id: identifierSchema,
    slug: slugSchema,
    publicationDateKst: publicationDateKstSchema,
    publishedAt: isoTimestampSchema,
    modifiedAt: isoTimestampSchema,
    visual: postVisualSchema,
  })
  .strict();

export type PublicationIdentity = z.infer<typeof publicationIdentitySchema>;

export class PublicationMappingError extends Error {
  readonly code = "INVALID_PUBLICATION_MAPPING";

  constructor() {
    super("검증된 생성 결과와 공개 게시물의 변환 관계가 유효하지 않습니다.");
    this.name = "PublicationMappingError";
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

/**
 * Deterministically projects the validated generation graph into the public
 * four-section contract. Presentation identity is supplied by the caller;
 * every content sentence and source is derived from the validated graph.
 */
export function mapValidatedGenerationToPublishedPost(input: {
  identity: PublicationIdentity;
  generatedPost: GeneratedPost;
  qualityResult: QualityResult;
  evidenceItems: readonly EvidenceItem[];
}): PublishedPostDetail {
  try {
    const identity = publicationIdentitySchema.parse(input.identity);
    const generatedPost = generatedPostSchema.parse(input.generatedPost);
    const qualityResult = qualityResultSchema.parse(input.qualityResult);
    const evidenceItems = z.array(evidenceItemSchema).parse(input.evidenceItems);
    if (!qualityResult.passed) throw new PublicationMappingError();

    const evidenceById = new Map(
      evidenceItems.map((evidence) => [evidence.evidenceId, evidence]),
    );
    const usedEvidenceIds = uniqueSorted(generatedPost.usedEvidenceIds);
    if (
      usedEvidenceIds.length !== generatedPost.usedEvidenceIds.length ||
      evidenceById.size !== evidenceItems.length ||
      usedEvidenceIds.some((evidenceId) => !evidenceById.has(evidenceId))
    ) {
      throw new PublicationMappingError();
    }

    const claimById = new Map(
      generatedPost.claims.map((claim) => [claim.claimId, claim]),
    );
    const mapSentence = (sentence: {
      text: string;
      claimIds: readonly string[];
    }) => {
      const claims = sentence.claimIds.map((claimId) => claimById.get(claimId));
      if (claims.some((claim) => claim === undefined)) {
        throw new PublicationMappingError();
      }
      const sourceIds = uniqueSorted(
        claims.flatMap((claim) =>
          claim === undefined
            ? []
            : claim.evidenceRefs.map((reference) => reference.evidenceId),
        ),
      );
      if (
        sourceIds.length === 0 ||
        sourceIds.some((evidenceId) => !evidenceById.has(evidenceId))
      ) {
        throw new PublicationMappingError();
      }
      return { text: sentence.text, sourceIds };
    };

    return publishedPostDetailSchema.parse({
      ...identity,
      title: generatedPost.title,
      summary: generatedPost.oneLineSummary.text,
      oneLineSummary: mapSentence(generatedPost.oneLineSummary),
      body: generatedPost.body.map((paragraph) => ({
        claims: paragraph.sentences.map(mapSentence),
      })),
      questions: generatedPost.questions,
      sources: usedEvidenceIds.map((evidenceId) => {
        const evidence = evidenceById.get(evidenceId);
        if (evidence === undefined) throw new PublicationMappingError();
        const publishedDate = getPublicationDateKst(evidence.publishedAt);
        if (publishedDate === null) throw new PublicationMappingError();
        return {
          id: evidence.evidenceId,
          title: evidence.title,
          publisher: evidence.sourceName,
          publishedDate,
          originalUrl: evidence.url,
        };
      }),
    });
  } catch (error) {
    if (error instanceof PublicationMappingError) throw error;
    throw new PublicationMappingError();
  }
}

export function isPublishedPostDerivedFromGeneration(input: {
  publishedPost: PublishedPostDetail;
  generatedPost: GeneratedPost;
  qualityResult: QualityResult;
  evidenceItems: readonly EvidenceItem[];
}): boolean {
  try {
    const publishedPost = publishedPostDetailSchema.parse(input.publishedPost);
    const expected = mapValidatedGenerationToPublishedPost({
      identity: {
        id: publishedPost.id,
        slug: publishedPost.slug,
        publicationDateKst: publishedPost.publicationDateKst,
        publishedAt: publishedPost.publishedAt,
        modifiedAt: publishedPost.modifiedAt,
        visual: publishedPost.visual,
      },
      generatedPost: input.generatedPost,
      qualityResult: input.qualityResult,
      evidenceItems: input.evidenceItems,
    });
    return JSON.stringify(expected) === JSON.stringify(publishedPost);
  } catch {
    return false;
  }
}
