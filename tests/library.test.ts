import { describe, expect, test } from "vitest";
import { formatLore, matchLore, parseKeys } from "../src/lib/lore";
import { buildMemoryRequest, cleanMemory, MEMORY_BATCH, pendingForMemory } from "../src/lib/memory";
import { buildSystemPrompt } from "../src/lib/prompt";
import { parseLegacyBackup } from "../src/lib/importLegacy";
import { DEFAULT_SETTINGS, type Character, type LoreEntry, type Message, type Room, type World } from "../src/lib/types";

const room = (over: Partial<Room> = {}): Room => ({ id: "r", title: "t", premise: "", memory: "", messages: [], createdAt: 0, updatedAt: 0, characterIds: [], ...over });
const lore = (o: Partial<LoreEntry>): LoreEntry => ({ id: Math.random().toString(), title: "", keys: [], content: "내용", enabled: true, ...o });
const msgs = (n: number): Message[] => Array.from({ length: n }, (_, i) => ({ id: "m" + i, role: i % 2 ? "assistant" : "user", text: "t" + i, createdAt: i + 1 }));

describe("lorebook", () => {
  test("parseKeys", () => expect(parseKeys(" 등불, 마력등 / 가로등,등불 ")).toEqual(["등불", "마력등", "가로등"]));
  test("keyword match (case-insensitive), always first, disabled skipped, budget", () => {
    const g = [{ source: "레인포트", entries: [lore({ title: "조합", keys: ["Guild", "조합"] }), lore({ title: "등불", keys: ["등불"] }), lore({ title: "규칙", always: true }), lore({ title: "꺼짐", keys: ["조합"], enabled: false })] }];
    const hits = matchLore(g, "그는 guild 건물로 향했다");
    expect(hits.map((h) => h.entry.title)).toEqual(["규칙", "조합"]);
    expect(hits[1].matched).toBe("Guild");
    expect(formatLore(hits)).toContain("- 조합 (레인포트): 내용");
    const big = [{ source: "", entries: [lore({ title: "a", keys: ["x"], content: "가".repeat(3000) }), lore({ title: "b", keys: ["x"], content: "나".repeat(3000) })] }];
    expect(matchLore(big, "x").map((h) => h.entry.title)).toEqual(["a"]);
  });
});

describe("prompt with library", () => {
  test("world, persona, characters, premise sections", () => {
    const w: World = { kind: "world", id: "w", name: "레인포트", description: "비 오는 항구", rules: "마법엔 대가", lore: [], createdAt: 0, updatedAt: 0 };
    const c: Character = { kind: "character", id: "c", name: "서율", summary: "29세 · 감찰관", profile: "차갑다", speech: '"규정입니다."', lore: [], createdAt: 0, updatedAt: 0 };
    const p = buildSystemPrompt(DEFAULT_SETTINGS, room({ premise: "첫 출근" }), { world: w, characters: [c], persona: { kind: "persona", id: "p", name: "도윤", profile: "신입", createdAt: 0, updatedAt: 0 } });
    for (const x of ["## 세계관: 레인포트", "비 오는 항구", "마법엔 대가", "## 주인공 (사용자가 연기하는 인물): 도윤", "### 서율 — 29세 · 감찰관", '"규정입니다."', "## 이 이야기의 추가 설정\n첫 출근"]) expect(p).toContain(x);
  });
});

describe("memory", () => {
  test("auto waits for a batch outside the context window; cursor respected", () => {
    const r = room({ messages: msgs(40 + MEMORY_BATCH - 1) });
    expect(pendingForMemory(r, 40, "auto")).toHaveLength(0);
    const r2 = room({ messages: msgs(40 + MEMORY_BATCH) });
    expect(pendingForMemory(r2, 40, "auto").map((m) => m.id)).toEqual(msgs(MEMORY_BATCH).map((m) => m.id));
    expect(pendingForMemory({ ...r2, memoryCursorAt: 5 }, 40, "auto")).toHaveLength(0);
    expect(pendingForMemory({ ...r2, memoryCursorAt: 5 }, 40, "manual")).toHaveLength(40 + MEMORY_BATCH - 6 - 5);
  });
  test("request includes old summary, labelled log, rating; cleanup", () => {
    const r = room({ memory: "기존 요약" });
    const q = buildMemoryRequest(DEFAULT_SETTINGS, r, msgs(2), { user: "도윤" });
    expect(q.system).toContain("전체 이용가");
    expect(q.messages[0].content).toContain("기존 요약");
    expect(q.messages[0].content).toContain("[도윤(사용자)] t0");
    expect(q.messages[0].content).toContain("[이야기] t1");
    expect(cleanMemory("```\n갱신된 요약:\n- 사건\n```")).toBe("- 사건");
  });
});

