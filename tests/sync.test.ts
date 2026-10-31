import "fake-indexeddb/auto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { decodePayload, encodePayload, PassphraseError } from "../src/lib/sync/codec";
import { GistClient, GistError, META_FILE } from "../src/lib/sync/gist";
import { mergeSnapshots, TOMBSTONE_KEEP_MS, type Snapshot } from "../src/lib/sync/merge";
import type { Room } from "../src/lib/types";
import { fakeGitHub } from "./helpers";

afterEach(() => vi.unstubAllGlobals());
const room = (id: string, updatedAt: number, title = id): Room => ({ id, title, premise: "", memory: "", messages: [], characterIds: [], createdAt: 0, updatedAt });
const snap = (p: Partial<Snapshot> = {}): Snapshot => ({ rooms: {}, library: {}, novels: {}, tombstones: {}, ...p });

describe("codec", () => {
  const data = { rooms: { a: { title: "한글 제목", text: "가".repeat(5000) } } };
  test("plain round-trip is compressed", async () => {
    const { meta, body } = await encodePayload(data);
    expect(meta.encoding).toBe("gzip-base64");
    expect(meta.enc).toBeUndefined();
    expect(body.length).toBeLessThan(JSON.stringify(data).length / 5);
    expect(await decodePayload(meta, body)).toEqual(data);
  });
  test("encrypted round-trip; wrong or missing passphrase rejected", async () => {
    const { meta, body } = await encodePayload(data, "비밀");
    expect(meta.enc).toMatchObject({ alg: "AES-GCM", kdf: "PBKDF2-SHA256" });
    expect(await decodePayload(meta, body, "비밀")).toEqual(data);
    await expect(decodePayload(meta, body, "틀림")).rejects.toBeInstanceOf(PassphraseError);
    await expect(decodePayload(meta, body)).rejects.toThrow("암호로 잠겨");
    const again = await encodePayload(data, "비밀");
    expect(again.meta.enc!.iv).not.toBe(meta.enc!.iv); // 매번 새 IV
  });
});

describe("merge", () => {
  const now = 1_000_000_000_000;
  test("newer wins per record, unions both sides", () => {
    const L = snap({ rooms: { a: room("a", 10, "L"), b: room("b", 5) } });
    const R = snap({ rooms: { a: room("a", 20, "R"), c: room("c", 7) } });
    const m = mergeSnapshots(L, R, now);
    expect(Object.keys(m.merged.rooms).sort()).toEqual(["a", "b", "c"]);
    expect(m.merged.rooms.a.title).toBe("R");
    expect(m.local.put.rooms.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(m.remoteChanged).toBe(true); // b 는 원격에 없음
  });
  test("tombstones delete on both sides unless the record is newer; old tombstones pruned", () => {
    const L = snap({ rooms: { a: room("a", now - 90), b: room("b", now - 10) }, tombstones: { old: now - TOMBSTONE_KEEP_MS - 1 } });
    const R = snap({ tombstones: { a: now - 50, b: now - 40 } });
    const m = mergeSnapshots(L, R, now);
    expect(m.local.del.rooms).toEqual(["a"]);
    expect(m.merged.rooms.b).toBeDefined(); // 삭제 후에 다시 고친 기록은 살아남음
    expect(m.merged.tombstones).toEqual({ a: now - 50, b: now - 40 });
    expect(m.local.tombstonesChanged).toBe(true);
  });
  test("no-op when identical; first sync pushes", () => {
    const S = snap({ rooms: { a: room("a", 1) }, settings: { value: { theme: "dark" }, updatedAt: 3 } });
    const m = mergeSnapshots(S, JSON.parse(JSON.stringify(S)), now);
    expect(m.remoteChanged).toBe(false);
    expect(m.local.put.rooms).toEqual([]);
    expect(mergeSnapshots(S, null, now).remoteChanged).toBe(true);
  });
  test("settings: newer side wins", () => {
    const m = mergeSnapshots(snap({ settings: { value: { theme: "dark" }, updatedAt: 5 } }), snap({ settings: { value: { theme: "light" }, updatedAt: 9 } }), now);
    expect(m.local.settings).toEqual({ theme: "light" });
    const m2 = mergeSnapshots(snap({ settings: { value: { theme: "dark" }, updatedAt: 10 } }), snap({ settings: { value: { theme: "light" }, updatedAt: 9 } }), now);
    expect(m2.local.settings).toBeUndefined();
    expect(m2.remoteChanged).toBe(true);
  });
});

describe("Gist client", () => {
  test("create → find → read; chunking + stale chunk cleanup; private gist", async () => {
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.handler);
    const c = new GistClient("tok");
    expect(await c.user()).toBe("tester");
    expect(await c.find()).toBeNull();
    const big = "x".repeat(2_000_000);
    const w = await c.write(null, { app: "novel-generator", payload: { format: 1, encoding: "base64" }, updatedAt: 1 }, big);
    const g = gh.gists.get(w.id)!;
    expect(g.public).toBe(false);
    expect(Object.keys(g.files).sort()).toEqual([META_FILE, "data-001.txt", "data-002.txt", "data-003.txt"].sort());
    expect(await c.find()).toBe(w.id);
    const r = (await c.read(w.id))!;
    expect(r.body).toBe(big);
    await c.write(w.id, { app: "novel-generator", payload: { format: 1, encoding: "base64" }, updatedAt: 2 }, "small", r.files);
    expect(Object.keys(g.files).sort()).toEqual([META_FILE, "data-001.txt"].sort());
  });
  test("truncated files are fetched from raw_url; errors are explained", async () => {
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.handler);
    gh.gists.set("big", { id: "big", description: "Novel Generator sync", public: false, files: { [META_FILE]: { content: JSON.stringify({ app: "novel-generator", payload: { format: 1, encoding: "base64" }, chunks: ["data-001.txt"], updatedAt: 1 }) }, "data-001.txt": { content: "y".repeat(1_200_000) } } });
    const r = (await new GistClient("tok").read("big"))!;
    expect(r.body.length).toBe(1_200_000);
    expect(gh.calls.some((x) => x.startsWith("GET gist.githubusercontent.com"))).toBe(true);
    await expect(new GistClient("bad").user()).rejects.toMatchObject({ status: 401, message: expect.stringContaining("토큰이 올바르지") });
    await expect(new GistClient("tok").read("nope")).rejects.toBeInstanceOf(GistError);
  });
});

