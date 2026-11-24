import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ARCHIVE, folderList, planOrganize, withFolder, type OrganizeItem } from "../src/lib/folders";
import { mergeSnapshots } from "../src/lib/sync/merge";
import { normalizeSettings, type OrganizeRule } from "../src/lib/types";

const DAY = 24 * 3600 * 1000;
const NOW = 1000 * DAY;
const rule = (p: Partial<OrganizeRule> = {}): OrganizeRule => ({ by: "character", archiveDays: 0, auto: false, ...p });
const it_ = (id: string, p: Partial<OrganizeItem> = {}): OrganizeItem => ({ id, activeAt: NOW, ...p });

describe("planOrganize", () => {
  test("같은 묶음이 2개 이상이면 폴더, 1개면 폴더 밖", () => {
    const plan = planOrganize([it_("a", { group: "👤 하루" }), it_("b", { group: "👤 하루" }), it_("c", { group: "👤 서율" }), it_("d")], rule(), NOW);
    expect(Object.fromEntries(plan)).toEqual({ a: { folder: "👤 하루", folderAuto: true }, b: { folder: "👤 하루", folderAuto: true } });
  });
  test("묶음 크기는 직접 정한 것까지 세고, 자유로운 것만 옮긴다", () => {
    const items = [it_("a", { group: "👤 하루", folder: "내 폴더", folderAuto: false }), it_("c", { group: "👤 하루" })];
    expect(Object.fromEntries(planOrganize(items, rule(), NOW))).toEqual({ c: { folder: "👤 하루", folderAuto: true } });
    expect(Object.fromEntries(planOrganize(items, rule(), NOW, { includeManual: true }))).toEqual({ a: { folder: "👤 하루", folderAuto: true }, c: { folder: "👤 하루", folderAuto: true } });
  });
  test("기준이 바뀌거나 묶음이 줄면 자동으로 넣은 것은 빠진다", () => {
    const items = [it_("a", { group: "👤 하루", folder: "👤 하루", folderAuto: true })];
    expect(Object.fromEntries(planOrganize(items, rule(), NOW))).toEqual({ a: { folder: undefined, folderAuto: undefined } });
  });
  test("보관: 오래 안 쓰면 보관함으로(직접 넣은 폴더도), 다시 쓰면 원래 자리로", () => {
    const old = NOW - 40 * DAY;
    const items = [it_("a", { activeAt: old, folder: "내 폴더", folderAuto: false }), it_("b", { activeAt: old }), it_("c")];
    const plan = planOrganize(items, rule({ by: "none", archiveDays: 30 }), NOW);
    expect(plan.get("a")).toEqual({ folder: ARCHIVE, folderAuto: true, folderPrev: { folder: "내 폴더", manual: true } });
    expect(plan.get("b")).toEqual({ folder: ARCHIVE, folderAuto: true, folderPrev: { manual: false } });
    expect(plan.has("c")).toBe(false);
    // 다시 씀 → 원래 자리
    const back = planOrganize([{ ...withFolder(items[0], plan.get("a")!), activeAt: NOW } as OrganizeItem, { ...withFolder(items[1], plan.get("b")!), activeAt: NOW } as OrganizeItem], rule({ by: "none", archiveDays: 30 }), NOW);
    expect(back.get("a")).toEqual({ folder: "내 폴더", folderAuto: false, folderPrev: undefined });
    expect(back.get("b")).toEqual({ folder: undefined, folderAuto: undefined, folderPrev: undefined });
    // 보관을 끄면 모두 꺼냄
    expect(planOrganize([withFolder(items[1], plan.get("b")!) as OrganizeItem], rule({ by: "none" }), NOW).get("b")?.folder).toBeUndefined();
    // 직접 보관함에 넣은 것은 그대로
    expect(planOrganize([it_("x", { folder: ARCHIVE, folderAuto: false })], rule({ by: "none", archiveDays: 30 }), NOW).size).toBe(0);
  });
  test("최근 활동 기준은 1개여도 폴더", () => {
    expect(planOrganize([it_("a", { group: "🕒 이번 주" })], rule({ by: "activity" }), NOW).get("a")?.folder).toBe("🕒 이번 주");
  });
  test("폴더 목록: 이름 순, 보관함은 맨 끝, 개수", () => {
    expect(folderList([{ id: "1", folder: ARCHIVE }, { id: "2", folder: "나" }, { id: "3", folder: "가" }, { id: "4", folder: "가" }, { id: "5" }])).toEqual([{ name: "가", count: 2 }, { name: "나", count: 1 }, { name: ARCHIVE, count: 1 }]);
  });
  test("설정: 규칙 정리 (소설만 연재 상태 기준)", () => {
    const s = normalizeSettings({ organize: { rooms: { by: "status", archiveDays: "30", auto: 1 }, novels: { by: "status", archiveDays: -3 } } });
    expect(s.organize).toEqual({ rooms: { by: "none", archiveDays: 30, auto: true }, novels: { by: "status", archiveDays: 0, auto: false } });
    expect(normalizeSettings({}).organize.rooms).toEqual({ by: "none", archiveDays: 0, auto: false });
  });
});

