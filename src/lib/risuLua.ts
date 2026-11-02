/**
 * RisuAI Lua 트리거 실행 (wasmoon = RisuAI와 같은 Lua 5.4 엔진)
 * RisuAI src/ts/process/scriptings.ts 의 API 이름·동작·권한 규칙을 따름 (AGPL-3.0)
 *  - 시점(mode)마다 엔진 하나: start → onStart, input → onInput, output → onOutput, 버튼 → 같은 이름의 전역 함수,
 *    onButtonClick, editRequest/editDisplay/editInput/editOutput → listenEdit 로 등록한 함수
 *  - 쓰기 API(setChat·addChat·alert…)는 이번 실행의 id에서만, editDisplay 실행은 변수 쓰기만 허용
 */
import { LuaFactory, type LuaEngine } from "wasmoon";
import wasmUri from "wasmoon/dist/glue.wasm?url";
import jsonLua from "./lua/json.lua?raw";
import wrapperLua from "./lua/wrapper.lua?raw";

export interface LuaChat {
  role: "user" | "char";
  data: string;
  time?: number;
}
/** Lua가 다루는 이야기방 (실행 후 host.chat 을 다시 읽어 반영) */
export interface LuaHost {
  chat: LuaChat[];
  getVar: (k: string) => string;
  setVar: (k: string, v: string) => boolean; // 바뀌었으면 true
  getGlobal: (k: string) => string;
  cbs: (t: string) => string;
  alertNormal: (m: string) => void;
  alertError: (m: string) => void;
  alertInput: (m: string) => Promise<string | null>;
  alertSelect: (opts: string[]) => Promise<string | null>;
  alertConfirm: (m: string) => Promise<boolean>;
  reload: () => void;
  name?: string;
  description?: string;
  firstMessage?: string;
  personaName?: string;
  personaDescription?: string;
  authorsNote?: string;
  backgroundEmbedding?: string;
  lore?: { comment: string; content: string; key: string; alwaysActive: boolean }[];
  llm?: (prompt: { role: string; content: string }[]) => Promise<string>; // lowLevelAccess 일 때만
  lowLevelAccess?: boolean;
}

let wasmOverride: string | undefined;
/** 테스트(Node)에서 wasm 파일 경로 지정 */
export function setLuaWasmUri(uri: string) {
  wasmOverride = uri;
  factoryP = null;
}
let factoryP: Promise<LuaFactory> | null = null;
function factory(): Promise<LuaFactory> {
  if (!factoryP)
    factoryP = (async () => {
      const f = new LuaFactory(wasmOverride ?? wasmUri);
      await f.mountFile("json.lua", jsonLua);
      return f;
    })().catch((e) => {
      factoryP = null;
      throw e;
    });
  return factoryP;
}

interface EngineState {
  engine: LuaEngine;
  code: string;
  host: LuaHost;
  stop: boolean;
  queue: Promise<unknown>;
}
const engines = new Map<string, EngineState>();
const safeIds = new Set<string>();
const displayIds = new Set<string>();
const lowIds = new Set<string>();
const codeKey = (code: string) => {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (Math.imul(h, 31) + code.charCodeAt(i)) | 0;
  return `${code.length}-${h}`;
};
const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

