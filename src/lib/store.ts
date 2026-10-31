import { useSyncExternalStore } from "react";
import { previewText, splitChoices } from "./choices";
import { loadAll, putKV, putRooms, requestPersist } from "./db";
import { uid } from "./id";
import type { LegacyImport } from "./importLegacy";
import { buildHistory, buildSystemPrompt, outputTokensFor } from "./prompt";
import { generate, ProviderError, type Usage } from "./providers";
import { DEFAULT_SETTINGS, normalizeSettings, type Message, type Room, type Settings } from "./types";

export interface LiveState {
  roomId: string;
  text: string;
  thinking: string;
  status: string;
  startedAt: number;
}
export interface AppState {
  ready: boolean;
  storageError: string;
  settings: Settings;
  rooms: Record<string, Room>;
  activeRoomId: string | null;
  live: LiveState | null;
  lastUsage: (Usage & { model: string }) | null;
}

let state: AppState = { ready: false, storageError: "", settings: DEFAULT_SETTINGS, rooms: {}, activeRoomId: null, live: null, lastUsage: null };
const subs = new Set<() => void>();
const dirty = new Set<string>();
const deleted = new Set<string>();
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
  const rooms = [...dirty].map((id) => state.rooms[id]).filter(Boolean);
  const del = [...deleted];
  const saveSettings = settingsDirty;
  dirty.clear();
  deleted.clear();
  settingsDirty = false;
  try {
    await putRooms(rooms, del);
    if (saveSettings) await putKV("settings", state.settings);
    if (state.storageError) setState({ storageError: "" });
  } catch (e) {
    rooms.forEach((r) => dirty.add(r.id));
    del.forEach((id) => deleted.add(id));
    settingsDirty ||= saveSettings;
    setState({ storageError: `저장 실패: ${(e as Error)?.message || e}` });
    saveTimer = setTimeout(() => void flush(), 3000);
  }
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flush());

export async function init() {
  try {
    const { kv, rooms } = await loadAll();
    const map: Record<string, Room> = {};
    rooms.forEach((r) => (map[r.id] = r));
    const recent = rooms.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setState({ ready: true, settings: normalizeSettings(kv.settings), rooms: map, activeRoomId: recent?.id ?? null });
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
  dirty.add(room.id);
  scheduleSave();
}
export function updateRoom(id: string, patch: Partial<Room>) {
  const r = state.rooms[id];
  if (r) putRoom({ ...r, ...patch, updatedAt: Date.now() });
}
export function createRoom(title = "새 이야기", premise = ""): string {
  const now = Date.now();
  const room: Room = { id: uid("r"), title, premise, memory: "", messages: [], createdAt: now, updatedAt: now };
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
  dirty.delete(id);
  deleted.add(id);
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
  rooms.forEach((r) => putRoom(r));
}

export function importLegacy(data: LegacyImport, withKeys: boolean) {
  data.rooms.forEach((r) => putRoom(r));
  if (withKeys && data.settingsPatch.keys) updateSettings({ keys: { ...state.settings.keys, ...data.settingsPatch.keys }, ...(data.settingsPatch.openaiBaseUrl ? { openaiBaseUrl: data.settingsPatch.openaiBaseUrl } : {}) });
  void putKV("legacyExtra", data.extra); // 세계관·캐릭터 등은 다음 버전의 관리 기능에서 사용
  if (data.rooms[0]) setState({ activeRoomId: data.rooms[0].id });
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

async function runGeneration(roomId: string) {
  const room = state.rooms[roomId];
  const s = state.settings;
  if (!room) return;
  const history = buildHistory(room, s.contextMessages);
  if (!history.length) history.push({ role: "user", content: "이야기를 시작해 주세요." });
  controller = new AbortController();
  setState({ live: { roomId, text: "", thinking: "", status: "", startedAt: Date.now() } });
  const live = (p: Partial<LiveState>) => setState((st) => (st.live ? { live: { ...st.live, ...p } } : {}));
  let streamed = "";
  try {
    const res = await generate({
      settings: s,
      system: buildSystemPrompt(s, room),
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
}
