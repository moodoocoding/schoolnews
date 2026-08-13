import type { SupabasePublishedPostDataSource } from "../db/supabase/published-post.data-source";
import { SupabasePublishedPostRepository } from "./supabase-published-post.repository";

/**
 * Archive rows deliberately use the same public card/detail contract as current
 * posts. The separate type prevents callers from accidentally querying the
 * mutable projection when rendering the archive.
 */
export class SupabaseArchivedPostRepository extends SupabasePublishedPostRepository {
  constructor(dataSource: SupabasePublishedPostDataSource) {
    super(dataSource);
  }
}

