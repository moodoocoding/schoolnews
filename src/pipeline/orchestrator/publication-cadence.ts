import { publicationDateKstSchema } from "../../contracts";

export const MAX_PUBLICATION_GAP_DAYS = 7;
export const PUBLICATION_CADENCE_VERSION = "publication-cadence-v1";

function epochDay(value: string): number {
  const parsed = publicationDateKstSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export type PublicationCadenceDecision = Readonly<{
  daysSinceLastPublication: number | null;
  forceBestCandidate: boolean;
  candidateWindowDays: number;
  reason: "bootstrap" | "deadline" | "quality_first";
}>;

export function decidePublicationCadence(input: {
  runDate: string;
  latestPublicationDateKst: string | null;
  forceBootstrap?: boolean;
}): PublicationCadenceDecision {
  const runDay = epochDay(input.runDate);
  if (input.latestPublicationDateKst === null) {
    return {
      daysSinceLastPublication: null,
      forceBestCandidate: true,
      candidateWindowDays: MAX_PUBLICATION_GAP_DAYS,
      reason: "bootstrap",
    };
  }
  const daysSinceLastPublication = runDay - epochDay(input.latestPublicationDateKst);
  if (daysSinceLastPublication < 0) {
    throw new RangeError("Latest publication date cannot be after the run date.");
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
