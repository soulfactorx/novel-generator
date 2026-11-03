import { T } from "./tuning";
import type { Character, ContentRating, Persona, Room, Settings, StyleOptions, World } from "./types";
import { P } from "./prompts";
import { CHOICE_MARKER } from "./choices";

/* 프롬프트 문구는 모두 prompts.ts 에 있다 (설정 → 프롬프트에서 고칠 수 있음). 여기서는 조립만 한다. */
export const ratingText = (r: ContentRating) => P(`rating.${r}`);
export const povText = (v: StyleOptions["pov"]) => P(`pov.${v}`);
export const pacingText = (v: StyleOptions["pacing"]) => P(`pacing.${v}`);
export const dialogueText = (v: StyleOptions["dialogue"]) => P(`dialogue.${v}`);
export const lengthText = (v: StyleOptions["length"]) => P(`length.${v}`);

/** 출력 토큰 상한 (분량 기준, 한국어 여유 포함) */
export const outputTokensFor = (s: Settings) => T(`chat.tokens.${s.style.length}`); // 설정 → 세부 수치

/** 이야기방에 연결된 라이브러리 항목 */
export interface StoryContext {
  world?: World;
  characters: Character[];
  persona?: Persona;
}

export function buildSystemPrompt(s: Settings, room: Room, ctx: StoryContext = { characters: [] }, imageRules: string[] = []): string {
  // 봇이 자기 선택지를 직접 만들면(Lua로 선택지 버튼 등) 이 앱의 선택지 형식을 요구하지 않는다 — 봇의 출력 형식과 부딪힘
  const choices = s.choices && !(s.risu.lua && botHandlesChoices(ctx));
  const premise = room.premise.trim();
  return P("chat.system", {
    시점: povText(s.style.pov),
    분량: lengthText(s.style.length),
    전개: pacingText(s.style.pacing),
    대사: dialogueText(s.style.dialogue),
    수위: ratingText(s.contentRating),
    선택지: choices ? P("chat.choices", { 표시: CHOICE_MARKER }) : "",
    설정: contextSections(ctx, "chat").join("\n").trim(),
    그림: imageRules.join("\n").trim(),
    추가설정: premise ? P(ctx.world || ctx.characters.length ? "chat.premise" : "chat.premiseOnly", { 내용: premise }) : "",
    줄거리: room.memory.trim() ? P("chat.memory", { 내용: room.memory.trim() }) : "",
  });
}

/** 세계관 · 주인공 · 등장인물 섹션 (대화형/소설 공용) */
export function contextSections(ctx: StoryContext, mode: "chat" | "novel"): string[] {
  const parts: string[] = [];
  const w = ctx.world;
  if (w) {
    parts.push("", P("ctx.world", { 이름: w.name, 설명: w.description.trim() }));
    if (w.rules.trim()) parts.push("", P("ctx.worldRules", { 내용: w.rules.trim() }));
  }
  if (ctx.persona) parts.push("", P(mode === "chat" ? "ctx.personaChat" : "ctx.personaNovel", { 이름: ctx.persona.name, 프로필: ctx.persona.profile.trim() }));
  if (ctx.characters.length) {
    parts.push("", P("ctx.characters"));
    for (const c of ctx.characters)
      parts.push("", P("ctx.character", { 이름: c.name, 한줄: c.summary.trim() ? P("ctx.summary", { 내용: c.summary.trim() }) : "", 프로필: c.profile.trim(), 말투: c.speech.trim() ? P("ctx.speech", { 내용: c.speech.trim() }) : "" }));
  }
  return parts;
}

/** 등장인물의 '응답 직전 지시' (RisuAI post_history_instructions 등) */
export function instructionsOf(ctx: StoryContext): string {
  return ctx.characters
    .filter((c) => c.instructions?.trim())
    .map((c) => (ctx.characters.length > 1 ? `[${c.name}]\n${c.instructions!.trim()}` : c.instructions!.trim()))
    .join("\n\n");
}

/** AI에게 보낼 대화: 최근 N개, 오류 메시지 제외, 첫 메시지는 user 로 시작 */
export function buildHistory(room: Room, limit: number): { role: "user" | "assistant"; content: string }[] {
  const msgs = room.messages.filter((m) => !m.error && m.text.trim());
  const recent = msgs.slice(-limit).map((m) => ({
    role: m.role,
    content: m.role === "assistant" && m.choices?.length ? `${m.text}\n\n${CHOICE_MARKER}\n${m.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : m.text,
  }));
  // 대화가 AI 응답(인사말 등)으로 시작하면 버리지 말고 시작 요청 한 줄을 앞에 붙인다 (AI가 첫 장면을 알도록)
  if (recent.length && recent[0].role !== "user" && msgs.length <= limit) recent.unshift({ role: "user", content: P("chat.start") });
  // 최근 N개로 잘려서 AI 응답으로 시작하면 그 앞부분은 장기 기억이 맡으므로 첫 사용자 입력부터
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}

/** 봇의 Lua가 선택지를 직접 다루는지 (예: 응답 끝 선택지 줄을 읽어 버튼으로 그림) */
export function botHandlesChoices(ctx: StoryContext): boolean {
  const lua = (t: unknown) => ((t as { effect?: { type?: string; code?: string }[] })?.effect ?? []).filter((e) => e?.type === "triggerlua" && typeof e.code === "string").map((e) => e.code!);
  return [...ctx.characters, ...(ctx.world ? [ctx.world] : [])].some((o) => (o.risu?.triggers ?? []).flatMap(lua).some((c) => /\bchoices?\b|선택지/i.test(c)));
}

/**
 * 봇(Lua editRequest)이 고친 요청 → 시스템 프롬프트 + 대화.
 * 맨 앞의 시스템 메시지만 시스템 프롬프트로 모으고, 대화 중간·끝에 넣은 시스템 메시지(봇의 그림 지침·장면 상태 등)는
 * 그 자리에 두기 위해 이웃한 사용자 차례에 붙인다 (Claude·Gemini는 대화 중간 시스템 메시지를 받지 않음).
 * RisuAI처럼 최신 턴 가까이 있어야 긴 대화에서도 지침이 약해지지 않는다.
 */
export function foldRequest(msgs: { role: string; content: string }[]): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  const lead: string[] = [];
  let i = 0;
  for (; i < msgs.length && msgs[i].role === "system"; i++) if (msgs[i].content.trim()) lead.push(msgs[i].content.trim());
  const out: { role: "user" | "assistant"; content: string }[] = [];
  let pending: string[] = [];
  const block = () => pending.map((c) => P("chat.inlineSystem", { 내용: c })).join("\n\n");
  const push = (role: "user" | "assistant", content: string) => {
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else out.push({ role, content });
  };
  for (; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "system") {
      if (m.content.trim()) pending.push(m.content.trim());
      continue;
    }
    const role = m.role === "user" ? "user" : "assistant";
    if (pending.length) {
      const b = block();
      pending = [];
      if (role === "user") {
        push("user", `${b}\n\n${m.content}`);
        continue;
      }
      push("user", b); // AI 차례 앞: 앞 사용자 차례 끝에 붙이거나 새 사용자 차례로
    }
    push(role, m.content);
  }
  if (pending.length) push("user", block());
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: P("chat.start") });
  return { system: lead.join("\n\n"), messages: out };
}
