import { afterEach, describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/lib/prompt";
import { changedPrompts, defaultPrompt, fill, P, PROMPT_DEFS, setPromptOverrides } from "../src/lib/prompts";
import { buildMemoryRequest } from "../src/lib/memory";
import { DEFAULT_SETTINGS, type Character, type Room } from "../src/lib/types";

const room: Room = { id: "r", title: "t", premise: "", memory: "", messages: [], createdAt: 0, updatedAt: 0, characterIds: [] };
const char = (o: Partial<Character> = {}): Character => ({ kind: "character", id: "c", name: "서율", summary: "", profile: "", speech: "", lore: [], createdAt: 0, updatedAt: 0, ...o });
afterEach(() => setPromptOverrides({}));

describe("프롬프트 모음", () => {
  test("id가 겹치지 않고, 적어 둔 자리(${이름})는 문구 안에 있다", () => {
    const ids = PROMPT_DEFS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROMPT_DEFS) for (const v of p.vars ?? []) expect(p.text, `${p.id}: ${v}`).toContain("${" + v + "}");
  });
  test("채우기: 값이 빈 자리만 있는 줄은 지우고 빈 줄은 하나로, 끼워 넣는 값은 그대로", () => {
    expect(fill("가\n\n${a}\n\n${b}\n\n나 ${c}", { a: "", b: "B\n\n\n\nB", c: 3 })).toBe("가\n\nB\n\n\n\nB\n\n나 3");
    expect(fill("${모름} ${a}", { a: "x" })).toBe("${모름} x"); // 모르는 이름은 그대로
  });
  test("사용자가 바꾼 문구가 실제 시스템 프롬프트에 쓰이고, 기본값으로 되돌리면 원래대로", () => {
    const s = { ...DEFAULT_SETTINGS, choices: false };
    expect(buildSystemPrompt(s, room, { characters: [char({ profile: "검을 쓴다" })] })).toContain("너는 사용자와 함께 이야기를 만들어 가는 소설가다");
    setPromptOverrides({ "chat.system": "역할: 작가\n${설정}\n수위=${수위}" });
    const out = buildSystemPrompt(s, room, { characters: [char({ profile: "검을 쓴다" })] });
    expect(out.startsWith("역할: 작가\n## 등장인물")).toBe(true);
    expect(out).toContain("검을 쓴다");
    expect(out).toContain("수위=콘텐츠 등급: 전체 이용가");
    setPromptOverrides({ "rating.general": "모두가 볼 수 있게" });
    expect(buildMemoryRequest(DEFAULT_SETTINGS, room, []).system).toContain("- 모두가 볼 수 있게 요약에서는");
    setPromptOverrides({});
    expect(P("rating.general")).toBe(defaultPrompt("rating.general"));
  });
  test("바꾼 것만 골라내기 (기본값과 같거나 모르는 id는 빼기)", () => {
    expect(changedPrompts({ "chat.start": "시작!", "chat.note": defaultPrompt("chat.note"), "없는.id": "x" })).toEqual({ "chat.start": "시작!" });
  });
});