describe("E.No.S import → library", () => {
  test("worlds, embedded + top-level characters, personas, lore, rule; rooms linked", () => {
    const r = parseLegacyBackup({
      worlds: [{ id: "w1", name: "레인포트", description: "항구", characterIds: ["c1"], aiRules: [{ content: "존댓말", enabled: true }, { content: "끔", enabled: false }], lorebook: [{ title: "등불", keywords: "등불, 마력등", content: "마력으로 켜는 가로등", enabled: true }], characters: [{ id: "c2", name: "하람", job: "선장" }], user: { id: "u1", name: "도윤", description: "신입" } }],
      characters: [{ id: "c1", name: "서율", age: "29", job: "감찰관", personality_tags: ["냉정", "성실"], appearance_desc: "흑발", sample_dialogue: '"규정입니다."', image: "data:image/png;base64,xxx", entries: [{ title: "과거", keywords: "과거", content: "전직 기사" }] }],
      userPersonas: [{ id: "u2", name: "민서" }],
      sessions: [{ title: "첫 이야기", worldId: "w1", activeUserId: "u1", memory: "요약", history: [{ role: "user", text: "a" }, { role: "model", text: "b" }] }],
    });
    const by = (n: string) => r.library.find((e) => e.name === n)!;
    const w = by("레인포트") as World, c = by("서율") as Character;
    expect(w.rules).toBe("- 존댓말");
    expect(w.lore[0]).toMatchObject({ title: "등불", keys: ["등불", "마력등"], content: "마력으로 켜는 가로등" });
    expect(c).toMatchObject({ summary: "29세 · 감찰관", speech: '"규정입니다."', worldId: w.id });
    expect(c.profile).toContain("성격: 냉정, 성실");
    expect(c.profile).toContain("외모: 흑발");
    expect(c.profile).not.toContain("data:");
    expect(c.lore[0].title).toBe("과거");
    expect((by("하람") as Character).worldId).toBe(w.id);
    expect(r.library.filter((e) => e.kind === "persona").map((e) => e.name).sort()).toEqual(["도윤", "민서"]);
    const room0 = r.rooms[0];
    expect(room0).toMatchObject({ worldId: w.id, characterIds: [c.id], personaId: by("도윤").id, premise: "" });
    expect(room0.memoryCursorAt).toBeDefined();
  });
});

describe("로어북 RisuAI 규칙", () => {
  const L = (o: Partial<LoreEntry>): LoreEntry => ({ id: Math.random().toString(), title: "t", keys: [], content: "내용", enabled: true, ...o });
  const titles = (h: ReturnType<typeof matchLore>) => h.map((x) => x.entry.title).sort();
  test("공백 무시·대소문자 무시, 보조 키는 둘 다 나와야", () => {
    const g = [{ source: "", entries: [L({ title: "a", keys: ["은빛 항구"] }), L({ title: "b", keys: ["항구"], secondKeys: ["조합"] }), L({ title: "c", keys: ["항구"], secondKeys: ["없음"] })] }];
    expect(titles(matchLore(g, "은빛항구의 조합 사무실"))).toEqual(["a", "b"]);
  });
  test("정규식 키 /…/플래그", () => {
    const g = [{ source: "", entries: [L({ title: "r", keys: ["/(검|칼)을 뽑/"], regex: true }), L({ title: "bad", keys: ["/[/"], regex: true })] }];
    expect(titles(matchLore(g, "그가 칼을 뽑았다"))).toEqual(["r"]);
  });
  test("데코레이터: activate_only_after · activate_only_every · exclude_keys · additional_keys · activate · dont_activate · probability", () => {
    const g = [{ source: "", entries: [
      L({ title: "after", keys: ["x"], decorators: "@@activate_only_after 5" }),
      L({ title: "every", keys: ["x"], decorators: "@@activate_only_every 2" }),
      L({ title: "excl", keys: ["x"], decorators: "@@exclude_keys 금지" }),
      L({ title: "add", keys: ["x"], decorators: "@@additional_keys 추가" }),
      L({ title: "force", keys: ["없는키"], decorators: "@@activate" }),
      L({ title: "never", keys: ["x"], decorators: "@@dont_activate" }),
      L({ title: "lucky", keys: ["x"], decorators: "@@probability 30" }),
    ] }];
    expect(titles(matchLore(g, "x 금지", 4000, { chatLength: 4, random: () => 0.9 }))).toEqual(["every", "force"]);
    expect(titles(matchLore(g, "x 추가", 4000, { chatLength: 5, random: () => 0.1 }))).toEqual(["add", "after", "excl", "force", "lucky"]);
  });
  test("재귀 검색: 활성화된 로어 내용으로 다른 로어가 켜짐, @@unrecursive · @@no_recursive_search", () => {
    const g = [{ source: "", entries: [
      L({ title: "a", keys: ["왕"], content: "왕의 검은 '서리'다" }),
      L({ title: "b", keys: ["서리"], content: "서리는 마검" }),
      L({ title: "c", keys: ["마검"], content: "마검 설명", decorators: "@@no_recursive_search" }),
    ] }];
    expect(titles(matchLore(g, "왕이 말했다"))).toEqual(["a", "b"]);
    expect(titles(matchLore(g, "왕이 말했다", 4000, { recursive: false }))).toEqual(["a"]);
  });
  test("우선순위(order·@@priority) 높은 것이 예산 안에 먼저, 검색 깊이(@@scan_depth)", () => {
    const g = [{ source: "", entries: [L({ title: "low", keys: ["x"], content: "가".repeat(3000), order: 1 }), L({ title: "high", keys: ["x"], content: "나".repeat(3000), order: 9 })] }];
    expect(matchLore(g, "x").map((h) => h.entry.title)).toEqual(["high"]);
    const d = [{ source: "", entries: [L({ title: "deep", keys: ["옛날"], decorators: "@@scan_depth 1" }), L({ title: "wide", keys: ["옛날"] })] }];
    expect(titles(matchLore(d, "", 4000, { messages: ["옛날 이야기", "지금"] }))).toEqual(["wide"]);
  });
});
