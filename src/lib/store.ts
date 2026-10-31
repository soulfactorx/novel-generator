import { useSyncExternalStore } from "react";
import { previewText, splitChoices } from "./choices";
import { deleteKV, loadAll, putKV, putRecords, requestPersist } from "./db";
import { uid } from "./id";
import { libraryFromExtra, type LegacyImport } from "./importLegacy";
import { formatLore, matchLore, type LoreHit } from "./lore";
import { buildMemoryRequest, cleanMemory, pendingForMemory } from "./memory";
import { buildHistory, buildSystemPrompt, outputTokensFor, type StoryContext } from "./prompt";
import { generate, ProviderError, type Usage } from "./providers";
import { buildEpisodeRequest, buildOutlineRequest, EPISODE_LENGTH, parseOutline, previewEpisode, splitEpisode } from "./novel";
import { DEFAULT_SETTINGS, normalizeNovel, normalizeRoom, normalizeSettings, type Character, type Entity, type EntityKind, type Episode, type Message, type Novel, type Persona, type Room, type Settings, type World } from "./types";

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

let state: AppState = { ready: false, storageError: "", settings: DEFAULT_SETTINGS, rooms: {}, library: {}, activeRoomId: null, live: null, memoryJob: null, lastUsage: null, legacyExtra: null, view: "rooms", novels: {}, activeNovelId: null, novelLive: null, novelError: null };
const subs = new Set<() => void>();
const dirty = { rooms: new Set<string>(), library: new Set<string>(), novels: new Set<string>() };
const deleted = { rooms: new Set<string>(), library: new Set<string>(), novels: new Set<string>() };
let settingsDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;

export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
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
  try {
    await putRecords("rooms", rooms.items, delRooms);
    await putRecords("library", lib.items, delLib);
    await putRecords("novels", nov.items, delNov);
    if (saveSettings) await putKV("settings", state.settings);
    if (state.storageError) setState({ storageError: "" });
  } catch (e) {
    rooms.ids.forEach((id) => dirty.rooms.add(id));
    lib.ids.forEach((id) => dirty.library.add(id));
    nov.ids.forEach((id) => dirty.novels.add(id));
    delNov.forEach((id) => deleted.novels.add(id));
    delRooms.forEach((id) => deleted.rooms.add(id));
    delLib.forEach((id) => deleted.library.add(id));
    settingsDirty ||= saveSettings;
    setState({ storageError: `저장 실패: ${(e as Error)?.message || e}` });
    saveTimer = setTimeout(() => void flush(), 3000);
  }
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flush());

export async function init() {
  try {
    const { kv, rooms, library, novels } = await loadAll();
    const nmap: Record<string, Novel> = {};
    novels.forEach((n) => (nmap[n.id] = normalizeNovel(n)));
    const recentNovel = Object.values(nmap).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const map: Record<string, Room> = {};
    rooms.forEach((r) => (map[r.id] = normalizeRoom(r)));
    const lib: Record<string, Entity> = {};
    library.forEach((e) => (lib[e.id] = e));
    const recent = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const extra = (kv.legacyExtra as LegacyImport["extra"]) || null;
    setState({ ready: true, settings: normalizeSettings(kv.settings), rooms: map, library: lib, activeRoomId: recent?.id ?? null, novels: nmap, activeNovelId: recentNovel?.id ?? null, view: kv.view === "novels" ? "novels" : "rooms", legacyExtra: extra && (extra.worlds?.length || extra.characters?.length || extra.personas?.length) ? extra : null });
    void requestPersist();
  } catch (e) {
    setState({ ready: true, storageError: `브라우저 저장소(IndexedDB)를 열 수 없습니다: ${(e as Error)?.message || e}. 이 상태에서는 데이터가 저장되지 않습니다.` });
  }
}

/* ---------------- 설정 · 이야기방 ---------------- */
export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: normalizeSettings({ ...s.settings, ...patch }) }));
  settingsDirty = true;
  scheduleSave();
}

function putRoom(room: Room) {
  setState((s) => ({ rooms: { ...s.rooms, [room.id]: room } }));
  dirty.rooms.add(room.id);
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
}
export function createRoom(opts: NewRoom = {}): string {
  const now = Date.now();
  const room: Room = { id: uid("r"), title: opts.title?.trim() || "새 이야기", premise: opts.premise ?? "", memory: "", messages: [], createdAt: now, updatedAt: now, characterIds: opts.characterIds ?? [], ...(opts.worldId ? { worldId: opts.worldId } : {}), ...(opts.personaId ? { personaId: opts.personaId } : {}) };
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
  rooms.forEach((r) => putRoom(normalizeRoom(r)));
}

