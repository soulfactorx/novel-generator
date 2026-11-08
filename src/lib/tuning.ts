/**
 * 바꿀 수 있는 수치 모음 (기본값 · 허용 범위). 코드 안에 결과에 영향을 주는 숫자를 직접 쓰지 않고 여기서 꺼내 쓴다.
 * 사용자는 [설정 → 세부 수치]에서 고치거나 기본값으로 되돌릴 수 있다 (바꾼 것만 settings.tuning 에 저장).
 * 동기화 조각 크기·암호화 반복 수처럼 기술적인 값은 넣지 않는다.
 */

export interface TuneDef {
  id: string;
  group: string;
  label: string;
  hint?: string;
  def: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

const G_CHAT = "이야기방";
const G_MEM = "장기 기억";
const G_NOVEL = "소설";
const G_DIAG = "이야기 진단";
const G_IMG = "그림";
const G_BOT = "봇 · 연결";
const t = (group: string, id: string, label: string, def: number, min: number, max: number, o: { hint?: string; step?: number; unit?: string } = {}): TuneDef => ({ id, group, label, def, min, max, ...o });

export const TUNE_DEFS: TuneDef[] = [
  t(G_CHAT, "chat.tokens.short", "응답 최대 길이 · 분량 짧게", 1500, 200, 32000, { step: 100, unit: "토큰", hint: "AI가 한 번에 쓸 수 있는 최대 길이. 글이 중간에 끊기면 늘리세요." }),
  t(G_CHAT, "chat.tokens.medium", "응답 최대 길이 · 분량 보통", 3500, 200, 32000, { step: 100, unit: "토큰" }),
  t(G_CHAT, "chat.tokens.long", "응답 최대 길이 · 분량 길게", 7000, 200, 64000, { step: 100, unit: "토큰" }),
  t(G_CHAT, "chat.loreBudget", "로어북 글자 예산", 4000, 500, 50000, { step: 500, unit: "자", hint: "한 번에 함께 보낼 로어북 항목의 글자 수 합계. 넘치면 우선순위가 낮은 항목부터 뺍니다." }),
  t(G_CHAT, "chat.loreScan", "로어북 키워드를 찾을 최근 메시지 수", 4, 1, 50, { unit: "개" }),

  t(G_MEM, "memory.batch", "자동 정리 기준", 10, 2, 100, { unit: "개", hint: "AI에게 보내는 최근 메시지 밖으로 밀려난 메시지가 이만큼 쌓이면 줄거리 요약을 갱신합니다." }),
  t(G_MEM, "memory.keepRecent", "수동 정리 때 남길 최근 메시지", 6, 0, 100, { unit: "개" }),
  t(G_MEM, "memory.maxChars", "요약 최대 길이", 2000, 300, 20000, { step: 100, unit: "자" }),
  t(G_MEM, "memory.maxBatch", "한 번에 정리할 최대 메시지", 80, 10, 500, { unit: "개", hint: "긴 이야기를 처음부터 정리할 때 요청이 너무 커지지 않게 나눕니다." }),
  t(G_MEM, "memory.tokens", "요약 응답 최대 길이", 3000, 500, 32000, { step: 100, unit: "토큰" }),

  t(G_NOVEL, "novel.chars.short", "회차 목표 분량 · 짧게", 3000, 500, 50000, { step: 500, unit: "자" }),
  t(G_NOVEL, "novel.chars.medium", "회차 목표 분량 · 보통", 5000, 500, 50000, { step: 500, unit: "자" }),
  t(G_NOVEL, "novel.chars.long", "회차 목표 분량 · 길게", 8000, 500, 50000, { step: 500, unit: "자" }),
  t(G_NOVEL, "novel.tokens.short", "회차 응답 최대 길이 · 짧게", 6000, 1000, 64000, { step: 500, unit: "토큰" }),
  t(G_NOVEL, "novel.tokens.medium", "회차 응답 최대 길이 · 보통", 9000, 1000, 64000, { step: 500, unit: "토큰" }),
  t(G_NOVEL, "novel.tokens.long", "회차 응답 최대 길이 · 길게", 14000, 1000, 64000, { step: 500, unit: "토큰" }),
  t(G_NOVEL, "novel.tailChars", "이어 쓸 때 보여 줄 직전 회차 끝부분", 1500, 0, 20000, { step: 100, unit: "자" }),
  t(G_NOVEL, "novel.outlineTokens", "개요 응답 최대 길이", 16000, 2000, 64000, { step: 500, unit: "토큰", hint: "개요 한 번의 출력 한도입니다. 생각(사고)하는 모델은 생각도 이 안에서 씁니다. 생각만 하다 한도를 다 쓰면 두 배로 늘려 한 번 더 요청합니다." }),

  t(G_DIAG, "diagnose.recent", "진단할 최근 메시지 수", 16, 2, 200, { unit: "개" }),
  t(G_DIAG, "diagnose.tokens", "진단 응답 최대 길이", 3000, 500, 32000, { step: 100, unit: "토큰" }),

  t(G_IMG, "image.shrinkOver", "저장할 때 줄일 그림 크기 기준", 1200, 100, 20000, { step: 100, unit: "KB", hint: "이보다 큰 그림은 저장할 때 줄여서 기기 저장 공간을 아낍니다 (움직이는 GIF·소리·영상은 그대로)." }),
  t(G_IMG, "image.maxSide", "줄일 때 긴 변 최대 길이", 1600, 400, 8000, { step: 100, unit: "px" }),
  t(G_IMG, "image.quality", "줄일 때 그림 품질", 88, 40, 100, { unit: "%" }),
  t(G_IMG, "image.listMax", "AI에게 알려 줄 그림 이름 최대 개수", 150, 10, 2000, { step: 10, unit: "개", hint: "봇에 그림 규칙이 없을 때 그림 목록을 프롬프트에 넣습니다. 많을수록 요청이 길어집니다." }),

  t(G_BOT, "bot.llmTokens", "봇 보조 AI 호출 응답 최대 길이", 4000, 200, 32000, { step: 100, unit: "토큰", hint: "봇 스크립트(Lua)가 직접 부르는 AI 요청(추천·그림 고르기 등)." }),
  t(G_BOT, "net.retries", "오류 시 자동 재시도 횟수", 2, 0, 6, { unit: "번", hint: "과부하·한도·서버 오류·네트워크 문제일 때 같은 모델로 다시 시도하는 횟수." }),
];

const DEFAULTS: Record<string, number> = Object.fromEntries(TUNE_DEFS.map((d) => [d.id, d.def]));
const BY_ID: Record<string, TuneDef> = Object.fromEntries(TUNE_DEFS.map((d) => [d.id, d]));
export const defaultTune = (id: string) => DEFAULTS[id];

let overrides: Record<string, number> = {};
export function setTuning(map: Record<string, number> | undefined) {
  overrides = map ?? {};
}
/** 수치 꺼내기 (바꾼 값이 범위를 벗어나면 범위 안으로) */
export function T(id: string): number {
  const d = BY_ID[id];
  if (!d) return NaN;
  const v = overrides[id];
  return typeof v === "number" && Number.isFinite(v) ? clampTune(d, v) : d.def;
}
export const clampTune = (d: TuneDef, v: number) => Math.min(d.max, Math.max(d.min, v));

/** 저장 전 정리: 아는 id · 숫자 · 기본값과 다른 것만 */
export function cleanTuning(map: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map || typeof map !== "object") return out;
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    const d = BY_ID[k];
    const n = typeof v === "number" ? v : Number(v);
    if (d && Number.isFinite(n) && clampTune(d, n) !== d.def) out[k] = clampTune(d, n);
  }
  return out;
}
