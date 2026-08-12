import { describe, expect, it } from "vitest";

import {
  mapPostGenerationForDailyStage,
  type DailyGenerationSourceResult,
} from "../../src/pipeline/generation";
import { validGeneratedPost } from "../fixtures/content/quality";

const usage = {
  modelCalls: 2,
  inputTokens: 1_234,
  outputTokens: 567,
  estimatedCostUsd: 0.0123456789,
  hasUnpricedCalls: false,
};

function result(
  overrides: Partial<DailyGenerationSourceResult> = {},
): DailyGenerationSourceResult {
  return {
    status: "validated",
    post: validGeneratedPost(),
    qualityResult: { passed: true },
    usage,
    failureCode: null,
    providerErrorCode: null,
    ...overrides,
  };
}

describe("post generation → daily stage 매핑", () => {
  it("검증된 게시물만 ready로 넘기고 사용량을 손실 없이 복사한다", () => {
    const mapped = mapPostGenerationForDailyStage(result());

    expect(mapped).toMatchObject({
      disposition: "ready",
      usage,
    });
    expect(mapped.usage).toEqual(usage);
    expect(mapped.usage).not.toBe(usage);
  });

  it("가격을 알 수 없는 호출 표시를 그대로 보존한다", () => {
    const mapped = mapPostGenerationForDailyStage(
      result({
        status: "withheld",
        post: null,
        qualityResult: null,
        usage: { ...usage, hasUnpricedCalls: true },
        failureCode: "BUDGET_EXCEEDED",
      }),
    );

    expect(mapped).toEqual({
      disposition: "blocked",
      reason: "BUDGET_EXCEEDED",
      post: null,
      usage: { ...usage, hasUnpricedCalls: true },
    });
  });

  it("품질 거절은 시스템 장애가 아닌 정상 발행 보류로 매핑한다", () => {
    const mapped = mapPostGenerationForDailyStage(
      result({
        status: "withheld",
        post: null,
        qualityResult: { passed: false },
        failureCode: "QUALITY_REJECTED",
      }),
    );

    expect(mapped).toEqual({
      disposition: "withheld",
      reason: "QUALITY_REJECTED",
      post: null,
      usage,
    });
  });

  it.each([
    ["PROVIDER_TIMEOUT", true],
    ["PROVIDER_REQUEST_FAILED", true],
    ["PROVIDER_ABORTED", false],
    ["INVALID_PROVIDER_CONFIGURATION", false],
    ["INVALID_MODEL_OUTPUT", false],
    [null, false],
  ] as const)(
    "provider failure %s의 재시도 여부를 보수적으로 결정한다",
    (providerErrorCode, retryable) => {
      const mapped = mapPostGenerationForDailyStage(
        result({
          status: "withheld",
          post: null,
          qualityResult: null,
          failureCode: "MODEL_PROVIDER_ERROR",
          providerErrorCode,
        }),
      );

      expect(mapped).toEqual({
        disposition: "failed",
        errorCode: "MODEL_PROVIDER_ERROR",
        retryable,
        post: null,
        usage,
      });
    },
  );

  it.each([
    result({ post: null }),
    result({ qualityResult: { passed: false } }),
    result({ failureCode: "QUALITY_REJECTED" }),
    result({ status: "withheld", failureCode: "QUALITY_REJECTED" }),
    result({
      status: "withheld",
      post: null,
      qualityResult: { passed: false },
      failureCode: null,
    }),
    result({
      status: "withheld",
      post: null,
      qualityResult: { passed: false },
      failureCode: "QUALITY_REJECTED",
      providerErrorCode: "PROVIDER_TIMEOUT",
    }),
  ])("모순된 상태를 게시 가능한 성공으로 가장하지 않는다", (source) => {
    expect(mapPostGenerationForDailyStage(source)).toEqual({
      disposition: "failed",
      errorCode: "INVALID_SOURCE_DATA",
      retryable: false,
      post: null,
      usage,
    });
  });

  it("잘못된 게시물 계약을 fail-closed한다", () => {
    const post = validGeneratedPost();
    post.body = [];

    expect(
      mapPostGenerationForDailyStage(result({ post })),
    ).toMatchObject({
      disposition: "failed",
      errorCode: "INVALID_SOURCE_DATA",
      retryable: false,
      post: null,
    });
  });

  it("잘못된 사용량을 0으로 정상화하지 않고 거부한다", () => {
    expect(() =>
      mapPostGenerationForDailyStage(
        result({
          usage: { ...usage, inputTokens: -1 },
        }),
      ),
    ).toThrow();
  });
});