type Store = typeof import("../src/lib/store");
async function freshStore(): Promise<Store> {
  vi.resetModules();
  const s = await import("../src/lib/store");
  await s.init();
  return s;
}
beforeEach(async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.indexedDB = new IDBFactory();
});

describe("store 폴더", () => {
  test("직접 넣기 · 이름 바꾸기 · 풀기, 정렬(최근 순)은 그대로, 새로고침 후에도 유지", async () => {
    const s = await freshStore();
    const a = s.createRoom({ title: "A" });
    const b = s.createRoom({ title: "B" });
    const order = () => Object.values(s.getState().rooms).sort((x, y) => y.updatedAt - x.updatedAt).map((r) => r.title);
    const before = order();
    s.moveToFolder("rooms", [a, b], "판타지");
    expect(s.getState().rooms[a]).toMatchObject({ folder: "판타지", folderAuto: false });
    expect(order()).toEqual(before);
    s.renameFolder("rooms", "판타지", "모험");
    expect(s.getState().rooms[b].folder).toBe("모험");
    s.dissolveFolder("rooms", "모험");
    expect(s.getState().rooms[a].folder).toBeUndefined();
    expect(s.getState().rooms[a].folderAuto).toBe(false);
    s.moveToFolder("rooms", [a], "보관할 것");
    await s.flush();
    const s2 = await freshStore();
    expect(s2.getState().rooms[a].folder).toBe("보관할 것");
  });
  test("자동 정리: 등장인물별, 새로 만든 이야기도 자동으로", async () => {
    const s = await freshStore();
    s.upsertLibrary([{ kind: "character", id: "c1", name: "하루", summary: "", profile: "", speech: "", lore: [], createdAt: 1, updatedAt: 1 } as never]);
    const a = s.createRoom({ characterIds: ["c1"] });
    const b = s.createRoom({ characterIds: ["c1"] });
    const solo = s.createRoom();
    const rule = { by: "character" as const, archiveDays: 0, auto: true };
    expect([...s.planFolders("rooms", rule).keys()].sort()).toEqual([a, b].sort());
    s.updateSettings({ organize: { ...s.getState().settings.organize, rooms: rule } });
    expect(s.organizeNow("rooms")).toBe(2);
    expect(s.getState().rooms[a].folder).toBe("👤 하루");
    expect(s.getState().rooms[solo].folder).toBeUndefined();
    const c = s.createRoom({ characterIds: ["c1"] });
    await vi.waitFor(() => expect(s.getState().rooms[c].folder).toBe("👤 하루"), { timeout: 4000 });
    // 직접 뺀 것은 다시 넣지 않음
    s.moveToFolder("rooms", [a], undefined);
    s.runAutoOrganize();
    expect(s.getState().rooms[a].folder).toBeUndefined();
    // 자동 폴더 모두 풀기
    s.updateSettings({ organize: { ...s.getState().settings.organize, rooms: { ...rule, auto: false } } });
    expect(s.clearAutoFolders("rooms")).toBe(2);
    expect(Object.values(s.getState().rooms).filter((r) => r.folder)).toHaveLength(0);
  });
  test("폴더는 동기화로 다른 기기에 전해진다 (레코드에 실림)", () => {
    const room = (folder?: string, updatedAt = 10) => ({ id: "r", title: "t", premise: "", memory: "", messages: [], characterIds: [], createdAt: 1, updatedAt, ...(folder ? { folder, folderAuto: false } : {}) });
    const m = mergeSnapshots({ rooms: { r: room("판타지", 11) }, library: {}, novels: {}, tombstones: {} }, { rooms: { r: room() }, library: {}, novels: {}, tombstones: {} });
    expect(m.remoteChanged).toBe(true);
    expect(m.merged.rooms.r.folder).toBe("판타지");
  });
});
