import { describe, expect, it } from "vitest";

import {
  formatPublicationDate,
  getCitationNumbers,
  getPatternProperties,
} from "../../src/components/presentation";

describe("UI presentation helpers", () => {
  it("formats a KST publication day without shifting the date", () => {
    expect(formatPublicationDate("2026-08-02")).toBe("2026년 8월 2일");
    expect(formatPublicationDate("not-a-date")).toBe("not-a-date");
  });

  it("returns deterministic and seed-specific pattern properties", () => {
    const first = getPatternProperties("post-20260812-gallery-visual");
    const repeated = getPatternProperties("post-20260812-gallery-visual");
    const different = getPatternProperties("post-20260811-gallery-visual");

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(different);
  });

  it("maps citations to source order, removes duplicates, and ignores unknown IDs", () => {
    expect(
      getCitationNumbers(
        ["source-b", "missing", "source-a", "source-b"],
        ["source-a", "source-b"],
      ),
    ).toEqual([1, 2]);
    expect(getCitationNumbers([], ["source-a"])).toEqual([]);
  });
});
