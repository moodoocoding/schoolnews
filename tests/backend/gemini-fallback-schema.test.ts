import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/202608130005_model_fallback_audit.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

describe("Gemini fallback audit migration", () => {
  it("물리 모델 호출을 논리 시도별 route attempt로 분리한다", () => {
    expect(sql).toContain("add column if not exists route_attempt");
    expect(sql).toContain(
      "unique (run_id, purpose, attempt_number, route_attempt)",
    );
  });
});
