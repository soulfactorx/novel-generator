import { P } from "../prompts";
import { generateClaude } from "./anthropic";
import { generateGemini } from "./gemini";
import { generateOpenAI } from "./openai";
import type { GenerateRequest, GenerateResult } from "./types";

export * from "./types";

export function generate(req: GenerateRequest): Promise<GenerateResult> {
  switch (req.settings.provider) {
    case "anthropic":
      return generateClaude(req);
    case "openai":
      return generateOpenAI(req);
    default:
      return generateGemini(req);
  }
}

/** 설정 화면의 '연결 테스트' */
export async function testConnection(req: Omit<GenerateRequest, "system" | "messages" | "maxTokens">): Promise<GenerateResult> {
  return generate({ ...req, settings: { ...req.settings, streaming: false }, system: P("test.system"), messages: [{ role: "user", content: P("test.user") }], maxTokens: 32 });
}
