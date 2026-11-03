import { ratingText } from "./prompt";
import { P } from "./prompts";
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
  const log = pending.map((m) => (m.role === "user" ? P("memory.userLine", { 이름: who, 내용: m.text }) : P("memory.storyLine", { 내용: m.text }))).join("\n\n");
  const system = P("memory.system", { 최대글자: MEMORY_MAX_CHARS.toLocaleString(), 수위: ratingText(s.contentRating) });
  const user = P("memory.user", { 기존: room.memory.trim() || P("memory.none"), 내용: log });
  return { system, messages: [{ role: "user", content: user }] };
}

/** 모델이 머리말·코드블록을 붙였을 때 정리 */
export function cleanMemory(text: string): string {
  return text
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/^(#+\s*)?(갱신된\s*)?(줄거리\s*)?요약\s*[:：]?\s*\n/, "")
    .trim();
}
