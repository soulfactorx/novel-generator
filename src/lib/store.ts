import { useSyncExternalStore } from "react";
import { CHOICE_MARKER, previewText, splitChoices } from "./choices";
import { deleteKV, getImageData, loadAll, putImages, putKV, putRecords, requestPersist, wipeDatabase } from "./db";
import { hasOwnImageRules, imagePool, imagePromptSection, runScripts, shrinkImage, sniffMedia, uniqueName, type ImagePool } from "./images";
import { uid } from "./id";
import { libraryFromExtra, type LegacyImport } from "./importLegacy";
import { greetingRoom, type RisuImage, type RisuImport } from "./risu";
import { buildEnv, cbs, chatIndexOf, processContext, processMessages, type EnvInput } from "./risuRuntime";
import { formatLore, matchLore, type LoreHit } from "./lore";
import { buildMemoryRequest, cleanMemory, pendingForMemory } from "./memory";
import { botHandlesChoices, buildHistory, buildSystemPrompt, foldRequest, instructionsOf, outputTokensFor, type StoryContext } from "./prompt";
import { P, setPromptOverrides } from "./prompts";
import { generate, ProviderError, type GenerateRequest, type GenerateResult, type Usage } from "./providers";
import { emptyUsage, recordUsage, type UsageData, type UsageKind } from "./usage";
import { buildEpisodeDiagnosis, buildRoomDiagnosis, splitDiagnosis } from "./diagnose";
import { decodePayload, encodePayload } from "./sync/codec";
import { GistClient, GistError } from "./sync/gist";
import { mergeSnapshots, type Snapshot } from "./sync/merge";
import { PROVIDER_LABEL } from "./providers/catalog";
import { buildEpisodeRequest, buildOutlineRequest, EPISODE_LENGTH, parseOutline, previewEpisode, splitEpisode } from "./novel";
import { DEFAULT_SETTINGS, type MessageUsage, normalizeNovel, normalizeRoom, normalizeSettings, type Character, type Entity, type EntityKind, type Episode, type ImageMeta, type Message, type Novel, type Persona, type Room, type Settings, type World } from "./types";

export interface LiveState {
  roomId: string;
  text: string;
  thinking: string;
  status: string;
  startedAt: number;
  lore: LoreHit[];
}
export interface AppState {
  ready: boolean;
  storageError: string;
  settings: Settings;
  rooms: Record<string, Room>;
  library: Record<string, Entity>;
  activeRoomId: string | null;
  live: LiveState | null;
  memoryJob: { roomId: string; error?: string } | null;
  lastUsage: (Usage & { model: string }) | null;
  legacyExtra: LegacyImport["extra"] | null;
  view: "rooms" | "novels";
  novels: Record<string, Novel>;
  activeNovelId: string | null;
  novelLive: NovelLive | null;
  novelError: { novelId: string; message: string } | null;
  usage: UsageData;
  sync: SyncStatus;
  images: Record<string, ImageMeta>; // 이미지 정보 (바이트는 필요할 때 IndexedDB에서)
  globals: Record<string, string>; // RisuAI 전역 변수 (토글: toggle_키) — 이 기기에 저장
  risuDialog: RisuDialog | null; // 봇(Lua·트리거)이 띄운 알림·입력 창
  risuTick: number; // 봇이 화면 다시 그리기를 요청할 때 증가
  lastRequest: LastRequest | null; // 마지막으로 AI에게 보낸 요청 (설정 → 프롬프트에서 확인, 저장하지 않음)
}
export type RisuDialog =
  | { kind: "normal" | "error"; message: string; resolve: () => void }
  | { kind: "input"; message: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; resolve: (v: boolean) => void }
  | { kind: "select"; message: string; options: string[]; resolve: (v: string | null) => void };
export interface SyncStatus {
  connected: boolean;
  auto: boolean;
  encrypted: boolean;
  running: boolean;
  login?: string;
  gistUrl?: string;
  lastSyncAt?: number;
  lastResult?: string;
  error?: string;
}
interface SyncConfig {
  token: string;
  passphrase: string;
  auto: boolean;
  gistId?: string;
  gistUrl?: string;
  login?: string;
  lastSyncAt?: number;
  device: string;
}
export interface NovelLive {
  novelId: string;
  task: "outline" | "episode";
  index: number; // 쓰는 중인 회차 (0부터)
  until?: number; // 연속 집필 목표 (이 회차까지)
  text: string;
  thinking: string;
  status: string;
  startedAt: number;
}

let state: AppState = { ready: false, storageError: "", settings: DEFAULT_SETTINGS, rooms: {}, library: {}, activeRoomId: null, live: null, memoryJob: null, lastUsage: null, legacyExtra: null, view: "rooms", novels: {}, activeNovelId: null, novelLive: null, novelError: null, usage: emptyUsage(), sync: { connected: false, auto: false, encrypted: false, running: false }, images: {}, globals: {}, risuDialog: null, risuTick: 0, lastRequest: null };
const subs = new Set<() => void>();
const dirty = { rooms: new Set<string>(), library: new Set<string>(), novels: new Set<string>() };
const deleted = { rooms: new Set<string>(), library: new Set<string>(), novels: new Set<string>() };
let settingsDirty = false;
let usageDirty = false;
/* 동기화용: 삭제 기록 · 설정 수정 시각 (kv "syncMeta") */
let tombstones: Record<string, number> = {};
let settingsUpdatedAt = 0;
let syncMetaDirty = false;
let syncConfig: SyncConfig | null = null;
let applyingRemote = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function markSyncDirty() {
  if (applyingRemote || !syncConfig?.auto) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), 45_000);
}
function addTombstone(id: string) {
  tombstones[id] = Date.now();
  syncMetaDirty = true;
  markSyncDirty();
}
/** 백업 복원 등으로 지웠던 항목을 다시 넣는 경우: 삭제 기록보다 새 것으로 만들어 동기화 때 다시 지워지지 않게 */
function revive<T extends { id: string; updatedAt: number }>(r: T): T {
  if (tombstones[r.id] === undefined) return r;
  delete tombstones[r.id];
  syncMetaDirty = true;
  return { ...r, updatedAt: Math.max(r.updatedAt, Date.now()) };
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;

export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const prevPrompts = state.settings.prompts;
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  if (state.settings.prompts !== prevPrompts) setPromptOverrides(state.settings.prompts); // 설정 → 프롬프트에서 바꾼 문구
  subs.forEach((f) => f());
}
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

/* ---------------- 저장 ---------------- */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 300);
}
export async function flush() {
  clearTimeout(saveTimer);
  const take = <T,>(set: Set<string>, pick: (id: string) => T | undefined) => {
    const ids = [...set];
    set.clear();
    return { ids, items: ids.map(pick).filter((x): x is T => !!x) };
  };
  const rooms = take(dirty.rooms, (id) => state.rooms[id]);
  const lib = take(dirty.library, (id) => state.library[id]);
  const nov = take(dirty.novels, (id) => state.novels[id]);
  const delRooms = [...deleted.rooms];
  const delLib = [...deleted.library];
  const delNov = [...deleted.novels];
  deleted.rooms.clear();
  deleted.library.clear();
  deleted.novels.clear();
  const saveSettings = settingsDirty;
  settingsDirty = false;
  const saveUsage = usageDirty;
  usageDirty = false;
  const saveSyncMeta = syncMetaDirty;
  syncMetaDirty = false;
  try {
    await putRecords("rooms", rooms.items, delRooms);
    await putRecords("library", lib.items, delLib);
    await putRecords("novels", nov.items, delNov);
    if (saveSettings) await putKV("settings", state.settings);
    if (saveUsage) await putKV("usage", state.usage);
    if (saveSyncMeta) await putKV("syncMeta", { tombstones, settingsUpdatedAt });
    if (state.storageError) setState({ storageError: "" });
  } catch (e) {
    rooms.ids.forEach((id) => dirty.rooms.add(id));
    lib.ids.forEach((id) => dirty.library.add(id));
    nov.ids.forEach((id) => dirty.novels.add(id));
    delNov.forEach((id) => deleted.novels.add(id));
    delRooms.forEach((id) => deleted.rooms.add(id));
    delLib.forEach((id) => deleted.library.add(id));
    settingsDirty ||= saveSettings;
    usageDirty ||= saveUsage;
    syncMetaDirty ||= saveSyncMeta;
    setState({ storageError: `저장 실패: ${(e as Error)?.message || e}` });
    saveTimer = setTimeout(() => void flush(), 3000);
  }
}
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
    // 다른 기기에서 쓰다 돌아온 경우를 위해, 다시 볼 때 2분 이상 지났으면 동기화
    else if (syncConfig?.auto && Date.now() - (syncConfig.lastSyncAt ?? 0) > 120_000) void syncNow();
  });

