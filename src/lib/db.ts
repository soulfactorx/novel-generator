import type { Entity, ImageMeta, Novel, Room } from "./types";

/**
 * IndexedDB 저장소 — 레코드 단위로 바뀐 것만 저장
 *  v1: kv(설정 등) + rooms(이야기방)
 *  v2: + library(세계관·등장인물·주인공, kind 필드로 구분)
 *  v3: + novels(소설: 개요 + 회차)
 *  v4: + images(이미지 정보) · imageData(이미지 바이트, 필요할 때만 읽음). 이미지는 동기화하지 않음
 */
const DB_NAME = "novel-generator";
let dbp: Promise<IDBDatabase> | null = null;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const done = (t: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("transaction aborted"));
  });

export function openDB(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 4);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("rooms")) d.createObjectStore("rooms", { keyPath: "id" });
        if (!d.objectStoreNames.contains("library")) d.createObjectStore("library", { keyPath: "id" });
        if (!d.objectStoreNames.contains("novels")) d.createObjectStore("novels", { keyPath: "id" });
        if (!d.objectStoreNames.contains("images")) d.createObjectStore("images", { keyPath: "id" });
        if (!d.objectStoreNames.contains("imageData")) d.createObjectStore("imageData");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

export async function loadAll(): Promise<{ kv: Record<string, unknown>; rooms: Room[]; library: Entity[]; novels: Novel[]; images: ImageMeta[] }> {
  const d = await openDB();
  const t = d.transaction(["kv", "rooms", "library", "novels", "images"], "readonly");
  const [keys, vals, rooms, library, novels, images] = await Promise.all([req(t.objectStore("kv").getAllKeys()), req(t.objectStore("kv").getAll()), req(t.objectStore("rooms").getAll()), req(t.objectStore("library").getAll()), req(t.objectStore("novels").getAll()), req(t.objectStore("images").getAll())]);
  const kv: Record<string, unknown> = {};
  keys.forEach((k, i) => (kv[String(k)] = vals[i]));
  return { kv, rooms: rooms as Room[], library: library as Entity[], novels: novels as Novel[], images: images as ImageMeta[] };
}

export async function deleteKV(key: string): Promise<void> {
  const d = await openDB();
  const t = d.transaction("kv", "readwrite");
  t.objectStore("kv").delete(key);
  await done(t);
}

export async function putKV(key: string, value: unknown): Promise<void> {
  const d = await openDB();
  const t = d.transaction("kv", "readwrite");
  t.objectStore("kv").put(value, key);
  await done(t);
}

export async function putRecords(store: "rooms" | "library" | "novels", records: { id: string }[], deleted: string[] = []): Promise<void> {
  if (!records.length && !deleted.length) return;
  const d = await openDB();
  const t = d.transaction(store, "readwrite");
  const os = t.objectStore(store);
  records.forEach((r) => os.put(r));
  deleted.forEach((id) => os.delete(id));
  await done(t);
}
export const putRooms = (rooms: Room[], deleted: string[] = []) => putRecords("rooms", rooms, deleted);

/* ---------------- 이미지 ---------------- */
/** 이미지 정보와 바이트를 함께 저장 (data가 없으면 정보만 갱신) */
export async function putImages(items: { meta: ImageMeta; data?: Uint8Array }[], deleted: string[] = []): Promise<void> {
  if (!items.length && !deleted.length) return;
  const d = await openDB();
  const t = d.transaction(["images", "imageData"], "readwrite");
  for (const { meta, data } of items) {
    t.objectStore("images").put(meta);
    // 바이트는 ArrayBuffer로 저장 (Safari 등에서 Blob 저장이 불안정한 경우가 있어서)
    if (data) t.objectStore("imageData").put(data.slice().buffer, meta.id);
  }
  for (const id of deleted) {
    t.objectStore("images").delete(id);
    t.objectStore("imageData").delete(id);
  }
  await done(t);
}
export async function getImageData(id: string): Promise<Uint8Array | null> {
  const d = await openDB();
  const v = await req(d.transaction("imageData", "readonly").objectStore("imageData").get(id));
  // instanceof 는 다른 실행 환경(realm)에서 만든 ArrayBuffer를 못 알아보므로 태그로 판별
  if (Object.prototype.toString.call(v) === "[object ArrayBuffer]") return new Uint8Array(v as ArrayBuffer);
  return ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;
}

/** 브라우저에 영구 저장 요청 (저장 공간 부족 시에도 데이터를 지우지 않도록) */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/* ---------------- 저장소 관리 ---------------- */
const byteLength = (v: unknown): number => {
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? "").length;
  } catch {
    return 0;
  }
};
/** kv 저장소 항목과 크기 (바이트) */
export async function listKV(): Promise<{ key: string; size: number }[]> {
  const d = await openDB();
  const t = d.transaction("kv", "readonly");
  const [keys, vals] = await Promise.all([req(t.objectStore("kv").getAllKeys()), req(t.objectStore("kv").getAll())]);
  return keys.map((k, i) => ({ key: String(k), size: byteLength(vals[i]) }));
}
/** 이미지 바이트 실제 크기 합계와, 정보 없이 남은 바이트(고아) id */
export async function scanImageData(knownIds: Set<string>): Promise<{ total: number; orphanIds: string[]; orphanSize: number }> {
  const d = await openDB();
  const os = d.transaction("imageData", "readonly").objectStore("imageData");
  const [keys, vals] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
  let total = 0;
  let orphanSize = 0;
  const orphanIds: string[] = [];
  keys.forEach((k, i) => {
    const n = byteLength(vals[i]);
    total += n;
    if (!knownIds.has(String(k))) {
      orphanIds.push(String(k));
      orphanSize += n;
    }
  });
  return { total, orphanIds, orphanSize };
}
export async function deleteImageData(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const d = await openDB();
  const t = d.transaction("imageData", "readwrite");
  ids.forEach((id) => t.objectStore("imageData").delete(id));
  await done(t);
}
/** 이 앱의 IndexedDB 전체 삭제 (초기화) */
export async function wipeDatabase(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = null;
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    r.onblocked = () => res(); // 다른 탭이 열려 있으면 그 탭이 닫힐 때 지워짐
  });
}
