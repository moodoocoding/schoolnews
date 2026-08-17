import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATASTORE_PROVIDER: z
      .enum(["memory", "firestore", "supabase"])
      .default("memory"),
    SITE_URL: z
      .string()
      .url()
      .default("http://localhost:3000")
      .transform((value) => value.replace(/\/$/, "")),
    FIREBASE_PROJECT_ID: z
      .string()
      .trim()
      .min(6)
      .max(30)
      .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/)
      .optional(),
    FIRESTORE_DATABASE_ID: z.string().trim().min(1).default("(default)"),
    FIRESTORE_EMULATOR_HOST: z
      .string()
      .trim()
      .regex(/^[^\s/:]+:\d{1,5}$/, "에뮬레이터 주소는 host:port 형식이어야 합니다.")
      .refine((value) => {
        const port = Number(value.split(":").at(-1));
        return Number.isInteger(port) && port >= 1 && port <= 65_535;
      }, "에뮬레이터 포트는 1부터 65535 사이여야 합니다.")
      .optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().min(1).optional(),
    SUPABASE_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/$/, ""))
      .optional(),
    SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .trim()
      .regex(/^sb_publishable_[A-Za-z0-9_-]{20,}$/)
      .optional(),
    SUPABASE_SECRET_KEY: z
      .string()
      .trim()
      .regex(/^sb_secret_[A-Za-z0-9_-]{20,}$/)
      .optional(),
    LLM_API_KEY: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z
      .string()
      .trim()
      .min(20)
      .max(256)
      .regex(/^\S+$/u)
      .optional(),
    LLM_ENABLED: z.enum(["true", "false"]).default("false"),
    LLM_PROVIDER: z.enum(["gemini"]).optional(),
    AUTOMATION_MODE: z
      .enum(["disabled", "dry_run", "live"])
      .default("disabled"),
    GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED: z
      .enum(["true", "false"])
      .default("false"),
    CRON_SECRET: z.string().min(16).optional(),
    /**
     * "daily_force" is a deliberately temporary override: publish the best
     * candidate in the 7-day rolling window every run instead of waiting
     * for the normal 7-day gap. It still keeps the baseline topic
     * relevance floor (TOPIC_SELECTION_THRESHOLDS) -- it is not a content
     * quality bypass, only a publish-cadence bypass.
     */
    PUBLICATION_CADENCE_MODE: z
      .enum(["quality_gated", "daily_force"])
      .default("quality_gated"),
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.LLM_ENABLED === "true") {
      if (environment.NODE_ENV === "test") {
        context.addIssue({
          code: "custom",
          path: ["LLM_ENABLED"],
          message: "테스트 환경에서는 실제 LLM 호출을 활성화할 수 없습니다.",
        });
      }
      if (environment.LLM_PROVIDER !== "gemini") {
        context.addIssue({
          code: "custom",
          path: ["LLM_PROVIDER"],
          message: "LLM 활성화 시 Gemini 공급자를 명시해야 합니다.",
        });
      }
      if (environment.GOOGLE_GENERATIVE_AI_API_KEY === undefined) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_GENERATIVE_AI_API_KEY"],
          message: "Gemini 활성화 시 서버 API 키가 필요합니다.",
        });
      }
      if (environment.GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED !== "true") {
        context.addIssue({
          code: "custom",
          path: ["GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED"],
          message: "무료 등급 데이터 사용 조건 확인이 필요합니다.",
        });
      }
    }
    if (environment.AUTOMATION_MODE === "live") {
      if (environment.DATASTORE_PROVIDER !== "supabase") {
        context.addIssue({
          code: "custom",
          path: ["AUTOMATION_MODE"],
          message: "live 자동화는 Supabase 저장소에서만 허용됩니다.",
        });
      }
      if (environment.LLM_ENABLED !== "true") {
        context.addIssue({
          code: "custom",
          path: ["LLM_ENABLED"],
          message: "live 자동화에는 명시적 LLM 활성화가 필요합니다.",
        });
      }
      if (environment.CRON_SECRET === undefined) {
        context.addIssue({
          code: "custom",
          path: ["CRON_SECRET"],
          message: "live 자동화에는 Cron 인증 비밀값이 필요합니다.",
        });
      }
      if (environment.SUPABASE_SECRET_KEY === undefined) {
        context.addIssue({
          code: "custom",
          path: ["SUPABASE_SECRET_KEY"],
          message: "live 자동화에는 Supabase 서버 Secret Key가 필요합니다.",
        });
      }
    }
    if (
      environment.DATASTORE_PROVIDER === "firestore" &&
      environment.FIREBASE_PROJECT_ID === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["FIREBASE_PROJECT_ID"],
        message: "Firestore를 사용할 때 Firebase 프로젝트 ID가 필요합니다.",
      });
    }
    if (environment.DATASTORE_PROVIDER === "supabase") {
      if (environment.SUPABASE_URL === undefined) {
        context.addIssue({
          code: "custom",
          path: ["SUPABASE_URL"],
          message: "Supabase를 사용할 때 프로젝트 URL이 필요합니다.",
        });
      }
      if (environment.SUPABASE_PUBLISHABLE_KEY === undefined) {
        context.addIssue({
          code: "custom",
          path: ["SUPABASE_PUBLISHABLE_KEY"],
          message: "Supabase 공개 조회에 Publishable Key가 필요합니다.",
        });
      }
    }
    if (environment.SUPABASE_URL !== undefined) {
      const url = new URL(environment.SUPABASE_URL);
      const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(
        url.hostname,
      );
      if (
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        (url.protocol !== "https:" &&
          !(environment.NODE_ENV !== "production" && isLoopback))
      ) {
        context.addIssue({
          code: "custom",
          path: ["SUPABASE_URL"],
          message:
            "Supabase URL은 경로·쿼리·자격 증명 없는 HTTPS origin이어야 하며 로컬 개발만 루프백 HTTP를 허용합니다.",
        });
      }
    }
    if (environment.FIRESTORE_DATABASE_ID !== "(default)") {
      context.addIssue({
        code: "custom",
        path: ["FIRESTORE_DATABASE_ID"],
        message: "M1에서는 기본 Firestore 데이터베이스만 지원합니다.",
      });
    }
    if (environment.FIRESTORE_EMULATOR_HOST !== undefined) {
      const host = environment.FIRESTORE_EMULATOR_HOST.split(":")[0];
      const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(host);
      if (!isLoopback) {
        context.addIssue({
          code: "custom",
          path: ["FIRESTORE_EMULATOR_HOST"],
          message: "Firestore Emulator는 로컬 루프백 주소만 허용합니다.",
        });
      }
      if (environment.NODE_ENV === "production") {
        context.addIssue({
          code: "custom",
          path: ["FIRESTORE_EMULATOR_HOST"],
          message: "운영 환경에서는 Firestore Emulator를 사용할 수 없습니다.",
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  input: Record<string, string | undefined>,
): Environment {
  return environmentSchema.parse({
    NODE_ENV: input.NODE_ENV,
    DATASTORE_PROVIDER: input.DATASTORE_PROVIDER,
    SITE_URL: input.SITE_URL,
    FIREBASE_PROJECT_ID: input.FIREBASE_PROJECT_ID,
    FIRESTORE_DATABASE_ID: input.FIRESTORE_DATABASE_ID,
    FIRESTORE_EMULATOR_HOST: input.FIRESTORE_EMULATOR_HOST,
    GOOGLE_APPLICATION_CREDENTIALS: input.GOOGLE_APPLICATION_CREDENTIALS,
    SUPABASE_URL: input.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: input.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: input.SUPABASE_SECRET_KEY,
    LLM_API_KEY: input.LLM_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: input.GOOGLE_GENERATIVE_AI_API_KEY,
    LLM_ENABLED: input.LLM_ENABLED,
    LLM_PROVIDER: input.LLM_PROVIDER,
    AUTOMATION_MODE: input.AUTOMATION_MODE,
    GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED:
      input.GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED,
    CRON_SECRET: input.CRON_SECRET,
    PUBLICATION_CADENCE_MODE: input.PUBLICATION_CADENCE_MODE,
  });
}