export async function init() {
  try {
    const { kv, rooms, library, novels, images } = await loadAll();
    const imap: Record<string, ImageMeta> = {};
    images.forEach((m) => (imap[m.id] = m));
    const nmap: Record<string, Novel> = {};
    novels.forEach((n) => (nmap[n.id] = normalizeNovel(n)));
    const recentNovel = Object.values(nmap).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const map: Record<string, Room> = {};
    rooms.forEach((r) => (map[r.id] = normalizeRoom(r)));
    const lib: Record<string, Entity> = {};
    library.forEach((e) => (lib[e.id] = e));
    const recent = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const extra = (kv.legacyExtra as LegacyImport["extra"]) || null;
    const sm = kv.syncMeta as { tombstones?: Record<string, number>; settingsUpdatedAt?: number } | undefined;
    tombstones = { ...(sm?.tombstones ?? {}) };
    // 동기화 이전부터 쓰던 기기: 저장된 설정이 있으면 기본값(0)보다 우선하도록 1
    settingsUpdatedAt = sm?.settingsUpdatedAt ?? (kv.settings ? 1 : 0);
    syncConfig = (kv.sync as SyncConfig) || null;
    setState({ ready: true, settings: normalizeSettings(kv.settings), rooms: map, library: lib, activeRoomId: recent?.id ?? null, novels: nmap, activeNovelId: recentNovel?.id ?? null, view: kv.view === "novels" ? "novels" : "rooms", usage: (kv.usage as UsageData)?.days ? (kv.usage as UsageData) : emptyUsage(), legacyExtra: extra && (extra.worlds?.length || extra.characters?.length || extra.personas?.length) ? extra : null, images: imap, globals: (kv.risuGlobals as Record<string, string>) ?? {} });
    setSyncStatus();
    void requestPersist();
    if (syncConfig?.auto) syncTimer = setTimeout(() => void syncNow(), 1500);
  } catch (e) {
    setState({ ready: true, storageError: `브라우저 저장소(IndexedDB)를 열 수 없습니다: ${(e as Error)?.message || e}. 이 상태에서는 데이터가 저장되지 않습니다.` });
  }
}

/* ---------------- 설정 · 이야기방 ---------------- */
const syncedSettings = (s: Settings): Partial<Settings> => {
  const { keys: _k, ...rest } = s; // API 키는 기기마다 따로 (동기화하지 않음)
  return rest;
};
export function updateSettings(patch: Partial<Settings>) {
  const before = JSON.stringify(syncedSettings(state.settings));
  setState((s) => ({ settings: normalizeSettings({ ...s.settings, ...patch }) }));
  settingsDirty = true;
  if (JSON.stringify(syncedSettings(state.settings)) !== before) {
    settingsUpdatedAt = Date.now();
    syncMetaDirty = true;
    markSyncDirty();
  }
  scheduleSave();
}

function putRoom(room: Room) {
  setState((s) => ({ rooms: { ...s.rooms, [room.id]: room } }));
  dirty.rooms.add(room.id);
  markSyncDirty();
  scheduleSave();
}
export function updateRoom(id: string, patch: Partial<Room>) {
  const r = state.rooms[id];
  if (r) putRoom({ ...r, ...patch, updatedAt: Date.now() });
}
export interface NewRoom {
  title?: string;
  premise?: string;
  worldId?: string;
  characterIds?: string[];
  personaId?: string;
  greeting?: string; // 첫 메시지(인사말)로 시작
}
export function createRoom(opts: NewRoom = {}): string {
  const now = Date.now();
  const messages: Message[] = opts.greeting?.trim() ? [{ id: uid("m"), role: "assistant", text: opts.greeting.trim(), greeting: true, createdAt: now }] : [];
  const room: Room = { id: uid("r"), title: opts.title?.trim() || "새 이야기", premise: opts.premise ?? "", memory: "", messages, createdAt: now, updatedAt: now, characterIds: opts.characterIds ?? [], ...(opts.worldId ? { worldId: opts.worldId } : {}), ...(opts.personaId ? { personaId: opts.personaId } : {}) };
  putRoom(room);
  setState({ activeRoomId: room.id });
  return room.id;
}
export function deleteRoom(id: string) {
  setState((s) => {
    const { [id]: _, ...rest } = s.rooms;
    const next = Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return { rooms: rest, activeRoomId: s.activeRoomId === id ? next?.id ?? null : s.activeRoomId };
  });
  dirty.rooms.delete(id);
  deleted.rooms.add(id);
  addTombstone(id);
  scheduleSave();
}
export const selectRoom = (id: string | null) => setState({ activeRoomId: id });

export function deleteMessage(roomId: string, msgId: string) {
  const r = state.rooms[roomId];
  if (r) updateRoom(roomId, { messages: r.messages.filter((m) => m.id !== msgId) });
}
export function editMessage(roomId: string, msgId: string, text: string) {
  const r = state.rooms[roomId];
  if (r) updateRoom(roomId, { messages: r.messages.map((m) => (m.id === msgId ? { ...m, text } : m)) });
}

/** 백업 복원: 같은 id 는 덮어쓰고 나머지는 추가 */
export function upsertRooms(rooms: Room[]) {
  rooms.forEach((r) => putRoom(revive(normalizeRoom(r))));
}

/* ---------------- 라이브러리 ---------------- */
export function putEntity(e: Entity) {
  setState((s) => ({ library: { ...s.library, [e.id]: e } }));
  dirty.library.add(e.id);
  markSyncDirty();
  scheduleSave();
}
export function updateEntity<T extends Entity>(id: string, patch: Partial<T>) {
  const e = state.library[id];
  if (e) putEntity({ ...e, ...patch, updatedAt: Date.now() } as Entity);
}
export function createEntity(kind: EntityKind, name = ""): string {
  const now = Date.now();
  const base = { id: uid(kind[0]), createdAt: now, updatedAt: now };
  const e: Entity =
    kind === "world"
      ? { ...base, kind, name: name || "새 세계관", description: "", rules: "", lore: [] }
      : kind === "character"
        ? { ...base, kind, name: name || "새 인물", summary: "", profile: "", speech: "", lore: [] }
        : { ...base, kind, name: name || "새 주인공", profile: "" };
  putEntity(e);
  return e.id;
}
/** 삭제 시 이야기방의 연결도 함께 해제 */
export function deleteEntity(id: string) {
  setState((s) => {
    const { [id]: _, ...rest } = s.library;
    return { library: rest };
  });
  dirty.library.delete(id);
  deleted.library.add(id);
  addTombstone(id);
  for (const r of Object.values(state.rooms)) {
    if (r.worldId === id || r.personaId === id || r.characterIds.includes(id))
      putRoom({ ...r, worldId: r.worldId === id ? undefined : r.worldId, personaId: r.personaId === id ? undefined : r.personaId, characterIds: r.characterIds.filter((c) => c !== id) });
  }
  for (const e of Object.values(state.library)) if (e.kind === "character" && e.worldId === id) putEntity({ ...e, worldId: undefined });
  const imgs = Object.values(state.images).filter((m) => m.ownerId === id).map((m) => m.id);
  if (imgs.length) void deleteImages(imgs);
  for (const n of Object.values(state.novels))
    if (n.worldId === id || n.personaId === id || n.characterIds.includes(id))
      putNovel({ ...n, worldId: n.worldId === id ? undefined : n.worldId, personaId: n.personaId === id ? undefined : n.personaId, characterIds: n.characterIds.filter((c) => c !== id) });
  scheduleSave();
}
export function upsertLibrary(items: Entity[]) {
  items.forEach((e) => putEntity(revive(e)));
}
export const entitiesOf = <K extends EntityKind>(lib: Record<string, Entity>, kind: K) =>
  (Object.values(lib).filter((e) => e.kind === kind) as Extract<Entity, { kind: K }>[]).sort((a, b) => a.name.localeCompare(b.name, "ko"));

export function contextFor(room: Pick<Room, "worldId" | "personaId" | "characterIds">, lib = state.library): StoryContext {
  const w = room.worldId ? lib[room.worldId] : undefined;
  const p = room.personaId ? lib[room.personaId] : undefined;
  return {
    world: w?.kind === "world" ? (w as World) : undefined,
    persona: p?.kind === "persona" ? (p as Persona) : undefined,
    characters: room.characterIds.map((id) => lib[id]).filter((c): c is Character => c?.kind === "character"),
  };
}

export function importLegacy(data: LegacyImport, withKeys: boolean) {
  upsertLibrary(data.library);
  upsertNovels(data.novels);
  data.rooms.forEach((r) => putRoom(r));
  if (withKeys && data.settingsPatch.keys) updateSettings({ keys: { ...state.settings.keys, ...data.settingsPatch.keys }, ...(data.settingsPatch.openaiBaseUrl ? { openaiBaseUrl: data.settingsPatch.openaiBaseUrl } : {}) });
  if (data.rooms[0]) setState({ activeRoomId: data.rooms[0].id });
}
/** RisuAI 파일(charx · risum · json · png) 가져오기. greeting: 첫 메시지(인사말) 번호로 새 이야기 시작 */
/** 이미 가져온 같은 패키지 (같은 종류·같은 이름이고 RisuAI에서 가져온 것) */
export function existingPackages(data: Pick<RisuImport, "library">): { incoming: string; existing: Character | World }[] {
  const out: { incoming: string; existing: Character | World }[] = [];
  for (const e of data.library) {
    if (e.kind === "persona") continue;
    const hit = Object.values(state.library).find((x) => x.kind === e.kind && x.name === e.name && x.id !== e.id && (x as Character | World).source?.kind === "risu") as Character | World | undefined;
    if (hit) out.push({ incoming: e.id, existing: hit });
  }
  return out;
}

/**
 * RisuAI 패키지 가져오기. replace: 이미 가져온 같은 패키지를 새 내용으로 교체
 * (id는 그대로 두어 그 패키지를 쓰던 이야기·소설의 연결이 유지됨, 이미지는 새 것으로 바꿈)
 */
