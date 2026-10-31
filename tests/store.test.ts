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
