import {
  Firestore,
  Timestamp,
  type DocumentData,
  type Query,
} from "@google-cloud/firestore";

import type { PublishedPostCursor } from "../../repositories/published-post.pagination";

export type FirestoreDocumentRecord = {
  documentId: string;
  data: unknown;
};

export interface FirestorePublishedPostDataSource {
  findPublishedCursor(
    cursor: PublishedPostCursor,
  ): Promise<readonly FirestoreDocumentRecord[]>;
  listPublishedContainers(input: {
    limit: number;
    after?: PublishedPostCursor;
  }): Promise<readonly FirestoreDocumentRecord[]>;
  getPostContainer(
    postDocumentId: string,
  ): Promise<FirestoreDocumentRecord | null>;
  getPostRevision(
    postDocumentId: string,
    revisionId: string,
  ): Promise<FirestoreDocumentRecord | null>;
  getSlugReservation(
    slug: string,
  ): Promise<FirestoreDocumentRecord | null>;
}

function toRecord(
  document: {
    id: string;
    exists: boolean;
    data(): DocumentData | undefined;
  },
): FirestoreDocumentRecord | null {
  if (!document.exists) {
    return null;
  }

  return {
    documentId: document.id,
    data: document.data(),
  };
}

function timestampForCursor(cursor: PublishedPostCursor): Timestamp {
  return Timestamp.fromDate(new Date(cursor.publishedAt));
}

export class GoogleCloudFirestorePublishedPostDataSource
  implements FirestorePublishedPostDataSource
{
  constructor(private readonly firestore: Firestore) {}

  async findPublishedCursor(
    cursor: PublishedPostCursor,
  ): Promise<readonly FirestoreDocumentRecord[]> {
    const snapshot = await this.firestore
      .collection("posts")
      .where("status", "==", "published")
      .where("publishedAt", "==", timestampForCursor(cursor))
      .where("id", "==", cursor.id)
      .limit(2)
      .get();

    return snapshot.docs.map((document) => ({
      documentId: document.id,
      data: document.data(),
    }));
  }

  async listPublishedContainers(input: {
    limit: number;
    after?: PublishedPostCursor;
  }): Promise<readonly FirestoreDocumentRecord[]> {
    let query: Query = this.firestore
      .collection("posts")
      .where("status", "==", "published")
      .orderBy("publishedAt", "desc")
      .orderBy("id", "desc");

    if (input.after) {
      query = query.startAfter(
        timestampForCursor(input.after),
        input.after.id,
      );
    }

    const snapshot = await query.limit(input.limit).get();
    return snapshot.docs.map((document) => ({
      documentId: document.id,
      data: document.data(),
    }));
  }

  async getPostContainer(
    postDocumentId: string,
  ): Promise<FirestoreDocumentRecord | null> {
    const document = await this.firestore
      .collection("posts")
      .doc(postDocumentId)
      .get();
    return toRecord(document);
  }

  async getPostRevision(
    postDocumentId: string,
    revisionId: string,
  ): Promise<FirestoreDocumentRecord | null> {
    const document = await this.firestore
      .collection("posts")
      .doc(postDocumentId)
      .collection("revisions")
      .doc(revisionId)
      .get();
    return toRecord(document);
  }

  async getSlugReservation(
    slug: string,
  ): Promise<FirestoreDocumentRecord | null> {
    const document = await this.firestore.collection("postSlugs").doc(slug).get();
    return toRecord(document);
  }
}
