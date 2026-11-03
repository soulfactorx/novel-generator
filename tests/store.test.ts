import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { claudeStream, json, mockFetch } from "./helpers";

type Store = typeof import("../src/lib/store");
async function freshStore(): Promise<Store> {
  vi.resetModules(); // "새로고침": 모듈 상태 초기화 (IndexedDB 는 그대로)
  const s = await import("../src/lib/store");
  await s.init();
  return s;
}
const keys = { gemini: "", anthropic: "ak", openai: "" };

beforeEach(async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.indexedDB = new IDBFactory(); // 테스트마다 빈 브라우저 저장소
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
/** 재시도 대기(setTimeout)만 가짜 시계로 빨리 감으며 실행 — IndexedDB 등 다른 비동기는 그대로 */
async function fastRetries<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let done = false;
  const p = run().finally(() => (done = true));
  while (!done) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise((r) => setImmediate(r));
  }
  vi.useRealTimers();
  return p;
}

describe("store", () => {
  test("chat round-trip is persisted and survives reload", async () => {
    let s = await freshStore();
    expect(s.getState().settings.contentRating).toBe("general");
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom();
    const calls = mockFetch(claudeStream("비가 내리기 시작했다.\n\n[선택지]\n1. 우산을 편다\n2. 뛰어간다"));
    await s.send(id, "골목으로 들어간다");
    const room = s.getState().rooms[id];
    expect(room.title).toBe("골목으로 들어간다");
    expect(room.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(room.messages[1]).toMatchObject({ text: "비가 내리기 시작했다.", choices: ["우산을 편다", "뛰어간다"], model: "claude-sonnet-5-5" });
    expect(calls[0].body.system[0].text).toContain("콘텐츠 등급: 전체 이용가");
    expect(s.getState().live).toBeNull();
    await s.flush();
    s = await freshStore();
    expect(s.getState().activeRoomId).toBe(id);
    expect(s.getState().rooms[id].messages).toHaveLength(2);
    expect(s.getState().settings.keys.anthropic).toBe("ak");
  });

  test("errors become an error message; regenerate replaces it", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom();
    mockFetch(json({ type: "error", error: { type: "authentication_error", message: "bad" } }, 401));
    await s.send(id, "안녕");
    expect(s.getState().rooms[id].messages[1].error).toContain("API 키가 올바르지 않습니다");
    mockFetch(claudeStream("다시 쓴 장면"));
    await s.regenerate(id);
    const msgs = s.getState().rooms[id].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].text).toBe("다시 쓴 장면");
  });

  test("stop aborts without adding an error", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = s.send(id, "go");
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState().live).not.toBeNull();
    s.stopGeneration();
    await p;
    expect(s.getState().rooms[id].messages).toHaveLength(1);
    expect(s.getState().live).toBeNull();
  });

  test("E.No.S import adds rooms (+ keys when chosen) and persists", async () => {
    let s = await freshStore();
    const { parseLegacyBackup } = await import("../src/lib/importLegacy");
    const data = parseLegacyBackup({ sessions: [{ title: "예전 이야기", history: [{ role: "user", text: "a" }, { role: "model", text: "b" }] }], settings: { apiKey: "gem" } });
    s.importLegacy(data, true);
    await s.flush();
    s = await freshStore();
    const rooms = Object.values(s.getState().rooms);
    expect(rooms.map((r) => r.title)).toEqual(["예전 이야기"]);
    expect(s.getState().settings.keys.gemini).toBe("gem");
  });
});

