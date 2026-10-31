import type { Room, Settings } from "./types";

export const BACKUP_APP = "novel-generator";

export function makeBackup(settings: Settings, rooms: Room[], withKeys: boolean) {
  const s = withKeys ? settings : { ...settings, keys: { gemini: "", anthropic: "", openai: "" } };
  return { app: BACKUP_APP, format: 1, exportedAt: new Date().toISOString(), settings: s, rooms };
}

export function isOwnBackup(j: unknown): j is ReturnType<typeof makeBackup> {
  return !!j && typeof j === "object" && (j as { app?: string }).app === BACKUP_APP && Array.isArray((j as { rooms?: unknown }).rooms);
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
