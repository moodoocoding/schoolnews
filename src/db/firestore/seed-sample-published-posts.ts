import {
  Firestore,
  type DocumentReference,
} from "@google-cloud/firestore";

import {
  assertSeedDocumentCompatible,
  seedSamplePublishedPostsWithStore,
  type FirestorePublishedPostSeedStore,
  type PublishedPostSeedBundle,
} from "../../repositories/firestore-sample-seeder";

class GoogleCloudFirestorePublishedPostSeedStore
  implements FirestorePublishedPostSeedStore
{
  constructor(private readonly firestore: Firestore) {}

  async seedBundle(bundle: PublishedPostSeedBundle): Promise<{
    created: number;
    preserved: number;
  }> {
    return this.firestore.runTransaction(async (transaction) => {
      const documents = [bundle.post, bundle.revision, bundle.slug];
      const references = documents.map((document) =>
        this.firestore.doc(document.path),
      );
      const snapshots = await transaction.getAll(...references);
      let created = 0;
      let preserved = 0;

      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        const snapshot = snapshots[index];
        const reference = references[index] as DocumentReference;

        if (snapshot.exists) {
          assertSeedDocumentCompatible(snapshot.data(), document);
          preserved += 1;
        } else {
          transaction.create(reference, document.data);
          created += 1;
        }
      }

      return { created, preserved };
    });
  }
}

export async function seedSamplePublishedPosts(
  firestore: Firestore,
) {
  return seedSamplePublishedPostsWithStore(
    new GoogleCloudFirestorePublishedPostSeedStore(firestore),
  );
}
