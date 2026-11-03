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
  /** 기본 모델이 과부하·한도·서버 오류로 실패하면 이 모델로 한 번 더 시도 */
  fallback: { enabled: boolean; provider: ProviderId; model: string };
  monthlyBudget: number; // USD, 0 = 끔 (넘으면 경고만)
  krwPerUsd: number; // 원화 환산 표시용
  customPrices: Record<string, { in: number; out: number }>; // 모델별 사용자 지정 단가 (USD/100만 토큰)
  coverModel: string; // AI 표지 그림 모델 (Gemini)
  /** RisuAI 호환 기능 켜고 끄기 */
  risu: RisuOptions;
  prompts: Record<string, string>; // 설정 → 프롬프트에서 바꾼 문구 (id → 문구, 바꾼 것만)
  dialogueColors: boolean; // 화자별 대사 색
}

/** 메시지·회차에 붙는 사용량 (usd: 단가를 아는 경우) */
export interface MessageUsage {
  input: number;
  output: number;
  cacheRead?: number;
  usd?: number;
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
  usage?: MessageUsage;
  fallback?: boolean; // 대체 모델로 생성됨
  bookmark?: string; // 책갈피 이름 ("" 도 책갈피)
  greeting?: boolean; // 인사말(첫 메시지): RisuAI처럼 대화 번호 -1로 다룸
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
  branchOf?: { roomId: string; messageId: string; title: string }; // 분기해 온 원래 이야기
  lastDiagnosis?: { at: number; report: string; directive: string };
  vars?: Record<string, string>; // RisuAI 채팅 변수 ({{setvar}} · Lua setChatVar)
  onboardingDone?: boolean; // 봇의 시작 설정(온보딩)을 마침
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
  /** RisuAI 로어 규칙 (선택) */
  secondKeys?: string[]; // 보조 키: 주 키와 보조 키가 모두 나와야 전달
  regex?: boolean; // 키를 /정규식/플래그 로 검사
  order?: number; // 넣는 순서·우선순위 (높을수록 먼저, 글자 예산이 모자라면 낮은 것부터 뺌)
  decorators?: string; // @@activate_only_after 3 같은 RisuAI 데코레이터 줄
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
  scripts?: RegexScript[]; // RisuAI 모듈의 정규식 스크립트
  source?: PackageSource;
  risu?: RisuExtras;
}
export interface Character extends EntityBase {
  kind: "character";
  summary: string; // 한 줄 소개 (나이·직업 등)
  profile: string; // 외모·성격·배경·관계
  speech: string; // 말투·대사 예시
  lore: LoreEntry[];
  worldId?: string; // 소속 세계관 (선택)
  scripts?: RegexScript[]; // RisuAI 캐릭터의 정규식 스크립트
  instructions?: string; // 응답 직전에 AI에게 주는 지시 (RisuAI post_history_instructions · @@depth 0 로어)
  greetings?: string[]; // 첫 메시지(인사말) 목록 — 새 이야기를 이 중 하나로 시작
  notes?: string; // 제작자 노트 (AI에게는 보내지 않음)
  notesByLang?: Record<string, string>; // 언어별 제작자 노트 (CCv3 creator_notes_multilingual: { ko, en, ja … })
  risu?: RisuExtras;
  source?: PackageSource; // 가져온 패키지 정보 (RisuAI charx 등)
  emotionMode?: boolean; // RisuAI '감정 이미지' 화면: AI가 응답마다 <Emotion="이름">으로 감정 이미지를 고름
  color?: string; // 대사 색 (#rrggbb, 없으면 자동)
  aliases?: string; // 대사 화자를 찾을 때 쓰는 다른 이름 (쉼표로 구분)
}
export interface Persona extends EntityBase {
  kind: "persona";
  profile: string; // 사용자가 연기하는 주인공
  color?: string; // 대사 색
  aliases?: string; // 다른 이름
}
export type Entity = World | Character | Persona;

/** 등장인물·세계관에 딸린 이미지 (RisuAI 에셋·감정 이미지). 바이트는 IndexedDB imageData에 따로 저장하고 동기화하지 않음 */
export interface ImageMeta {
  id: string;
  ownerId: string; // 등장인물 또는 세계관 id
  name: string; // {{img::이름}} 등으로 부르는 이름
  kind: "icon" | "emotion" | "asset";
  mime: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}