/* ---------- 두 기기 시나리오 (기기마다 별도 IndexedDB) ---------- */
type Store = typeof import("../src/lib/store");
async function device(db: IDBFactory): Promise<Store> {
  globalThis.indexedDB = db;
  vi.resetModules();
  const s = await import("../src/lib/store");
  await s.init();
  return s;
}
describe("two devices via Gist", () => {
  test("A pushes → B pulls (encrypted, keys not synced) → B deletes & edits → A receives; wrong passphrase never overwrites", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    const dbA = new IDBFactory(), dbB = new IDBFactory();
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.handler);

    let A = await device(dbA);
    A.updateSettings({ keys: { gemini: "A-key", anthropic: "", openai: "" }, theme: "dark", contextMessages: 60 });
    const r1 = A.createRoom({ title: "항구 이야기" });
    const r2 = A.createRoom({ title: "지울 이야기" });
    const w = A.createEntity("world", "레인포트");
    const n = A.createNovel({ title: "비의 항구" });
    expect(await A.connectSync({ token: "tok", passphrase: "pw", auto: false })).toBe(true);
    expect(A.getState().sync).toMatchObject({ connected: true, encrypted: true, login: "tester" });
    const gist = [...gh.gists.values()][0];
    const raw = Object.values(gist.files).map((f) => f.content).join("");
    expect(raw).not.toContain("항구"); // 암호화되어 내용이 보이지 않음
    expect(raw).not.toContain("A-key");
    await A.flush();

    let B = await device(dbB);
    expect(await B.connectSync({ token: "tok", passphrase: "pw", auto: false })).toBe(true); // 같은 Gist 를 찾아 받음
    expect(gh.gists.size).toBe(1);
    expect(B.getState().rooms[r1].title).toBe("항구 이야기");
    expect(B.getState().library[w].name).toBe("레인포트");
    expect(B.getState().novels[n].title).toBe("비의 항구");
    expect(B.getState().settings).toMatchObject({ theme: "dark", contextMessages: 60 });
    expect(B.getState().settings.keys.gemini).toBe(""); // 키는 동기화 안 됨
    B.deleteRoom(r2);
    B.updateRoom(r1, { title: "항구 이야기 (수정)" });
    expect(await B.syncNow()).toBe(true);
    await B.flush();
    B = await device(dbB); // 새로고침해도 유지
    expect(B.getState().rooms[r2]).toBeUndefined();

    A = await device(dbA);
    expect(await A.syncNow()).toBe(true);
    expect(A.getState().rooms[r2]).toBeUndefined(); // 삭제가 전달됨
    expect(A.getState().rooms[r1].title).toBe("항구 이야기 (수정)");
    expect(A.getState().settings.keys.gemini).toBe("A-key"); // 내 키는 그대로
    expect(A.getState().sync.lastResult).toContain("삭제 1");

    // 다른 암호의 기기: 데이터를 덮어쓰지 않음
    const before = JSON.stringify(gist.files);
    const C = await device(new IDBFactory());
    expect(await C.connectSync({ token: "tok", passphrase: "다른암호", auto: false })).toBe(false);
    expect(C.getState().sync.error).toContain("암호가 맞지 않습니다");
    expect(JSON.stringify(gist.files)).toBe(before);
  });

  test("restoring a deleted item from a backup is not re-deleted by sync", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.handler);
    const A = await device(new IDBFactory());
    const id = A.createRoom({ title: "복원할 이야기" });
    const copy = A.getState().rooms[id];
    await A.connectSync({ token: "tok", passphrase: "", auto: false });
    A.deleteRoom(id);
    await A.syncNow();
    A.upsertRooms([copy]); // 백업에서 복원
    await A.syncNow();
    expect(A.getState().rooms[id]?.title).toBe("복원할 이야기");
    const B = await device(new IDBFactory());
    await B.connectSync({ token: "tok", passphrase: "", auto: false });
    expect(B.getState().rooms[id]?.title).toBe("복원할 이야기");
  });
});