describe("library & memory in store", () => {
  test("lore + cast reach the request; deleting an entity unlinks rooms; persisted", async () => {
    let s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys, autoMemory: false });
    const w = s.createEntity("world", "레인포트");
    s.updateEntity(w, { lore: [{ id: "l", title: "조합", keys: ["조합"], content: "항구를 지배하는 상인 조합", enabled: true }] });
    const c = s.createEntity("character", "서율");
    const id = s.createRoom({ worldId: w, characterIds: [c] });
    const calls = mockFetch(claudeStream("장면"));
    await s.send(id, "조합 건물로 간다");
    expect(calls[0].body.system[0].text).toContain("## 세계관: 레인포트");
    expect(calls[0].body.system[0].text).toContain("### 서율");
    expect(calls[0].body.system[0].text).not.toContain("상인 조합"); // 로어는 시스템이 아니라
    expect(calls[0].body.messages.at(-1).content.at(-1).text).toContain("항구를 지배하는 상인 조합"); // 마지막 입력에
    s.deleteEntity(c);
    expect(s.getState().rooms[id].characterIds).toEqual([]);
    await s.flush();
    s = await freshStore();
    expect(s.getState().library[w].name).toBe("레인포트");
    expect(s.getState().library[c]).toBeUndefined();
    expect(s.getState().rooms[id].worldId).toBe(w);
  });

  test("auto memory runs after a reply once enough messages fall out of the window", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys, contextMessages: 10 });
    const id = s.createRoom();
    const old = Array.from({ length: 20 }, (_, i) => ({ id: "o" + i, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "옛 대화 " + i, createdAt: i + 1 }));
    s.updateRoom(id, { messages: old });
    const calls = mockFetch(claudeStream("새 장면"), claudeStream("- 갱신된 줄거리"));
    await s.send(id, "계속");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages[0].content[0].text ?? calls[1].body.messages[0].content).toContain("옛 대화 0");
    const r = s.getState().rooms[id];
    expect(r.memory).toBe("- 갱신된 줄거리");
    expect(r.memoryCursorAt).toBe(12); // 22개 중 최근 10개 밖 → 12개 정리
    expect(s.getState().memoryJob).toBeNull();
    // 바로 다음 턴엔 새로 밀려난 게 2개뿐 → 정리 안 함
    const c2 = mockFetch(claudeStream("다음"));
    await s.send(id, "또");
    expect(c2).toHaveLength(1);
  });

  test("memory failure is reported but keeps the story", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom();
    s.updateRoom(id, { messages: Array.from({ length: 20 }, (_, i) => ({ id: "o" + i, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "x" + i, createdAt: i + 1 })) });
    mockFetch(json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400));
    const r = await s.updateMemory(id, "manual");
    expect(r).toMatchObject({ error: expect.stringContaining("장기 기억 정리 실패") });
    expect(s.getState().rooms[id].messages).toHaveLength(20);
    expect(s.getState().memoryJob?.error).toBeTruthy();
  });

  test("v0.1 database (no library store) upgrades without losing rooms", async () => {
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open("novel-generator", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("rooms", { keyPath: "id" }); };
      r.onsuccess = () => {
        const t = r.result.transaction(["rooms", "kv"], "readwrite");
        t.objectStore("rooms").put({ id: "old", title: "v0.1 이야기", premise: "", memory: "", messages: [], createdAt: 1, updatedAt: 1 });
        t.objectStore("kv").put({ worlds: [{ id: "w", name: "옛 세계" }], characters: [], personas: [], novels: [] }, "legacyExtra");
        t.oncomplete = () => { r.result.close(); res(); };
      };
      r.onerror = () => rej(r.error);
    });
    let s = await freshStore();
    expect(s.getState().rooms.old).toMatchObject({ title: "v0.1 이야기", characterIds: [] });
    expect(s.getState().legacyExtra).not.toBeNull();
    expect(s.importLegacyExtra()).toBe(1);
    await s.flush();
    await new Promise((r) => setTimeout(r, 20));
    s = await freshStore();
    expect(Object.values(s.getState().library).map((e) => e.name)).toEqual(["옛 세계"]);
    expect(s.getState().legacyExtra).toBeNull();
  });
});

