import { contextSections, dialogueText, pacingText, povText, ratingText, type StoryContext } from "./prompt";
import { P } from "./prompts";
import type { ChatMessage } from "./providers";
import type { EpisodeLength, Novel, OutlineItem, Settings } from "./types";

/** 회차 분량: [목표 글자 수, 출력 토큰 상한] */
export const EPISODE_LENGTH: Record<EpisodeLength, { label: string; chars: number; tokens: number }> = {
  short: { label: "짧게 (약 3,000자)", chars: 3000, tokens: 6000 },
  medium: { label: "보통 (약 5,000자)", chars: 5000, tokens: 9000 },
  long: { label: "길게 (약 8,000자)", chars: 8000, tokens: 14000 },
};
export const SUMMARY_MARKER = "[회차 요약]";
const TAIL_CHARS = 1500;

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

/** "[1화] 제목\n요약…" 형식 파싱. "제 1화:", "## 1화 - 제목", "1화. 제목" 등 변형도 허용 */
export function parseOutline(text: string): { number: number; title: string; summary: string }[] {
  const re = /^[ \t]*(?:#+[ \t]*)?(?:\*\*)?\[?[ \t]*(?:제[ \t]*)?(\d{1,3})[ \t]*화[ \t]*\]?(?:\*\*)?[ \t]*[:.\-–—)]?[ \t]*(.*)$/gm;
  const heads = [...text.matchAll(re)];
  return heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
    const body = text.slice(m.index! + m[0].length, end).replace(/^\s*(?:요약|내용)\s*[:：]\s*/m, "").replace(/\*\*/g, "").trim();
    let title = m[2].replace(/\*\*/g, "").replace(/^["'「『]|["'」』]$/g, "").trim();
    let summary = body;
    if (!title && body) [title, summary] = [body.split("\n")[0].trim(), body.split("\n").slice(1).join("\n").trim()];
    return { number: Number(m[1]), title: title || `${m[1]}화`, summary };
  });
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
  const len = EPISODE_LENGTH[n.episodeLength];
  const written = n.episodes.slice(0, index);
  const prevSummaries = written.map((e, i) => `[${i + 1}화] ${e.title}: ${e.summary || n.outline[i]?.summary || ""}`).join("\n");
  const tail = written.length ? written[written.length - 1].text.slice(-TAIL_CHARS) : "";
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
