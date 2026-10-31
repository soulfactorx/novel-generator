import { RATING_POLICY } from "./prompt";
import type { ChatMessage } from "./providers";
import type { Message, Room, Settings } from "./types";

/** 대화창 밖으로 밀려난 메시지가 이만큼 쌓이면 장기 기억을 갱신 */
export const MEMORY_BATCH = 10;
/** 수동 정리 시에도 남겨 두는 최근 메시지 수 */
export const MEMORY_KEEP_RECENT = 6;
export const MEMORY_MAX_CHARS = 2000;
/** 한 번에 정리하는 최대 메시지 수 (긴 이야기를 처음부터 정리할 때 요청이 너무 커지지 않게, 나머지는 다음 차례에) */
export const MEMORY_MAX_BATCH = 80;

const valid = (m: Message) => !m.error && m.text.trim().length > 0;

/**
 * 아직 장기 기억에 반영되지 않은 메시지 중 정리 대상.
 * auto: AI에게 보내는 최근 contextMessages 개 밖으로 밀려난 것만, MEMORY_BATCH 이상일 때
 * manual: 최근 MEMORY_KEEP_RECENT 개를 뺀 전부
 */
export function pendingForMemory(room: Room, contextMessages: number, mode: "auto" | "manual"): Message[] {
  const msgs = room.messages.filter(valid);
  const keep = mode === "auto" ? contextMessages : MEMORY_KEEP_RECENT;
  const outside = msgs.slice(0, Math.max(0, msgs.length - keep));
  const cursor = room.memoryCursorAt ?? -Infinity;
  const pending = outside.filter((m) => m.createdAt > cursor);
  if (mode === "auto" && pending.length < MEMORY_BATCH) return [];
  return pending.slice(0, MEMORY_MAX_BATCH);
}

export function buildMemoryRequest(s: Settings, room: Room, pending: Message[], names: { user?: string } = {}): { system: string; messages: ChatMessage[] } {
  const who = names.user || "주인공";
  const log = pending.map((m) => (m.role === "user" ? `[${who}(사용자)] ${m.text}` : `[이야기] ${m.text}`)).join("\n\n");
  const system = [
    "너는 연재 소설의 편집자다. 작가가 다음 회를 쓸 때 참고할 '지금까지의 줄거리 요약'을 관리한다.",
    "기존 요약에 새로 진행된 내용을 합쳐, 갱신된 요약 전체를 다시 쓴다.",
    "",
    "## 작성 규칙",
    "- 한국어, 건조한 사실 위주. 문학적 수식과 대사 인용은 줄인다.",
    "- 아래 네 항목 순서로, 각 항목은 '- '로 시작하는 짧은 줄로 쓴다.",
    "  1) 주요 사건 (시간 순, 오래된 일은 더 짧게 압축)",
    "  2) 인물 상태와 관계 변화",
    "  3) 아직 풀리지 않은 일 · 약속 · 복선",
    "  4) 현재 상황 (장소, 시간, 직전 장면)",
    `- 전체 ${MEMORY_MAX_CHARS.toLocaleString()}자 이내. 넘치면 오래된 사건부터 압축한다.`,
    "- 요약만 출력한다. 머리말이나 설명을 붙이지 않는다.",
    `- ${RATING_POLICY[s.contentRating]} 요약에서는 성적·폭력적 장면도 무슨 일이 있었는지만 간단히 적는다.`,
  ].join("\n");
  const user = [`## 기존 요약\n${room.memory.trim() || "(없음)"}`, `## 이어서 진행된 내용\n${log}`, "위 내용을 반영해 갱신된 요약 전체를 작성하라."].join("\n\n");
  return { system, messages: [{ role: "user", content: user }] };
}

/** 모델이 머리말·코드블록을 붙였을 때 정리 */
export function cleanMemory(text: string): string {
  return text
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/^(#+\s*)?(갱신된\s*)?(줄거리\s*)?요약\s*[:：]?\s*\n/, "")
    .trim();
}
