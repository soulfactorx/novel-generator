import type { Character, ContentRating, Persona, Room, Settings, StyleOptions, World } from "./types";
import { CHOICE_MARKER } from "./choices";

/** 수위별 지침. 성인 단계도 각 AI 제공업체의 이용 정책 범위 안에서만 동작합니다. */
export const RATING_POLICY: Record<ContentRating, string> = {
  general:
    "콘텐츠 등급: 전체 이용가. 노골적인 성적 묘사, 잔혹한 폭력 묘사, 혐오 표현을 쓰지 않는다. 갈등과 긴장은 감정과 상황으로 표현한다.",
  mature:
    "콘텐츠 등급: 성숙(15세 이상). 연애, 갈등, 어두운 주제를 다룰 수 있다. 신체적 친밀감은 암시와 장면 전환으로 처리하고 노골적 묘사는 하지 않는다. 폭력은 결과 중심으로 절제해 묘사한다.",
  adult:
    "콘텐츠 등급: 성인. 사용자는 성인임을 확인했다. 등장인물은 모두 성인이며 합의된 관계만 다룬다. 장면의 맥락과 관계 진전에 맞게 표현 수위를 조절하고, 이야기 전개를 우선한다. 미성년자, 비동의 성적 묘사, 실존 인물은 어떤 경우에도 다루지 않는다.",
};

export const POV: Record<StyleOptions["pov"], string> = {
  "third-limited": "3인칭 제한 시점. 주인공의 내면만 직접 서술하고 다른 인물은 말과 행동으로 드러낸다.",
  first: "1인칭 주인공 시점. '나'는 주인공뿐이며 다른 인물의 속마음은 추측으로만 표현한다.",
  "third-omniscient": "3인칭 전지적 시점. 여러 인물의 내면을 오갈 수 있으나 전환은 문단으로 분명히 구분한다.",
};
const LENGTH: Record<StyleOptions["length"], [string, number]> = {
  short: ["한 번에 400~700자 정도로 짧게 쓴다.", 1500],
  medium: ["한 번에 1,000~1,600자 정도로 쓴다.", 3500],
  long: ["한 번에 2,500~3,500자 정도로 충분히 길게 쓴다.", 7000],
};
export const PACING: Record<StyleOptions["pacing"], string> = {
  fast: "사건 중심으로 빠르게 전개한다.",
  balanced: "행동, 대사, 내면 묘사를 고르게 섞는다.",
  slow: "감각과 분위기, 작은 표정 변화까지 천천히 묘사한다.",
};
export const DIALOGUE: Record<StyleOptions["dialogue"], string> = {
  balanced: "대사와 서술의 비중을 비슷하게 맞춘다.",
  more: "인물 간 대화를 중심으로 주고받는 흐름을 살린다.",
  less: "서술과 묘사를 중심으로 하고 대사는 꼭 필요한 만큼만 쓴다.",
};

/** 출력 토큰 상한 (분량 기준, 한국어 여유 포함) */
export const outputTokensFor = (s: Settings) => LENGTH[s.style.length][1];

/** 이야기방에 연결된 라이브러리 항목 */
export interface StoryContext {
  world?: World;
  characters: Character[];
  persona?: Persona;
}

export function buildSystemPrompt(s: Settings, room: Room, ctx: StoryContext = { characters: [] }, imageRules: string[] = []): string {
  const parts = [
    "너는 사용자와 함께 이야기를 만들어 가는 소설가다. 사용자의 입력은 주인공의 행동·대사이거나 이야기 전개에 대한 요청이다.",
    "",
    "## 작성 원칙",
    "- 한국어로, 읽기 좋은 웹소설 문체로 쓴다. 문단은 장면·행동이 바뀔 때 나누고 대사는 큰따옴표로 감싼다.",
    "- 사용자가 직접 정한 주인공의 행동이나 대사를 임의로 대신 정하지 않는다. 다른 인물의 반응과 상황 변화를 중심으로 이어 쓴다.",
    "- 앞서 쓴 문장이나 표현을 반복하지 않고, 매번 이야기를 한 걸음 진전시킨다.",
    "- 설정과 이전 사건을 일관되게 유지한다. 해설·요약·메타 발언 없이 본문만 쓴다.",
    `- 시점: ${POV[s.style.pov]}`,
    `- 분량: ${LENGTH[s.style.length][0]}`,
    `- 전개: ${PACING[s.style.pacing]}`,
    `- 대사: ${DIALOGUE[s.style.dialogue]}`,
    `- ${RATING_POLICY[s.contentRating]}`,
  ];
  // 봇이 자기 선택지를 직접 만들면(Lua로 선택지 버튼 등) 이 앱의 선택지 형식을 요구하지 않는다 — 봇의 출력 형식과 부딪힘
  if (s.choices && !(s.risu.lua && botHandlesChoices(ctx))) {
    parts.push(
      "",
      "## 선택지",
      `본문을 마친 뒤 빈 줄을 두고 "${CHOICE_MARKER}" 한 줄을 쓴 다음, 주인공이 할 수 있는 서로 다른 다음 행동 4가지를 "1. "부터 번호를 붙여 한 줄씩 짧게 제시한다.`,
    );
  }
  parts.push(...contextSections(ctx, "chat"), ...imageRules);
  if (room.premise.trim()) parts.push("", ctx.world || ctx.characters.length ? "## 이 이야기의 추가 설정" : "## 이야기 설정", room.premise.trim());
  if (room.memory.trim()) parts.push("", "## 지금까지의 줄거리 요약 (참고용, 문장을 그대로 반복하지 말 것)", room.memory.trim());
  return parts.join("\n");
}

/** 세계관 · 주인공 · 등장인물 섹션 (대화형/소설 공용) */
export function contextSections(ctx: StoryContext, mode: "chat" | "novel"): string[] {
  const parts: string[] = [];
  const w = ctx.world;
  if (w) {
    parts.push("", `## 세계관: ${w.name}`);
    if (w.description.trim()) parts.push(w.description.trim());
    if (w.rules.trim()) parts.push("", "### 이 세계의 규칙", w.rules.trim());
  }
  if (ctx.persona) {
    parts.push("", mode === "chat" ? `## 주인공 (사용자가 연기하는 인물): ${ctx.persona.name}` : `## 주인공: ${ctx.persona.name}`);
    if (ctx.persona.profile.trim()) parts.push(ctx.persona.profile.trim());
    if (mode === "chat") parts.push("주인공의 행동·대사·속마음은 사용자가 정한다. 사용자가 쓰지 않은 주인공의 대사를 지어내지 않는다.");
  }
  if (ctx.characters.length) {
    parts.push("", "## 등장인물");
    for (const c of ctx.characters) {
      parts.push("", `### ${c.name}${c.summary.trim() ? ` — ${c.summary.trim()}` : ""}`);
      if (c.profile.trim()) parts.push(c.profile.trim());
      if (c.speech.trim()) parts.push("말투 예시:", c.speech.trim());
    }
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
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}

/** 봇의 Lua가 선택지를 직접 다루는지 (예: 응답 끝 선택지 줄을 읽어 버튼으로 그림) */
export function botHandlesChoices(ctx: StoryContext): boolean {
  const lua = (t: unknown) => ((t as { effect?: { type?: string; code?: string }[] })?.effect ?? []).filter((e) => e?.type === "triggerlua" && typeof e.code === "string").map((e) => e.code!);
  return [...ctx.characters, ...(ctx.world ? [ctx.world] : [])].some((o) => (o.risu?.triggers ?? []).flatMap(lua).some((c) => /\bchoices?\b|선택지/i.test(c)));
}
