import {
  publishedPostDetailSchema,
  publishedPostPageSchema,
  slugSchema,
} from "../contracts";
import {
  decodePublishedPostCursor,
  emptyPublishedPostPage,
  encodePublishedPostCursor,
  normalizePublishedPostLimit,
  toPublishedPostCard,
} from "./published-post.pagination";
import { getSamplePublishedPosts } from "./published-post.samples";
import type {
  PublishedPostListOptions,
  PublishedPostRepository,
} from "./published-post.repository";

export class MemoryPublishedPostRepository
  implements PublishedPostRepository
{
  readonly #posts = getSamplePublishedPosts();

  async list(
    options: PublishedPostListOptions = {},
  ): ReturnType<PublishedPostRepository["list"]> {
    const limit = normalizePublishedPostLimit(options.limit);
    let startIndex = 0;

    if (options.after !== undefined) {
      const cursor = decodePublishedPostCursor(options.after);
      if (cursor === null) {
        return emptyPublishedPostPage();
      }

      const cursorIndex = this.#posts.findIndex(
        (post) =>
          post.publishedAt === cursor.publishedAt && post.id === cursor.id,
      );
      if (cursorIndex < 0) {
        return emptyPublishedPostPage();
      }

      startIndex = cursorIndex + 1;
    }

    const selectedPosts = this.#posts.slice(startIndex, startIndex + limit);
    const hasNextPage = startIndex + selectedPosts.length < this.#posts.length;
    const lastPost = selectedPosts.at(-1);

    return publishedPostPageSchema.parse({
      items: selectedPosts.map(toPublishedPostCard),
      nextCursor:
        hasNextPage && lastPost
          ? encodePublishedPostCursor({
              publishedAt: lastPost.publishedAt,
              id: lastPost.id,
            })
          : null,
    });
  }

  async getBySlug(
    slug: string,
  ): ReturnType<PublishedPostRepository["getBySlug"]> {
    const parsedSlug = slugSchema.safeParse(slug);
    if (!parsedSlug.success) {
      return null;
    }

    const post = this.#posts.find((item) => item.slug === parsedSlug.data);
    return post ? publishedPostDetailSchema.parse(post) : null;
  }
}