/** RisuAI 정규식 스크립트 (editinput · editoutput · editprocess · editdisplay) */
export interface RegexScript {
  comment: string;
  in: string;
  out: string;
  type: string;
  flag?: string;
  ableFlag?: boolean;
  disabled?: boolean; // 이 앱에서 끈 스크립트 (지우지 않고 보관)
}
/** RisuAI 봇의 실행 요소 (토글·기본 변수·트리거·Lua·배경 HTML) — 원본 그대로 보관 */
export interface RisuExtras {
  toggles?: string; // 사이드바 토글 정의 ("key=이름=select=가,나")
  defaultVariables?: string; // "key=value" 줄
  triggers?: unknown[]; // RisuAI triggerscript (블록·Lua)
  backgroundHTML?: string; // 채팅 배경 HTML·CSS
  lowLevelAccess?: boolean;
  onboarding?: Onboarding; // 채팅 시작 전 설정 화면 (답은 채팅 변수로)
  emotionPanel?: boolean; // 감정 이미지를 본문이 아니라 옆 패널에 (RisuAI 기본 감정 화면)
}
/** RisuAI 온보딩: 채팅 시작 전에 보여 주는 질문(양식) 또는 HTML. 답은 채팅 변수에 기록 */
export interface Onboarding {
  enabled: boolean;
  mode: "form" | "html";
  title: string;
  description: string;
  html: string;
  floatingButton?: boolean;
  questions: { id: string; title: string; description: string; type: "single" | "multiple" | "text"; varName: string; required: boolean; placeholder: string; options: { label: string; value: string }[] }[];
}

/** 가져온 패키지: 어디서 왔는지 (같은 봇을 다시 가져올 때 교체할 수 있게) */
export interface PackageSource {
  kind: "risu";
  file: string; // 파일 이름
  format: string; // "캐릭터 카드(charx)" 등
  importedAt: number;
}
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
  fallback: { enabled: false, provider: "gemini", model: "gemini-3.8-flash" },
  monthlyBudget: 0,
  krwPerUsd: 1400,
  customPrices: {},
  coverModel: "gemini-nano-banana-2.1",
  risu: { cbs: true, scripts: true, triggers: true, lua: true, background: true, markdown: true, imageEveryTurn: true },
  prompts: {},
  dialogueColors: true,
};

export interface RisuOptions {
  cbs: boolean; // {{…}} 문법·변수·토글
  scripts: boolean; // 정규식 스크립트
  triggers: boolean; // 트리거 스크립트 (블록)
  lua: boolean; // Lua 트리거 · 버튼
  background: boolean; // 배경 HTML·CSS
  markdown: boolean; // *기울임* **굵게** 표시
  imageEveryTurn: boolean; // 봇 그림 규칙이 있으면 매 응답마다 그림 표시를 적어도 하나
}

/** 저장된 설정을 기본값과 병합 (새 항목이 추가돼도 안전) */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...r,
    keys: { ...DEFAULT_SETTINGS.keys, ...(r.keys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(r.models || {}) },
    style: { ...DEFAULT_SETTINGS.style, ...(r.style || {}) },
    fallback: { ...DEFAULT_SETTINGS.fallback, ...(r.fallback || {}) },
    risu: { ...DEFAULT_SETTINGS.risu, ...(r.risu || {}) },
    customPrices: r.customPrices && typeof r.customPrices === "object" ? r.customPrices : {},
    prompts: Object.fromEntries(Object.entries(r.prompts && typeof r.prompts === "object" ? r.prompts : {}).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    version: 1,
  };
  // 성인 확인 없이 adult 로 저장될 수 없음
  if (s.contentRating === "adult" && !s.adultConfirmed) s.contentRating = "mature";
  s.temperature = Math.min(1, Math.max(0, Number(s.temperature) || 0));
  s.monthlyBudget = Math.max(0, Number(s.monthlyBudget) || 0);
  s.krwPerUsd = Math.max(0, Number(s.krwPerUsd) || 0);
  s.readerFontSize = Math.min(28, Math.max(13, Math.round(Number(s.readerFontSize) || 18)));
  s.contextMessages = Math.min(400, Math.max(4, Math.round(Number(s.contextMessages) || 40)));
  return s;
}

/* ---------------- 소설 (자동 집필 · 서고) ---------------- */
export interface NovelCover {
  dataUrl: string; // JPEG data URL (약 800×1200)
  source: "ai" | "upload" | "design";
  prompt?: string;
  createdAt: number;
}
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
  usage?: MessageUsage;
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
  cover?: NovelCover;
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