export async function importRisu(data: RisuImport, opts: { greeting?: number; replace?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<{ room: string | null; images: number; replaced: number }> {
  const idMap = new Map<string, string>();
  let replaced = 0;
  if (opts.replace)
    for (const { incoming, existing } of existingPackages(data)) {
      idMap.set(incoming, existing.id);
      const old = Object.values(state.images).filter((m) => m.ownerId === existing.id).map((m) => m.id);
      if (old.length) await deleteImages(old);
      replaced++;
    }
  if (idMap.size) {
    const keep = (e: Entity) => state.library[idMap.get(e.id)!] as Character | World;
    data = {
      ...data,
      library: data.library.map((e) => (idMap.has(e.id) ? ({ ...e, id: idMap.get(e.id)!, createdAt: keep(e).createdAt, ...(e.kind === "character" && keep(e).kind === "character" && (keep(e) as Character).worldId ? { worldId: (keep(e) as Character).worldId } : {}) } as Entity) : e)),
      images: data.images.map((x) => (idMap.has(x.ownerId) ? { ...x, ownerId: idMap.get(x.ownerId)! } : x)),
      ...(data.greeting ? { greeting: { ...data.greeting, characterId: idMap.get(data.greeting.characterId) ?? data.greeting.characterId } } : {}),
    };
  }
  upsertLibrary(data.library);
  const images = await addImages(data.images, opts.onProgress);
  data.rooms.forEach((r) => putRoom(r));
  let open: string | null = data.rooms[0]?.id ?? null;
  if (data.greeting && opts.greeting !== undefined) {
    const r = greetingRoom(data.greeting, opts.greeting);
    putRoom(r);
    open = r.id;
  }
  if (open) setState({ activeRoomId: open, view: "rooms" });
  return { room: open, images, replaced };
}

/* ---------------- 이미지 (RisuAI 에셋 · 감정 이미지) ---------------- */
/** 이미지 저장. 그림이 아닌 파일은 건너뛰고, 같은 주인 안에서 이름이 겹치면 _2 … 를 붙인다. 저장한 개수를 돌려준다 */
export async function addImages(list: Pick<RisuImage, "ownerId" | "name" | "kind" | "load">[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const items: { meta: ImageMeta; data: Uint8Array }[] = [];
  const taken = new Map<string, string[]>();
  const namesOf = (owner: string) => taken.get(owner) ?? (taken.set(owner, Object.values(state.images).filter((m) => m.ownerId === owner).map((m) => m.name)), taken.get(owner)!);
  let done = 0;
  for (const it of list) {
    if (onProgress && (done++ % 10 === 0 || done === list.length)) {
      onProgress(done, list.length);
      await new Promise((r) => setTimeout(r, 0)); // 화면이 진행률을 그릴 틈
    }
    let raw: Uint8Array | null = null;
    try {
      raw = await it.load();
    } catch {
      raw = null;
    }
    const mime = raw && sniffMedia(raw, it.name.split(".").pop() ?? "");
    if (!raw || !mime) continue;
    const { bytes, mime: m2 } = mime.startsWith("image/") ? await shrinkImage(raw, mime) : { bytes: raw, mime }; // 소리·영상은 그대로
    const names = namesOf(it.ownerId);
    const name = uniqueName(it.name, names);
    names.push(name);
    const now = Date.now();
    items.push({ meta: { id: uid("i"), ownerId: it.ownerId, name, kind: it.kind, mime: m2, size: bytes.length, createdAt: now + items.length, updatedAt: now }, data: bytes });
  }
  if (!items.length) return 0;
  try {
    // 한 번에 너무 크게 쓰지 않도록 나눠서 저장
    for (let i = 0; i < items.length; i += 40) await putImages(items.slice(i, i + 40));
  } catch (e) {
    setState({ storageError: `이미지 저장 실패: ${(e as Error)?.message || e}` });
    return 0;
  }
  setState((st) => ({ images: { ...st.images, ...Object.fromEntries(items.map((x) => [x.meta.id, x.meta])) } }));
  return items.length;
}
export async function renameImage(id: string, name: string, kind?: ImageMeta["kind"]) {
  const m = state.images[id];
  if (!m) return;
  const others = Object.values(state.images).filter((x) => x.ownerId === m.ownerId && x.id !== id).map((x) => x.name);
  const next: ImageMeta = { ...m, name: uniqueName(name, others), ...(kind ? { kind } : {}), updatedAt: Date.now() };
  setState((st) => ({ images: { ...st.images, [id]: next } }));
  await putImages([{ meta: next }]).catch((e) => setState({ storageError: `이미지 저장 실패: ${(e as Error)?.message || e}` }));
}
export async function deleteImages(ids: string[]) {
  setState((st) => {
    const images = { ...st.images };
    ids.forEach((id) => delete images[id]);
    return { images };
  });
  await putImages([], ids).catch(() => {});
}
export const loadImageData = (id: string) => getImageData(id);
/* ---------------- RisuAI 변수 · CBS ---------------- */
/** 인사말을 뺀 대화 수 = 다음 메시지의 대화 번호 */
const splitRest = (r: Pick<Room, "messages">) => r.messages.filter((m) => !m.greeting && !m.error).length;
/** 이야기방의 CBS 환경 (vars를 주면 그 객체에 기록, 아니면 이야기 변수의 복사본) */
export function envFor(room: Pick<Room, "worldId" | "personaId" | "characterIds" | "messages" | "id"> & { vars?: Record<string, string> }, o: Partial<EnvInput> = {}) {
  return buildEnv({ ctx: contextFor(room), messages: room.messages, vars: o.vars ?? { ...(room.vars ?? {}) }, globals: state.globals, images: Object.values(state.images), seed: room.id, version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "", ...o });
}
export const cbsFor = (room: Parameters<typeof envFor>[0], o: Partial<EnvInput> = {}) => {
  const env = envFor(room, o);
  return (t: string) => cbs(t, env);
};
/** 화면 표시용 CBS 함수 (메시지마다 자기 대화 번호, 변수는 지우기만). 같은 이야기·변수·토글이면 재사용 */
const displayCache = new WeakMap<object, { globals: object; library: object; risuOn: boolean; fns: Map<string, (t: string) => string> }>();
export function displayCbs(room: Room, msgId: string | null): ((t: string) => string) | undefined {
  if (!state.settings.risu.cbs) return undefined;
  let c = displayCache.get(room);
  if (!c || c.globals !== state.globals || c.library !== state.library || !c.risuOn) displayCache.set(room, (c = { globals: state.globals, library: state.library, risuOn: true, fns: new Map() }));
  const key = msgId ?? "__live__";
  let fn = c.fns.get(key);
  if (!fn) {
    const chatIndex = msgId === null ? splitRest(room) : chatIndexOf(room.messages, msgId);
    const env = envFor(room, { chatIndex, rmVar: true, displaying: true });
    // 인사말은 RisuAI에서 firstmsg(역할 char), 생성 중인 응답도 char
    const msg = msgId === null ? null : room.messages.find((m) => m.id === msgId);
    if (msg?.greeting) env.firstMsg = true;
    else if (msgId === null) env.role = "char";
    fn = (t: string) => cbs(t, env);
    c.fns.set(key, fn);
  }
  return fn;
}

/** 이야기에 연결된 봇의 온보딩(시작 설정 화면) — 꺼져 있거나 내용이 없으면 null */
export function onboardingFor(room: Pick<Room, "worldId" | "personaId" | "characterIds">): { owner: Character | World; onboarding: NonNullable<Character["risu"]>["onboarding"] & object } | null {
  const ctx = contextFor(room);
  for (const o of [...ctx.characters, ...(ctx.world ? [ctx.world] : [])]) {
    const ob = o.risu?.onboarding;
    if (ob?.enabled && (ob.mode === "html" ? ob.html.trim() : ob.questions.length)) return { owner: o, onboarding: ob };
  }
  return null;
}
/** 온보딩 답을 이야기 변수에 기록하고 마침 표시 */
export function completeOnboarding(roomId: string, answers: Record<string, string>) {
  const r = state.rooms[roomId];
  if (!r) return;
  const vars = { ...(r.vars ?? {}) };
  for (const [k, v] of Object.entries(answers)) if (k) vars[k] = v;
  updateRoom(roomId, { vars, onboardingDone: true });
}

/** 봇 버튼(risu-trigger · risu-btn) 실행 */
export async function runRisuTrigger(roomId: string, name: string, id: string | null, meta?: object): Promise<void> {
  await runRoomTrigger(roomId, "manual", { manualName: name, triggerId: id, meta });
}

/* ---------------- RisuAI 트리거 · Lua ---------------- */
/** 봇이 띄우는 알림·입력 창 (화면의 RisuDialogView가 보여 줌) */
function askDialog<T>(d: (resolve: (v: T) => void) => RisuDialog): Promise<T> {
  return new Promise<T>((resolve) => setState({ risuDialog: d((v: T) => (setState({ risuDialog: null }), resolve(v))) }));
}
function triggersOf(room: Pick<Room, "worldId" | "personaId" | "characterIds">) {
  const ctx = contextFor(room);
  const owners = [...ctx.characters, ...(ctx.world ? [ctx.world] : [])];
  return owners.flatMap((o) => (o.risu?.triggers ?? []).map((t) => ({ ...(t as object), lowLevelAccess: !!o.risu?.lowLevelAccess }) as { comment?: string; type?: string; conditions?: unknown[]; effect?: { type?: string; code?: string }[]; lowLevelAccess: boolean }));
}
/** 이야기방 → Lua·트리거가 다루는 형태 (첫 메시지 제외, 변수는 vars 객체에 기록) */
function hostFor(room: Room, vars: Record<string, string>) {
  const ctx = contextFor(room);
  const { first, rest } = splitGreetingRoom(room);
  const env = envFor(room, { vars });
  const c0 = ctx.characters[0];
  return {
    chat: rest.map((m) => ({ role: (m.role === "user" ? "user" : "char") as "user" | "char", data: m.text, time: m.createdAt })),
    getVar: (k: string) => env.getVar(k),
    setVar: (k: string, v: string) => {
      const changed = vars[k] !== v;
      vars[k] = v;
      return changed;
    },
    getGlobal: (k: string) => state.globals[k] ?? "null",
    cbs: (t: string) => cbs(t, env),
    alertNormal: (message: string) => void askDialog<void>((resolve) => ({ kind: "normal", message, resolve })),
    alertError: (message: string) => void askDialog<void>((resolve) => ({ kind: "error", message, resolve })),
    alertInput: (message: string) => askDialog<string | null>((resolve) => ({ kind: "input", message, resolve })),
    alertSelect: (options: string[]) => askDialog<string | null>((resolve) => ({ kind: "select", message: "선택하세요", options, resolve })),
    alertConfirm: (message: string) => askDialog<boolean>((resolve) => ({ kind: "confirm", message, resolve })),
    reload: () => setState((st) => ({ risuTick: st.risuTick + 1 })),
    name: c0?.name,
    description: c0?.profile,
    firstMessage: first?.text ?? c0?.greetings?.[0],
    personaName: ctx.persona?.name,
    personaDescription: ctx.persona?.profile,
    authorsNote: room.premise,
    backgroundEmbedding: c0?.risu?.backgroundHTML,
    lore: [...ctx.characters, ...(ctx.world ? [ctx.world] : [])].flatMap((c) => c.lore.map((l) => ({ comment: l.title, content: l.content, key: l.keys.join(", "), alwaysActive: !!l.always, ...(l.enabled === false ? { enabled: false } : {}), ...(l.secondKeys?.length ? { selective: true, secondkey: l.secondKeys.join(", ") } : {}), ...(l.order ? { insertorder: l.order } : {}) }))),
    llm: async (prompt: { role: string; content: string }[]) => {
      const sys = prompt.filter((p) => p.role === "system").map((p) => p.content).join("\n\n");
      const res = await callAI("chat", { system: sys, messages: prompt.filter((p) => p.role !== "system").map((p) => ({ role: p.role === "user" ? "user" : "assistant", content: p.content })) as { role: "user" | "assistant"; content: string }[], maxTokens: 4000 });
      return res.text;
    },
  };
}
const splitGreetingRoom = (room: Pick<Room, "messages">) => {
  const first = room.messages[0]?.greeting ? room.messages[0] : undefined;
  return { first, rest: room.messages.filter((m) => m !== first && !m.error) };
};
/** Lua·트리거가 바꾼 대화를 이야기방 메시지로 (같은 자리·같은 역할이면 기존 메시지를 고쳐 id·사용량 등 유지) */
function applyChat(room: Room, chat: { role: "user" | "char"; data: string }[]): Message[] {
  const { first, rest } = splitGreetingRoom(room);
  const errors = room.messages.filter((m) => m.error);
  const out: Message[] = chat.map((c, i) => {
    const old = rest[i];
    const role = c.role === "user" ? "user" : "assistant";
    if (old && old.role === role) return old.text === c.data ? old : { ...old, text: c.data };
    return { id: uid("m"), role, text: c.data, createdAt: (rest[rest.length - 1]?.createdAt ?? Date.now()) + i + 1 };
  });
  return [...(first ? [first] : []), ...out, ...errors];
}

export interface TriggerRun {
  stop: boolean;
  systemPrompt?: { start: string; historyend: string; promptend: string };
}
/**
 * 이야기방의 RisuAI 트리거 실행 (Lua + 블록 트리거).
 * mode: start(보내기 직전) · input(내 입력 후) · output(응답 후) · manual(버튼)
 */
export async function runRoomTrigger(roomId: string, mode: "start" | "input" | "output" | "manual", arg: { manualName?: string; triggerId?: string | null; meta?: object } = {}): Promise<TriggerRun> {
  const room = state.rooms[roomId];
  const s = state.settings.risu;
  if (!room) return { stop: false };
  const triggers = triggersOf(room);
  if (!triggers.length || (!s.triggers && !s.lua)) return { stop: false };
  const vars = { ...(room.vars ?? {}) };
  const host = hostFor(room, vars);
  let stop = false;
  let systemPrompt: TriggerRun["systemPrompt"];
  if (s.lua) {
    const { runLua } = await import("./risuLua");
    for (const t of triggers) {
      const lua = (t.effect ?? []).find((e) => e?.type === "triggerlua" && typeof e.code === "string");
      if (!lua || t.effect?.[0]?.type !== "triggerlua") continue;
      const name = mode === "manual" ? arg.manualName ?? "" : "";
      // risu-btn → onButtonClick(값), risu-form → onFormSubmit(이름, {data}), risu-trigger → 그 이름의 함수
      const luaMode = !name ? mode : name.startsWith("__btn:") ? "onButtonClick" : name.startsWith("__form:") ? "onFormSubmit" : name;
      const data = luaMode === "onButtonClick" ? name.slice(6) : luaMode === "onFormSubmit" ? name.slice(7) : undefined;
      const r = await runLua(lua.code!, luaMode, { ...host, lowLevelAccess: t.lowLevelAccess, get chat() { return host.chat; }, set chat(v) { host.chat = v; } }, data, arg.meta ?? {});
      if (r.error) console.warn("[Lua]", r.error);
      stop ||= r.stop;
    }
  }
  if (s.triggers) {
    const blocks = triggers.filter((t) => t.effect?.[0]?.type !== "triggerlua" && t.effect?.[0]?.type !== "triggercode");
    if (blocks.length) {
      const { runTriggers } = await import("./risuTriggers");
      try {
        const r = await runTriggers(blocks as Parameters<typeof runTriggers>[0], mode, host, { manualName: arg.manualName });
        stop ||= r.stop;
        systemPrompt = r.systemPrompt;
        if (r.reload) host.reload();
      } catch (e) {
        console.warn("[트리거]", e); // 봇 트리거 오류가 이야기를 막지 않게
      }
    }
  }
  const cur = state.rooms[roomId] ?? room;
  const messages = applyChat(cur, host.chat);
  const changedVars = JSON.stringify(vars) !== JSON.stringify(cur.vars ?? {});
  const changedChat = messages.length !== cur.messages.length || messages.some((m, i) => m !== cur.messages[i]);
  if (changedVars || changedChat) updateRoom(roomId, { ...(changedChat ? { messages } : {}), ...(changedVars ? { vars } : {}) });
  return { stop, systemPrompt };
}

/** 화면 표시용 Lua editDisplay (메시지별 결과 캐시, 이야기·토글·다시 그리기 요청이 바뀌면 새로) */
const luaDisplayCache = new WeakMap<object, { globals: object; tick: number; fns: Map<string, (t: string) => Promise<string>>; results: Map<string, Promise<string>> }>();
export function displayLua(room: Room, msgId: string | null): ((t: string) => Promise<string>) | undefined {
  if (!state.settings.risu.lua || !triggersOf(room).some((t) => t.effect?.[0]?.type === "triggerlua")) return undefined;
  let c = luaDisplayCache.get(room);
  if (!c || c.globals !== state.globals || c.tick !== state.risuTick) luaDisplayCache.set(room, (c = { globals: state.globals, tick: state.risuTick, fns: new Map(), results: new Map() }));
  const key = msgId ?? "__live__";
  let fn = c.fns.get(key);
  if (!fn) {
    const index = msgId === null ? splitRest(room) : chatIndexOf(room.messages, msgId);
    const results = c.results;
    fn = (t: string) => {
      const k = `${index}|${t}`;
      let p = results.get(k);
      if (!p) results.set(k, (p = runLuaEdit(room, "editDisplay", t, { index }).then(String).catch(() => t)));
      return p;
    };
    c.fns.set(key, fn);
  }
  return fn;
}

/** Lua 편집 리스너 (editInput · editOutput · editRequest · editDisplay) — 리스너가 없으면 값 그대로 */
export async function runLuaEdit<T>(room: Room, type: "editInput" | "editOutput" | "editRequest" | "editDisplay", value: T, meta: object = {}): Promise<T> {
  if (!state.settings.risu.lua) return value;
  const codes = triggersOf(room).filter((t) => t.effect?.[0]?.type === "triggerlua").map((t) => t.effect!.find((e) => e.type === "triggerlua")!.code!).filter(Boolean);
  if (!codes.length) return value;
  const { runLua } = await import("./risuLua");
  const vars = { ...(room.vars ?? {}) };
  const host = hostFor(room, vars);
  let v = value;
  for (const code of codes) {
    const r = await runLua(code, type, host, v, meta);
    v = (r.res ?? v) as T;
  }
  if (type !== "editDisplay" && JSON.stringify(vars) !== JSON.stringify(room.vars ?? {})) updateRoom(room.id, { vars });
  return v;
}

/** 브라우저에 영구 저장 요청 (설정 → 저장소) */
export const requestPersistNow = () => requestPersist();
/** 봇 전역 변수(토글 값 포함) 모두 지우기 */
export function clearGlobals() {
  setState({ globals: {} });
  void putKV("risuGlobals", {}).catch(() => {});
}
/** 이 앱의 모든 로컬 데이터 삭제 후 새로 시작 (IndexedDB 전체 + 이 앱의 localStorage 항목) */
export async function resetAllData() {
  await wipeDatabase();
  try {
    localStorage.removeItem("risuUiState");
  } catch {
    /* 무시 */
  }
  location.reload();
}

/** 전역 변수 (토글은 toggle_키) */
export function setGlobal(key: string, value: string) {
  setState((st) => ({ globals: { ...st.globals, [key]: value } }));
  void putKV("risuGlobals", state.globals).catch(() => {});
}
/** 이야기방 채팅 변수 직접 고치기 */
export function setRoomVar(roomId: string, key: string, value: string | null) {
  const r = state.rooms[roomId];
  if (!r) return;
  const vars = { ...(r.vars ?? {}) };
  if (value === null) delete vars[key];
  else vars[key] = value;
  updateRoom(roomId, { vars });
}

/** 이야기·소설에서 쓸 수 있는 이미지와 봇의 정규식 스크립트 */
export const poolFor = (target: Pick<Room, "worldId" | "personaId" | "characterIds">): ImagePool => imagePool(contextFor(target), state.images, state.settings.risu.scripts);
/** v0.1 에서 보관만 해 둔 세계관·캐릭터를 라이브러리로 */
export function importLegacyExtra(): number {
  const items = state.legacyExtra ? libraryFromExtra(state.legacyExtra) : [];
  upsertLibrary(items);
  setState({ legacyExtra: null });
  void deleteKV("legacyExtra");
  return items.length;
}

/* ---------------- AI 호출 공통: 대체 모델 + 사용량 집계 ---------------- */
const FALLBACK_KINDS = new Set(["rate", "server", "network"]);
export const hasKeyFor = (s: Settings, p: Settings["provider"]) => (p === "openai" ? !!s.keys.openai || /localhost|127\.0\.0\.1/.test(s.openaiBaseUrl) : !!s.keys[p]);

export interface AIResult extends GenerateResult {
  usedFallback: boolean;
  cost?: MessageUsage;
}
/**
 * 모든 AI 요청은 여기를 거친다.
 * - 기본 모델이 과부하·한도·서버·네트워크 오류(자동 재시도 후에도)면 대체 모델로 한 번 더
 *   (인증·요청 오류·거절은 대체하지 않음 — 거절을 다른 모델로 우회하지 않는다)
 * - 응답마다 사용량·비용 기록
 */
export interface LastRequest {
  kind: UsageKind;
  at: number;
  system: string;
  messages: { role: string; content: string }[];
}
export async function callAI(kind: UsageKind, req: Omit<GenerateRequest, "settings">, opts: { settings?: Settings; onRestart?: () => void } = {}): Promise<AIResult> {
  setState({ lastRequest: { kind, at: Date.now(), system: req.system, messages: req.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })) } });
  const s = opts.settings ?? state.settings;
  const fb = s.fallback;
  const record = (provider: Settings["provider"], res: GenerateResult): MessageUsage | undefined => {
    if (!res.usage) return undefined;
    const { data, usd } = recordUsage(state.usage, { provider, model: res.model, kind, usage: res.usage, custom: state.settings.customPrices });
    setState({ usage: data, lastUsage: { ...res.usage, model: res.model } });
    usageDirty = true;
    scheduleSave();
    return { input: res.usage.input, output: res.usage.output, ...(res.usage.cacheRead ? { cacheRead: res.usage.cacheRead } : {}), ...(usd !== null ? { usd } : {}) };
  };
  try {
    const res = await generate({ ...req, settings: s });
    return { ...res, usedFallback: false, cost: record(s.provider, res) };
  } catch (e) {
    const err = e as ProviderError;
    const same = fb.provider === s.provider && fb.model === s.models[s.provider];
    if (!(err instanceof ProviderError) || !FALLBACK_KINDS.has(err.kind) || !fb.enabled || !fb.model.trim() || same || !hasKeyFor(s, fb.provider) || req.signal?.aborted) throw e;
    opts.onRestart?.();
    req.onStatus?.(`기본 모델 오류(${err.message.slice(0, 60)}) → 대체 모델 ${PROVIDER_LABEL[fb.provider]} · ${fb.model}로 다시 시도합니다`);
    const s2: Settings = { ...s, provider: fb.provider, models: { ...s.models, [fb.provider]: fb.model } };
    const res = await generate({ ...req, settings: s2 });
    return { ...res, usedFallback: true, cost: record(fb.provider, res) };
  }
}

