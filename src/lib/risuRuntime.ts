/**
 * RisuAI 실행 환경: 이야기방의 채팅 변수 · 전역 변수(토글) · 기본 변수로 CBS 환경을 만들고,
 * 프롬프트 · 대화 기록 · 출력 · 화면 표시에 적용한다.
 */
import { parseCbs, parseKeyValue, parseToggles, risuUnescape, type CbsEnv, type Toggle } from "./cbs";
import type { StoryContext } from "./prompt";
import type { Character, ImageMeta, Message, Room, World } from "./types";

export const USER_FALLBACK = "주인공";

/** 인사말(첫 메시지)과 나머지 대화 — RisuAI는 첫 메시지를 대화 번호 -1로 다룬다 */
export function splitGreeting(messages: Message[]): { first?: Message; rest: Message[] } {
  const first = messages[0]?.greeting ? messages[0] : undefined;
  return { first, rest: messages.filter((m) => m !== first && !m.error) };
}
/** 메시지의 RisuAI 대화 번호 (인사말 -1, 그 다음부터 0…) */
export function chatIndexOf(messages: Message[], id: string): number {
  const { first, rest } = splitGreeting(messages);
  if (first?.id === id) return -1;
  return rest.findIndex((m) => m.id === id);
}

const owners = (ctx: StoryContext): (Character | World)[] => [...ctx.characters, ...(ctx.world ? [ctx.world] : [])];

/** 봇들의 기본 변수 */
export function defaultVars(ctx: StoryContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of owners(ctx)) for (const [k, v] of parseKeyValue(o.risu?.defaultVariables ?? "")) if (!(k in out)) out[k] = v;
  return out;
}
/** 이야기에 연결된 봇들의 토글 정의 */
export function togglesOf(ctx: StoryContext): { owner: string; toggles: Toggle[] }[] {
  return owners(ctx)
    .filter((o) => o.risu?.toggles?.trim())
    .map((o) => ({ owner: o.name, toggles: parseToggles(o.risu!.toggles!) }));
}

export interface EnvInput {
  ctx: StoryContext;
  messages?: Message[];
  vars?: Record<string, string>; // 이 객체에 기록됨 (runVar)
  globals: Record<string, string>;
  chatIndex?: number;
  runVar?: boolean;
  rmVar?: boolean;
  displaying?: boolean;
  images?: ImageMeta[];
  seed?: string;
  version?: string;
}
export function buildEnv(i: EnvInput): CbsEnv {
  const defaults = defaultVars(i.ctx);
  const vars = i.vars ?? {};
  const { first, rest } = splitGreeting(i.messages ?? []);
  const c0 = i.ctx.characters[0];
  const mine = (i.images ?? []).filter((m) => owners(i.ctx).some((o) => o.id === m.ownerId));
  return {
    user: i.ctx.persona?.name?.trim() || USER_FALLBACK,
    char: c0?.name ?? i.ctx.world?.name ?? "",
    getVar: (k) => vars[k] ?? defaults[k] ?? "null",
    setVar: (k, v) => {
      vars[k] = v;
    },
    getGlobal: (k) => i.globals[k] ?? "null",
    messages: rest.map((m) => ({ role: m.role === "user" ? "user" : "char", data: m.text, time: m.createdAt })),
    firstMessage: first?.text ?? c0?.greetings?.[0] ?? "",
    chatIndex: i.chatIndex ?? -1,
    runVar: i.runVar,
    rmVar: i.rmVar,
    displaying: i.displaying,
    description: c0?.profile,
    exampleDialogue: c0?.speech,
    persona: i.ctx.persona?.profile,
    assets: mine.filter((m) => m.kind === "asset").map((m) => m.name),
    emotions: mine.filter((m) => m.kind === "emotion").map((m) => m.name),
    seed: i.seed,
    version: i.version,
  };
}
export const cbs = (text: string, env: CbsEnv) => risuUnescape(parseCbs(text, env));

/** 프롬프트에 들어갈 설정 글에 CBS 적용 (토글·변수에 따라 바뀌는 부분). 내용이 비게 된 로어는 뺀다 */
export function processContext(ctx: StoryContext, env: CbsEnv): StoryContext {
  const t = (s: string) => (s && s.includes("{") ? cbs(s, env).trim() : s);
  const lore = <L extends { content: string }>(list: L[]) => list.map((l) => ({ ...l, content: t(l.content) })).filter((l) => l.content.trim());
  return {
    ...ctx,
    world: ctx.world && { ...ctx.world, description: t(ctx.world.description), rules: t(ctx.world.rules), lore: lore(ctx.world.lore) },
    persona: ctx.persona && { ...ctx.persona, profile: t(ctx.persona.profile) },
    characters: ctx.characters.map((c) => ({ ...c, summary: t(c.summary), profile: t(c.profile), speech: t(c.speech), lore: lore(c.lore), ...(c.instructions ? { instructions: t(c.instructions) } : {}) })),
  };
}

/** AI에게 보낼 대화 기록에 CBS 적용 (메시지마다 자기 대화 번호로) */
export function processMessages(room: Room, mk: (chatIndex: number) => CbsEnv): Room {
  return { ...room, messages: room.messages.map((m) => (m.text.includes("{") ? { ...m, text: cbs(m.text, mk(chatIndexOf(room.messages, m.id))) } : m)) };
}
