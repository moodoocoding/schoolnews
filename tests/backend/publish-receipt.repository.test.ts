import { describe, expect, it } from "vitest";

import {
  SupabasePublishReceiptError,
  SupabasePublishReceiptRepository,
  type SupabasePublishReceiptRpcDataSource,
  type SupabasePublishReceiptRpcResult,
} from "../../src/repositories/supabase-publish-receipt.repository";
import { publishedPostDetailFixture } from "../fixtures/contracts";

const lookup = {
  runDate: "2026-08-12",
  runId: "run-20260812",
  revisionId: "post-20260812-revision-1",
  validationOutputReference: "workspace.validate.publication.output-1",
} as const;

type RpcCall = Readonly<{
  functionName: "get_publish_receipt";
  parameters: Readonly<Record<string, unknown>>;
}>;

class FakeReceiptDataSource implements SupabasePublishReceiptRpcDataSource {
  readonly calls: RpcCall[] = [];

  constructor(
    private readonly handler: () =>
      | SupabasePublishReceiptRpcResult
      | Promise<SupabasePublishReceiptRpcResult>,
  ) {}

  async rpc(
    functionName: "get_publish_receipt",
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabasePublishReceiptRpcResult> {
    this.calls.push({ functionName, parameters });
    return this.handler();
  }
}

function receipt() {
  return {
    ...lookup,
    post: structuredClone(publishedPostDetailFixture),
  };
}

async function expectReceiptError(
  operation: Promise<unknown>,
  code: SupabasePublishReceiptError["code"],
) {
  try {
    await operation;
    throw new Error("Receipt error expected.");
  } catch (error) {
    expect(error).toBeInstanceOf(SupabasePublishReceiptError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toBe(code);
    return error as SupabasePublishReceiptError;
  }
}

describe("SupabasePublishReceiptRepository", () => {
  it("응답 손실 복구는 publish 재호출 없이 get_publish_receipt를 정확히 한 번 조회한다", async () => {
    const dataSource = new FakeReceiptDataSource(() => ({
      data: receipt(),
      error: null,
    }));
    const repository = new SupabasePublishReceiptRepository(dataSource);

    await expect(repository.get(lookup)).resolves.toEqual(receipt());
    expect(dataSource.calls).toEqual([
      {
        functionName: "get_publish_receipt",
        parameters: {
          p_run_date: lookup.runDate,
          p_run_id: lookup.runId,
          p_revision_id: lookup.revisionId,
          p_validation_output_reference: lookup.validationOutputReference,
        },
      },
    ]);
  });

  it("네 식별자가 모두 없는 상태는 null로 보존한다", async () => {
    const dataSource = new FakeReceiptDataSource(() => ({
      data: null,
      error: null,
    }));

    await expect(
      new SupabasePublishReceiptRepository(dataSource).get(lookup),
    ).resolves.toBeNull();
    expect(dataSource.calls).toHaveLength(1);
  });

  it("잘못된 외부 입력은 RPC 전에 안정 오류로 차단한다", async () => {
    const dataSource = new FakeReceiptDataSource(() => ({
      data: null,
      error: null,
    }));
    const repository = new SupabasePublishReceiptRepository(dataSource);

    for (const invalid of [
      { ...lookup, runDate: "2026-02-30" },
      { ...lookup, runId: "run id" },
      { ...lookup, revisionId: "" },
      { ...lookup, validationOutputReference: " " },
    ]) {
      await expectReceiptError(
        repository.get(invalid),
        "INVALID_RECEIPT_INPUT",
      );
    }
    expect(dataSource.calls).toHaveLength(0);
  });

  it("부분 일치나 DB 모순은 원문 없이 stable conflict로 전달한다", async () => {
    const secret = "database-row-and-key-must-not-escape";
    const dataSource = new FakeReceiptDataSource(() => ({
      data: { secret },
      error: { code: "P0001", message: "PUBLISH_RECEIPT_CONFLICT" },
    }));

    const error = await expectReceiptError(
      new SupabasePublishReceiptRepository(dataSource).get(lookup),
      "PUBLISH_RECEIPT_CONFLICT",
    );
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(dataSource.calls).toHaveLength(1);
  });

  it("malformed·다른 identity·다른 게시 날짜 응답을 conflict로 fail closed 한다", async () => {
    for (const data of [
      { invalid: true },
      { ...receipt(), runId: "different-run" },
      { ...receipt(), revisionId: "different-revision" },
      {
        ...receipt(),
        post: {
          ...publishedPostDetailFixture,
          publicationDateKst: "2026-08-11",
          publishedAt: "2026-08-11T07:00:00+09:00",
          modifiedAt: "2026-08-11T07:00:00+09:00",
        },
      },
    ]) {
      const dataSource = new FakeReceiptDataSource(() => ({ data, error: null }));
      await expectReceiptError(
        new SupabasePublishReceiptRepository(dataSource).get(lookup),
        "PUBLISH_RECEIPT_CONFLICT",
      );
      expect(dataSource.calls).toHaveLength(1);
    }
  });

  it.each(["401", "403", "42501", "PGRST301", "PGRST302"])(
    "권한 오류 %s를 자격 증명 비노출 코드로 변환한다",
    async (permissionCode) => {
      const repository = new SupabasePublishReceiptRepository(
        new FakeReceiptDataSource(() => ({
          data: null,
          error: { code: permissionCode, message: "secret credential detail" },
        })),
      );
      const error = await expectReceiptError(
        repository.get(lookup),
        "RPC_PERMISSION_DENIED",
      );
      expect(JSON.stringify(error)).not.toContain("secret credential detail");
    },
  );

  it("network throw와 알 수 없는 Data API 오류를 단일 비노출 코드로 변환한다", async () => {
    const thrown = new SupabasePublishReceiptRepository({
      rpc: async () => {
        throw new Error("network address and secret");
      },
    });
    const unknown = new SupabasePublishReceiptRepository(
      new FakeReceiptDataSource(() => ({
        data: null,
        error: { code: "XX000", message: "database row detail" },
      })),
    );

    for (const repository of [thrown, unknown]) {
      const error = await expectReceiptError(
        repository.get(lookup),
        "RECEIPT_LOOKUP_UNAVAILABLE",
      );
      expect(JSON.stringify(error)).not.toContain("secret");
      expect(JSON.stringify(error)).not.toContain("database row");
    }
  });
});
