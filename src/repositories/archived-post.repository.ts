import type {
  PublishedPostDetail,
  PublishedPostPage,
} from "../contracts";
import { parseEnvironment, type Environment } from "../lib/config/env";
import type { PublishedPostListOptions } from "./published-post.repository";

export interface ArchivedPostRepository {
  list(options?: PublishedPostListOptions): Promise<PublishedPostPage>;
  getBySlug(slug: string): Promise<PublishedPostDetail | null>;
}

const emptyArchiveRepository: ArchivedPostRepository = {
  async list() {
    return { items: [], nextCursor: null };
  },
  async getBySlug() {
    return null;
  },
};

export async function selectArchivedPostRepository(
  environment: Environment = parseEnvironment(process.env),
): Promise<ArchivedPostRepository> {
  if (environment.DATASTORE_PROVIDER === "memory") {
    return emptyArchiveRepository;
  }
  if (environment.DATASTORE_PROVIDER !== "supabase") {
    return emptyArchiveRepository;
  }
  const { createConfiguredSupabaseArchivedPostRepository } = await import(
    "../db/supabase/configured-archived-post.repository"
  );
  return createConfiguredSupabaseArchivedPostRepository(environment);
}

export async function listArchivedPosts(
  options: PublishedPostListOptions = {},
): Promise<PublishedPostPage> {
  return (await selectArchivedPostRepository()).list(options);
}

export async function getArchivedPostBySlug(
  slug: string,
): Promise<PublishedPostDetail | null> {
  return (await selectArchivedPostRepository()).getBySlug(slug);
}