function declare(st: EngineState) {
  const g = st.engine.global;
  const h = () => st.host;
  const safe = (id: string) => safeIds.has(id);
  const api = (name: string, fn: (...a: never[]) => unknown) => g.set(name, fn);
  const at = (i: number) => h().chat.at(Number(i));
  const asJson = (m?: LuaChat) => JSON.stringify(m ? { role: m.role, data: m.data, time: m.time ?? 0 } : null);
  api("getChatVar", (_id: string, k: string) => h().getVar(String(k)));
  api("setChatVar", (id: string, k: string, v: string) => {
    if (safe(id) || displayIds.has(id)) h().setVar(String(k), String(v ?? ""));
  });
  api("setChatVarChanged", (id: string, k: string, v: string) => (safe(id) || displayIds.has(id) ? h().setVar(String(k), String(v ?? "")) || undefined : undefined));
  api("getGlobalVar", (_id: string, k: string) => h().getGlobal(String(k)));
  api("stopChat", (id: string) => {
    if (safe(id)) st.stop = true;
  });
  api("alertError", (id: string, v: string) => safe(id) && h().alertError(String(v)));
  api("alertNormal", (id: string, v: string) => safe(id) && h().alertNormal(String(v)));
  api("alertInput", (id: string, v: string) => (safe(id) ? h().alertInput(String(v)) : undefined));
  api("alertSelect", (id: string, v: string[]) => (safe(id) ? h().alertSelect(Array.isArray(v) ? v.map(String) : Object.values(v ?? {}).map(String)) : undefined));
  api("alertConfirm", (id: string, v: string) => (safe(id) ? h().alertConfirm(String(v)) : undefined));
  api("getChatMain", (_id: string, i: number) => asJson(at(i)));
  api("getChatData", (_id: string, i: number) => at(i)?.data ?? "");
  api("getChatRole", (_id: string, i: number) => at(i)?.role ?? "");
  api("getRecentChatsMain", (_id: string, n: number) => JSON.stringify(h().chat.slice(Math.max(0, h().chat.length - Math.max(0, Math.floor(n || 0)))).map((m) => ({ role: m.role, data: m.data, time: m.time ?? 0 }))));
  api("setChat", (id: string, i: number, v: string) => {
    const m = safe(id) ? at(i) : undefined;
    if (m) m.data = String(v ?? "");
  });
  api("setChatRole", (id: string, i: number, v: string) => {
    const m = safe(id) ? at(i) : undefined;
    if (m) m.role = v === "user" ? "user" : "char";
  });
  api("cutChat", (id: string, s: number, e: number) => {
    if (safe(id)) h().chat = h().chat.slice(s, e);
  });
  api("removeChat", (id: string, i: number) => {
    if (safe(id)) h().chat.splice(Number(i), 1);
  });
  api("addChat", (id: string, role: string, v: string) => {
    if (safe(id)) h().chat.push({ role: role === "user" ? "user" : "char", data: String(v ?? ""), time: Date.now() });
  });
  api("insertChat", (id: string, i: number, role: string, v: string) => {
    if (safe(id)) h().chat.splice(Number(i), 0, { role: role === "user" ? "user" : "char", data: String(v ?? ""), time: Date.now() });
  });
  api("getTokens", (id: string, v: string) => (safe(id) ? Math.ceil(String(v ?? "").length / 3) : undefined));
  api("getChatLength", () => h().chat.length);
  api("getFullChatMain", () => JSON.stringify(h().chat.map((m) => ({ role: m.role, data: m.data, time: m.time ?? 0 }))));
  api("sleep", (id: string, ms: number) => (safe(id) ? new Promise((r) => setTimeout(() => r(true), Number(ms) || 0)) : undefined));
  api("cbs", (v: string) => h().cbs(String(v ?? "")));
  api("setFullChatMain", (id: string, v: string) => {
    if (!safe(id)) return;
    const arr = JSON.parse(String(v)) as { role: string; data: string }[];
    h().chat = arr.map((m) => ({ role: m.role === "user" ? "user" : "char", data: String(m.data ?? "") }));
  });
  api("logMain", (v: string) => console.log("[Lua]", (() => { try { return JSON.parse(String(v)); } catch { return v; } })()));
  api("reloadDisplay", (id: string) => safe(id) && h().reload());
  api("reloadChat", (id: string) => safe(id) && h().reload());
  api("getName", () => h().name ?? "");
  api("setName", () => undefined);
  api("getDescription", (id: string) => (safe(id) ? h().description ?? "" : undefined));
  api("setDescription", () => undefined);
  api("getCharacterFirstMessage", () => h().firstMessage ?? "");
  api("setCharacterFirstMessage", () => undefined);
  api("getPersonaName", () => h().personaName ?? "");
  api("getPersonaDescription", () => h().personaDescription ?? "");
  api("getAuthorsNote", () => h().authorsNote ?? "");
  api("getBackgroundEmbedding", (id: string) => (safe(id) ? h().backgroundEmbedding ?? "" : undefined));
  api("setBackgroundEmbedding", () => undefined);
  api("getCharacterLastMessage", () => [...h().chat].reverse().find((m) => m.role === "char")?.data ?? h().firstMessage ?? "");
  api("getUserLastMessage", () => [...h().chat].reverse().find((m) => m.role === "user")?.data ?? "");
  api("getLoreBooksMain", (id: string, search: string) => (safe(id) ? JSON.stringify((h().lore ?? []).filter((l) => l.comment === search)) : undefined));
  api("loadLoreBooksMain", async (id: string) => (safe(id) ? JSON.stringify((h().lore ?? []).filter((l) => l.alwaysActive).map((l) => ({ role: "system", data: l.content }))) : undefined));
  api("upsertLocalLoreBook", () => undefined);
  api("hash", async (_id: string, v: string) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(v ?? "")));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  });
  api("similarity", async () => JSON.stringify([]));
  api("request", async () => JSON.stringify({ status: 403, data: "이 앱에서는 외부 요청을 허용하지 않습니다." }));
  api("generateImage", async () => "");
  api("getCharacterImageMain", async () => "");
  api("getPersonaImageMain", async () => "");
  const llm = async (id: string, promptStr: string) => {
    if (!lowIds.has(id) || !h().llm) return JSON.stringify({ success: false, result: "LLM은 low level access를 허용한 봇에서만 쓸 수 있습니다." });
    try {
      const prompt = (JSON.parse(String(promptStr)) as { role: string; content: string }[]).map((p) => ({ role: p.role === "sys" ? "system" : p.role === "bot" ? "assistant" : p.role, content: String(p.content ?? "") }));
      return JSON.stringify({ success: true, result: await h().llm!(prompt) });
    } catch (e) {
      return JSON.stringify({ success: false, result: (e as Error).message });
    }
  };
  api("LLMMain", llm);
  api("axLLMMain", llm);
  api("simpleLLM", async (id: string, p: string) => JSON.parse(await llm(id, JSON.stringify([{ role: "user", content: String(p) }]))));
}

