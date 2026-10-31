import type { Entity, Novel, Room, Settings } from "../types";

/** 동기화 대상 전체. 삭제는 tombstones(id → 삭제 시각)로 전달해 다른 기기에서 되살아나지 않게 함 */
export interface Snapshot {
  rooms: Record<string, Room>;
  library: Record<string, Entity>;
  novels: Record<string, Novel>;
  tombstones: Record<string, number>;
  settings?: { value: Partial<Settings>; updatedAt: number };
}
type Coll = "rooms" | "library" | "novels";
const COLLS: Coll[] = ["rooms", "library", "novels"];
export const TOMBSTONE_KEEP_MS = 180 * 24 * 3600 * 1000;

export interface MergeResult {
  merged: Snapshot;
  /** 이 기기에 반영할 변경 */
  local: { put: { rooms: Room[]; library: Entity[]; novels: Novel[] }; del: { rooms: string[]; library: string[]; novels: string[] }; settings?: Partial<Settings>; tombstonesChanged: boolean };
  /** 원격(Gist)에 다시 써야 하는지 */
  remoteChanged: boolean;
}

const empty = (): Snapshot => ({ rooms: {}, library: {}, novels: {}, tombstones: {} });

/**
 * 레코드 단위 병합: 같은 id 는 updatedAt 이 더 큰 쪽, 삭제 기록이 레코드보다 나중이면 삭제.
 * (같은 이야기를 두 기기에서 동시에 고치면 나중에 저장된 쪽이 남음)
 */
export function mergeSnapshots(local: Snapshot, remoteIn: Snapshot | null, now = Date.now()): MergeResult {
  const remote = remoteIn ?? empty();
  const tomb: Record<string, number> = {};
  for (const src of [local.tombstones, remote.tombstones])
    for (const [id, t] of Object.entries(src ?? {})) if (now - t < TOMBSTONE_KEEP_MS) tomb[id] = Math.max(tomb[id] ?? 0, t);
  const merged = empty();
  merged.tombstones = tomb;
  const res: MergeResult = { merged, local: { put: { rooms: [], library: [], novels: [] }, del: { rooms: [], library: [], novels: [] }, tombstonesChanged: false }, remoteChanged: !remoteIn };
  for (const c of COLLS) {
    const L = local[c] as Record<string, { updatedAt: number }>;
    const R = (remote[c] ?? {}) as Record<string, { updatedAt: number }>;
    const out = merged[c] as Record<string, { updatedAt: number }>;
    for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) {
      const l = L[id], r = R[id];
      const pick = !l ? r : !r ? l : (r.updatedAt ?? 0) > (l.updatedAt ?? 0) ? r : l;
      const dead = tomb[id] !== undefined && tomb[id] >= (pick.updatedAt ?? 0);
      if (dead) {
        if (l) (res.local.del[c] as string[]).push(id);
        if (r) res.remoteChanged = true;
        continue;
      }
      out[id] = pick;
      // 객체가 달라도 updatedAt 이 같으면 같은 버전으로 봄 (불필요한 쓰기 방지)
      if (!l || (l.updatedAt ?? 0) !== (pick.updatedAt ?? 0)) (res.local.put[c] as unknown[]).push(pick);
      if (!r || (r.updatedAt ?? 0) !== (pick.updatedAt ?? 0)) res.remoteChanged = true;
    }
  }
  const tk = (o: Record<string, number>) => JSON.stringify(Object.entries(o ?? {}).sort());
  if (tk(tomb) !== tk(remote.tombstones)) res.remoteChanged = true;
  if (tk(tomb) !== tk(local.tombstones)) res.local.tombstonesChanged = true;
  const ls = local.settings, rs = remote.settings;
  if (rs && (!ls || rs.updatedAt > ls.updatedAt)) {
    merged.settings = rs;
    res.local.settings = rs.value;
  } else {
    merged.settings = ls;
    if (ls && (!rs || ls.updatedAt > rs.updatedAt)) res.remoteChanged = true;
  }
  return res;
}
