import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration007 = readFileSync(
  new URL(
    "../../supabase/migrations/202608130007_model_invocation_ledger.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration009 = readFileSync(
  new URL(
    "../../supabase/migrations/202608130009_model_invocation_actual_budget.sql",
    import.meta.url,
  ),
  "utf8",
);

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function prepareFunction(sql: string): string {
  const start = sql.search(
    /create(?: or replace)? function public\.prepare_model_invocation\(/i,
  );
  const end = sql.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error("prepare function not found");
  return normalized(sql.slice(start, end + 4)).replace(
    "create or replace function",
    "create function",
  );
}

function splitBudget(body: string) {
  const budgetIf = body.indexOf("if jsonb_typeof(v_run.journal");
  const budgetStart =
    body.slice(Math.max(0, budgetIf - 6), budgetIf) === "begin "
      ? budgetIf - 6
      : budgetIf;
  const insertStart = body.indexOf(
    "insert into news_clipping_private.model_invocation_intents(",
  );
  if (budgetStart < 0 || insertStart < 0) {
    throw new Error("budget boundary not found");
  }
  return {
    prefix: body.slice(0, budgetStart),
    budget: body.slice(budgetStart, insertStart),
    suffix: body.slice(insertStart),
  };
}

type Intent =
  | {
      status: "reserved";
      reservedInput: number;
      reservedOutput: number;
      reservedCost: number;
    }
  | {
      status: "completed";
      auditInput: number;
      auditOutput: number;
      auditCost: number;
    };

function prospectiveOutput(
  intents: readonly Intent[],
  requestedReservation: number,
): number {
  return (
    intents.reduce(
      (total, intent) =>
        total +
        (intent.status === "reserved"
          ? intent.reservedOutput
          : intent.auditOutput),
      0,
    ) + requestedReservation
  );
}

describe("Supabase model invocation actual-budget forward migration", () => {
  it("명시적 forward transaction 안에서 동일 시그니처만 교체한다", () => {
    const sql = normalized(migration009);
    expect(sql).toMatch(/^--[\s\S]* begin; /);
    expect(sql).toMatch(/ commit;$/);
    expect(sql).toContain(
      "create or replace function public.prepare_model_invocation(",
    );
    expect(sql).not.toMatch(/drop\s+(table|schema|function)/);
    expect(sql).not.toMatch(/create\s+table|alter\s+table/);
    expect(sql).toContain("security definer");
    expect(sql).toContain(
      "set search_path = pg_catalog, news_clipping_private",
    );
  });

  it("007 prepare와 예산 블록 외의 잠금·CAS·계보·응답이 exact 동일하다", () => {
    const original = splitBudget(prepareFunction(migration007));
    const replacement = splitBudget(prepareFunction(migration009));
    expect(replacement.prefix).toBe(original.prefix);
    expect(replacement.suffix).toBe(original.suffix);
    expect(replacement.budget).not.toBe(original.budget);
  });

  it("reserved는 상한, completed는 감사 실제값으로 prospective 합산한다", () => {
    const budget = splitBudget(prepareFunction(migration009)).budget;
    expect(budget).toContain(
      "case when status = 'reserved' then reserved_input_tokens::bigint else (audit #>> '{usage,inputtokens}')::bigint end",
    );
    expect(budget).toContain(
      "case when status = 'reserved' then reserved_output_tokens::bigint else (audit #>> '{usage,outputtokens}')::bigint end",
    );
    expect(budget).toContain(
      "case when status = 'reserved' then reserved_cost_usd else (audit ->> 'estimatedcostusd')::numeric end",
    );
    expect(budget).toContain(
      "(v_run.journal #>> '{run,usage,modelcalls}')::bigint + v_reserved_calls + 1",
    );
  });

  it("정상 draft 실제 사용량 뒤 semantic 남은 상한은 통과하고 초과는 차단한다", () => {
    const completedDraft: Intent = {
      status: "completed",
      auditInput: 100,
      auditOutput: 200,
      auditCost: 0,
    };
    expect(prospectiveOutput([completedDraft], 800)).toBe(1_000);
    expect(prospectiveOutput([completedDraft], 800)).toBeLessThanOrEqual(1_000);
    expect(prospectiveOutput([completedDraft], 801)).toBeGreaterThan(1_000);

    const unresolvedDraft: Intent = {
      status: "reserved",
      reservedInput: 2_000,
      reservedOutput: 1_000,
      reservedCost: 0.1,
    };
    expect(prospectiveOutput([unresolvedDraft], 800)).toBeGreaterThan(1_000);
  });

  it("malformed/null/unpriced completed audit는 cast 전에 fail-closed한다", () => {
    const budget = splitBudget(prepareFunction(migration009)).budget;
    expect(budget).toContain(
      "jsonb_typeof(intent.audit) is distinct from 'object'",
    );
    expect(budget).toContain(
      "jsonb_typeof(intent.audit -> 'usage') is distinct from 'object'",
    );
    expect(budget).toContain(
      "jsonb_typeof(intent.audit -> 'estimatedcostusd') is distinct from 'number'",
    );
    expect(budget).toContain(
      "array['inputtokens','outputtokens','totaltokens']",
    );
    expect(budget).toContain(
      "(intent.audit #>> '{usage,totaltokens}')::bigint < (intent.audit #>> '{usage,inputtokens}')::bigint + (intent.audit #>> '{usage,outputtokens}')::bigint",
    );
    expect(budget).toContain("message = 'invocation_budget_exceeded'");
  });

  it("public callers를 차단하고 기존 service_role 실행 권한만 복구한다", () => {
    const sql = normalized(migration009);
    expect(sql).toMatch(
      /revoke all on function public\.prepare_model_invocation\([^;]+from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.prepare_model_invocation\([^;]+to service_role/,
    );
    expect(sql).not.toMatch(/grant execute[^;]+to (anon|authenticated)/);
  });
});
