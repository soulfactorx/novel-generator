import { contextSections, RATING_POLICY, type StoryContext } from "./prompt";
import type { ChatMessage } from "./providers";
import type { Novel, Room, Settings } from "./types";

export const DIRECTIVE_MARKER = "[다음 지시]";
const RECENT = 16;

const rules = (s: Settings) => [
  "## 출력 형식",
  "아래 제목을 그대로 쓰고, 각 항목은 '- '로 시작하는 짧은 줄로 쓴다. 문제가 없으면 '- 특별한 문제 없음'이라고 쓴다.",
  "### 한 줄 평",
  "### 설정·인물 일관성",
  "(인물이 프로필·말투·관계와 다르게 행동하는 부분(캐릭터 붕괴), 설정·이전 사건과 어긋나는 부분을 근거 문장과 함께)",
  "### 반복·문체",
  "(반복되는 표현·문장 구조·전개 패턴, 어색한 문장)",
  "### 전개",
  "(정체되거나 급한 부분, 놓친 복선·약속)",
  "### 제안",
  "(다음에 시도할 구체적인 방향 2~4개)",
  "",
  `마지막에 빈 줄을 두고 "${DIRECTIVE_MARKER}" 한 줄을 쓴 다음, 위 진단을 반영해 작가(AI)에게 줄 지시를 2~4문장으로 쓴다. 이 지시는 다음 원고를 쓸 때 그대로 전달된다.`,
  "",
  `- ${RATING_POLICY[s.contentRating]} 진단 중에 장면을 인용할 때도 이 기준을 지킨다.`,
];

export function buildRoomDiagnosis(s: Settings, room: Room, ctx: StoryContext): { system: string; messages: ChatMessage[] } {
  const recent = room.messages.filter((m) => !m.error && m.text.trim()).slice(-RECENT);
  const log = recent.map((m) => (m.role === "user" ? `[사용자] ${m.text}` : `[AI] ${m.text}`)).join("\n\n");
  const system = [
    "너는 연재 소설의 편집자다. 사용자와 AI가 함께 쓰는 이야기의 최근 진행을 검토하고, AI 쪽 원고의 문제를 진단한다. 사용자의 입력은 평가하지 않는다.",
    "",
    ...rules(s),
    ...contextSections(ctx, "chat"),
    room.premise.trim() ? `\n## 이 이야기의 추가 설정\n${room.premise.trim()}` : "",
    room.memory.trim() ? `\n## 지금까지의 줄거리 요약\n${room.memory.trim()}` : "",
  ].join("\n");
  return { system, messages: [{ role: "user", content: `## 검토할 최근 진행 (오래된 순)\n\n${log || "(아직 내용 없음)"}\n\n위 진행을 진단하라.` }] };
}

export function buildEpisodeDiagnosis(s: Settings, n: Novel, ctx: StoryContext, index: number): { system: string; messages: ChatMessage[] } {
  const e = n.episodes[index];
  const system = [
    "너는 연재 소설의 편집자다. 작가가 쓴 한 회차 원고를 개요·설정·앞 회차와 비교해 진단한다.",
    "",
    ...rules(s),
    "또한 '전개' 항목에서 이번 회차 개요의 사건을 빠뜨리지 않았는지 확인한다.",
    ...contextSections(ctx, "novel"),
  ].join("\n");
  const prev = n.episodes.slice(0, index).map((x, i) => `[${i + 1}화] ${x.title}: ${x.summary || n.outline[i]?.summary || ""}`).join("\n");
  const user = [
    n.brief.trim() && `## 기획\n${n.brief.trim()}`,
    prev && `## 앞 회차 요약\n${prev}`,
    `## 이번 회차 개요: ${index + 1}화 「${n.outline[index]?.title ?? e.title}」\n${n.outline[index]?.summary ?? ""}`,
    `## 검토할 원고\n${e.text}`,
    "위 원고를 진단하라.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, messages: [{ role: "user", content: user }] };
}

export function splitDiagnosis(raw: string): { report: string; directive: string } {
  const i = raw.lastIndexOf(DIRECTIVE_MARKER);
  if (i === -1) return { report: raw.trim(), directive: "" };
  return { report: raw.slice(0, i).trim(), directive: raw.slice(i + DIRECTIVE_MARKER.length).trim() };
}