/* ---------------- 라이브러리 ---------------- */
export function putEntity(e: Entity) {
  setState((s) => ({ library: { ...s.library, [e.id]: e } }));
  dirty.library.add(e.id);
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
  for (const r of Object.values(state.rooms)) {
    if (r.worldId === id || r.personaId === id || r.characterIds.includes(id))
      putRoom({ ...r, worldId: r.worldId === id ? undefined : r.worldId, personaId: r.personaId === id ? undefined : r.personaId, characterIds: r.characterIds.filter((c) => c !== id) });
  }
  for (const e of Object.values(state.library)) if (e.kind === "character" && e.worldId === id) putEntity({ ...e, worldId: undefined });
  for (const n of Object.values(state.novels))
    if (n.worldId === id || n.personaId === id || n.characterIds.includes(id))
      putNovel({ ...n, worldId: n.worldId === id ? undefined : n.worldId, personaId: n.personaId === id ? undefined : n.personaId, characterIds: n.characterIds.filter((c) => c !== id) });
  scheduleSave();
}
export function upsertLibrary(items: Entity[]) {
  items.forEach(putEntity);
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
/** v0.1 에서 보관만 해 둔 세계관·캐릭터를 라이브러리로 */
export function importLegacyExtra(): number {
  const items = state.legacyExtra ? libraryFromExtra(state.legacyExtra) : [];
  upsertLibrary(items);
  setState({ legacyExtra: null });
  void deleteKV("legacyExtra");
  return items.length;
}

/* ---------------- 생성 ---------------- */
export const isGenerating = () => state.live !== null;
export function stopGeneration() {
  controller?.abort();
}

export async function send(roomId: string, text: string) {
  const r = state.rooms[roomId];
  if (!r || isGenerating()) return;
  const t = text.trim();
  const msg: Message = { id: uid("m"), role: "user", text: t, createdAt: Date.now() };
  const title = r.messages.length === 0 && r.title === "새 이야기" && t ? t.slice(0, 24) + (t.length > 24 ? "…" : "") : r.title;
  updateRoom(roomId, { messages: t ? [...r.messages, msg] : r.messages, title });
  await runGeneration(roomId);
}

/** 마지막 AI 응답을 지우고 다시 생성 */
export async function regenerate(roomId: string) {
  const r = state.rooms[roomId];
  if (!r || isGenerating()) return;
  const msgs = [...r.messages];
  while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
  updateRoom(roomId, { messages: msgs });
  await runGeneration(roomId);
}

/** 최근 대화에 등장한 로어북 항목 (세계관 + 등장인물) */
export function loreFor(room: Room, ctx: StoryContext): LoreHit[] {
  const groups = [...(ctx.world ? [{ source: ctx.world.name, entries: ctx.world.lore }] : []), ...ctx.characters.map((c) => ({ source: c.name, entries: c.lore }))];
  if (!groups.some((g) => g.entries.length)) return [];
  const recent = room.messages.filter((m) => !m.error).slice(-4).map((m) => m.text).join("\n");
  return matchLore(groups, recent);
}

async function runGeneration(roomId: string) {
  const room = state.rooms[roomId];
  const s = state.settings;
  if (!room) return;
  const ctx = contextFor(room);
  const history = buildHistory(room, s.contextMessages);
  if (!history.length) history.push({ role: "user", content: "이야기를 시작해 주세요." });
  // 로어북은 시스템 프롬프트가 아니라 마지막 입력에 붙인다 → 앞부분이 고정돼 프롬프트 캐시가 유지됨
  const lore = loreFor(room, ctx);
  if (lore.length) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}\n\n<참고 설정: 이번 장면과 관련된 자료. 필요한 만큼만 자연스럽게 반영하고 그대로 옮겨 쓰지 말 것>\n${formatLore(lore)}\n</참고 설정>` };
  }
  controller = new AbortController();
  setState({ live: { roomId, text: "", thinking: "", status: "", startedAt: Date.now(), lore } });
  const live = (p: Partial<LiveState>) => setState((st) => (st.live ? { live: { ...st.live, ...p } } : {}));
  let streamed = "";
  let ok = false;
  try {
    const res = await generate({
      settings: s,
      system: buildSystemPrompt(s, room, ctx),
      messages: history,
      maxTokens: outputTokensFor(s),
      signal: controller.signal,
      onText: (d) => {
        streamed += d;
        live({ text: previewText(streamed), status: "" });
      },
      onThinking: (d) => live({ thinking: (state.live?.thinking ?? "") + d }),
      onStatus: (m) => live({ status: m }),
    });
    const { text, choices } = s.choices ? splitChoices(res.text) : { text: res.text.trim(), choices: [] };
    if (!text) throw new ProviderError("AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.", 0, "server");
    const cur = state.rooms[roomId];
    const reply: Message = { id: uid("m"), role: "assistant", text, ...(choices.length ? { choices } : {}), ...(res.thinking ? { thinking: res.thinking } : {}), model: res.model, createdAt: Date.now() };
    if (cur) updateRoom(roomId, { messages: [...cur.messages, reply] });
    setState({ lastUsage: res.usage ? { ...res.usage, model: res.model } : null });
    ok = true;
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
    const res = await generate({ settings: s, ...req, maxTokens: 3000 });
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
  scheduleSave();
}
export function upsertNovels(list: Novel[]) {
  list.forEach((n) => putNovel(normalizeNovel(n)));
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
    const res = await generate({
      settings: s,
      ...buildOutlineRequest(s, n, contextFor(n), from),
      maxTokens: Math.min(16000, 1500 + (n.episodeCount - from) * 250),
      signal: novelController.signal,
      onText: (d) => novelLiveSet({ text: (streamed += d), status: "" }),
      onThinking: (d) => novelLiveSet({ thinking: (state.novelLive?.thinking ?? "") + d }),
      onStatus: (m) => novelLiveSet({ status: m }),
    });
    const items = parseOutline(res.text).filter((x) => x.number > from);
    if (!items.length) throw new Error("개요 형식을 읽지 못했습니다. 다시 시도해 주세요.");
    const cur = state.novels[novelId] ?? n;
    const outline = [...cur.outline.slice(0, from), ...items.slice(0, cur.episodeCount - from).map((x) => ({ id: uid("o"), title: x.title, summary: x.summary }))];
    updateNovel(novelId, { outline });
    setState({ lastUsage: res.usage ? { ...res.usage, model: res.model } : null });
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
  const save = (raw: string, model: string, incomplete: boolean) => {
    const { text, summary } = splitEpisode(raw);
    const cur = state.novels[novelId];
    if (!cur || !text) return;
    const now = Date.now();
    const old = cur.episodes[index];
    const ep: Episode = { id: old?.id ?? uid("e"), title: cur.outline[index]?.title ?? `${index + 1}화`, text, summary, model, ...(incomplete ? { incomplete: true } : {}), createdAt: old?.createdAt ?? now, updatedAt: now };
    const episodes = [...cur.episodes];
    episodes[index] = ep;
    updateNovel(novelId, { episodes });
  };
  try {
    const s = state.settings;
    const ctx = contextFor(n);
    const groups = [...(ctx.world ? [{ source: ctx.world.name, entries: ctx.world.lore }] : []), ...ctx.characters.map((c) => ({ source: c.name, entries: c.lore }))];
    const scan = [n.outline[index].title, n.outline[index].summary, n.episodes[index - 1]?.text.slice(-1500) ?? ""].join("\n");
    const lore = groups.length ? formatLore(matchLore(groups, scan)) : "";
    const res = await generate({
      settings: s,
      ...buildEpisodeRequest(s, n, ctx, index, { lore, note }),
      maxTokens: EPISODE_LENGTH[n.episodeLength].tokens,
      signal: novelController.signal,
      onText: (d) => novelLiveSet({ text: previewEpisode((streamed += d)), status: "" }),
      onThinking: (d) => novelLiveSet({ thinking: (state.novelLive?.thinking ?? "") + d }),
      onStatus: (m) => novelLiveSet({ status: m }),
    });
    const cut = res.stopReason === "max_tokens" || res.stopReason === "length" || res.stopReason === "MAX_TOKENS";
    if (!splitEpisode(res.text).text) throw new Error("AI가 빈 원고를 보냈습니다. 다시 시도해 주세요.");
    save(res.text, res.model, cut);
    setState({ lastUsage: res.usage ? { ...res.usage, model: res.model } : null });
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
