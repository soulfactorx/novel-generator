import type { Entity, Novel, Room, Settings } from "./types";

export const BACKUP_APP = "novel-generator";

/** format 1: settings + rooms (v0.1) / 2: + library (v0.2) / 3: + novels (v0.3~) */
export function makeBackup(settings: Settings, rooms: Room[], library: Entity[], withKeys: boolean, novels: Novel[] = []) {
  const s = withKeys ? settings : { ...settings, keys: { gemini: "", anthropic: "", openai: "" } };
  return { app: BACKUP_APP, format: 3, exportedAt: new Date().toISOString(), settings: s, rooms, library, novels };
}
export type Backup = ReturnType<typeof makeBackup>;

export function isOwnBackup(j: unknown): j is Backup {
  return !!j && typeof j === "object" && (j as { app?: string }).app === BACKUP_APP && Array.isArray((j as { rooms?: unknown }).rooms);
}
export const backupLibrary = (b: Backup): Entity[] => (Array.isArray(b.library) ? b.library.filter((e) => e && ["world", "character", "persona"].includes(e.kind)) : []);

export const backupNovels = (b: Backup): Novel[] => (Array.isArray(b.novels) ? b.novels.filter((n) => n && typeof n.id === "string") : []);

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