describe("novels in store", () => {
  const outlineText = "[1화] 비 오는 밤\n밀수선 발견.\n\n[2화] 조합\n잠입.\n\n[3화] 진실\n결말.";
  test("outline → sequential writing → persisted; extend keeps written episodes", async () => {
    let s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createNovel({ title: "비의 항구", brief: "밀수", episodeCount: 3 });
    expect(s.getState().view).toBe("novels");
    let calls = mockFetch(claudeStream(outlineText));
    expect(await s.generateOutline(id)).toBe(true);
    expect(s.getState().novels[id].outline.map((o) => o.title)).toEqual(["비 오는 밤", "조합", "진실"]);
    calls = mockFetch(claudeStream("첫 화 본문.\n\n[회차 요약]\n발견했다."), claudeStream("둘째 화 본문.\n\n[회차 요약]\n잠입했다."), claudeStream("셋째 화 본문.\n\n[회차 요약]\n끝."));
    expect(await s.writeEpisodes(id, 2)).toBe(3);
    const n = s.getState().novels[id];
    expect(n.episodes.map((e) => [e.title, e.text, e.summary])).toEqual([["비 오는 밤", "첫 화 본문.", "발견했다."], ["조합", "둘째 화 본문.", "잠입했다."], ["진실", "셋째 화 본문.", "끝."]]);
    expect(calls[2].body.messages[0].content[0].text ?? calls[2].body.messages[0].content).toContain("[2화] 조합: 잠입했다.");
    expect(calls[0].body.max_tokens).toBe(9000 + 16000);
    // 회차 늘리고 이어서 개요
    s.updateNovel(id, { episodeCount: 5 });
    calls = mockFetch(claudeStream("[4화] 후일담\n정리.\n\n[5화] 새 사건\n시작."));
    await s.generateOutline(id, 3);
    expect(s.getState().novels[id].outline.map((o) => o.title)).toEqual(["비 오는 밤", "조합", "진실", "후일담", "새 사건"]);
    await s.flush();
    s = await freshStore();
    expect(s.getState().novels[id].episodes).toHaveLength(3);
    expect(s.getState().activeNovelId).toBe(id);
  });

  test("guards: needs outline, writes in order; errors stop the sequence; stop keeps a long partial as incomplete", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createNovel({ episodeCount: 3 });
    expect(await s.writeEpisode(id, 0)).toBe(false);
    expect(s.getState().novelError?.message).toContain("개요가 없습니다");
    s.updateNovel(id, { outline: [{ id: "a", title: "A", summary: "" }, { id: "b", title: "B", summary: "" }, { id: "c", title: "C", summary: "" }] });
    expect(await s.writeEpisode(id, 1)).toBe(false);
    mockFetch(claudeStream("A 본문"), json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400));
    expect(await s.writeEpisodes(id, 2)).toBe(1);
    expect(s.getState().novelError).not.toBeNull();
    // 중단: 스트림 일부만 오고 멈춤
    const enc = new TextEncoder();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "m", usage: { input_tokens: 1 } } })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "긴 원고 ".repeat(150) } })}\n\n`));
        init.signal!.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const p = s.writeEpisode(id, 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.getState().novelLive?.text).toContain("긴 원고");
    s.stopNovel();
    expect(await p).toBe(false);
    const e = s.getState().novels[id].episodes[1];
    expect(e.incomplete).toBe(true);
    expect(s.getState().novelLive).toBeNull();
  });

  test("novel from room copies cast and memory; deleting a character unlinks novels", async () => {
    const s = await freshStore();
    const c = s.createEntity("character", "서율");
    const rid = s.createRoom({ title: "항구 이야기", premise: "비 오는 도시", characterIds: [c] });
    s.updateRoom(rid, { memory: "- 첫 만남" });
    const nid = s.novelFromRoom(rid)!;
    expect(s.getState().novels[nid]).toMatchObject({ title: "항구 이야기", characterIds: [c] });
    expect(s.getState().novels[nid].brief).toContain("- 첫 만남");
    s.deleteEntity(c);
    expect(s.getState().novels[nid].characterIds).toEqual([]);
  });
});

describe("v0.4: fallback, usage, directives, branches", () => {
  const overloaded = () => json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529);
  const geminiOk = (text: string) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } });

  test("server error → fallback model; usage recorded with cost and persisted", async () => {
    let s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys: { gemini: "gk", anthropic: "ak", openai: "" }, streaming: false, fallback: { enabled: true, provider: "gemini", model: "gemini-3.8-flash" } });
    const id = s.createRoom();
    const calls = mockFetch(overloaded(), overloaded(), overloaded(), (url) => (expect(url).toContain("gemini-3.8-flash"), geminiOk("대체 모델 장면")));
    await fastRetries(() => s.send(id, "간다"));
    expect(calls).toHaveLength(4);
    const m = s.getState().rooms[id].messages[1];
    expect(m).toMatchObject({ text: "대체 모델 장면", model: "gemini-3.8-flash", fallback: true });
    expect(m.usage?.usd).toBeGreaterThan(0);
    const { summarize, monthRange } = await import("../src/lib/usage");
    expect(summarize(s.getState().usage, ...monthRange()).total.n).toBe(1);
    await s.flush();
    s = await freshStore();
    expect(summarize(s.getState().usage, ...monthRange()).models[0].model).toBe("gemini-3.8-flash");
  });

  test("auth errors and missing fallback key do not fall back", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys: { gemini: "", anthropic: "ak", openai: "" }, fallback: { enabled: true, provider: "gemini", model: "gemini-3.8-flash" } });
    const id = s.createRoom();
    let calls = mockFetch(json({ type: "error", error: { type: "authentication_error", message: "bad" } }, 401));
    await s.send(id, "a");
    expect(calls).toHaveLength(1);
    expect(s.getState().rooms[id].messages.at(-1)!.error).toBeTruthy();
    calls = mockFetch(overloaded(), overloaded(), overloaded());
    await fastRetries(() => s.regenerate(id));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url.includes("anthropic"))).toBe(true); // Gemini 키 없음 → 대체 안 함
  });

  test("regenerate with a directive appends it to the last user turn", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom();
    mockFetch(claudeStream("첫 응답"));
    await s.send(id, "간다");
    const calls = mockFetch(claudeStream("고친 응답"));
    await s.regenerate(id, "대화를 늘려라");
    const last = calls[0].body.messages.at(-1).content.at(-1).text;
    expect(last).toContain("간다");
    expect(last).toContain("<작가 지시: 이번 응답에 반영할 것>\n대화를 늘려라");
    expect(s.getState().rooms[id].messages.map((m) => m.text)).toEqual(["간다", "고친 응답"]);
  });

  test("diagnosis stored on room; bookmarks; branch keeps/clears memory; rewind", async () => {
    const s = await freshStore();
    s.updateSettings({ provider: "anthropic", keys });
    const id = s.createRoom({ title: "원본" });
    const msgs = Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "t" + i, createdAt: i + 1 }));
    s.updateRoom(id, { messages: msgs, memory: "요약(m3까지)", memoryCursorAt: 4 });
    mockFetch(claudeStream("### 한 줄 평\n- 무난\n\n[다음 지시]\n긴장감을 높여라."));
    const r = await s.diagnoseRoom(id);
    expect(r.directive).toBe("긴장감을 높여라.");
    expect(s.getState().rooms[id].lastDiagnosis?.report).toContain("무난");
    s.setBookmark(id, "m2", "첫 고백");
    expect(s.getState().rooms[id].messages[2].bookmark).toBe("첫 고백");
    s.setBookmark(id, "m2", null);
    expect("bookmark" in s.getState().rooms[id].messages[2]).toBe(false);
    const b1 = s.branchRoom(id, "m4")!; // 기억(m3까지)은 분기점 이전 → 유지
    expect(s.getState().rooms[b1]).toMatchObject({ title: "원본 (분기)", memory: "요약(m3까지)", branchOf: { roomId: id, messageId: "m4" } });
    expect(s.getState().rooms[b1].messages.map((m) => m.text)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(s.getState().activeRoomId).toBe(b1);
    const b2 = s.branchRoom(id, "m1")!; // 기억에 분기점 이후 내용 → 비움
    expect(s.getState().rooms[b2]).toMatchObject({ memory: "", memoryCursorAt: undefined });
    expect(s.getState().rooms[id].messages).toHaveLength(6); // 원본 그대로
    s.rewindTo(id, "m1");
    expect(s.getState().rooms[id].messages.map((m) => m.id)).toEqual(["m0", "m1"]);
    expect(s.getState().rooms[id].memory).toBe("");
  });
});

describe("RisuAI 패키지 보관·재사용", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const card = (desc: string, greetings: string[]) => ({
    spec: "chara_card_v3",
    data: { name: "하루", description: desc, first_mes: greetings[0], alternate_greetings: greetings.slice(1), assets: [{ type: "x-risu-asset", uri: "data:image/png;base64," + btoa(String.fromCharCode(...PNG)), name: "harbor", ext: "png" }] },
  });
  test("인사말은 패키지에 보관 → 나중에 다른 인사말로 새 이야기, 같은 파일을 다시 가져오면 교체(연결 유지)", async () => {
    const s = await freshStore();
    const { parseRisuJson, withSource } = await import("../src/lib/risu");
    // 1) 이야기 없이 라이브러리에만
    await s.importRisu(withSource(parseRisuJson(card("v1 설정", ["인사 A", "인사 B"]))!, "haru.json"), {});
    const c1 = Object.values(s.getState().library).find((e) => e.name === "하루")! as any;
    expect(c1.greetings).toEqual(["인사 A", "인사 B"]);
    expect(c1.source).toMatchObject({ kind: "risu", file: "haru.json" });
    expect(Object.keys(s.getState().rooms)).toHaveLength(0);
    expect(Object.values(s.getState().images).filter((m) => m.ownerId === c1.id)).toHaveLength(1);
    // 2) 나중에 2번 인사말로 새 이야기
    const roomId = s.createRoom({ characterIds: [c1.id], greeting: c1.greetings[1] });
    expect(s.getState().rooms[roomId].messages.map((m) => [m.role, m.text])).toEqual([["assistant", "인사 B"]]);
    // 3) 같은 패키지를 다시 가져오기 → 교체: id·이야기 연결 유지, 내용·이미지는 새 것
    const { existingPackages } = s;
    const again = withSource(parseRisuJson(card("v2 설정", ["새 인사"]))!, "haru.json");
    expect(existingPackages(again).map((d) => d.existing.id)).toEqual([c1.id]);
    const res = await s.importRisu(again, { replace: true });
    expect(res.replaced).toBe(1);
    const chars = Object.values(s.getState().library).filter((e) => e.name === "하루") as any[];
    expect(chars).toHaveLength(1);
    expect(chars[0].id).toBe(c1.id);
    expect(chars[0].profile).toBe("v2 설정");
    expect(chars[0].greetings).toEqual(["새 인사"]);
    expect(s.getState().rooms[roomId].characterIds).toEqual([c1.id]);
    expect(Object.values(s.getState().images).filter((m) => m.ownerId === c1.id)).toHaveLength(1); // 옛 이미지는 지우고 새 이미지
    // 4) '따로 추가'를 고르면 하나 더
    await s.importRisu(withSource(parseRisuJson(card("v3", ["x"]))!, "haru.json"), { replace: false });
    expect(Object.values(s.getState().library).filter((e) => e.name === "하루")).toHaveLength(2);
    // 새로고침 후에도 유지
    await s.flush();
    const s2 = await freshStore();
    expect((s2.getState().library[c1.id] as any).greetings).toEqual(["새 인사"]);
  });
});

test("입력 없이 보내기: 마지막이 AI 응답이면 이어 쓰기 요청을 붙여 다음 턴 진행 (기록에는 남지 않음)", async () => {
  const s = await freshStore();
  s.updateSettings({ provider: "anthropic", keys, streaming: false });
  const id = s.createRoom();
  const calls = mockFetch(json({ content: [{ type: "text", text: "첫 장면" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }), json({ content: [{ type: "text", text: "다음 장면" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }));
  await s.send(id, "");
  await s.send(id, "");
  const last = calls[1].body.messages;
  expect(last[last.length - 2].role).toBe("assistant");
  expect(JSON.stringify(last[last.length - 1])).toContain("이어서 다음 장면");
  expect(s.getState().rooms[id].messages.map((m) => [m.role, m.text])).toEqual([["assistant", "첫 장면"], ["assistant", "다음 장면"]]);
});
