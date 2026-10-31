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
afterEach(() => vi.unstubAllGlobals());

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
