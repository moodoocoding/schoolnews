import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140027_reset_august14_test_run.sql",
  "utf8",
).toLowerCase();

describe("August 14 test-run reset migration", () => {
  it("is a single transaction scoped to the exact unpublished test run", () => {
    expect(sql.match(/\bbegin;/g)).toHaveLength(1);
    expect(sql.match(/\bcommit;/g)).toHaveLength(1);
    expect(sql).toContain("v_run_id constant text := 'daily-20260814'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-14'");
    expect(sql).toContain("v_status is distinct from 'succeeded_without_publish'");
  });

  it("refuses runs with publication or model activity", () => {
    expect(sql).toContain("from news_clipping_private.posts");
    expect(sql).toContain("from news_clipping_private.model_calls");
    expect(sql).toContain("from news_clipping_private.model_invocation_intents");
    expect(sql).toContain("message = 'test_run_reset_refused'");
  });

  it("preserves source attempt throttles while removing only run-owned outputs", () => {
    expect(sql).not.toContain("source_collection_attempts");
    expect(sql).not.toContain("source_collection_policies");
    expect(sql).toContain("delete from news_clipping_private.pipeline_artifacts");
    expect(sql).toContain("delete from news_clipping_private.daily_runs");
  });
});
