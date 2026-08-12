import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseEnvironment } from "../../src/lib/config/env";
import {
  isUsingSamplePublishedPosts,
  selectPublishedPostRepository,
  SupabasePublishedPostRepository,
} from "../../src/repositories";

describe("Supabase 저장소 선택", () => {
  it("Supabase 환경에서는 공개 조회 저장소를 선택한다", async () => {
    const repository = await selectPublishedPostRepository(
      parseEnvironment({
        NODE_ENV: "test",
        DATASTORE_PROVIDER: "supabase",
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
      }),
    );

    expect(repository).toBeInstanceOf(SupabasePublishedPostRepository);
  });

  it("공개 조회 저장소 선택만으로 네트워크 요청을 만들지 않는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await selectPublishedPostRepository(
      parseEnvironment({
        NODE_ENV: "test",
        DATASTORE_PROVIDER: "supabase",
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("Supabase 모드에서는 개발용 샘플 안내를 숨긴다", () => {
    expect(
      isUsingSamplePublishedPosts(
        parseEnvironment({
          NODE_ENV: "test",
          DATASTORE_PROVIDER: "supabase",
          SUPABASE_URL: "https://project-ref.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
        }),
      ),
    ).toBe(false);
    expect(
      isUsingSamplePublishedPosts(
        parseEnvironment({ NODE_ENV: "test", DATASTORE_PROVIDER: "memory" }),
      ),
    ).toBe(true);
  });
});
