import type { CSSProperties } from "react";

type PatternProperties = CSSProperties & {
  "--pattern-hue": string;
  "--pattern-hue-alt": string;
  "--pattern-angle": string;
  "--pattern-line-angle": string;
  "--pattern-x": string;
  "--pattern-y": string;
};

function stableHash(value: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function getPatternProperties(seed: string): PatternProperties {
  const hash = stableHash(seed);
  const hue = hash % 360;
  const hueAlt = (hue + 62 + ((hash >>> 8) % 80)) % 360;
  const angle = 18 + ((hash >>> 16) % 145);
  const x = 22 + ((hash >>> 5) % 57);
  const y = 18 + ((hash >>> 12) % 61);

  return {
    "--pattern-hue": `${hue}`,
    "--pattern-hue-alt": `${hueAlt}`,
    "--pattern-angle": `${angle}deg`,
    "--pattern-line-angle": `${Math.round(angle * -0.32)}deg`,
    "--pattern-x": `${x}%`,
    "--pattern-y": `${y}%`,
  };
}

export function formatPublicationDate(publicationDateKst: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(publicationDateKst);

  if (!match) {
    return publicationDateKst;
  }

  const [, year, month, day] = match;
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

export function getCitationNumbers(
  sourceIds: readonly string[],
  sourceOrder: readonly string[],
): number[] {
  const orderById = new Map(
    sourceOrder.map((sourceId, index) => [sourceId, index + 1]),
  );

  return Array.from(
    new Set(
      sourceIds.flatMap((sourceId) => {
        const number = orderById.get(sourceId);
        return number === undefined ? [] : [number];
      }),
    ),
  ).sort((left, right) => left - right);
}
