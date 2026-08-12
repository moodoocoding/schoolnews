import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createConfiguredSupabaseContentPersistenceRepository,
  createConfiguredSupabasePipelineWorkspaceRepository,
  createConfiguredSupabasePublisherRepository,
} from "../../src/db/supabase/configured-write.repositories";
import { parseEnvironment } from "../../src/lib/config/env";
import {
  SupabaseContentPersistenceRepository,
  SupabasePipelineWorkspaceRepository,
  SupabasePublisherRepository,
} from "../../src/repositories";

const supabaseEnvironment = parseEnvironment({
  NODE_ENV: "test",
  DATASTORE_PROVIDER: "supabase",
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${"b".repeat(24)}`,
});

describe("Supabase 서버 쓰기 저장소 구성", () => {
  it("Secret Key가 있는 서버 환경에서 세 쓰기 경계를 지연 생성한다", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(
      createConfiguredSupabaseContentPersistenceRepository(supabaseEnvironment),
    ).toBeInstanceOf(SupabaseContentPersistenceRepository);
    expect(
      createConfiguredSupabasePipelineWorkspaceRepository(supabaseEnvironment, {
        writeAuthority: async () => ({
          runDate: "2026-08-13",
          runId: "run-20260813",
          leaseToken: "lease-test",
          fence: 1,
          expectedRevision: 1,
        }),
        publicationPostMapper: async () => {
          throw new Error("not called during configuration");
        },
      }),
    ).toBeInstanceOf(SupabasePipelineWorkspaceRepository);
    expect(
      createConfiguredSupabasePublisherRepository(supabaseEnvironment),
    ).toBeInstanceOf(SupabasePublisherRepository);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("Secret Key가 없거나 Supabase 모드가 아니면 구성 단계에서 차단한다", () => {
    const withoutSecret = parseEnvironment({
      NODE_ENV: "test",
      DATASTORE_PROVIDER: "supabase",
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
    });
    const memory = parseEnvironment({ NODE_ENV: "test" });

    for (const environment of [withoutSecret, memory]) {
      expect(() =>
        createConfiguredSupabaseContentPersistenceRepository(environment),
      ).toThrow();
      expect(() =>
        createConfiguredSupabasePublisherRepository(environment),
      ).toThrow();
    }
  });
});