/* ---------------- 생성 ---------------- */
export const isGenerating = () => state.live !== null;
export function stopGeneration() {
  controller?.abort();
}

export async function send(roomId: string, text: string) {
  const r = state.rooms[roomId];
  if (!r || isGenerating()) return;
  // 입력 없이 [보내기]: Lua 봇은 사용자 차례가 있어야 턴을 처리하므로(상태·그림 갱신) 짧은 이어 쓰기 입력을 남긴다.
  // 그 밖의 이야기는 기록에 남기지 않고 요청에만 이어 쓰기 지시를 붙인다 (runGeneration)
  const lastMsg = r.messages.filter((m) => !m.error).at(-1);
  if (!text.trim() && lastMsg?.role === "assistant" && state.settings.risu.lua && triggersOf(r).some((t) => t.effect?.[0]?.type === "triggerlua")) text = P("chat.continueInput");
  // 봇의 입력 스크립트(editinput) + Lua editInput
  const scripted = runScripts(text.trim(), poolFor(r).scripts, "editinput", state.settings.risu.cbs ? cbsFor(r, { chatIndex: splitRest(r) }) : undefined).text.trim();
  const t = String(await runLuaEdit(r, "editInput", scripted)).trim();
  const msg: Message = { id: uid("m"), role: "user", text: t, createdAt: Date.now() };
  const title = r.messages.length === 0 && r.title === "새 이야기" && t ? t.slice(0, 24) + (t.length > 24 ? "…" : "") : r.title;
  updateRoom(roomId, { messages: t ? [...r.messages, msg] : r.messages, title });
  // 봇 트리거: 입력 후
  if (t && (await runRoomTrigger(roomId, "input")).stop) return;
  await runGeneration(roomId);
}

