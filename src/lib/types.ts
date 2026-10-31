export type ProviderId = "gemini" | "anthropic" | "openai";

/** 콘텐츠 수위. general(기본) → mature → adult(본인이 직접 켜야 함) */
export type ContentRating = "general" | "mature" | "adult";

export interface StyleOptions {
  pov: "third-limited" | "first" | "third-omniscient";
  length: "short" | "medium" | "long";
  pacing: "fast" | "balanced" | "slow";
  dialogue: "balanced" | "more" | "less";
}

export interface Settings {
  version: 1;
  provider: ProviderId;
  keys: Record<ProviderId, string>;
  models: Record<ProviderId, string>;
  openaiBaseUrl: string;
  temperature: number; // 0~1 (모델이 지원할 때만 적용)
  contextMessages: number; // AI에게 보내는 최근 메시지 수
  streaming: boolean;
  choices: boolean; // 다음 행동 선택지 제안
  contentRating: ContentRating;
  adultConfirmed: boolean; // 성인 확인을 직접 했는지
  style: StyleOptions;
  theme: "system" | "light" | "dark";
}

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  text: string;
  choices?: string[];
  thinking?: string;
  error?: string;
  model?: string;
  createdAt: number;
}

export interface Room {
  id: string;
  title: string;
  premise: string; // 배경·설정 메모 (시스템 프롬프트에 포함)
  memory: string; // 장기 기억 요약
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  provider: "gemini",
  keys: { gemini: "", anthropic: "", openai: "" },
  models: { gemini: "gemini-3.8-flash", anthropic: "claude-sonnet-5-5", openai: "gpt-4.1" },
  openaiBaseUrl: "https://openrouter.ai/api/v1",
  temperature: 0.8,
  contextMessages: 40,
  streaming: true,
  choices: true,
  contentRating: "general",
  adultConfirmed: false,
  style: { pov: "third-limited", length: "medium", pacing: "balanced", dialogue: "balanced" },
  theme: "system",
};

/** 저장된 설정을 기본값과 병합 (새 항목이 추가돼도 안전) */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...r,
    keys: { ...DEFAULT_SETTINGS.keys, ...(r.keys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(r.models || {}) },
    style: { ...DEFAULT_SETTINGS.style, ...(r.style || {}) },
    version: 1,
  };
  // 성인 확인 없이 adult 로 저장될 수 없음
  if (s.contentRating === "adult" && !s.adultConfirmed) s.contentRating = "mature";
  s.temperature = Math.min(1, Math.max(0, Number(s.temperature) || 0));
  s.contextMessages = Math.min(400, Math.max(4, Math.round(Number(s.contextMessages) || 40)));
  return s;
}
