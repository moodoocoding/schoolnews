import type { EvidenceItem, GeneratedPost } from "../../../src/contracts";
import {
  evidenceItemsFixture,
  generatedPostFixture,
} from "../contracts";

export function validEvidenceItems(): EvidenceItem[] {
  return structuredClone(evidenceItemsFixture);
}

export function validGeneratedPost(): GeneratedPost {
  return structuredClone(generatedPostFixture);
}

export function authoritativeSingleSourcePost(): GeneratedPost {
  const post = validGeneratedPost();

  for (const claim of post.claims) {
    claim.kind = "fact";
    claim.evidenceRefs = [{ evidenceId: "evidence-1", support: "direct" }];
  }
  post.usedEvidenceIds = ["evidence-1"];

  return post;
}
