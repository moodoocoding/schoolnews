import "server-only";

import { createGeminiGeneration } from "./gemini-factory";

export function createConfiguredGeminiGeneration(input?: {
  apiKey?: string;
}) {
  const apiKey = input?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey || apiKey.trim().length < 20 || /\s/u.test(apiKey)) {
    throw new Error("Google Gemini API 키 설정이 유효하지 않습니다.");
  }

  return createGeminiGeneration({ apiKey });
}
