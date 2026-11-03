import { contextSections, ratingText, type StoryContext } from "./prompt";
import { P } from "./prompts";
import type { ChatMessage } from "./providers";
import type { Novel, Room, Settings } from "./types";

export const DIRECTIVE_MARKER = "[다음 지시]";
const RECENT = 16;

const rules = (s: Settings) => P("diagnose.rules", { 지시표시: DIRECTIVE_MARKER, 수위: ratingText(s.contentRating) });

export function buildRoomDiagnosis(s: Settings, room: Room, ctx: StoryContext): { system: string; messages: ChatMessage[] } {
  const recent = room.messages.filter((m) => !m.error && m.text.trim()).slice(-RECENT);
  const log = recent.map((m) => P(m.role === "user" ? "diagnose.userLine" : "diagnose.aiLine", { 내용: m.text })).join("\n\n");
  const system = P("diagnose.room.system", {
    형식: rules(s),
    설정: contextSections(ctx, "chat").join("\n").trim(),
    추가설정: room.premise.trim() ? P("diagnose.room.premise", { 내용: room.premise.trim() }) : "",
    줄거리: room.memory.trim() ? P("diagnose.room.memory", { 내용: room.memory.trim() }) : "",
  });
  return { system, messages: [{ role: "user", content: P("diagnose.room.user", { 기록: log || P("diagnose.room.empty") }) }] };
}

export function buildEpisodeDiagnosis(s: Settings, n: Novel, ctx: StoryContext, index: number): { system: string; messages: ChatMessage[] } {
  const e = n.episodes[index];
  const system = P("diagnose.episode.system", { 형식: rules(s), 설정: contextSections(ctx, "novel").join("\n").trim() });
  const prev = n.episodes.slice(0, index).map((x, i) => `[${i + 1}화] ${x.title}: ${x.summary || n.outline[i]?.summary || ""}`).join("\n");
  const user = P("diagnose.episode.user", {
    기획: n.brief.trim() ? P("diagnose.episode.brief", { 내용: n.brief.trim() }) : "",
    앞회차: prev ? P("diagnose.episode.prev", { 내용: prev }) : "",
    번호: index + 1,
    제목: n.outline[index]?.title ?? e.title,
    회차개요: n.outline[index]?.summary ?? "",
    원고: e.text,
  });
  return { system, messages: [{ role: "user", content: user }] };
}

export function splitDiagnosis(raw: string): { report: string; directive: string } {
  const i = raw.lastIndexOf(DIRECTIVE_MARKER);
  if (i === -1) return { report: raw.trim(), directive: "" };
  return { report: raw.slice(0, i).trim(), directive: raw.slice(i + DIRECTIVE_MARKER.length).trim() };
}
