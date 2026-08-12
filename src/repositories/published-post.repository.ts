import type {
  PublishedPostDetail,
  PublishedPostPage,
} from "../contracts";
import { parseEnvironment, type Environment } from "../lib/config/env";
import { MemoryPublishedPostRepository } from "./memory-published-post.repository";

export type PublishedPostListOptions = {
  limit?: number;
  after?: string;
};

export interface PublishedPostRepository {
  list(options?: PublishedPostListOptions): Promise<PublishedPostPage>;
  getBySlug(slug: string): Promise<PublishedPostDetail | null>;
}

const memoryRepository = new MemoryPublishedPostRepository();

export function isUsingSamplePublishedPosts(
  environment: Environment = parseEnvironment(process.env),
): boolean {
  return environment.DATASTORE_PROVIDER === "memory";
}

export async function selectPublishedPostRepository(
  environment: Environment = parseEnvironment(process.env),
): Promise<PublishedPostRepository> {
  if (environment.DATASTORE_PROVIDER === "memory") {
    return memoryRepository;
  }

  if (environment.DATASTORE_PROVIDER === "supabase") {
    const { createConfiguredSupabasePublishedPostRepository } = await import(
      "../db/supabase/configured-published-post.repository"
    );
    return createConfiguredSupabasePublishedPostRepository(environment);
  }

  const { createConfiguredFirestorePublishedPostRepository } = await import(
    "../db/firestore/configured-published-post.repository"
  );
  return createConfiguredFirestorePublishedPostRepository(environment);
}

export async function listPublishedPosts(
  options: PublishedPostListOptions = {},
): Promise<PublishedPostPage> {
  const repository = await selectPublishedPostRepository();
  return repository.list(options);
}

export async function getPublishedPostBySlug(
  slug: string,
): Promise<PublishedPostDetail | null> {
  const repository = await selectPublishedPostRepository();
  return repository.getBySlug(slug);
}
