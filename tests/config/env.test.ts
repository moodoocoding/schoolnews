import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../../src/lib/config/env";

describe("환경 변수 계약", () => {
  it("로컬 기본값을 제공한다", () => {
    const environment = parseEnvironment({ NODE_ENV: "test" });

    expect(environment.SITE_URL).toBe("http://localhost:3000");
    expect(environment.DATASTORE_PROVIDER).toBe("memory");
    expect(environment.AUTOMATION_MODE).toBe("disabled");
    expect(environment.FIRESTORE_DATABASE_ID).toBe("(default)");
  });

  it("사이트 URL 끝의 슬래시를 제거한다", () => {
    const environment = parseEnvironment({
      NODE_ENV: "production",
      SITE_URL: "https://example.com/",
    });

    expect(environment.SITE_URL).toBe("https://example.com");
  });

  it("짧은 Cron 비밀정보를 거부한다", () => {
    expect(() =>
      parseEnvironment({ NODE_ENV: "test", CRON_SECRET: "short" }),
    ).toThrow();
  });

  it("Firestore 모드는 Firebase 프로젝트 ID를 요구한다", () => {
    expect(() =>
      parseEnvironment({ DATASTORE_PROVIDER: "firestore" }),
    ).toThrow();

    expect(
      parseEnvironment({
        DATASTORE_PROVIDER: "firestore",
        FIREBASE_PROJECT_ID: "ai-education-today",
      }).FIREBASE_PROJECT_ID,
    ).toBe("ai-education-today");
  });

  it("Firestore 에뮬레이터 주소에 URL 스킴을 허용하지 않는다", () => {
    expect(() =>
      parseEnvironment({ FIRESTORE_EMULATOR_HOST: "http://127.0.0.1:8080" }),
    ).toThrow();
    expect(() =>
      parseEnvironment({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:99999" }),
    ).toThrow();
    expect(() =>
      parseEnvironment({ FIRESTORE_EMULATOR_HOST: "example.com:8080" }),
    ).toThrow();
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow();
  });

  it("M1에서는 기본 Firestore 데이터베이스만 허용한다", () => {
    expect(() =>
      parseEnvironment({ FIRESTORE_DATABASE_ID: "staging" }),
    ).toThrow();
  });

  it("Supabase 모드는 프로젝트 URL과 Publishable Key를 요구한다", () => {
    expect(() =>
      parseEnvironment({ DATASTORE_PROVIDER: "supabase" }),
    ).toThrow();

    const environment = parseEnvironment({
      DATASTORE_PROVIDER: "supabase",
      SUPABASE_URL: "https://project-ref.supabase.co/",
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
    });
    expect(environment.SUPABASE_URL).toBe(
      "https://project-ref.supabase.co",
    );
    expect(environment.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it("운영 Supabase URL의 HTTP와 URL 자격 증명을 거부한다", () => {
    const key = `sb_publishable_${"a".repeat(24)}`;
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DATASTORE_PROVIDER: "supabase",
        SUPABASE_URL: "http://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow();
    expect(() =>
      parseEnvironment({
        DATASTORE_PROVIDER: "supabase",
        SUPABASE_URL: "https://user:password@project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow();
  });

  it("Supabase URL의 경로, 쿼리와 fragment를 거부한다", () => {
    const key = `sb_publishable_${"a".repeat(24)}`;
    for (const SUPABASE_URL of [
      "https://project-ref.supabase.co/rest/v1",
      "https://project-ref.supabase.co?debug=true",
      "https://project-ref.supabase.co/#settings",
    ]) {
      expect(() =>
        parseEnvironment({
          DATASTORE_PROVIDER: "supabase",
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY: key,
        }),
      ).toThrow();
    }
  });

  it("서버 Secret Key 형식과 로컬 Supabase HTTP를 구분한다", () => {
    const environment = parseEnvironment({
      NODE_ENV: "development",
      DATASTORE_PROVIDER: "supabase",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
      SUPABASE_SECRET_KEY: `sb_secret_${"b".repeat(24)}`,
    });
    expect(environment.SUPABASE_SECRET_KEY).toMatch(/^sb_secret_/);
    expect(() =>
      parseEnvironment({
        DATASTORE_PROVIDER: "memory",
        SUPABASE_SECRET_KEY: "legacy-service-role-value",
      }),
    ).toThrow();
  });

  it("Gemini는 키만으로 활성화하지 않고 공급자·데이터 사용 확인을 요구한다", () => {
    const apiKey = `google-key-${"a".repeat(24)}`;
    expect(
      parseEnvironment({
        NODE_ENV: "development",
        GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      }).LLM_ENABLED,
    ).toBe("false");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "development",
        LLM_ENABLED: "true",
        GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      }),
    ).toThrow();
    expect(
      parseEnvironment({
        NODE_ENV: "development",
        LLM_ENABLED: "true",
        LLM_PROVIDER: "gemini",
        GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED: "true",
        GOOGLE_GENERATIVE_AI_API_KEY: apiKey,
      }).LLM_ENABLED,
    ).toBe("true");
  });

  it("테스트 환경에서는 live Gemini opt-in도 거부한다", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        LLM_ENABLED: "true",
        LLM_PROVIDER: "gemini",
        GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED: "true",
        GOOGLE_GENERATIVE_AI_API_KEY: `google-key-${"a".repeat(24)}`,
      }),
    ).toThrow();
  });

  it("live 자동화는 Supabase·LLM·Cron 인증을 모두 요구한다", () => {
    const base = {
      NODE_ENV: "production",
      DATASTORE_PROVIDER: "supabase",
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(24)}`,
      SUPABASE_SECRET_KEY: `sb_secret_${"b".repeat(24)}`,
      LLM_ENABLED: "true",
      LLM_PROVIDER: "gemini",
      GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED: "true",
      GOOGLE_GENERATIVE_AI_API_KEY: `google-key-${"c".repeat(24)}`,
    } as const;

    expect(() =>
      parseEnvironment({ ...base, AUTOMATION_MODE: "live" }),
    ).toThrow();
    expect(
      parseEnvironment({
        ...base,
        AUTOMATION_MODE: "live",
        CRON_SECRET: "d".repeat(32),
      }).AUTOMATION_MODE,
    ).toBe("live");
  });
});
