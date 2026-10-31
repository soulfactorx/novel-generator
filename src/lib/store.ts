import { useSyncExternalStore } from "react";
import { previewText, splitChoices } from "./choices";
import { deleteKV, loadAll, putKV, putRecords, requestPersist } from "./db";
import { uid } from "./id";
import { libraryFromExtra, type LegacyImport } from "./importLegacy";
import { formatLore, matchLore, type LoreHit } from "./lore";
import { buildMemoryRequest, cleanMemory, pendingForMemory } from "./memory";
import { buildHistory, buildSystemPrompt, outputTokensFor, type StoryContext } from "./prompt";
import { generate, ProviderError, type Usage } from "./providers";
import { DEFAULT_SETTINGS, normalizeRoom, normalizeSettings, type Character, type Entity, type EntityKind, type Message, type Persona, type Room, type Settings, type World } from "./types";

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
}

let state: AppState = { ready: false, storageError: "", settings: DEFAULT_SETTINGS, rooms: {}, library: {}, activeRoomId: null, live: null, memoryJob: null, lastUsage: null, legacyExtra: null };
const subs = new Set<() => void>();
const dirty = { rooms: new Set<string>(), library: new Set<string>() };
const deleted = { rooms: new Set<string>(), library: new Set<string>() };
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
  const delRooms = [...deleted.rooms];
  const delLib = [...deleted.library];
  deleted.rooms.clear();
  deleted.library.clear();
  const saveSettings = settingsDirty;
  settingsDirty = false;
  try {
    await putRecords("rooms", rooms.items, delRooms);
    await putRecords("library", lib.items, delLib);
    if (saveSettings) await putKV("settings", state.settings);
    if (state.storageError) setState({ storageError: "" });
  } catch (e) {
    rooms.ids.forEach((id) => dirty.rooms.add(id));
    lib.ids.forEach((id) => dirty.library.add(id));
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
    const { kv, rooms, library } = await loadAll();
    const map: Record<string, Room> = {};
    rooms.forEach((r) => (map[r.id] = normalizeRoom(r)));
    const lib: Record<string, Entity> = {};
    library.forEach((e) => (lib[e.id] = e));
    const recent = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const extra = (kv.legacyExtra as LegacyImport["extra"]) || null;
    setState({ ready: true, settings: normalizeSettings(kv.settings), rooms: map, library: lib, activeRoomId: recent?.id ?? null, legacyExtra: extra && (extra.worlds?.length || extra.characters?.length || extra.personas?.length) ? extra : null });
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
  scheduleSave();
}
export function upsertLibrary(items: Entity[]) {
  items.forEach(putEntity);
}
export const entitiesOf = <K extends EntityKind>(lib: Record<string, Entity>, kind: K) =>
  (Object.values(lib).filter((e) => e.kind === kind) as Extract<Entity, { kind: K }>[]).sort((a, b) => a.name.localeCompare(b.name, "ko"));

export function contextFor(room: Room, lib = state.library): StoryContext {
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
