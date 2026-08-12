import type {
  EvidenceItem,
  GeneratedPost,
  SemanticReview,
} from "../../../src/contracts";
import {
  evidenceItemsFixture,
  generatedPostFixture,
} from "../contracts";

export function semanticPostFixture(): GeneratedPost {
  return structuredClone(generatedPostFixture);
}

export function semanticEvidenceFixture(): EvidenceItem[] {
  return structuredClone(evidenceItemsFixture);
}

export function externalSemanticFindingFixture(): SemanticReview {
  return {
    passed: false,
    evaluatorVersion: "fake-semantic-evaluator-v1",
    findings: [
      {
        code: "CONTRADICTED_CLAIM",
        message: "두 근거가 주장에 대해 서로 다른 내용을 제시합니다.",
        claimIds: ["claim-1"],
        evidenceIds: ["evidence-1", "evidence-2"],
      },
    ],
  };
}
