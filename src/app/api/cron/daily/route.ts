import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request, process.env.CRON_SECRET)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // Import only after authentication so an unauthenticated request cannot
  // initialize database or model clients.
  const [{ parseEnvironment }, { runConfiguredSupabaseAutomation }] =
    await Promise.all([
      import("../../../../lib/config/env"),
      import("../../../../lib/ops/configured-supabase-automation"),
    ]);
  const environment = parseEnvironment(process.env);
  if (environment.AUTOMATION_MODE !== "live") {
    return Response.json(
      { ok: false, code: "AUTOMATION_DISABLED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await runConfiguredSupabaseAutomation({
    environment,
    ownerId: "vercel-cron-daily",
    abortSignal: request.signal,
  });
  if (result.status === "busy") {
    return Response.json(
      { ok: true, status: "busy", runId: result.runId },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const successfulStatus = new Set([
    "succeeded",
    "succeeded_without_publish",
    "published_with_warning",
  ]).has(result.journal.run.status);
  return Response.json(
    {
      ok: successfulStatus,
      status: result.status,
      runId: result.journal.run.runId,
      runDate: result.journal.run.runDate,
      runStatus: result.journal.run.status,
      terminalReason: result.journal.terminalReason,
      published: result.journal.run.steps.some(
        (step) => step.stage === "publish" && step.status === "succeeded",
      ),
    },
    {
      status: successfulStatus ? 200 : 500,
      headers: { "cache-control": "no-store" },
    },
  );
}
