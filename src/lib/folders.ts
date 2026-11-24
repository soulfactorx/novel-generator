/**
 * 사이드바 폴더 · 자동 정리.
 * 폴더는 따로 저장하지 않고 이야기·소설 레코드의 folder(폴더 이름)로 표현한다.
 * → 레코드 단위 동기화에 그대로 실려 다른 기기에서도 같은 폴더로 보인다. (빈 폴더는 없음)
 *
 * folderAuto: true = 자동 정리가 넣음 · false = 사용자가 직접 정함(폴더 없음 포함) · 없음 = 아직 정하지 않음
 * 자동 정리는 사용자가 직접 정한 것은 건드리지 않는다 (보관함만 예외: 오래 안 쓰면 넣고, 다시 쓰면 원래 자리로).
 */
import type { Entity, Novel, OrganizeRule, Room } from "./types";

export const ARCHIVE = "🗄 보관함";
const DAY = 24 * 3600 * 1000;

export interface Foldered {
  id: string;
  folder?: string;
  folderAuto?: boolean;
  /** 보관함에 넣기 전 자리 (다시 쓰면 돌아감) */
  folderPrev?: { folder?: string; manual: boolean };
}
export type FolderPatch = Pick<Foldered, "folder" | "folderAuto" | "folderPrev">;

/** 폴더 이름 정리 (앞뒤 공백, 줄바꿈 제거, 너무 길면 자름) */
export const cleanFolderName = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 40);

/** 폴더 목록 (이름 순, 보관함은 맨 끝) + 폴더마다 항목 수 */
export function folderList(items: readonly Foldered[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) if (it.folder) m.set(it.folder, (m.get(it.folder) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === ARCHIVE ? 1 : b.name === ARCHIVE ? -1 : a.name.localeCompare(b.name, "ko", { numeric: true })));
}

/** 마지막으로 쓴 시각: 이야기는 마지막 메시지, 소설은 마지막 수정 */
export const roomActiveAt = (r: Room) => Math.max(r.createdAt, ...r.messages.map((m) => m.createdAt ?? 0));
export const novelActiveAt = (n: Novel) => n.updatedAt;

export interface OrganizeItem extends Foldered {
  activeAt: number;
  /** 기준에 따른 묶음 이름 (없으면 폴더 밖) */
  group?: string;
}

/** 기준에 따른 묶음 이름. 이야기·소설 공통 (등장인물은 첫 번째 인물) */
export function groupOf(rule: OrganizeRule["by"], x: { worldId?: string; characterIds: string[] }, lib: Record<string, Entity>, activeAt: number, now: number, done?: boolean): string | undefined {
  if (rule === "character") {
    const c = x.characterIds.map((id) => lib[id]).find(Boolean);
    return c ? `👤 ${c.name}` : undefined;
  }
  if (rule === "world") {
    const w = x.worldId ? lib[x.worldId] : undefined;
    return w ? `🌍 ${w.name}` : undefined;
  }
  if (rule === "activity") {
    const age = now - activeAt;
    return age < 7 * DAY ? "🕒 이번 주" : age < 30 * DAY ? "🕒 이번 달" : "🕒 그 전";
  }
  if (rule === "status") return done === undefined ? undefined : done ? "✅ 완결" : "✍️ 연재 중";
  return undefined;
}

/**
 * 자동 정리 계획: 바뀌는 항목만 돌려준다.
 * - 보관: archiveDays 일 넘게 안 쓴 것은 보관함으로 (직접 넣은 폴더도), 다시 쓰면(또는 보관을 끄면) 원래 자리로
 * - 기준: 아직 정하지 않았거나 자동으로 넣은 것만, 같은 묶음이 minGroup 개 이상일 때 그 폴더로 (최근 활동은 개수 상관없이)
 * - includeManual: 직접 정한 것까지 기준대로 다시 정리
 */
export function planOrganize(items: readonly OrganizeItem[], rule: OrganizeRule, now: number, o: { includeManual?: boolean; minGroup?: number } = {}): Map<string, FolderPatch> {
  const minGroup = rule.by === "activity" ? 1 : o.minGroup ?? 2;
  const out = new Map<string, FolderPatch>();
  const old = (it: OrganizeItem) => rule.archiveDays > 0 && now - it.activeAt > rule.archiveDays * DAY;
  // 1) 보관 · 보관에서 꺼내기 → 그 결과 상태로 이어서 기준 정리
  const state = items.map((it): OrganizeItem => {
    const archived = it.folder === ARCHIVE && it.folderAuto === true;
    if (!archived && it.folder !== ARCHIVE && old(it)) return { ...it, folder: ARCHIVE, folderAuto: true, folderPrev: { ...(it.folder ? { folder: it.folder } : {}), manual: it.folderAuto === false } };
    if (archived && !old(it)) {
      const p = it.folderPrev;
      return { ...it, folder: p?.folder, folderAuto: p ? (p.manual ? false : p.folder ? true : undefined) : undefined, folderPrev: undefined };
    }
    return it;
  });
  // 2) 기준에 따른 폴더 (보관함에 있는 것은 제외)
  const free = (it: OrganizeItem) => it.folder !== ARCHIVE && (o.includeManual || it.folderAuto !== false);
  const size = new Map<string, number>();
  for (const it of state) if (it.folder !== ARCHIVE && it.group) size.set(it.group, (size.get(it.group) ?? 0) + 1);
  const result = state.map((it) => {
    if (!free(it)) return it;
    const g = it.group && (size.get(it.group) ?? 0) >= minGroup ? it.group : undefined;
    if (!g) return it.folderAuto === true || (o.includeManual && it.folderAuto === false) ? { ...it, folder: undefined, folderAuto: undefined } : it;
    return { ...it, folder: g, folderAuto: true };
  });
  items.forEach((it, i) => {
    const r = result[i];
    if (r.folder !== it.folder || r.folderAuto !== it.folderAuto || JSON.stringify(r.folderPrev) !== JSON.stringify(it.folderPrev)) out.set(it.id, { folder: r.folder, folderAuto: r.folderAuto, folderPrev: r.folderPrev });
  });
  return out;
}

/** 레코드에 폴더 변경을 적용 (undefined 인 필드는 지운다) */
export function withFolder<T extends Foldered>(x: T, p: FolderPatch): T {
  const { folder: _f, folderAuto: _a, folderPrev: _p, ...rest } = x;
  return { ...rest, ...(p.folder ? { folder: p.folder } : {}), ...(p.folderAuto !== undefined ? { folderAuto: p.folderAuto } : {}), ...(p.folderPrev ? { folderPrev: p.folderPrev } : {}) } as T;
}