/** 마지막 AI 응답을 지우고 다시 생성 */
export async function regenerate(roomId: string, note = "") {
  const r = state.rooms[roomId];
  if (!r || isGenerating()) return;
  const msgs = [...r.messages];
  while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
  updateRoom(roomId, { messages: msgs });
  await runGeneration(roomId, note);
}

/** 최근 대화에 등장한 로어북 항목 (세계관 + 등장인물) */
export function loreFor(room: Room, ctx: StoryContext): LoreHit[] {
  const groups = [...(ctx.world ? [{ source: ctx.world.name, entries: ctx.world.lore }] : []), ...ctx.characters.map((c) => ({ source: c.name, entries: c.lore }))];
  if (!groups.some((g) => g.entries.length)) return [];
  const msgs = room.messages.filter((m) => !m.error);
  const recent = msgs.slice(-4).map((m) => m.text);
  return matchLore(groups, recent.join("\n"), 4000, { messages: recent, chatLength: msgs.length + (msgs[0]?.greeting ? 0 : 1) });
}

async function runGeneration(roomId: string, note = "") {
  // 봇 트리거: 보내기 직전 (Lua onStart · 블록 트리거 'start')
  const started = state.rooms[roomId] ? await runRoomTrigger(roomId, "start") : { stop: false };
  if (started.stop) return;
  const room = state.rooms[roomId];
  const s = state.settings;
  if (!room) return;
  const ctx0 = contextFor(room);
  const pool = imagePool(ctx0, state.images, s.risu.scripts);
  // RisuAI CBS: 토글·변수에 따라 설정 글과 대화 기록을 정리 ({{setvar}} 등은 기록하지 않고 지움)
  const useCbs = s.risu.cbs;
  const ctx = useCbs ? processContext(ctx0, envFor(room, { rmVar: true })) : ctx0;
  const roomP = useCbs ? processMessages(room, (chatIndex) => envFor(room, { chatIndex, rmVar: true })) : room;
  const procCbs = useCbs ? cbsFor(room, { rmVar: true }) : undefined;
  // 봇의 프롬프트 스크립트(editprocess): AI에게 보내는 대화만 바꾸고 저장된 대화는 그대로
  const history = buildHistory(roomP, s.contextMessages).map((h) => ({ ...h, content: runScripts(h.content, pool.scripts, "editprocess", procCbs).text }));
  if (!history.length) history.push({ role: "user", content: P("chat.start") });
  // 입력 없이 [보내기]: 마지막이 AI 응답이면 이어서 다음 전개를 쓰게 한다 (대화는 사용자 차례로 끝나야 하므로 요청 한 줄을 붙임)
  else if (history[history.length - 1].role === "assistant") history.push({ role: "user", content: P("chat.continue") });
  // 로어북은 시스템 프롬프트가 아니라 마지막 입력에 붙인다 → 앞부분이 고정돼 프롬프트 캐시가 유지됨
  const lore = loreFor(roomP, ctx);
  if (lore.length) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}\n\n${P("chat.lore", { 내용: formatLore(lore) })}` };
  }
  // 설정의 응답 직전 지시 (RisuAI post_history_instructions): 마지막 입력 뒤에 붙인다
  const instr = instructionsOf(ctx);
  if (instr) {
    const last = history[history.length - 1];
    // 봇 지시가 '응답 맨 끝'을 요구하는 경우가 많아(상태창 등) 선택지와 순서를 정해 준다
    const order = s.choices && !(s.risu.lua && botHandlesChoices(ctx)) ? `\n\n${P("chat.choiceOrder", { 표시: CHOICE_MARKER })}` : "";
    history[history.length - 1] = { ...last, content: `${last.content}\n\n${P("chat.instructions", { 내용: instr })}${order}` };
  }
  if (note.trim()) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}\n\n${P("chat.note", { 내용: note.trim() })}` };
  }
  // 그림 자주 쓰기: 시스템 프롬프트(맨 앞)만으로는 긴 대화에서 약해지므로 최신 입력 바로 뒤에도 한 번 더
  if (s.risu.imageEveryTurn && (hasOwnImageRules(ctx, pool) || pool.assets.some((m) => m.kind !== "icon"))) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}\n\n${P("chat.imageReminder")}` };
  }
  // 봇 트리거의 시스템 프롬프트 추가 (위치: 맨 앞 / 대화 기록 끝 / 프롬프트 끝)
  const sp = started.systemPrompt;
  if (sp && (sp.historyend.trim() || sp.promptend.trim())) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: [last.content, sp.historyend.trim(), sp.promptend.trim()].filter(Boolean).join("\n\n") };
  }
  let system = [sp?.start.trim(), buildSystemPrompt(s, room, ctx, imagePromptSection(ctx, pool, "chat", s.risu.imageEveryTurn))].filter(Boolean).join("\n\n");
  // Lua editRequest: AI에게 보낼 요청 전체를 봇이 고칠 수 있게
  {
    const req = [{ role: "system", content: system }, ...history] as { role: string; content: string }[];
    const edited = await runLuaEdit(room, "editRequest", req);
    if (Array.isArray(edited) && edited !== req) {
      // 봇이 대화 중간·끝에 넣은 시스템 메시지(그림 지침·장면 상태 등)는 그 자리에 둔다 — 맨 앞으로 모으면 긴 대화에서 지침이 묻힘
      const folded = foldRequest(edited.map((m) => ({ role: String(m.role), content: String(m.content ?? (m as { data?: unknown }).data ?? "") })));
      system = folded.system;
      if (folded.messages.length) history.splice(0, history.length, ...folded.messages);
    }
  }
  controller = new AbortController();
  setState({ live: { roomId, text: "", thinking: "", status: "", startedAt: Date.now(), lore } });
  const live = (p: Partial<LiveState>) => setState((st) => (st.live ? { live: { ...st.live, ...p } } : {}));
  let streamed = "";
  let ok = false;
  try {
    const res = await callAI(
      "chat",
      {
        system,
        messages: history,
        maxTokens: outputTokensFor(s),
        signal: controller.signal,
        onText: (d) => {
          streamed += d;
          live({ text: previewText(streamed) });
        },
        onThinking: (d) => live({ thinking: (state.live?.thinking ?? "") + d }),
        onStatus: (m) => live({ status: m }),
      },
      { onRestart: () => ((streamed = ""), live({ text: "", thinking: "" })) },
    );
    // 봇의 출력 스크립트 + CBS({{setvar}} 등을 실제로 기록하고 글에서는 지움)
    const vars = { ...(state.rooms[roomId]?.vars ?? {}) };
    const outCbs = useCbs ? cbsFor(state.rooms[roomId] ?? room, { runVar: true, vars, chatIndex: splitRest(state.rooms[roomId] ?? room) }) : undefined;
    const out = String(await runLuaEdit(state.rooms[roomId] ?? room, "editOutput", runScripts(res.text, pool.scripts, "editoutput", outCbs).text));
    const { text, choices } = s.choices ? splitChoices(out) : { text: out.trim(), choices: [] };
    if (!text) throw new ProviderError("AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.", 0, "server");
    const cur = state.rooms[roomId];
    const reply: Message = { id: uid("m"), role: "assistant", text, ...(choices.length ? { choices } : {}), ...(res.thinking ? { thinking: res.thinking } : {}), model: res.model, ...(res.cost ? { usage: res.cost } : {}), ...(res.usedFallback ? { fallback: true } : {}), createdAt: Date.now() };
    if (cur) updateRoom(roomId, { messages: [...cur.messages, reply], ...(useCbs ? { vars } : {}) });
    ok = true;
    // 봇 트리거: 응답 후 (Lua onOutput · 블록 트리거 'output')
    await runRoomTrigger(roomId, "output").catch((e) => console.warn("[트리거]", e));
  } catch (e) {
    const err = e as Error;
    if (err?.name !== "AbortError") {
      const cur = state.rooms[roomId];
      const msg: Message = { id: uid("m"), role: "assistant", text: "", error: err?.message || String(e), createdAt: Date.now() };
      if (cur) updateRoom(roomId, { messages: [...cur.messages, msg] });
    }
  } finally {
    controller = null;
    setState({ live: null });
  }
  if (ok && state.settings.autoMemory) await updateMemory(roomId, "auto");
}

/* ---------------- 장기 기억 ---------------- */
let memoryRunning = false;
/**
 * 오래된 대화를 장기 기억(요약)에 반영한다.
 * 결과: "updated" | "nothing" | "busy" | 오류 메시지(Error throw 대신 반환 → 이야기 진행을 막지 않음)
 */
export async function updateMemory(roomId: string, mode: "auto" | "manual"): Promise<"updated" | "nothing" | "busy" | { error: string }> {
  const room = state.rooms[roomId];
  if (!room) return "nothing";
  if (memoryRunning) return "busy";
  const s = state.settings;
  const pending = pendingForMemory(room, s.contextMessages, mode);
  if (!pending.length) return "nothing";
  memoryRunning = true;
  setState({ memoryJob: { roomId } });
  try {
    const req = buildMemoryRequest(s, room, pending, { user: contextFor(room).persona?.name });
    const res = await callAI("memory", { ...req, maxTokens: 3000 });
    const memory = cleanMemory(res.text);
    if (!memory) throw new Error("빈 요약이 돌아왔습니다.");
    updateRoom(roomId, { memory, memoryCursorAt: pending[pending.length - 1].createdAt, memoryUpdatedAt: Date.now() });
    setState({ memoryJob: null });
    return "updated";
  } catch (e) {
    const error = `장기 기억 정리 실패: ${(e as Error)?.message || e}`;
    setState({ memoryJob: { roomId, error } });
    return { error };
  } finally {
    memoryRunning = false;
  }
}
export const dismissMemoryError = () => setState({ memoryJob: null });

/* ---------------- 소설 ---------------- */
export function setView(view: AppState["view"]) {
  setState({ view });
  void putKV("view", view);
}
function putNovel(n: Novel) {
  setState((s) => ({ novels: { ...s.novels, [n.id]: n } }));
  dirty.novels.add(n.id);
  markSyncDirty();
  scheduleSave();
}
export function upsertNovels(list: Novel[]) {
  list.forEach((n) => putNovel(revive(normalizeNovel(n))));
}
export function updateNovel(id: string, patch: Partial<Novel>) {
  const n = state.novels[id];
  if (n) putNovel(normalizeNovel({ ...n, ...patch, updatedAt: Date.now() }));
}
export function createNovel(init: Partial<Novel> = {}): string {
  const now = Date.now();
  const n = normalizeNovel({ id: uid("n"), title: "", author: "", genre: "", brief: "", characterIds: [], episodeCount: 10, episodeLength: "medium", outline: [], episodes: [], createdAt: now, updatedAt: now, ...init });
  putNovel(n);
  setState({ activeNovelId: n.id, view: "novels" });
  return n.id;
}
export function deleteNovel(id: string) {
  if (state.novelLive?.novelId === id) stopNovel();
  setState((s) => {
    const { [id]: _, ...rest } = s.novels;
    const next = Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return { novels: rest, activeNovelId: s.activeNovelId === id ? next?.id ?? null : s.activeNovelId };
  });
  dirty.novels.delete(id);
  deleted.novels.add(id);
  addTombstone(id);
  scheduleSave();
}
export const selectNovel = (id: string | null) => setState({ activeNovelId: id, view: "novels" });
/** 이야기방의 설정을 바탕으로 소설 기획 만들기 */
export function novelFromRoom(roomId: string): string | null {
  const r = state.rooms[roomId];
  if (!r) return null;
  const brief = [r.premise.trim(), r.memory.trim() && `지금까지의 줄거리:\n${r.memory.trim()}`].filter(Boolean).join("\n\n");
  return createNovel({ title: r.title === "새 이야기" ? "" : r.title, brief, worldId: r.worldId, characterIds: r.characterIds, personaId: r.personaId });
}

let novelController: AbortController | null = null;

/* 긴 집필 중 화면이 꺼지면 모바일 브라우저가 요청을 끊으므로 화면 켜짐 유지 (지원 브라우저만) */
type WakeLock = { release: () => Promise<void> };
let wakeLock: WakeLock | null = null;
let wakeUsers = 0;
async function holdWake() {
  wakeUsers++;
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } }).wakeLock;
    if (!wakeLock && wl) wakeLock = await wl.request("screen");
  } catch {
    /* 미지원·거부 시 무시 */
  }
}
function releaseWake() {
  wakeUsers = Math.max(0, wakeUsers - 1);
  if (!wakeUsers && wakeLock) {
    void wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
// 탭을 다시 보면 잠금이 풀려 있으므로 재요청
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeUsers && !wakeLock) {
      wakeUsers--;
      void holdWake();
    }
  });
export const stopNovel = () => novelController?.abort();
const novelLiveSet = (p: Partial<NovelLive>) => setState((st) => (st.novelLive ? { novelLive: { ...st.novelLive, ...p } } : {}));

/** 개요 생성. from: 이 회차(0부터)부터 다시 짠다 (앞부분 유지) */
export async function generateOutline(novelId: string, from = 0): Promise<boolean> {
  const n = state.novels[novelId];
  if (!n || state.novelLive) return false;
  from = Math.max(0, Math.min(from, n.outline.length, n.episodeCount - 1));
  novelController = new AbortController();
  setState({ novelLive: { novelId, task: "outline", index: from, text: "", thinking: "", status: "", startedAt: Date.now() }, novelError: null });
  let streamed = "";
  try {
    const s = state.settings;
    const res = await callAI("outline", {
      ...buildOutlineRequest(s, n, contextFor(n), from),
      maxTokens: Math.min(16000, 1500 + (n.episodeCount - from) * 250),
      signal: novelController.signal,
      onText: (d) => novelLiveSet({ text: (streamed += d) }),
      onThinking: (d) => novelLiveSet({ thinking: (state.novelLive?.thinking ?? "") + d }),
      onStatus: (m) => novelLiveSet({ status: m }),
    }, { onRestart: () => ((streamed = ""), novelLiveSet({ text: "", thinking: "" })) });
    const items = parseOutline(res.text).filter((x) => x.number > from);
    if (!items.length) throw new Error("개요 형식을 읽지 못했습니다. 다시 시도해 주세요.");
    const cur = state.novels[novelId] ?? n;
    const outline = [...cur.outline.slice(0, from), ...items.slice(0, cur.episodeCount - from).map((x) => ({ id: uid("o"), title: x.title, summary: x.summary }))];
    updateNovel(novelId, { outline });
    return true;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") setState({ novelError: { novelId, message: (e as Error)?.message || String(e) } });
    return false;
  } finally {
    novelController = null;
    setState({ novelLive: null });
  }
}

/** 한 회차 집필 (이미 있으면 다시 쓰기). 앞 회차가 비어 있으면 불가 */
export async function writeEpisode(novelId: string, index: number, note = "", until?: number): Promise<boolean> {
  const n = state.novels[novelId];
  if (!n || state.novelLive) return false;
  if (!n.outline[index]) return setNovelError(novelId, `${index + 1}화의 개요가 없습니다. 먼저 개요를 만들어 주세요.`);
  if (index > n.episodes.length) return setNovelError(novelId, `${n.episodes.length + 1}화부터 순서대로 써 주세요.`);
  novelController = new AbortController();
  setState({ novelLive: { novelId, task: "episode", index, until, text: "", thinking: "", status: "", startedAt: Date.now() }, novelError: null });
  void holdWake();
  let streamed = "";
  const pool = poolFor(n);
  const save = (raw: string, model: string, incomplete: boolean, usage?: MessageUsage) => {
    const { text: body, summary } = splitEpisode(raw);
    const text = runScripts(body, pool.scripts, "editoutput").text.trim(); // 봇의 출력 스크립트
    const cur = state.novels[novelId];
    if (!cur || !text) return;
    const now = Date.now();
    const old = cur.episodes[index];
    const ep: Episode = { id: old?.id ?? uid("e"), title: cur.outline[index]?.title ?? `${index + 1}화`, text, summary, model, ...(incomplete ? { incomplete: true } : {}), ...(usage ? { usage } : {}), createdAt: old?.createdAt ?? now, updatedAt: now };
    const episodes = [...cur.episodes];
    episodes[index] = ep;
    updateNovel(novelId, { episodes });
  };
  try {
    const s = state.settings;
    const ctx0 = contextFor(n);
    // RisuAI CBS: 소설은 이야기 변수가 없으므로 기본 변수·전역 변수(토글)로 설정 글을 정리
    const ctx = s.risu.cbs ? processContext(ctx0, buildEnv({ ctx: ctx0, globals: state.globals, images: Object.values(state.images), rmVar: true, seed: n.id })) : ctx0;
    const groups = [...(ctx.world ? [{ source: ctx.world.name, entries: ctx.world.lore }] : []), ...ctx.characters.map((c) => ({ source: c.name, entries: c.lore }))];
    const scan = [n.outline[index].title, n.outline[index].summary, n.episodes[index - 1]?.text.slice(-1500) ?? ""].join("\n");
    const lore = groups.length ? formatLore(matchLore(groups, scan)) : "";
    const res = await callAI("episode", {
      ...buildEpisodeRequest(s, n, ctx, index, { lore, note, imageRules: imagePromptSection(ctx, pool, "novel"), instructions: instructionsOf(ctx) }),
      maxTokens: EPISODE_LENGTH[n.episodeLength].tokens,
      signal: novelController.signal,
      onText: (d) => novelLiveSet({ text: previewEpisode((streamed += d)) }),
      onThinking: (d) => novelLiveSet({ thinking: (state.novelLive?.thinking ?? "") + d }),
      onStatus: (m) => novelLiveSet({ status: m }),
    }, { onRestart: () => ((streamed = ""), novelLiveSet({ text: "", thinking: "" })) });
    const cut = res.stopReason === "max_tokens" || res.stopReason === "length" || res.stopReason === "MAX_TOKENS";
    if (!splitEpisode(res.text).text) throw new Error("AI가 빈 원고를 보냈습니다. 다시 시도해 주세요.");
    save(res.text, res.model, cut, res.cost);
    return true;
  } catch (e) {
    const err = e as Error;
    // 중단해도 충분히 쓴 원고는 '미완성'으로 보존
    if (splitEpisode(streamed).text.length >= 500) save(streamed, "", true);
    if (err?.name !== "AbortError") setNovelError(novelId, err?.message || String(e));
    return false;
  } finally {
    novelController = null;
    setState({ novelLive: null });
    releaseWake();
  }
}
function setNovelError(novelId: string, message: string): false {
  setState({ novelError: { novelId, message } });
  return false;
}
export const dismissNovelError = () => setState({ novelError: null });

/** 다음 회차부터 until(포함)까지 연속 집필. 중단·오류 시 멈춤 */
export async function writeEpisodes(novelId: string, until: number): Promise<number> {
  let done = 0;
  await holdWake();
  try {
    for (;;) {
      const n = state.novels[novelId];
      if (!n) break;
      const next = n.episodes.length;
      if (next > until || next >= n.outline.length) break;
      if (!(await writeEpisode(novelId, next, "", until))) break;
      done++;
    }
  } finally {
    releaseWake();
  }
  return done;
}

/** 회차 직접 수정 · 삭제(마지막 회차만 — 중간을 지우면 이어 쓰기가 어긋남) */
export function editEpisode(novelId: string, index: number, patch: Partial<Episode>) {
  const n = state.novels[novelId];
  if (!n?.episodes[index]) return;
  const episodes = [...n.episodes];
  episodes[index] = { ...episodes[index], ...patch, updatedAt: Date.now() };
  updateNovel(novelId, { episodes });
}
export function deleteLastEpisode(novelId: string) {
  const n = state.novels[novelId];
  if (n?.episodes.length) updateNovel(novelId, { episodes: n.episodes.slice(0, -1) });
}

export function resetUsage() {
  setState({ usage: emptyUsage() });
  usageDirty = true;
  scheduleSave();
}

/** generate 를 거치지 않는 요청(표지 그림 등)의 사용량 기록. 반환: 비용(USD, 모르면 undefined) */
export function recordExternalUsage(kind: UsageKind, provider: Settings["provider"], model: string, usage: Usage): number | undefined {
  const { data, usd } = recordUsage(state.usage, { provider, model, kind, usage, custom: state.settings.customPrices });
  setState({ usage: data });
  usageDirty = true;
  scheduleSave();
  return usd ?? undefined;
}

/* ---------------- 진단 ---------------- */
export interface DiagnosisResult {
  report: string;
  directive: string;
}
let diagController: AbortController | null = null;
export const stopDiagnosis = () => diagController?.abort();

async function runDiagnosis(req: { system: string; messages: { role: "user" | "assistant"; content: string }[] }, onText?: (all: string) => void): Promise<DiagnosisResult> {
  diagController = new AbortController();
  let all = "";
  try {
    const res = await callAI("diagnose", { ...req, maxTokens: 3000, signal: diagController.signal, onText: (d) => onText?.((all += d)) }, { onRestart: () => onText?.((all = "")) });
    const r = splitDiagnosis(res.text);
    if (!r.report) throw new Error("빈 진단이 돌아왔습니다.");
    return r;
  } finally {
    diagController = null;
  }
}
export async function diagnoseRoom(roomId: string, onText?: (all: string) => void): Promise<DiagnosisResult> {
  const room = state.rooms[roomId];
  if (!room) throw new Error("이야기를 찾을 수 없습니다.");
  const r = await runDiagnosis(buildRoomDiagnosis(state.settings, room, contextFor(room)), onText);
  updateRoom(roomId, { lastDiagnosis: { at: Date.now(), ...r } });
  return r;
}
export async function diagnoseEpisode(novelId: string, index: number, onText?: (all: string) => void): Promise<DiagnosisResult> {
  const n = state.novels[novelId];
  if (!n?.episodes[index]) throw new Error("회차를 찾을 수 없습니다.");
  return runDiagnosis(buildEpisodeDiagnosis(state.settings, n, contextFor(n), index), onText);
}

/* ---------------- 책갈피 · 분기 · 되돌리기 ---------------- */
export function setBookmark(roomId: string, msgId: string, label: string | null) {
  const r = state.rooms[roomId];
  if (!r) return;
  updateRoom(roomId, {
    messages: r.messages.map((m) => {
      if (m.id !== msgId) return m;
      const { bookmark: _, ...rest } = m;
      return label === null ? rest : { ...rest, bookmark: label };
    }),
  });
}
/** 이 메시지까지를 복사한 새 이야기. 기억이 분기 시점 이후 내용을 담고 있으면 비워서 다시 정리되게 함 */
export function branchRoom(roomId: string, msgId: string): string | null {
  const r = state.rooms[roomId];
  const idx = r?.messages.findIndex((m) => m.id === msgId) ?? -1;
  if (!r || idx < 0) return null;
  const point = r.messages[idx];
  const keepMemory = r.memoryCursorAt !== undefined && r.memoryCursorAt <= point.createdAt;
  const now = Date.now();
  const room: Room = {
    ...r,
    id: uid("r"),
    title: `${r.title} (분기)`,
    messages: r.messages.slice(0, idx + 1).map((m) => ({ ...m, id: uid("m") })),
    memory: keepMemory ? r.memory : "",
    memoryCursorAt: keepMemory ? r.memoryCursorAt : undefined,
    memoryUpdatedAt: keepMemory ? r.memoryUpdatedAt : undefined,
    lastDiagnosis: undefined,
    branchOf: { roomId: r.id, messageId: msgId, title: r.title },
    createdAt: now,
    updatedAt: now,
  };
  putRoom(room);
  setState({ activeRoomId: room.id });
  return room.id;
}
/** 이 메시지 이후를 모두 삭제 */
export function rewindTo(roomId: string, msgId: string) {
  const r = state.rooms[roomId];
  const idx = r?.messages.findIndex((m) => m.id === msgId) ?? -1;
  if (!r || idx < 0) return;
  const kept = r.messages.slice(0, idx + 1);
  const point = kept[kept.length - 1];
  const stale = r.memoryCursorAt !== undefined && r.memoryCursorAt > point.createdAt;
  updateRoom(roomId, { messages: kept, ...(stale ? { memory: "", memoryCursorAt: undefined, memoryUpdatedAt: undefined } : {}) });
}

/* ---------------- 표지 ---------------- */
export function setCover(novelId: string, cover: Novel["cover"] | null) {
  const n = state.novels[novelId];
  if (!n) return;
  const { cover: _, ...rest } = n;
  putNovel(normalizeNovel({ ...rest, ...(cover ? { cover } : {}), updatedAt: Date.now() } as Novel));
}

/* ---------------- 기기 간 동기화 (GitHub Gist) ---------------- */
function setSyncStatus(p: Partial<SyncStatus> = {}) {
  const c = syncConfig;
  setState((st) => ({ sync: { ...st.sync, connected: !!c, auto: !!c?.auto, encrypted: !!c?.passphrase, login: c?.login, gistUrl: c?.gistUrl, lastSyncAt: c?.lastSyncAt, ...p } }));
}
async function saveSyncConfig(c: SyncConfig | null) {
  syncConfig = c;
  if (c) await putKV("sync", c);
  else await deleteKV("sync");
  setSyncStatus();
}
function localSnapshot(): Snapshot {
  return { rooms: state.rooms, library: state.library, novels: state.novels, tombstones, settings: { value: syncedSettings(state.settings), updatedAt: settingsUpdatedAt } };
}

/** 토큰 확인 → (있으면) 기존 동기화 Gist 찾기 → 바로 동기화 */
export async function connectSync(opts: { token: string; passphrase: string; auto: boolean }): Promise<boolean> {
  const token = opts.token.trim();
  if (!token) return false;
  setSyncStatus({ running: true, error: undefined });
  try {
    const client = new GistClient(token);
    const login = await client.user();
    const gistId = (await client.find()) ?? undefined;
    await saveSyncConfig({ token, passphrase: opts.passphrase, auto: opts.auto, login, gistId, device: navigator.userAgent.slice(0, 80) });
  } catch (e) {
    setSyncStatus({ running: false, error: (e as Error)?.message || String(e) });
    return false;
  }
  setSyncStatus({ running: false });
  return syncNow();
}
export async function disconnectSync() {
  clearTimeout(syncTimer);
  await saveSyncConfig(null);
  setSyncStatus({ error: undefined, lastResult: undefined });
}
export async function updateSyncOptions(p: { auto?: boolean; passphrase?: string }) {
  if (syncConfig) await saveSyncConfig({ ...syncConfig, ...p });
}

let syncRunning = false;
/**
 * 원격을 받아 병합 → 이 기기에 반영 → 원격이 달라졌으면 다시 씀.
 * forcePush: 원격 내용을 무시하고 이 기기 데이터로 덮어씀 (암호를 바꿨거나 잊었을 때)
 */
export async function syncNow(opts: { forcePush?: boolean } = {}): Promise<boolean> {
  const cfg = syncConfig;
  if (!cfg || syncRunning) return false;
  if (state.live || state.novelLive) {
    // 생성 중에는 미룸 (쓰는 중인 이야기를 덮어쓰지 않도록)
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncNow(opts), 30_000);
    return false;
  }
  clearTimeout(syncTimer);
  syncRunning = true;
  setSyncStatus({ running: true, error: undefined });
  try {
    await flush();
    const client = new GistClient(cfg.token);
    let id = cfg.gistId ?? null;
    let remote: Snapshot | null = null;
    let files: string[] = [];
    let url = cfg.gistUrl;
    if (id) {
      try {
        const r = await client.read(id);
        if (r) {
          files = r.files;
          url = r.url ?? url;
          if (!opts.forcePush) remote = await decodePayload<Snapshot>(r.meta.payload, r.body, cfg.passphrase || undefined);
        }
      } catch (e) {
        if (e instanceof GistError && e.status === 404) id = (await client.find()) ?? null; // 지워졌으면 다시 찾고, 없으면 새로 만듦
        else throw e;
      }
    }
    const m = mergeSnapshots(localSnapshot(), remote);
    // 이 기기에 반영 (updatedAt 은 그대로 → 다시 '변경'으로 잡히지 않음)
    applyingRemote = true;
    try {
      const L = m.local;
      if (L.put.rooms.length || L.del.rooms.length || L.put.library.length || L.del.library.length || L.put.novels.length || L.del.novels.length) {
        setState((st) => {
          const rooms = { ...st.rooms }, library = { ...st.library }, novels = { ...st.novels };
          L.put.rooms.forEach((r) => ((rooms[r.id] = normalizeRoom(r)), dirty.rooms.add(r.id)));
          L.put.library.forEach((e) => ((library[e.id] = e), dirty.library.add(e.id)));
          L.put.novels.forEach((n) => ((novels[n.id] = normalizeNovel(n)), dirty.novels.add(n.id)));
          L.del.rooms.forEach((rid) => (delete rooms[rid], deleted.rooms.add(rid)));
          L.del.library.forEach((lid) => (delete library[lid], deleted.library.add(lid)));
          L.del.novels.forEach((nid) => (delete novels[nid], deleted.novels.add(nid)));
          const recent = (o: Record<string, { updatedAt: number; id: string }>) => Object.values(o).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
          return {
            rooms, library, novels,
            activeRoomId: st.activeRoomId && rooms[st.activeRoomId] ? st.activeRoomId : recent(rooms),
            activeNovelId: st.activeNovelId && novels[st.activeNovelId] ? st.activeNovelId : recent(novels),
          };
        });
      }
      if (L.tombstonesChanged) {
        tombstones = { ...m.merged.tombstones };
        syncMetaDirty = true;
      }
      if (L.settings && m.merged.settings) {
        setState((st) => ({ settings: normalizeSettings({ ...L.settings, keys: st.settings.keys }) }));
        settingsUpdatedAt = m.merged.settings.updatedAt;
        settingsDirty = true;
        syncMetaDirty = true;
      }
    } finally {
      applyingRemote = false;
    }
    let wrote = false;
    if (m.remoteChanged || !id || opts.forcePush) {
      const { meta, body } = await encodePayload(m.merged, cfg.passphrase || undefined);
      const w = await client.write(id, { app: "novel-generator", payload: meta, updatedAt: Date.now(), device: cfg.device }, body, files);
      id = w.id;
      url = w.url ?? url;
      wrote = true;
    }
    const got = m.local.put.rooms.length + m.local.put.library.length + m.local.put.novels.length;
    const removed = m.local.del.rooms.length + m.local.del.library.length + m.local.del.novels.length;
    if (syncConfig) await saveSyncConfig({ ...syncConfig, gistId: id ?? undefined, gistUrl: url, lastSyncAt: Date.now() }); // 도중에 연결 해제했으면 되살리지 않음
    setSyncStatus({ running: false, lastResult: [got && `받음 ${got}`, removed && `삭제 ${removed}`, wrote ? "올림" : "변경 없음"].filter(Boolean).join(" · ") });
    await flush();
    return true;
  } catch (e) {
    setSyncStatus({ running: false, error: (e as Error)?.message || String(e) });
    return false;
  } finally {
    syncRunning = false;
  }
}
