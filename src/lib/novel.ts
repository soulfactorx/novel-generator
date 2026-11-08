import { contextSections, dialogueText, pacingText, povText, ratingText, type StoryContext } from "./prompt";
import { P } from "./prompts";
import { T } from "./tuning";
import type { ChatMessage } from "./providers";
import type { EpisodeLength, Novel, OutlineItem, Settings } from "./types";

/** 회차 분량: 목표 글자 수 · 출력 토큰 상한 (설정 → 세부 수치) */
const LENGTH_NAME: Record<EpisodeLength, string> = { short: "짧게", medium: "보통", long: "길게" };
export const EPISODE_LENGTHS = Object.keys(LENGTH_NAME) as EpisodeLength[];
export function episodeLength(k: EpisodeLength): { label: string; chars: number; tokens: number } {
  const chars = T(`novel.chars.${k}`);
  return { label: `${LENGTH_NAME[k]} (약 ${chars.toLocaleString()}자)`, chars, tokens: T(`novel.tokens.${k}`) };
}
export const SUMMARY_MARKER = "[회차 요약]";

function novelInfo(n: Novel): string {
  const body = [P("novel.info.title", { 내용: n.title || P("novel.info.untitled") }), n.genre.trim() && P("novel.info.genre", { 내용: n.genre.trim() }), n.brief.trim() && P("novel.info.brief", { 내용: n.brief.trim() })].filter(Boolean).join("\n");
  return P("novel.info", { 내용: body });
}

/* ---------------- 개요 ---------------- */
export function buildOutlineRequest(s: Settings, n: Novel, ctx: StoryContext, from: number): { system: string; messages: ChatMessage[] } {
  const system = P("novel.outline.system", { 수위: ratingText(s.contentRating), 설정: contextSections(ctx, "novel").join("\n").trim() });
  const prev = n.outline.slice(0, from);
  const user = P("novel.outline.user", {
    작품정보: novelInfo(n),
    이전회차: prev.length ? P("novel.outline.prev", { 내용: formatOutline(prev) }) : "",
    직전내용: from > 0 && n.episodes[from - 1]?.summary ? P("novel.outline.last", { 내용: n.episodes[from - 1].summary }) : "",
    시작: from + 1,
    끝: n.episodeCount,
    개수: n.episodeCount - from,
  });
  return { system, messages: [{ role: "user", content: user }] };
}

export const formatOutline = (items: OutlineItem[], offset = 0) => items.map((o, i) => `[${i + 1 + offset}화] ${o.title}\n${o.summary}`).join("\n\n");

type OutlineHead = { number: number; title: string; summary: string };

/** 제목·요약 다듬기: 굵게·따옴표·'요약:' 머리 제거, 제목이 비면 다음 줄을 제목으로 */
function outlineItem(num: number, rawTitle: string, rawBody: string): OutlineHead {
  const body = rawBody.replace(/^\s*(?:요약|내용|줄거리|summary)\s*[:：]\s*/im, "").replace(/\*\*/g, "").trim();
  let title = rawTitle.replace(/\*\*/g, "").replace(/^\s*(?:제목\s*[:：]\s*)?/, "").replace(/^["'「『“]|["'」』”]$/g, "").trim();
  let summary = body;
  if (!title && body) [title, summary] = [body.split("\n")[0].trim(), body.split("\n").slice(1).join("\n").trim()];
  return { number: num, title: title || `${num}화`, summary };
}

/** 머리 줄(정규식, 1번 그룹=번호, 2번 그룹=제목)로 나눠 읽기 */
function splitByHeads(text: string, re: RegExp): OutlineHead[] {
  const heads = [...text.matchAll(re)];
  return heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
    return outlineItem(Number(m[1]), m[2] ?? "", text.slice(m.index! + m[0].length, end));
  });
}

const HEAD = String.raw`^[ \t]*(?:[-*•][ \t]*)?(?:#+[ \t]*)?(?:\*\*)?[\[【(]?[ \t]*`;
const TAIL = String.raw`[ \t]*[\]】)]?(?:\*\*)?[ \t]*[:：.\-–—)]?[ \t]*(.*)$`;
/** 머리 줄 형식: 우선순위 순서. 앞의 형식으로 하나도 못 찾을 때만 다음 형식을 쓴다 */
const OUTLINE_HEADS = [
  new RegExp(String.raw`${HEAD}(?:제[ \t]*)?(\d{1,3})[ \t]*화${TAIL}`, "gm"), // [1화] · 제 1화: · ## 1화 - 제목
  new RegExp(String.raw`${HEAD}(?:episode|ep\.?|chapter|ch\.?|part)[ \t]*(\d{1,3})${TAIL}`, "gim"), // Episode 1 · EP.1 · Chapter 1
  new RegExp(String.raw`${HEAD}(?:제[ \t]*)?(\d{1,3})[ \t]*(?:회|장|편|막)${TAIL}`, "gm"), // 1회 · 제1장
];

/** 표: | 1 | 제목 | 요약 | */
function parseTable(text: string): OutlineHead[] {
  const out: OutlineHead[] = [];
  for (const line of text.split("\n")) {
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const m = cells.length >= 3 && /^(?:제\s*)?(\d{1,3})\s*(?:화|회|장)?$/.exec(cells[0].replace(/\*\*/g, ""));
    if (m) out.push(outlineItem(Number(m[1]), cells[1], cells.slice(2).join(" ")));
  }
  return out;
}

