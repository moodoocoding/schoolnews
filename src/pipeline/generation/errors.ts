import type { ModelCallAudit } from "../../contracts";

export const generationProviderErrorCodes = [
  "INVALID_GENERATION_INPUT",
  "INVALID_PROVIDER_CONFIGURATION",
  "INVALID_MODEL_OUTPUT",
  "INVALID_MODEL_USAGE",
  "INVALID_COST_ESTIMATE",
  "PROVIDER_ABORTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_MODEL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REQUEST_FAILED",
] as const;

export type GenerationProviderErrorCode =
  (typeof generationProviderErrorCodes)[number];

const messages: Record<GenerationProviderErrorCode, string> = {
  INVALID_GENERATION_INPUT: "생성 입력이 유효하지 않습니다.",
  INVALID_PROVIDER_CONFIGURATION: "생성 공급자 설정이 유효하지 않습니다.",
  INVALID_MODEL_OUTPUT: "모델 출력이 게시물 계약을 통과하지 못했습니다.",
  INVALID_MODEL_USAGE: "모델 사용량 기록이 유효하지 않습니다.",
  INVALID_COST_ESTIMATE: "모델 비용 추정값이 유효하지 않습니다.",
  PROVIDER_ABORTED: "모델 호출이 중단되었습니다.",
  PROVIDER_TIMEOUT: "모델 호출 제한 시간을 초과했습니다.",
  PROVIDER_RATE_LIMITED: "모델 무료 할당량 또는 호출 한도에 도달했습니다.",
  PROVIDER_MODEL_UNAVAILABLE: "요청한 모델을 현재 사용할 수 없습니다.",
  PROVIDER_UNAVAILABLE: "모델 공급자가 일시적으로 응답할 수 없습니다.",
  PROVIDER_REQUEST_FAILED: "모델 공급자 호출에 실패했습니다.",
};

export class GenerationProviderError extends Error {
  readonly code: GenerationProviderErrorCode;
  readonly audit: ModelCallAudit | null;
  readonly audits: readonly ModelCallAudit[];

  constructor(
    code: GenerationProviderErrorCode,
    options?: ErrorOptions & {
      audit?: ModelCallAudit | null;
      audits?: readonly ModelCallAudit[];
    },
  ) {
    super(messages[code], options);
    this.name = "GenerationProviderError";
    this.code = code;
    this.audit = options?.audit ?? null;
    this.audits = options?.audits ?? (this.audit ? [this.audit] : []);
  }
}
