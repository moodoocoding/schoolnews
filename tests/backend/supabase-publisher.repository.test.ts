import { describe, expect, it } from "vitest";

import type { QualityResult } from "../../src/contracts";
import {
  SupabasePublisherError,
  SupabasePublisherRepository,
  type SupabasePublisherRpcDataSource,
  type SupabasePublisherRpcResult,
} from "../../src/repositories/supabase-publisher.repository";
import { publishedPostDetailFixture } from "../fixtures/contracts";

const RUN_DATE = "2026-08-12";
const RUN_ID = "run-20260812";
const VALIDATION_REFERENCE = "workspace.validate.publication.output-1";
const REVISION_ID = "post-20260812-revision-1";
const TOPIC_ID = "topic-20260812-ai-guide";

const passedQuality: QualityResult = {
  passed: true,
  checks: [
    {
      type: "publication-contract",
      passed: true,
      reasons: [],
      checkerVersion: "publication-contract-v1",
    },
  ],
  blockingReasons: [],
};

type RpcCall = {
  functionName: "publish_post";
  parameters: Readonly<Record<string, unknown>>;
};

class FakePublisherDataSource implements SupabasePublisherRpcDataSource {
  readonly calls: RpcCall[] = [];

  constructor(
    private readonly handler: () =>
      | SupabasePublisherRpcResult
      | Promise<SupabasePublisherRpcResult>,
  ) {}

