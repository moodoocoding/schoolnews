import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const coreSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608130001_news_clipping_core.sql",
  ),
  "utf8",
);
const forwardSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608130004_locked_server_clock_rpcs.sql",
  ),
  "utf8",
);

const functionNames = [
  "acquire_daily_run",
  "checkpoint_daily_run",
  "finish_daily_run",
  "publish_post",
] as const;

function functionDefinition(sql: string, name: (typeof functionNames)[number]): string {
  const create = `function public.${name}(`;
  const start = sql.indexOf(create);
  if (start < 0) throw new Error(`Missing ${name}`);
  const statementStart = sql.lastIndexOf("create", start);
  const end = sql.indexOf("\n$$;", start);
  if (statementStart < 0 || end < 0) throw new Error(`Malformed ${name}`);
  return sql.slice(statementStart, end + 4);
}

function expectedLockedClockDefinition(
  name: (typeof functionNames)[number],
): string {
  let definition = functionDefinition(coreSql, name)
    .replace("create function public.", "create or replace function public.")
    .replace("v_now timestamptz := clock_timestamp();", "v_now timestamptz;");

  const multilineLockAndSelect =
    "  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));\n" +
    "  select * into v_row from news_clipping_private.daily_runs\n" +
    "    where run_date = p_run_date for update;\n";

  if (name === "acquire_daily_run") {
    const originalSelect =
      "  select * into v_row from news_clipping_private.daily_runs\n" +
      "  where run_date = p_run_date for update;\n\n";
    definition = definition.replace(originalSelect, "");
    const advisory =
      "  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));\n\n";
    return definition.replace(
      advisory,
      advisory +
        "  select * into v_row from news_clipping_private.daily_runs\n" +
        "  where run_date = p_run_date for update;\n" +
        "  v_now := clock_timestamp();\n\n",
    );
  }
  if (name === "publish_post") {
    const lockAndSelect =
      "  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));\n" +
      "  select * into v_run from news_clipping_private.daily_runs where run_date = p_run_date for update;\n";
    return definition.replace(
      lockAndSelect,
      `${lockAndSelect}  v_now := clock_timestamp();\n`,
    );
  }
  return definition.replace(
    multilineLockAndSelect,
    `${multilineLockAndSelect}  v_now := clock_timestamp();\n`,
  );
}

describe("locked authoritative server clock forward migration", () => {
  it("명시적 forward transaction이며 네 RPC만 CREATE OR REPLACE 한다", () => {
    expect(forwardSql.trimStart()).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(forwardSql.trimEnd()).toMatch(/commit;$/);
    expect(forwardSql.match(/create or replace function public\./g)).toHaveLength(4);
    expect(forwardSql).not.toContain("function public.get_daily_run(");
    expect(forwardSql).not.toMatch(/drop\s+(function|table|schema)/i);
  });

  it.each(functionNames)("%s는 001과 clock 위치 외에 본문·시그니처가 같다", (name) => {
    expect(functionDefinition(forwardSql, name)).toBe(
      expectedLockedClockDefinition(name),
    );
  });

  it.each(functionNames)("%s는 advisory와 daily row lock 뒤에 서버 시각을 한 번 읽는다", (name) => {
    const definition = functionDefinition(forwardSql, name);
    const advisoryIndex = definition.indexOf("pg_advisory_xact_lock(");
    const rowLockIndex = definition.indexOf("for update;");
    const clockIndex = definition.indexOf("v_now := clock_timestamp();");

    expect(advisoryIndex).toBeGreaterThan(0);
    expect(rowLockIndex).toBeGreaterThan(advisoryIndex);
    expect(clockIndex).toBeGreaterThan(rowLockIndex);
    expect(definition.slice(rowLockIndex, clockIndex)).not.toMatch(/\bif\b|\breturn\b/);
    expect(definition.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(definition).toContain("v_now timestamptz;");
    expect(definition).not.toContain("v_now timestamptz := clock_timestamp();");
  });

  it("001의 공개 권한 차단과 service_role 실행 권한을 같은 시그니처로 유지한다", () => {
    const signatures = [
      "acquire_daily_run(date, jsonb, jsonb, timestamptz)",
      "checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz)",
      "finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz)",
      "publish_post(date, text, text, bigint, integer, text, text, text, jsonb)",
    ];
    for (const signature of signatures) {
      expect(forwardSql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated;`,
      );
      expect(forwardSql).toContain(
        `grant execute on function public.${signature} to service_role;`,
      );
    }
  });
});
