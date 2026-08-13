import "server-only";

import {
  createGeminiGeneration,
  createGeminiRawRoutes,
} from "./gemini-factory";

function configuredApiKey(input?: { apiKey?: string }): string {
  const apiKey = input?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey || apiKey.trim().length < 20 || /\s/u.test(apiKey)) {
    throw new Error("Google Gemini API 키 설정이 유효하지 않습니다.");
  }
  return apiKey;
}

export function createConfiguredGeminiGeneration(input?: {
  apiKey?: string;
}) {
  return createGeminiGeneration({ apiKey: configuredApiKey(input) });
}

/** Server-only raw routes for the persistent Supabase ledger integration. */
export function createConfiguredGeminiRawRoutes(input?: { apiKey?: string }) {
  return createGeminiRawRoutes({ apiKey: configuredApiKey(input) });
}
