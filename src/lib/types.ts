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
  autoMemory: boolean; // 오래된 대화를 장기 기억으로 자동 정리
  readerFontSize: number; // 소설 읽기 글자 크기(px)
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
  premise: string; // 이 이야기만의 추가 설정 메모 (시스템 프롬프트에 포함)
  memory: string; // 장기 기억 요약
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  worldId?: string;
  characterIds: string[];
  personaId?: string;
  memoryCursorAt?: number; // 이 시각(createdAt) 이전 메시지까지 장기 기억에 반영됨
  memoryUpdatedAt?: number;
}

/* ---------------- 라이브러리: 세계관 · 등장인물 · 주인공(페르소나) ---------------- */

/** 로어북 항목: 키워드가 최근 대화에 나오면(또는 '항상') AI에게 전달 */
export interface LoreEntry {
  id: string;
  title: string;
  keys: string[];
  content: string;
  enabled: boolean;
  always?: boolean;
}
interface EntityBase {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}
export interface World extends EntityBase {
  kind: "world";
  description: string; // 배경·시대·분위기
  rules: string; // 이 세계에서 지켜야 할 규칙·문체 지시
  lore: LoreEntry[];
}
export interface Character extends EntityBase {
  kind: "character";
  summary: string; // 한 줄 소개 (나이·직업 등)
  profile: string; // 외모·성격·배경·관계
  speech: string; // 말투·대사 예시
  lore: LoreEntry[];
  worldId?: string; // 소속 세계관 (선택)
}
export interface Persona extends EntityBase {
  kind: "persona";
  profile: string; // 사용자가 연기하는 주인공
}
export type Entity = World | Character | Persona;
export type EntityKind = Entity["kind"];

export function normalizeRoom(raw: Room): Room {
  return { ...raw, premise: raw.premise ?? "", memory: raw.memory ?? "", messages: raw.messages ?? [], characterIds: Array.isArray(raw.characterIds) ? raw.characterIds : [] };
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
  autoMemory: true,
  readerFontSize: 18,
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
  s.readerFontSize = Math.min(28, Math.max(13, Math.round(Number(s.readerFontSize) || 18)));
  s.contextMessages = Math.min(400, Math.max(4, Math.round(Number(s.contextMessages) || 40)));
  return s;
}

/* ---------------- 소설 (자동 집필 · 서고) ---------------- */
export type EpisodeLength = "short" | "medium" | "long";
export interface OutlineItem {
  id: string;
  title: string;
  summary: string; // 이 회차에서 일어날 일 (계획)
}
export interface Episode {
  id: string;
  title: string;
  text: string;
  summary: string; // 실제로 쓴 내용 요약 (다음 회차 집필 때 참고)
  model?: string;
  incomplete?: boolean; // 중단·분량 초과로 끝까지 쓰지 못함
  createdAt: number;
  updatedAt: number;
}
export interface Novel {
  id: string;
  title: string;
  author: string;
  genre: string;
  brief: string; // 기획 · 시놉시스 · 요청 사항
  worldId?: string;
  characterIds: string[];
  personaId?: string; // 주인공
  episodeCount: number; // 목표 회차 수
  episodeLength: EpisodeLength;
  outline: OutlineItem[]; // outline[i] ↔ episodes[i]
  episodes: Episode[];
  createdAt: number;
  updatedAt: number;
}

export function normalizeNovel(raw: Novel): Novel {
  return {
    ...raw,
    author: raw.author ?? "",
    genre: raw.genre ?? "",
    brief: raw.brief ?? "",
    characterIds: Array.isArray(raw.characterIds) ? raw.characterIds : [],
    episodeCount: Math.min(200, Math.max(1, Math.round(Number(raw.episodeCount) || 10))),
    episodeLength: (["short", "medium", "long"] as const).includes(raw.episodeLength) ? raw.episodeLength : "medium",
    outline: Array.isArray(raw.outline) ? raw.outline : [],
    episodes: Array.isArray(raw.episodes) ? raw.episodes : [],
  };
}
