import type { Entity, Room } from "./types";

/**
 * IndexedDB 저장소 — 레코드 단위로 바뀐 것만 저장
 *  v1: kv(설정 등) + rooms(이야기방)
 *  v2: + library(세계관·등장인물·주인공, kind 필드로 구분)
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
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("rooms")) d.createObjectStore("rooms", { keyPath: "id" });
        if (!d.objectStoreNames.contains("library")) d.createObjectStore("library", { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

export async function loadAll(): Promise<{ kv: Record<string, unknown>; rooms: Room[]; library: Entity[] }> {
  const d = await openDB();
  const t = d.transaction(["kv", "rooms", "library"], "readonly");
  const [keys, vals, rooms, library] = await Promise.all([req(t.objectStore("kv").getAllKeys()), req(t.objectStore("kv").getAll()), req(t.objectStore("rooms").getAll()), req(t.objectStore("library").getAll())]);
  const kv: Record<string, unknown> = {};
  keys.forEach((k, i) => (kv[String(k)] = vals[i]));
  return { kv, rooms: rooms as Room[], library: library as Entity[] };
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

export async function putRecords(store: "rooms" | "library", records: { id: string }[], deleted: string[] = []): Promise<void> {
  if (!records.length && !deleted.length) return;
  const d = await openDB();
  const t = d.transaction(store, "readwrite");
  const os = t.objectStore(store);
  records.forEach((r) => os.put(r));
  deleted.forEach((id) => os.delete(id));
  await done(t);
}
export const putRooms = (rooms: Room[], deleted: string[] = []) => putRecords("rooms", rooms, deleted);

/** 브라우저에 영구 저장 요청 (저장 공간 부족 시에도 데이터를 지우지 않도록) */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
