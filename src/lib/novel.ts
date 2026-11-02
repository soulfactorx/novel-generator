import { contextSections, DIALOGUE, PACING, POV, RATING_POLICY, type StoryContext } from "./prompt";
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
  return [`제목: ${n.title || "(미정)"}`, n.genre.trim() && `장르: ${n.genre.trim()}`, n.brief.trim() && `기획:\n${n.brief.trim()}`].filter(Boolean).join("\n");
}

/* ---------------- 개요 ---------------- */
export function buildOutlineRequest(s: Settings, n: Novel, ctx: StoryContext, from: number): { system: string; messages: ChatMessage[] } {
  const count = n.episodeCount - from;
  const system = [
    "너는 웹소설 기획 편집자다. 작가가 회차별로 집필할 수 있도록 연재 개요를 짠다.",
    "",
    "## 원칙",
    "- 회차마다 분명한 사건과 변화가 있고, 회차 끝은 다음 화가 궁금해지는 고리로 맺는다.",
    "- 전체가 도입 → 전개 → 위기 → 절정 → 결말의 흐름을 갖도록 배분한다. 목표 회차 수 안에서 이야기를 마무리한다.",
    "- 설정과 인물의 성격·관계를 일관되게 지킨다.",
    `- ${RATING_POLICY[s.contentRating]}`,
    "",
    "## 출력 형식 (이 형식만 출력, 머리말·설명 금지)",
    "[1화] 회차 제목",
    "이 회차의 핵심 사건, 갈등, 끝맺음을 2~4문장으로.",
    "",
    "[2화] 회차 제목",
    "…",
    ...contextSections(ctx, "novel"),
  ].join("\n");
  const prev = n.outline.slice(0, from);
  const user = [
    `## 작품 정보\n${novelInfo(n)}`,
    prev.length ? `## 이미 정해진 회차 (그대로 유지)\n${formatOutline(prev)}` : "",
    from > 0 && n.episodes[from - 1]?.summary ? `## 직전 회차에서 실제로 쓴 내용\n${n.episodes[from - 1].summary}` : "",
    `${from + 1}화부터 ${n.episodeCount}화까지 ${count}개 회차의 개요를 위 형식으로 작성하라.`,
  ]
    .filter(Boolean)
    .join("\n\n");
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
  return [
    "너는 한국어 웹소설 작가다. 주어진 개요에 따라 연재 소설의 한 회차를 완성된 원고로 쓴다.",
    "",
    "## 작성 원칙",
    "- 읽기 좋은 웹소설 문체. 장면·행동이 바뀔 때 문단을 나누고 대사는 큰따옴표로 감싼다.",
    "- 개요의 사건을 빠짐없이 다루되, 요약하듯 넘기지 말고 장면으로 보여 준다.",
    "- 앞 회차와 자연스럽게 이어지게 쓰고, 이미 쓴 문장·표현을 반복하지 않는다.",
    "- 회차 제목, 작가의 말, 해설 없이 본문만 쓴다.",
    `- 시점: ${POV[s.style.pov]}`,
    `- 전개: ${PACING[s.style.pacing]}`,
    `- 대사: ${DIALOGUE[s.style.dialogue]}`,
    `- ${RATING_POLICY[s.contentRating]}`,
    ...contextSections(ctx, "novel"),
    ...imageRules,
  ].join("\n");
}

export function buildEpisodeRequest(s: Settings, n: Novel, ctx: StoryContext, index: number, opts: { lore?: string; note?: string; imageRules?: string[]; instructions?: string } = {}): { system: string; messages: ChatMessage[] } {
  const o = n.outline[index];
  const len = EPISODE_LENGTH[n.episodeLength];
  const written = n.episodes.slice(0, index);
  const prevSummaries = written.map((e, i) => `[${i + 1}화] ${e.title}: ${e.summary || n.outline[i]?.summary || ""}`).join("\n");
  const tail = written.length ? written[written.length - 1].text.slice(-TAIL_CHARS) : "";
  const user = [
    `## 작품 정보\n${novelInfo(n)}`,
    `## 전체 개요\n${n.outline.map((x, i) => `[${i + 1}화]${i === index ? " ◀ 이번 회차" : ""} ${x.title}: ${x.summary}`).join("\n")}`,
    prevSummaries && `## 지금까지 쓴 내용\n${prevSummaries}`,
    tail && `## 직전 회차의 마지막 부분 (여기서 자연스럽게 이어 쓸 것)\n…${tail}`,
    opts.lore && `## 참고 설정 (이번 회차와 관련된 자료, 필요한 만큼만 반영)\n${opts.lore}`,
    `## 이번에 쓸 회차: ${index + 1}화 「${o.title}」\n${o.summary}`,
    opts.instructions?.trim() && `## 설정에 정해진 지시 (반드시 따를 것)\n${opts.instructions.trim()}`,
    opts.note?.trim() && `## 작가의 추가 요청\n${opts.note.trim()}`,
    [
      "## 지시",
      `- 공백 포함 약 ${len.chars.toLocaleString()}자 분량의 본문을 쓴다.`,
      index === n.episodeCount - 1 ? "- 마지막 회차다. 이야기를 완결한다." : "- 회차 끝은 다음 화가 궁금해지도록 맺는다.",
      `- 본문을 마친 뒤 빈 줄을 두고 "${SUMMARY_MARKER}" 한 줄을 쓴 다음, 이번 회차에서 실제로 일어난 일을 3~5문장으로 요약한다. (다음 회차 집필용)`,
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
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