  async rpc(
    functionName: "publish_post",
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublisherRpcResult> {
    this.calls.push({ functionName, parameters });
    return this.handler();
  }
}

function input() {
  return {
    runDate: RUN_DATE,
    runId: RUN_ID,
    leaseToken: "lease-token-1",
    fence: 3,
    expectedRevision: 9,
    validationOutputReference: VALIDATION_REFERENCE,
    revisionId: REVISION_ID,
    topicId: TOPIC_ID,
    post: structuredClone(publishedPostDetailFixture),
    qualityResult: structuredClone(passedQuality),
  };
}

function successful(data: unknown): SupabasePublisherRpcResult {
  return { data, error: null };
}

async function expectPublisherError(
  operation: Promise<unknown>,
  code: SupabasePublisherError["code"],
  ambiguous = false,
): Promise<SupabasePublisherError> {
  try {
    await operation;
    throw new Error("Publisher error expected.");
  } catch (error) {
    expect(error).toBeInstanceOf(SupabasePublisherError);
    expect(error).toMatchObject({ code, ambiguous, retryable: false });
    expect((error as Error).message).toBe(code);
    return error as SupabasePublisherError;
  }
}

describe("SupabasePublisherRepository", () => {
  it("검증된 게시물을 publication artifact 참조와 함께 publish_post RPC에 전달한다", async () => {
    const returnedPost = {
      ...structuredClone(publishedPostDetailFixture),
      publishedAt: "2026-08-12T07:01:00+09:00",
      modifiedAt: "2026-08-12T07:01:00+09:00",
    };
    const dataSource = new FakePublisherDataSource(() =>
      successful(returnedPost),
    );
    const repository = new SupabasePublisherRepository(dataSource);

    const receipt = await repository.publish(input());

    expect(dataSource.calls).toEqual([
      {
        functionName: "publish_post",
        parameters: {
          p_run_date: RUN_DATE,
          p_run_id: RUN_ID,
          p_lease_token: "lease-token-1",
          p_fence: 3,
          p_expected_revision: 9,
          p_validation_output_reference: VALIDATION_REFERENCE,
          p_revision_id: REVISION_ID,
          p_topic_id: TOPIC_ID,
          p_post: publishedPostDetailFixture,
        },
      },
    ]);
    expect(receipt).toEqual({
      runDate: RUN_DATE,
      runId: RUN_ID,
      revisionId: REVISION_ID,
      validationOutputReference: VALIDATION_REFERENCE,
      post: returnedPost,
    });
  });

  it("동일 리비전의 멱등 응답도 같은 계약으로 검증한다", async () => {
    const dataSource = new FakePublisherDataSource(() =>
      successful(structuredClone(publishedPostDetailFixture)),
    );
    const repository = new SupabasePublisherRepository(dataSource);

    await expect(repository.publish(input())).resolves.toMatchObject({
      runDate: RUN_DATE,
      runId: RUN_ID,
      revisionId: REVISION_ID,
      post: { id: publishedPostDetailFixture.id },
    });
    expect(dataSource.calls).toHaveLength(1);
  });

  it("품질 미통과와 KST 날짜·입력 계약 오류는 RPC 호출 전에 차단한다", async () => {
    const dataSource = new FakePublisherDataSource(() =>
      successful(publishedPostDetailFixture),
    );
    const repository = new SupabasePublisherRepository(dataSource);
    const rejected = input();
    rejected.qualityResult = {
      passed: false,
      checks: [
        {
          type: "publication-contract",
          passed: false,
          reasons: ["blocked"],
          checkerVersion: "publication-contract-v1",
        },
      ],
      blockingReasons: ["FORMAT_INVALID"],
    };
    await expectPublisherError(
      repository.publish(rejected),
      "QUALITY_REJECTED",
    );

    const wrongDate = input();
    wrongDate.runDate = "2026-08-13";
    await expectPublisherError(
      repository.publish(wrongDate),
      "INVALID_PUBLISH_INPUT",
    );

    const wrongReference = input();
    wrongReference.validationOutputReference = " ";
    await expectPublisherError(
      repository.publish(wrongReference),
      "INVALID_PUBLISH_INPUT",
    );

    const unknownPublishedDate = input();
    unknownPublishedDate.post.sources[0].publishedDate = null;
    await expectPublisherError(
      repository.publish(unknownPublishedDate),
      "INVALID_PUBLISH_INPUT",
    );
    expect(dataSource.calls).toHaveLength(0);
  });

  it.each([
    "LEASE_TOKEN_MISMATCH",
    "FENCE_MISMATCH",
    "STALE_JOURNAL_REVISION",
    "LEASE_EXPIRED",
    "DUPLICATE_PUBLICATION_DATE",
    "SLUG_CONFLICT",
    "INVALID_SOURCE_DATA",
  ] as const)("DB 안정 오류 %s만 외부로 노출한다", async (code) => {
    const secretPayload = "never-expose-secret-payload";
    const dataSource = new FakePublisherDataSource(() => ({
      data: { secretPayload },
      error: {
        code: "P0001",
        message: code,
      },
    }));
    const repository = new SupabasePublisherRepository(dataSource);

    const error = await expectPublisherError(repository.publish(input()), code);
    expect(JSON.stringify(error)).not.toContain(secretPayload);
  });

  it.each(["42501", "PGRST301", "PGRST302"])(
    "권한 오류 %s를 세부정보 없는 안정 코드로 바꾼다",
    async (permissionCode) => {
      const dataSource = new FakePublisherDataSource(() => ({
        data: null,
        error: {
          code: permissionCode,
          message: "credential details must not escape",
        },
      }));
      const repository = new SupabasePublisherRepository(dataSource);

      await expectPublisherError(
        repository.publish(input()),
        "RPC_PERMISSION_DENIED",
      );
    },
  );

  it("timeout·network·알 수 없는 서비스 오류는 모호하며 자동 재시도 불가다", async () => {
    const timeoutRepository = new SupabasePublisherRepository(
      new FakePublisherDataSource(() => ({
        data: null,
        error: { code: "PUBLISH_TIMEOUT_AMBIGUOUS" },
      })),
    );
    await expectPublisherError(
      timeoutRepository.publish(input()),
      "PUBLISH_TIMEOUT_AMBIGUOUS",
      true,
    );

    const networkRepository = new SupabasePublisherRepository({
      rpc: async () => {
        throw new Error("network details");
      },
    });
    await expectPublisherError(
      networkRepository.publish(input()),
      "PUBLISH_STATE_AMBIGUOUS",
      true,
    );

    const unknownRepository = new SupabasePublisherRepository(
      new FakePublisherDataSource(() => ({
        data: null,
        error: { code: "XX000", message: "database details" },
      })),
    );
    await expectPublisherError(
      unknownRepository.publish(input()),
      "PUBLISH_STATE_AMBIGUOUS",
      true,
    );
  });

  it("malformed 또는 다른 게시물 응답은 발행 상태 모호성으로 차단한다", async () => {
    for (const response of [
      null,
      { data: null, error: "unsafe-error-shape" },
      successful({ invalid: true }),
      successful({ ...publishedPostDetailFixture, id: "other-post" }),
      successful({
        ...publishedPostDetailFixture,
        publicationDateKst: "2026-08-11",
        publishedAt: "2026-08-11T07:00:00+09:00",
        modifiedAt: "2026-08-11T07:00:00+09:00",
      }),
    ]) {
      const repository = new SupabasePublisherRepository(
        new FakePublisherDataSource(
          () => response as SupabasePublisherRpcResult,
        ),
      );
      await expectPublisherError(
        repository.publish(input()),
        "PUBLISH_STATE_AMBIGUOUS",
        true,
      );
    }
  });
});
