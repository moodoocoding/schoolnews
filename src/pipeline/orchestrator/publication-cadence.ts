import { publicationDateKstSchema } from "../../contracts";

export const MAX_PUBLICATION_GAP_DAYS = 7;
export const PUBLICATION_CADENCE_VERSION = "publication-cadence-v2";

/**
 * "quality_gated" is the original behaviour: publish only same-day
 * candidates that clear the quality bar, and only fall back to the best
 * candidate in the rolling window once MAX_PUBLICATION_GAP_DAYS has passed
 * without a publish. "daily_force" always force-publishes the best
 * candidate in the rolling window every run, regardless of score or days
 * since the last publish -- a deliberately temporary operating mode, meant
 * to be switched back once article volume/quality is judged sufficient.
 */
export type PublicationCadenceMode = "quality_gated" | "daily_force";

function epochDay(value: string): number {
  const parsed = publicationDateKstSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export type PublicationCadenceDecision = Readonly<{
  daysSinceLastPublication: number | null;
  forceBestCandidate: boolean;
  candidateWindowDays: number;
  reason: "bootstrap" | "deadline" | "quality_first" | "daily_force";
}>;

export function decidePublicationCadence(input: {
  runDate: string;
  latestPublicationDateKst: string | null;
  forceBootstrap?: boolean;
  mode?: PublicationCadenceMode;
}): PublicationCadenceDecision {
  const runDay = epochDay(input.runDate);
  const daysSinceLastPublication =
    input.latestPublicationDateKst === null
      ? null
      : runDay - epochDay(input.latestPublicationDateKst);
  if (daysSinceLastPublication !== null && daysSinceLastPublication < 0) {
    throw new RangeError("Latest publication date cannot be after the run date.");
  }

  if (input.mode === "daily_force") {
    return {
      daysSinceLastPublication,
      forceBestCandidate: true,
      candidateWindowDays: MAX_PUBLICATION_GAP_DAYS,
      reason: "daily_force",
    };
  }

  if (daysSinceLastPublication === null) {
    return {
      daysSinceLastPublication: null,
      forceBestCandidate: true,
      candidateWindowDays: MAX_PUBLICATION_GAP_DAYS,
      reason: "bootstrap",
    };
  }
  const forceBestCandidate =
    input.forceBootstrap === true ||
    daysSinceLastPublication >= MAX_PUBLICATION_GAP_DAYS;
  return {
    daysSinceLastPublication,
    forceBestCandidate,
    candidateWindowDays: forceBestCandidate ? MAX_PUBLICATION_GAP_DAYS : 1,
    reason: input.forceBootstrap
      ? "bootstrap"
      : forceBestCandidate
        ? "deadline"
        : "quality_first",
  };
}
