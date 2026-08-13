import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createConfiguredSupabasePipelineRepositories } from "../../src/db/supabase/server";
import { parseEnvironment } from "../../src/lib/config/env";
import {
  SupabaseContentPersistenceRepository,
  SupabaseDailyRunRepository,
  SupabaseModelInvocationRepository,
  SupabasePipelineWorkspaceRepository,
  SupabasePublicationHistoryRepository,
  SupabasePublishReceiptRepository,
  SupabasePublisherRepository,
  SupabaseSourceAttemptRepository,
  SupabaseArticleFullTextRepository,
  SupabaseEditorialMaterialsRepository,
} from "../../src/repositories";

const environment = parseEnvironment({
  NODE_ENV: "test",
  DATASTORE_PROVIDER: "supabase",
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${"b".repeat(24)}`,
});

const options = {
  writeAuthority: async () => {
    throw new Error("not called during configuration");
  },
  publicationPostMapper: async () => {
    throw new Error("not called during configuration");
  },
};

describe("configured Supabase pipeline repositories", () => {
  it("server-only 경계를 네트워크 없이 조립한다", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const repositories = createConfiguredSupabasePipelineRepositories(
      environment,
      options,
    );

    expect(repositories).toMatchObject({
      dailyRun: expect.any(SupabaseDailyRunRepository),
      contentPersistence: expect.any(SupabaseContentPersistenceRepository),
      workspace: expect.any(SupabasePipelineWorkspaceRepository),
      sourceAttempt: expect.any(SupabaseSourceAttemptRepository),
      modelInvocation: expect.any(SupabaseModelInvocationRepository),
      publisher: expect.any(SupabasePublisherRepository),
      publishReceipt: expect.any(SupabasePublishReceiptRepository),
      publicationHistory: expect.any(SupabasePublicationHistoryRepository),
      articleFullText: expect.any(SupabaseArticleFullTextRepository),
      editorialMaterials: expect.any(SupabaseEditorialMaterialsRepository),
    });
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("memory 모드나 secret 누락은 일괄 조립 전에 차단한다", () => {
    const memory = parseEnvironment({ NODE_ENV: "test" });
    const withoutSecret = parseEnvironment({
      NODE_ENV: "test",
      DATASTORE_PROVIDER: "supabase",
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
    });

    for (const invalid of [memory, withoutSecret]) {
      expect(() =>
        createConfiguredSupabasePipelineRepositories(invalid, options),
      ).toThrow();
    }
  });
});
