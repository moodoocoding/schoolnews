import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  SUPABASE_BACKFILL_PUBLISH_RPC_NAME,
  SupabasePublisherRepository,
  type SupabasePublisherRpcDataSource,
} from "../../src/repositories/supabase-publisher.repository";
import { publishedPostDetailFixture } from "../fixtures/contracts";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608130013_august_backfill_publish.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("August 2026 backfill publisher", () => {
  it("keeps a transaction-scoped service-role-only RPC with an exact date window", () => {
    expect(migration.trimStart().startsWith("-- Operator-approved")).toBe(true);
    expect(migration).toContain("begin;");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("create or replace function public.publish_backfill_post(");
    expect(migration).toContain("set search_path = pg_catalog, news_clipping_private");
    expect(migration).toContain("p_run_date < date '2026-08-01'");
    expect(migration).toContain("p_run_date > date '2026-08-12'");
    expect(migration).toContain("BACKFILL_DATE_NOT_ALLOWED");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("uses a KST timestamp matching the archive date while keeping current server time for lease checks", () => {
    expect(migration).toContain("v_now := clock_timestamp()");
    expect(migration).toContain(
      "v_publication_time := (p_run_date::timestamp + time '07:00:00') at time zone 'Asia/Seoul'",
    );
    expect(migration).toContain(
      "'publishedAt', news_clipping_private.iso_json(v_publication_time)",
    );
    expect(migration).toContain(
      "published_at = v_publication_time, modified_at = v_publication_time",
    );
  });

  it("routes an otherwise standard validated publish through the backfill RPC", async () => {
    const post = structuredClone(publishedPostDetailFixture);
    const rpc = vi.fn().mockResolvedValue({ data: post, error: null });
    const dataSource: SupabasePublisherRpcDataSource = { rpc };
    const repository = new SupabasePublisherRepository(
      dataSource,
      SUPABASE_BACKFILL_PUBLISH_RPC_NAME,
    );

    await repository.publish({
      runDate: "2026-08-12",
      runId: "daily-20260812",
      leaseToken: "lease-token-20260812",
      fence: 1,
      expectedRevision: 9,
      validationOutputReference: "validation-output-20260812",
      revisionId: "revision-20260812",
      topicId: "topic-20260812",
      post,
      qualityResult: {
        passed: true,
        checks: [
          {
            type: "publication-contract",
            passed: true,
            reasons: [],
            checkerVersion: "publication-contract-v1",
          },
        ],
        blockingReasons: [],
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      SUPABASE_BACKFILL_PUBLISH_RPC_NAME,
      expect.objectContaining({ p_run_date: "2026-08-12" }),
    );
  });
});
