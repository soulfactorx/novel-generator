import { describe, expect, test } from "vitest";
import { readSSE } from "../src/lib/sse";
import { previewText, splitChoices } from "../src/lib/choices";
import { buildHistory, buildSystemPrompt, ratingText } from "../src/lib/prompt";
import { DEFAULT_SETTINGS, normalizeSettings, type Room } from "../src/lib/types";
import { parseLegacyBackup } from "../src/lib/importLegacy";
import { apiRoot } from "../src/lib/providers/openai";
import { backupLibrary, isOwnBackup, makeBackup } from "../src/lib/backup";

const room = (over: Partial<Room> = {}): Room => ({ id: "r", title: "t", premise: "", memory: "", messages: [], createdAt: 0, updatedAt: 0, characterIds: [], ...over });

describe("SSE", () => {
  test("CRLF split across chunks + multibyte split", async () => {
    const bytes = new TextEncoder().encode('event: a\r\ndata: {"t":"안녕"}\r\n\r\ndata: x\ndata: y\n\n: comment\ndata: tail');
    const chunks: Uint8Array[] = [];
    for (let i = 0, k = 1; i < bytes.length; i += k, k = (k % 5) + 1) chunks.push(bytes.slice(i, i + k));
    const body = new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
    const got: [string, string][] = [];
    await readSSE(body, (e, d) => got.push([e, d]));
    expect(got).toEqual([["a", '{"t":"안녕"}'], ["", "x\ny"], ["", "tail"]]);
  });
});

describe("choices", () => {
  test("split + numbering variants", () => {
    const r = splitChoices("본문 첫 문단.\n\n둘째 문단.\n\n[선택지]\n1. 다가간다\n2) 물러선다\n- 묻는다\n• 웃는다");
    expect(r.text).toBe("본문 첫 문단.\n\n둘째 문단.");
    expect(r.choices).toEqual(["다가간다", "물러선다", "묻는다", "웃는다"]);
    expect(splitChoices("선택지 없음").choices).toEqual([]);
    // 봇이 응답 맨 끝에 쓰라고 한 상태창이 선택지 뒤에 와도 선택지로 먹지 않고 본문으로
    const status = "[체력:100% |시간:10:35 AM|날짜:04-08]";
    const r2 = splitChoices(`본문.\n\n[선택지]\n1. 인사한다\n\n2. 떠난다\n\n${status}`);
    expect(r2.choices).toEqual(["인사한다", "떠난다"]);
    expect(r2.text).toBe(`본문.\n\n${status}`);
    expect(previewText(`본문.\n\n[선택지]\n1. 인사한다\n\n${status}`)).toBe(`본문.\n\n${status}`);
    expect(previewText("본문입니다\n\n[선택지]\n1. a")).toBe("본문입니다");
    expect(previewText("본문입니다\n\n[선택")).toBe("본문입니다");
  });
});

