import { z } from "zod";

import type { PublishedPostCursor } from "../../repositories/published-post.pagination";
import {
  SupabaseDataApiError,
  type SupabasePublishedPostDataSource,
  type SupabasePublishedPostListQuery,
  type SupabasePublishedPostRow,
} from "./published-post.data-source";

export const ORIGINAL_AUGUST_ARCHIVE_KEY = "august-2026-original";

const LIST_COLUMNS = [
  "id:original_post_id",
  "slug",
  "status",
  "publication_date_kst",
  "published_at",
  "title",
  "summary",
  "visual",
].join(",");

const DETAIL_COLUMNS = [
  LIST_COLUMNS,
  "modified_at",
  "one_line_summary",
  "body",
  "questions",
  "sources",
].join(",");

const DATA_API_TIMEOUT_MS = 10_000;

const configSchema = z
  .object({
    projectUrl: z
      .string()
      .url()
      .transform((value) => new URL(value))
      .refine(
        (url) =>
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "::1"].includes(url.hostname)),
        { message: "Supabase project URL must use HTTPS or local loopback HTTP." },
      )
      .refine(
        (url) =>
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === "",
        { message: "Supabase project URL must be an origin URL." },
      ),
    publishableKey: z
      .string()
      .min(20)
      .max(512)
      .regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
    archiveKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,63}$/)
      .default(ORIGINAL_AUGUST_ARCHIVE_KEY),
  })
  .strict();

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class SupabaseRestArchivedPostDataSource
  implements SupabasePublishedPostDataSource
{
  readonly #endpoint: URL;
  readonly #publishableKey: string;
  readonly #archiveKey: string;
  readonly #fetch: FetchLike;

  constructor(options: {
    projectUrl: string;
    publishableKey: string;
    archiveKey?: string;
    fetch?: FetchLike;
  }) {
    const config = configSchema.parse({
      projectUrl: options.projectUrl,
      publishableKey: options.publishableKey,
      archiveKey: options.archiveKey,
    });
    this.#endpoint = new URL("/rest/v1/published_post_archive", config.projectUrl);
    this.#publishableKey = config.publishableKey;
    this.#archiveKey = config.archiveKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async findPublishedCursor(
    cursor: PublishedPostCursor,
  ): Promise<SupabasePublishedPostRow[]> {
    const parameters = this.#baseParameters(LIST_COLUMNS);
    parameters.set("original_post_id", `eq.${cursor.id}`);
    parameters.set("published_at", `eq.${cursor.publishedAt}`);
    parameters.set("limit", "2");
    return this.#request(parameters);
  }

  async listPublishedRows(
    input: SupabasePublishedPostListQuery,
  ): Promise<SupabasePublishedPostRow[]> {
    const parameters = this.#baseParameters(LIST_COLUMNS);
    parameters.set("order", "published_at.desc,original_post_id.desc");
    parameters.set("limit", String(input.limit));
    if (input.after !== undefined) {
      parameters.set(
        "or",
        `(published_at.lt.${input.after.publishedAt},and(published_at.eq.${input.after.publishedAt},original_post_id.lt.${input.after.id}))`,
      );
    }
    return this.#request(parameters);
  }

  async findPublishedBySlug(slug: string): Promise<SupabasePublishedPostRow[]> {
    const parameters = this.#baseParameters(DETAIL_COLUMNS);
    parameters.set("slug", `eq.${slug}`);
    parameters.set("limit", "2");
    return this.#request(parameters);
  }

  #baseParameters(columns: string): URLSearchParams {
    return new URLSearchParams({
      select: columns,
      archive_key: `eq.${this.#archiveKey}`,
      status: "eq.published",
    });
  }

  async #request(parameters: URLSearchParams): Promise<SupabasePublishedPostRow[]> {
    const url = new URL(this.#endpoint);
    url.search = parameters.toString();
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", apikey: this.#publishableKey },
        signal: AbortSignal.timeout(DATA_API_TIMEOUT_MS),
      });
    } catch {
      throw new SupabaseDataApiError("REQUEST_FAILED");
    }
    if (!response.ok) {
      throw new SupabaseDataApiError("RESPONSE_ERROR");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new SupabaseDataApiError("INVALID_RESPONSE");
    }
    if (!Array.isArray(value)) {
      throw new SupabaseDataApiError("INVALID_RESPONSE");
    }
    return value as SupabasePublishedPostRow[];
  }
}
