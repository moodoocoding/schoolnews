import type { EvidenceItem } from "../contracts";

export const MAX_MODEL_EVIDENCE_ITEMS = 12;
export const MAX_MODEL_EVIDENCE_GRAPHEMES = 6_000;

const sensitivePatterns = [
  /\b\d{6}\s*[- ]?\s*[1-8]\d{6}\b/u,
  /(?:학생\s*이름|아동\s*이름|보호자\s*이름)\s*[:：]\s*[가-힣]{2,5}/u,
  /[가-힣]{2,5}\s*학생\s*\(?\s*\d{1,2}\s*학년\s*\d{1,2}\s*반/u,
  /[가-힣]{0,20}(?:초등학교|초교|초)\s+\d{1,2}\s*학년\s+[가-힣]{2,5}\s*(?:학생|군|양|어린이)/u,
  /[가-힣]{2,5}\s*\(\s*\d{1,2}\s*[·,]\s*[가-힣]{1,20}(?:초등학교|초교|초)\s*\)/u,
  /(?:학교명|재학학교|주소|거주지)\s*[:：]\s*[^\n,]{2,80}/u,
  /\d{1,2}\s*학년\s*\d{1,2}\s*반\s*\d{1,3}\s*번/u,
  /(?:카카오톡|텔레그램|인스타그램|SNS)\s*(?:ID|아이디|계정)?\s*[:：]\s*@?[A-Za-z0-9._-]{3,}/iu,
];

function graphemeCount(value: string): number {
  return Array.from(value.normalize("NFC")).length;
}

export function assertEvidenceSafeForModel(
  items: readonly EvidenceItem[],
): void {
  if (items.length > MAX_MODEL_EVIDENCE_ITEMS) {
    throw new TypeError("모델 입력 근거 개수 한도를 초과했습니다.");
  }

  let total = 0;
  for (const item of items) {
    const values = [
      item.sourceName,
      item.title,
      item.passage,
      item.locator ?? "",
    ];
    for (const value of values) {
      total += graphemeCount(value);
      if (sensitivePatterns.some((pattern) => pattern.test(value))) {
        throw new TypeError("모델 입력에서 학생·보호자 식별 가능 정보를 감지했습니다.");
      }
    }
  }

  if (total > MAX_MODEL_EVIDENCE_GRAPHEMES) {
    throw new TypeError("모델 입력 근거 전체 길이 한도를 초과했습니다.");
  }
}