describe("settings & content rating", () => {
  test("defaults are conservative; adult requires confirmation", () => {
    expect(DEFAULT_SETTINGS.contentRating).toBe("general");
    expect(normalizeSettings({ contentRating: "adult" }).contentRating).toBe("mature");
    expect(normalizeSettings({ contentRating: "adult", adultConfirmed: true }).contentRating).toBe("adult");
    expect(normalizeSettings({ temperature: 9, contextMessages: 1 })).toMatchObject({ temperature: 1, contextMessages: 4 });
    expect(normalizeSettings({ keys: { gemini: "g" } }).keys).toEqual({ gemini: "g", anthropic: "", openai: "" });
  });
  test("system prompt includes rating policy, style, premise, memory, choices", () => {
    const p = buildSystemPrompt({ ...DEFAULT_SETTINGS }, room({ premise: "항구 도시", memory: "첫 만남" }));
    expect(p).toContain(ratingText("general"));
    expect(p).toContain("항구 도시");
    expect(p).toContain("첫 만남");
    expect(p).toContain("[선택지]");
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, choices: false }, room())).not.toContain("[선택지]");
    expect(buildSystemPrompt(normalizeSettings({ contentRating: "adult", adultConfirmed: true }), room())).toContain("미성년자");
  });
  test("history: limit, skips errors, starts with user (대화 첫 AI 응답은 시작 요청을 붙여 유지)", () => {
    const msgs = [
      { id: "1", role: "assistant" as const, text: "인트로", createdAt: 0 },
      { id: "2", role: "user" as const, text: "a", createdAt: 0 },
      { id: "3", role: "assistant" as const, text: "", error: "x", createdAt: 0 },
      { id: "4", role: "assistant" as const, text: "b", choices: ["c1"], createdAt: 0 },
    ];
    const h = buildHistory(room({ messages: msgs }), 10);
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(h[0].content).toBe("이야기를 시작해 주세요.");
    expect(h[1].content).toBe("인트로");
    expect(h[3].content).toContain("[선택지]\n1. c1");
    expect(buildHistory(room({ messages: msgs }), 2).map((m) => m.role)).toEqual(["user", "assistant"]); // 잘린 앞부분은 장기 기억이 맡음
  });
  test("한도를 넘으면 한꺼번에 덜어내 몇 턴 동안 앞부분이 그대로 (프롬프트 캐시)", () => {
    const conv = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `m${i}`, createdAt: i }));
    const first = (n: number) => buildHistory(room({ messages: conv(n) }), 40)[0].content;
    expect(buildHistory(room({ messages: conv(40) }), 40)).toHaveLength(40);
    // 41~50개: 10개를 덜어내 m10부터, 그 사이 앞부분은 같다
    for (let n = 41; n <= 50; n++) expect(first(n)).toBe("m10");
    expect(buildHistory(room({ messages: conv(50) }), 40)).toHaveLength(40);
    expect(buildHistory(room({ messages: conv(41) }), 40)).toHaveLength(31);
    expect(first(51)).toBe("m20");
    // 덜어낸 자리가 AI 응답이면 다음 사용자 입력부터
    const odd = [{ id: "x", role: "assistant" as const, text: "인사", createdAt: 0 }, ...conv(45).map((m) => ({ ...m, createdAt: m.createdAt + 1 }))];
    expect(buildHistory(room({ messages: odd }), 40)[0].content).toBe("m10");
    // 한도의 절반까지만 덜어낸다
    expect(buildHistory(room({ messages: conv(11) }), 10).length).toBeGreaterThanOrEqual(5);
  });
});

describe("E.No.S backup import", () => {
  test("sessions → rooms linked to imported world/characters, keys only if plaintext", () => {
    const r = parseLegacyBackup({
      worlds: [{ id: "w", name: "항구", description: "비 오는 도시", characterIds: ["c"] }],
      characters: [{ id: "c", name: "서율", job: "상무", personality_tags: "차가움" }],
      sessions: [{ id: "s", title: "첫 이야기", worldId: "w", memory: "요약", updatedAt: 5, history: [{ role: "director", text: "안내" }, { role: "user", text: "안녕" }, { role: "model", text: "본문", choices: ["a", "b"] }] }],
      settings: { apiKey: "g-key", anthropicApiKey: "enc_v1:xxx", customBaseUrl: "https://x/v1" },
    });
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(r.rooms[0].messages[1].choices).toEqual(["a", "b"]);
    const w = r.library.find((e) => e.kind === "world")!;
    const ch = r.library.find((e) => e.kind === "character")!;
    expect(r.rooms[0]).toMatchObject({ worldId: w.id, characterIds: [ch.id] });
    expect(ch).toMatchObject({ name: "서율", summary: "상무" });
    expect(r.rooms[0].memory).toBe("요약");
    expect(r.settingsPatch.keys).toEqual({ gemini: "g-key" });
    expect(() => parseLegacyBackup({ foo: 1 })).toThrow();
  });
});

test("OpenAI-compatible endpoint roots", () => {
  expect(apiRoot("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
  expect(apiRoot("http://localhost:11434")).toBe("http://localhost:11434/v1");
  expect(apiRoot("https://x.ai/v1/chat/completions")).toBe("https://x.ai/v1");
});

test("backup format 2 carries library; keys stripped unless requested; v1 backups still accepted", () => {
  const w = { kind: "world" as const, id: "w", name: "레인포트", description: "", rules: "", lore: [], createdAt: 0, updatedAt: 0 };
  const b = makeBackup({ ...DEFAULT_SETTINGS, keys: { gemini: "g", anthropic: "a", openai: "" } }, [room()], [w], false);
  expect(b.settings.keys.gemini).toBe("");
  expect(isOwnBackup(b) && backupLibrary(b)).toEqual([w]);
  const v1 = { app: "novel-generator", format: 1, settings: DEFAULT_SETTINGS, rooms: [] };
  expect(isOwnBackup(v1) && backupLibrary(v1 as any)).toEqual([]);
});