async function engineFor(mode: string, code: string, host: LuaHost): Promise<EngineState> {
  let st = engines.get(mode);
  if (st && st.code === code) {
    st.host = host;
    return st;
  }
  st?.engine.global.close();
  const f = await factory();
  const engine = await f.createEngine({ injectObjects: true, enableProxy: false });
  st = { engine, code, host, stop: false, queue: Promise.resolve() };
  declare(st);
  await engine.doString(`${wrapperLua}\n${code}`);
  engines.set(mode, st);
  return st;
}

export interface LuaResult {
  stop: boolean;
  res: unknown;
  error?: string;
}
/**
 * Lua 코드를 mode로 실행. mode: start · input · output · 버튼 이름 · onButtonClick · editRequest · editDisplay · editInput · editOutput
 * data: onButtonClick은 버튼 값, edit* 는 바꿀 값 (editDisplay 문자열, 나머지는 JSON으로 주고받음)
 */
export async function runLua(code: string, mode: string, host: LuaHost, data?: unknown, meta: object = {}): Promise<LuaResult> {
  // 코드마다 엔진 하나 (편집 리스너는 따로) — 같은 봇의 버튼·출력 처리는 Lua 전역 상태를 공유
  const key = `${mode.startsWith("edit") ? mode : "main"}:${codeKey(code)}`;
  const st = await engineFor(key, code, host);
  const run = async (): Promise<LuaResult> => {
    st.host = host;
    st.stop = false;
    const id = newId();
    if (mode === "editDisplay") displayIds.add(id);
    else {
      safeIds.add(id);
      if (host.lowLevelAccess) lowIds.add(id);
    }
    let res: unknown;
    let error: string | undefined;
    try {
      const g = st.engine.global;
      if (mode === "input" || mode === "output" || mode === "start") {
        const fn = g.get({ input: "onInput", output: "onOutput", start: "onStart" }[mode]);
        if (typeof fn === "function") res = await fn(id);
      } else if (mode === "onButtonClick") {
        const fn = g.get("onButtonClick");
        if (typeof fn === "function") res = await fn(id, data);
      } else if (mode === "onFormSubmit") {
        const fn = g.get("onFormSubmit");
        if (typeof fn === "function") res = await fn(id, data, JSON.stringify(meta));
      } else if (mode.startsWith("edit")) {
        const count = g.get("__countListeners");
        if (typeof count === "function" && (await count(mode)) > 0) {
          const fn = g.get("callListenMain");
          const direct = mode === "editDisplay";
          res = await fn(mode, id, direct ? data : JSON.stringify(data), JSON.stringify(meta));
          if (!direct) res = JSON.parse(String(res));
        } else res = data;
      } else {
        const fn = g.get(mode);
        if (typeof fn === "function") res = await fn(id);
      }
      if (res === false) st.stop = true;
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
      console.error("[Lua]", mode, e);
      if (mode.startsWith("edit")) res = data;
    } finally {
      safeIds.delete(id);
      displayIds.delete(id);
      lowIds.delete(id);
    }
    return { stop: st.stop, res, error };
  };
  // 같은 엔진은 한 번에 하나씩 (RisuAI mutex)
  const p = st.queue.then(run, run);
  st.queue = p.catch(() => undefined);
  return p;
}

/** 이 코드에 해당 리스너(editDisplay 등)가 등록돼 있는지 */
export async function hasListener(code: string, type: string, host: LuaHost): Promise<boolean> {
  const st = await engineFor(`${type}:${codeKey(code)}`, code, host);
  const count = st.engine.global.get("__countListeners");
  return typeof count === "function" && (await count(type)) > 0;
}

/** 트리거 목록에서 Lua 코드 모으기 (triggerlua 효과) */
export function luaCodesOf(triggers: unknown[]): string[] {
  const out: string[] = [];
  for (const t of triggers as { effect?: { type?: string; code?: string }[] }[]) for (const e of t?.effect ?? []) if (e?.type === "triggerlua" && typeof e.code === "string" && e.code.trim()) out.push(e.code);
  return out;
}

/** 버튼 실행 — store가 이야기방 상태로 host를 만들어 넘긴다 (store.runRisuTrigger) */
export async function runButton(roomId: string, name: string, id: string | null): Promise<void> {
  const { runRoomTrigger } = await import("./store");
  await runRoomTrigger(roomId, "manual", { manualName: name, triggerId: id });
}
