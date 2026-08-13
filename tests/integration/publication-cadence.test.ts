import { describe, expect, it } from "vitest";

import { decidePublicationCadence } from "../../src/pipeline/orchestrator";

describe("최대 7일 발행 간격", () => {
  it("1~6일에는 어제 기사만 높은 즉시 기준으로 평가한다", () => {
    expect(
      decidePublicationCadence({
        runDate: "2026-08-14",
        latestPublicationDateKst: "2026-08-09",
      }),
    ).toMatchObject({
      daysSinceLastPublication: 5,
      forceBestCandidate: false,
      candidateWindowDays: 1,
      reason: "quality_first",
    });
  });

  it("7일째에는 최근 7일 최고 후보를 강제 선택 모드로 보낸다", () => {
    expect(
      decidePublicationCadence({
        runDate: "2026-08-14",
        latestPublicationDateKst: "2026-08-07",
      }),
    ).toMatchObject({
      daysSinceLastPublication: 7,
      forceBestCandidate: true,
      candidateWindowDays: 7,
      reason: "deadline",
    });
  });

  it("최초 실행과 명시적 전환일은 7일 후보를 평가한다", () => {
    expect(
      decidePublicationCadence({ runDate: "2026-08-14", latestPublicationDateKst: null }),
    ).toMatchObject({ forceBestCandidate: true, reason: "bootstrap" });
    expect(
      decidePublicationCadence({
        runDate: "2026-08-14",
        latestPublicationDateKst: "2026-08-13",
        forceBootstrap: true,
      }),
    ).toMatchObject({ forceBestCandidate: true, reason: "bootstrap" });
  });
});