/** JSON: [{ "title": …, "summary": … }] 또는 { "episodes": [...] } */
function parseJsonOutline(text: string): OutlineHead[] {
  const m = /[[{][\s\S]*[\]}]/.exec(text);
  if (!m) return [];
  try {
    let j: unknown = JSON.parse(m[0]);
    if (j && !Array.isArray(j) && typeof j === "object") j = Object.values(j).find(Array.isArray);
    if (!Array.isArray(j)) return [];
    return j.flatMap((x, i) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const num = Number(o.number ?? o.episode ?? o.no ?? i + 1) || i + 1;
      const title = String(o.title ?? o.제목 ?? "");
      const summary = String(o.summary ?? o.요약 ?? o.content ?? o.내용 ?? "");
      return title || summary ? [outlineItem(num, title, summary)] : [];
    });
  } catch {
    return [];
  }
}

/** 번호 목록: "1. 제목 — 요약" (1부터 차례로 이어지는 줄만) */
function parseNumbered(text: string): OutlineHead[] {
  const heads = splitByHeads(text, /^[ \t]*(?:\*\*)?(\d{1,3})[ \t]*[.)](?:\*\*)?[ \t]+(.*)$/gm);
  const seq = heads.filter((h, i) => h.number === i + 1);
  if (seq.length < 2 || seq.length !== heads.length) return [];
  return seq.map((h) => {
    if (h.summary) return h;
    const [t, ...rest] = h.title.split(/\s+[—–-]\s+|[:：]\s+/);
    return rest.length ? { ...h, title: t.trim(), summary: rest.join(" ").trim() } : h;
  });
}

/**
 * AI가 보낸 개요 읽기. 기본 형식은 "[1화] 제목\n요약…".
 * "제 1화:", "## 1화 - 제목", "Episode 1", "1회", 표, JSON, "1. 제목" 번호 목록도 읽는다.
 */
export function parseOutline(raw: string): OutlineHead[] {
  // 생각 블록·코드 울타리 제거
  const text = raw.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, "").replace(/^```[a-z]*\s*$/gim, "");
  for (const re of OUTLINE_HEADS) {
    const r = splitByHeads(text, re);
    if (r.length) return r;
  }
  for (const f of [parseTable, parseJsonOutline, parseNumbered]) {
    const r = f(text);
    if (r.length) return r;
  }
  return [];
}

/* ---------------- 회차 집필 ---------------- */
export function buildNovelSystem(s: Settings, ctx: StoryContext, imageRules: string[] = []): string {
  return P("novel.system", {
    시점: povText(s.style.pov),
    전개: pacingText(s.style.pacing),
    대사: dialogueText(s.style.dialogue),
    수위: ratingText(s.contentRating),
    설정: contextSections(ctx, "novel").join("\n").trim(),
    그림: imageRules.join("\n").trim(),
  });
}

export function buildEpisodeRequest(s: Settings, n: Novel, ctx: StoryContext, index: number, opts: { lore?: string; note?: string; imageRules?: string[]; instructions?: string } = {}): { system: string; messages: ChatMessage[] } {
  const o = n.outline[index];
  const len = episodeLength(n.episodeLength);
  const written = n.episodes.slice(0, index);
  const prevSummaries = written.map((e, i) => `[${i + 1}화] ${e.title}: ${e.summary || n.outline[i]?.summary || ""}`).join("\n");
  const tail = written.length ? written[written.length - 1].text.slice(-T("novel.tailChars") || Infinity) : "";
  const user = P("novel.episode.user", {
    작품정보: novelInfo(n),
    개요: n.outline.map((x, i) => `[${i + 1}화]${i === index ? P("novel.episode.current") : ""} ${x.title}: ${x.summary}`).join("\n"),
    지금까지: prevSummaries ? P("novel.episode.written", { 내용: prevSummaries }) : "",
    직전부분: tail ? P("novel.episode.tail", { 내용: tail }) : "",
    참고설정: opts.lore ? P("novel.episode.lore", { 내용: opts.lore }) : "",
    번호: index + 1,
    제목: o.title,
    회차개요: o.summary,
    설정지시: opts.instructions?.trim() ? P("novel.episode.instructions", { 내용: opts.instructions.trim() }) : "",
    추가요청: opts.note?.trim() ? P("novel.episode.note", { 내용: opts.note.trim() }) : "",
    글자수: len.chars.toLocaleString(),
    끝맺음: P(index === n.episodeCount - 1 ? "novel.episode.final" : "novel.episode.hook"),
    요약표시: SUMMARY_MARKER,
  });
  return { system: buildNovelSystem(s, ctx, opts.imageRules), messages: [{ role: "user", content: user }] };
}

/** 본문과 [회차 요약] 분리 */
export function splitEpisode(raw: string): { text: string; summary: string } {
  const i = raw.lastIndexOf(SUMMARY_MARKER);
  const strip = (t: string) => t.replace(/^\s*(?:#+\s*)?(?:제\s*)?\d+\s*화[^\n]{0,40}\n+/, "").trim(); // 모델이 회차 제목을 붙인 경우
  if (i === -1) return { text: strip(raw), summary: "" };
  return { text: strip(raw.slice(0, i)), summary: raw.slice(i + SUMMARY_MARKER.length).trim() };
}

/** 스트리밍 중 표시용: 요약 표시가 시작되면 숨김 */
export function previewEpisode(partial: string): string {
  const i = partial.indexOf("[회차");
  if (i !== -1) return partial.slice(0, i).trimEnd();
  const j = partial.lastIndexOf("[");
  if (j !== -1 && SUMMARY_MARKER.startsWith(partial.slice(j))) return partial.slice(0, j).trimEnd();
  return partial;
}

export const charCount = (t: string) => t.replace(/\s+/g, " ").length;
