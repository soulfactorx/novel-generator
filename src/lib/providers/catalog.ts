import type { ProviderId } from "../types";

export interface ModelInfo {
  id: string;
  label: string;
  note?: string;
  /** Claude: temperature 허용 여부 (4.7 이후·5 세대는 거부) */
  temperature?: boolean;
  /** Claude: 요청에 thinking 이 없을 때 적응형 사고가 켜지는지 */
  thinksByDefault?: boolean;
  maxOutput?: number;
}

/** Claude 모델 (platform.claude.com 공식 문서 기준, 2026-10) */
export const CLAUDE_MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "최고 품질 · $4/$20", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "권장 · 속도·품질 균형 · $2/$10", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "최고속·저렴 · $0.10/$0.50", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "고난도 추론 · $10/$50", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-opus-5", label: "Claude Opus 5", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", thinksByDefault: true, maxOutput: 128000 },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", maxOutput: 128000 },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", maxOutput: 128000 },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", temperature: true, maxOutput: 128000 },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", temperature: true, maxOutput: 128000 },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", temperature: true, maxOutput: 64000 },
];

/** Gemini 텍스트 모델 (ai.google.dev 공식 문서 기준, 2026-10) */
export const GEMINI_MODELS: ModelInfo[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "권장 · 최신 Flash" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "최상위 추론 모델" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "이전 세대 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "빠르고 저렴" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", note: "저렴" },
];

export const OPENAI_PRESETS: ModelInfo[] = [{ id: "gpt-4.1", label: "gpt-4.1" }];

export const PROVIDER_LABEL: Record<ProviderId, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude", openai: "OpenAI 호환" };

export const claudeInfo = (id: string): ModelInfo =>
  CLAUDE_MODELS.find((m) => m.id === id) ?? { id, label: id, temperature: false, thinksByDefault: true };
