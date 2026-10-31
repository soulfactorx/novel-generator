import type { Room } from "./types";

/** IndexedDB 저장소: kv(설정 등) + rooms(이야기방마다 1개 레코드 → 바뀐 방만 저장) */
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
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("rooms")) d.createObjectStore("rooms", { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

export async function loadAll(): Promise<{ kv: Record<string, unknown>; rooms: Room[] }> {
  const d = await openDB();
  const t = d.transaction(["kv", "rooms"], "readonly");
  const [keys, vals, rooms] = await Promise.all([req(t.objectStore("kv").getAllKeys()), req(t.objectStore("kv").getAll()), req(t.objectStore("rooms").getAll())]);
  const kv: Record<string, unknown> = {};
  keys.forEach((k, i) => (kv[String(k)] = vals[i]));
  return { kv, rooms: rooms as Room[] };
}

export async function putKV(key: string, value: unknown): Promise<void> {
  const d = await openDB();
  const t = d.transaction("kv", "readwrite");
  t.objectStore("kv").put(value, key);
  await done(t);
}

export async function putRooms(rooms: Room[], deleted: string[] = []): Promise<void> {
  if (!rooms.length && !deleted.length) return;
  const d = await openDB();
  const t = d.transaction("rooms", "readwrite");
  const os = t.objectStore("rooms");
  rooms.forEach((r) => os.put(r));
  deleted.forEach((id) => os.delete(id));
  await done(t);
}

/** 브라우저에 영구 저장 요청 (저장 공간 부족 시에도 데이터를 지우지 않도록) */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
