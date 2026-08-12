import { Timestamp } from "@google-cloud/firestore";

import {
  FIRESTORE_SCHEMA_VERSION,
  postRevisionDocumentSchema,
  postSlugDocumentSchema,
  publishedPostContainerSchema,
} from "../contracts";
import { getSamplePublishedPosts } from "./published-post.samples";

export type FirestoreSeedDocument = {
  path: string;
  data: Record<string, unknown>;
};

export type PublishedPostSeedBundle = {
  post: FirestoreSeedDocument;
  revision: FirestoreSeedDocument;
  slug: FirestoreSeedDocument;
};

export type FirestoreSeedResult = {
  postsProcessed: number;
  documentsCreated: number;
  documentsPreserved: number;
};

export interface FirestorePublishedPostSeedStore {
  seedBundle(bundle: PublishedPostSeedBundle): Promise<{
    created: number;
    preserved: number;
  }>;
}

export class FirestoreSeedConflictError extends Error {
  constructor(readonly documentPath: string) {
    super(`기존 Firestore 문서가 샘플 시드와 충돌합니다. (${documentPath})`);
    this.name = "FirestoreSeedConflictError";
  }
}

function makeRevisionId(postId: string): string {
  return `${postId}-revision-v1`;
}

export function createSamplePublishedPostSeedBundles(): PublishedPostSeedBundle[] {
  return getSamplePublishedPosts().map((detail) => {
    const revisionId = makeRevisionId(detail.id);
    const post = publishedPostContainerSchema.parse({
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      id: detail.id,
      slug: detail.slug,
      publicationDateKst: detail.publicationDateKst,
      status: "published",
      activeRevisionId: revisionId,
      publishedAt: detail.publishedAt,
      modifiedAt: detail.modifiedAt,
      title: detail.title,
      summary: detail.summary,
      visual: detail.visual,
    });
    const revision = postRevisionDocumentSchema.parse({
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      revisionId,
      postId: detail.id,
      createdAt: detail.modifiedAt,
      detail,
    });
    const slug = postSlugDocumentSchema.parse({
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      slug: detail.slug,
      postDocumentId: detail.publicationDateKst,
      postId: detail.id,
    });

    return {
      post: {
        path: `posts/${detail.publicationDateKst}`,
        data: {
          ...post,
          publishedAt: Timestamp.fromDate(new Date(post.publishedAt)),
          modifiedAt: Timestamp.fromDate(new Date(post.modifiedAt)),
        },
      },
      revision: {
        path: `posts/${detail.publicationDateKst}/revisions/${revisionId}`,
        data: {
          ...revision,
          createdAt: Timestamp.fromDate(new Date(revision.createdAt)),
        },
      },
      slug: {
        path: `postSlugs/${detail.slug}`,
        data: slug,
      },
    };
  });
}

function toComparable(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      __firestoreTimestamp: [value.seconds, value.nanoseconds],
    };
  }

  if (Array.isArray(value)) {
    return value.map(toComparable);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, toComparable(nested)]),
    );
  }

  return value;
}

export function assertSeedDocumentCompatible(
  existing: unknown,
  expected: FirestoreSeedDocument,
): void {
  const existingValue = JSON.stringify(toComparable(existing));
  const expectedValue = JSON.stringify(toComparable(expected.data));
  if (existingValue !== expectedValue) {
    throw new FirestoreSeedConflictError(expected.path);
  }
}

export async function seedSamplePublishedPostsWithStore(
  store: FirestorePublishedPostSeedStore,
): Promise<FirestoreSeedResult> {
  const bundles = createSamplePublishedPostSeedBundles();
  const result: FirestoreSeedResult = {
    postsProcessed: 0,
    documentsCreated: 0,
    documentsPreserved: 0,
  };

  for (const bundle of bundles) {
    const bundleResult = await store.seedBundle(bundle);
    result.postsProcessed += 1;
    result.documentsCreated += bundleResult.created;
    result.documentsPreserved += bundleResult.preserved;
  }

  return result;
}
