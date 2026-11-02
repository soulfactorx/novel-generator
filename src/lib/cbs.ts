/**
 * CBS (Curly Braced Syntax) — RisuAI의 {{…}} 문법
 * RisuAI src/ts/parser/parser.svelte.ts · cbs.ts · process/infunctions.ts 를 이 앱에 맞게 옮김 (AGPL-3.0)
 *  - 한 번 훑으며 안쪽 {{…}}부터 계산 (RisuAI와 같은 순서)
 *  - 블록: {{#if}} {{#if_pure}} {{#when …}} {{:else}} {{#pure}} {{#puredisplay}} {{#code}} {{#escape}} {{#each}} {{#func}}/{{call::}}
 *  - 변수: {{getvar}} {{setvar}} {{addvar}} {{setdefaultvar}} (runVar일 때만 기록), {{getglobalvar}}(토글 포함), {{tempvar}}
 *  - 계산·비교·문자열·배열·사전·무작위·날짜 함수 대부분
 * 에셋 표시({{img::}} 등)는 여기서 건드리지 않고 그대로 남겨 images.ts가 처리한다.
 */

export interface CbsMessage {
  role: "user" | "char";
  data: string;
  time?: number;
}
export interface CbsEnv {
  user: string;
  char: string;
  getVar: (key: string) => string; // 없으면 "null"
  setVar: (key: string, value: string) => void;
  getGlobal: (key: string) => string; // 없으면 "null"
  messages?: CbsMessage[]; // 첫 메시지(인사말)를 뺀 대화
  firstMessage?: string;
  chatIndex?: number; // 지금 처리 중인 메시지 번호 (-1: 첫 메시지·프롬프트)
  runVar?: boolean; // setvar 등을 실제로 기록할지 (출력 저장 시)
  rmVar?: boolean; // setvar 등을 지우기만 (표시용)
  displaying?: boolean;
  role?: string;
  firstMsg?: boolean;
  description?: string;
  personality?: string;
  scenario?: string;
  persona?: string;
  exampleDialogue?: string;
  assets?: string[];
  emotions?: string[];
  triggerId?: string;
  seed?: string; // pick·rollp 의 고정 난수 씨앗 (이야기 id 등)
  lang?: string;
  version?: string;
}

/* ---------------- 계산 ({{? 식}} · {{calc::식}}) ---------------- */
const OPS: Record<string, { p: number; a: "L" | "R" }> = { "+": { p: 2, a: "L" }, "-": { p: 2, a: "L" }, "*": { p: 3, a: "L" }, "/": { p: 3, a: "L" }, "^": { p: 4, a: "L" }, "%": { p: 3, a: "L" }, "<": { p: 1, a: "L" }, ">": { p: 1, a: "L" }, "|": { p: 1, a: "L" }, "&": { p: 1, a: "L" }, "≤": { p: 1, a: "L" }, "≥": { p: 1, a: "L" }, "=": { p: 1, a: "L" }, "≠": { p: 1, a: "L" }, "!": { p: 5, a: "R" } };
function toRPN(expression: string): string {
  let out = "";
  const st: string[] = [];
  const keys = Object.keys(OPS);
  expression = expression.replace(/\s+/g, "");
  const tokens: string[] = [];
  let last = "";
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === "-" && (i === 0 || keys.includes(expression[i - 1]) || expression[i - 1] === "(")) last += ch;
    else if (keys.includes(ch)) {
      tokens.push(last !== "" ? last : "0");
      last = "";
      tokens.push(ch);
    } else last += ch;
  }
  tokens.push(last !== "" ? last : "0");
  for (const t of tokens) {
    if (parseFloat(t) || t === "0") out += t + " ";
    else if (keys.includes(t)) {
      while (st.length && ((OPS[t].a === "L" && OPS[t].p <= OPS[st[st.length - 1]].p) || (OPS[t].a === "R" && OPS[t].p < OPS[st[st.length - 1]].p))) out += st.pop() + " ";
      st.push(t);
    }
  }
  while (st.length) out += st.pop() + " ";
  return out.trim();
}
function calcRPN(expression: string): number {
  const st: number[] = [];
  for (const t of expression.split(" ")) {
    if (parseFloat(t) || t === "0") st.push(parseFloat(t));
    else {
      const b = st.pop()!;
      const a = st.pop()!;
      switch (t) {
        case "+": st.push(a + b); break;
        case "-": st.push(a - b); break;
        case "*": st.push(a * b); break;
        case "/": st.push(a / b); break;
        case "^": st.push(a ** b); break;
        case "%": st.push(a % b); break;
        case "<": st.push(a < b ? 1 : 0); break;
        case ">": st.push(a > b ? 1 : 0); break;
        case "|": st.push(a || b); break;
        case "&": st.push(a && b); break;
        case "≤": st.push(a <= b ? 1 : 0); break;
        case "≥": st.push(a >= b ? 1 : 0); break;
        case "=": st.push(a === b ? 1 : 0); break;
        case "≠": st.push(a !== b ? 1 : 0); break;
        case "!": st.push(b ? 0 : 1); break;
      }
    }
  }
  return st.length ? st.pop()! : 0;
}
function evalRPN(text: string, env: CbsEnv): number {
  const num = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? "0" : n.toString();
  };
  text = text
    .replace(/\$([a-zA-Z0-9_]+)/g, (_, k: string) => num(env.getVar(k)))
    .replace(/@([a-zA-Z0-9_]+)/g, (_, k: string) => num(env.getGlobal(k)))
    .replace(/&&/g, "&").replace(/\|\|/g, "|").replace(/<=/g, "≤").replace(/>=/g, "≥").replace(/==/g, "=").replace(/!=/g, "≠").replace(/null/gi, "0");
  return calcRPN(toRPN(text));
}
export function calcString(text: string, env: CbsEnv): number {
  const depth: string[] = [""];
  for (const ch of text) {
    if (ch === "(") depth.push("");
    else if (ch === ")" && depth.length > 1) {
      const r = evalRPN(depth.pop()!, env);
      depth[depth.length - 1] += r;
    } else depth[depth.length - 1] += ch;
  }
  return evalRPN(depth.join(""), env);
}

/* ---------------- 도우미 ---------------- */
export function sfc32(a: number, b: number, c: number, d: number) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
export function pickHashRand(cid: number, word: string) {
  let h = 5515;
  const rand = (w: string) => {
    for (let i = 0; i < w.length; i++) h = (h << 5) + h + w.charCodeAt(i);
    return h;
  };
  const f = sfc32(rand(word), rand(word), rand(word), rand(word));
  for (let i = 0; i < cid % 1000; i++) f();
  return f();
}
function parseArray(s: string): unknown[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : s.split("§");
  } catch {
    return s.split("§");
  }
}
function parseDict(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
const makeArray = (a: unknown[]) => JSON.stringify(a.map((f) => (typeof f === "string" ? f.replace(/::/g, "\\u003A\\u003A") : f)));
const ESC_BACK = ["{", "}", "(", ")", "<", ">", ":", ";"];
export const risuUnescape = (t: string) => t.replace(/[-]/g, (f) => ESC_BACK[f.charCodeAt(0) - 0xe9b8]);
const risuEscape = (t: string) => t.replace(/[{}()]/g, (f) => ({ "{": "", "}": "", "(": "", ")": "" })[f]!);
function dateTimeFormat(main: string, time = 0): string {
  const date = time === 0 ? new Date() : new Date(time);
  if (!main) return "";
  if (main.startsWith(":")) main = main.slice(1);
  if (main.length > 300) return "";
  return main
    .replace(/YYYY/g, date.getFullYear().toString())
    .replace(/YY/g, date.getFullYear().toString().substring(2))
    .replace(/MMMM/g, Intl.DateTimeFormat("en", { month: "long" }).format(date))
    .replace(/MMM/g, Intl.DateTimeFormat("en", { month: "short" }).format(date))
    .replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, "0"))
    .replace(/DDDD/g, Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000).toString())
    .replace(/DD/g, date.getDate().toString().padStart(2, "0"))
    .replace(/dddd/g, Intl.DateTimeFormat("en", { weekday: "long" }).format(date))
    .replace(/ddd/g, Intl.DateTimeFormat("en", { weekday: "short" }).format(date))
    .replace(/HH/g, date.getHours().toString().padStart(2, "0"))
    .replace(/hh/g, (date.getHours() % 12 || 12).toString().padStart(2, "0"))
    .replace(/mm/g, date.getMinutes().toString().padStart(2, "0"))
    .replace(/ss/g, date.getSeconds().toString().padStart(2, "0"))
    .replace(/X/g, Math.floor(date.getTime() / 1000).toString())
    .replace(/x/g, date.getTime().toString())
    .replace(/A/g, date.getHours() >= 12 ? "PM" : "AM");
}

/* ---------------- 함수 표 ---------------- */
interface Ctx {
  env: CbsEnv;
  vars: Record<string, string>;
  getNested: () => string[];
  setNestedRoot: (v: string) => void;
}
type Fn = (args: string[], c: Ctx, raw: string) => string | null;
const FN = new Map<string, Fn>();
const def = (names: string[], fn: Fn) => names.forEach((n) => FN.set(n, fn));
const n = (v: string) => Number(v);
const msgs = (e: CbsEnv) => e.messages ?? [];
const randPick = (args: string[], rand: number) => {
  if (!args.length) return rand.toString();
  const arr: unknown[] = args.length === 1 ? (args[0].startsWith("[") && args[0].endsWith("]") ? parseArray(args[0]) : args[0].replace(/\\,/g, "§X").split(/:|,/g)) : args;
  const el = arr[Math.floor(rand * arr.length)];
  return typeof el === "string" ? el.replace(/§X/g, ",") : JSON.stringify(el) ?? "";
};
const rollN = (args: string[], rand: (i: number) => number) => {
  if (!args.length) return "1";
  const no = args[0].split("d");
  let num = 1;
  let sides = 6;
  if (no.length === 2) [num, sides] = [Number(no[0] || 1), Number(no[1] || 6)];
  else sides = Number(no[0]);
  if (isNaN(num) || isNaN(sides) || num < 1 || sides < 1) return "NaN";
  let t = 0;
  for (let i = 0; i < num; i++) t += Math.floor(rand(i) * sides) + 1;
  return t.toString();
};
const num0 = (v: unknown) => (isNaN(Number(v)) ? 0 : Number(v));
const listOf = (args: string[]) => (args.length > 1 ? args : parseArray(args[0]).map(String));

def(["char", "bot"], (_, c) => c.env.char);
def(["user"], (_, c) => c.env.user);
def(["triggerid", "triggerid"], (_, c) => c.env.triggerId ?? "null");
def(["previouscharchat", "lastcharmessage"], (_, c) => {
  const m = msgs(c.env);
  for (let p = (c.env.chatIndex ?? -1) !== -1 ? c.env.chatIndex! - 1 : m.length - 1; p >= 0; p--) if (m[p]?.role === "char") return m[p].data;
  return c.env.firstMessage ?? "";
});
def(["previoususerchat", "lastusermessage"], (_, c) => {
  const ci = c.env.chatIndex ?? -1;
  if (ci === -1) return "";
  const m = msgs(c.env);
  for (let p = ci - 1; p >= 0; p--) if (m[p]?.role === "user") return m[p].data;
  return c.env.firstMessage ?? "";
});
def(["personality", "charpersona"], (_, c) => c.env.personality ?? "");
def(["description", "chardesc"], (_, c) => c.env.description ?? "");
def(["scenario"], (_, c) => c.env.scenario ?? "");
def(["exampledialogue", "examplemessage"], (_, c) => c.env.exampleDialogue ?? "");
def(["persona", "userpersona"], (_, c) => c.env.persona ?? "");
def(["userhistory", "usermessages"], (_, c) => makeArray(msgs(c.env).filter((m) => m.role === "user").map((m) => m.data)));
def(["charhistory", "charmessages"], (_, c) => makeArray(msgs(c.env).filter((m) => m.role === "char").map((m) => m.data)));
def(["chatindex"], (_, c) => String(c.env.chatIndex ?? -1));
def(["firstmsgindex", "firstmessageindex"], () => "-1");
def(["blank", "none"], () => "");
def(["unixtime"], () => (Date.now() / 1000).toFixed(0));
def(["isotime"], () => {
  const d = new Date();
  return `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}`;
});
def(["isodate"], () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
});
def(["time"], (a) => {
  if (!a.length) {
    const d = new Date();
    return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
  }
  return dateTimeFormat(a[0], a[1] ? num0(a[1]) / 1000 : 0);
});
def(["date", "datetimeformat"], (a) => {
  if (!a.length) {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  return dateTimeFormat(a[0], a[1] ? num0(a[1]) / 1000 : 0);
});
def(["messagetime"], (_, c) => {
  const t = msgs(c.env)[c.env.chatIndex ?? -1]?.time;
  return t ? new Date(t).toLocaleTimeString() : "[Cannot get time]";
});
def(["messagedate"], (_, c) => {
  const t = msgs(c.env)[c.env.chatIndex ?? -1]?.time;
  return t ? new Date(t).toLocaleDateString() : "[Cannot get time]";
});
def(["br", "newline"], () => "\n");
def(["role"], (_, c) => (c.env.firstMsg ? "char" : (c.env.chatIndex ?? -1) !== -1 ? (msgs(c.env)[c.env.chatIndex!]?.role ?? "null") : (c.env.role ?? "null")));
def(["isfirstmsg", "isfirstmessage"], (_, c) => (c.env.firstMsg ? "1" : "0"));
def(["jbtoggled"], () => "1");
def(["maxcontext"], () => "0");
def(["model"], () => "");
def(["lastmessage"], (_, c) => msgs(c.env).at(-1)?.data ?? c.env.firstMessage ?? "");
def(["lastmessageid", "lastmessageindex"], (_, c) => String(msgs(c.env).length - 1));
def(["tempvar", "gettempvar"], (a, c) => c.vars[a[0]] ?? "");
def(["settempvar"], (a, c) => ((c.vars[a[0]] = a[1]), ""));
def(["return"], (a, c) => ((c.vars.__return__ = a[0]), (c.vars.__force_return__ = "1"), ""));
def(["getvar"], (a, c) => c.env.getVar(a[0]));
def(["calc"], (a, c) => calcString(a[0], c.env).toString());
def(["addvar"], (a, c) => (c.env.rmVar ? "" : c.env.runVar ? (c.env.setVar(a[0], (Number(c.env.getVar(a[0])) + Number(a[1])).toString()), "") : null));
def(["setvar"], (a, c) => (c.env.rmVar ? "" : c.env.runVar ? (c.env.setVar(a[0], a[1]), "") : null));
def(["setdefaultvar"], (a, c) => {
  if (c.env.rmVar) return "";
  if (!c.env.runVar) return null;
  const cur = c.env.getVar(a[0]);
  if (!cur || cur === "null") c.env.setVar(a[0], a[1]);
  return "";
});
def(["getglobalvar"], (a, c) => c.env.getGlobal(a[0]));
def(["button"], (a) => `<button class="button-default" risu-trigger="${a[1]}">${a[0]}</button>`);
def(["risu"], () => "");
def(["equal"], (a) => (a[0] === a[1] ? "1" : "0"));
def(["notequal", "notequal"], (a) => (a[0] !== a[1] ? "1" : "0"));
def(["greater"], (a) => (n(a[0]) > n(a[1]) ? "1" : "0"));
def(["less"], (a) => (n(a[0]) < n(a[1]) ? "1" : "0"));
def(["greaterequal"], (a) => (n(a[0]) >= n(a[1]) ? "1" : "0"));
def(["lessequal"], (a) => (n(a[0]) <= n(a[1]) ? "1" : "0"));
def(["and"], (a) => (a[0] === "1" && a[1] === "1" ? "1" : "0"));
def(["or"], (a) => (a[0] === "1" || a[1] === "1" ? "1" : "0"));
def(["not"], (a) => (a[0] === "1" ? "0" : "1"));
def(["startswith"], (a) => (a[0].startsWith(a[1]) ? "1" : "0"));
def(["endswith"], (a) => (a[0].endsWith(a[1]) ? "1" : "0"));
def(["contains"], (a) => (a[0].includes(a[1]) ? "1" : "0"));
def(["replace"], (a) => a[0].replaceAll(a[1], a[2]));
def(["split"], (a) => makeArray(a[0].split(a[1])));
def(["join"], (a) => parseArray(a[0]).join(a[1]));
def(["spread"], (a) => parseArray(a[0]).join("::"));
def(["trim"], (a) => a[0].trim());
def(["length"], (a) => a[0].length.toString());
def(["arraylength"], (a) => parseArray(a[0]).length.toString());
def(["lower"], (a) => a[0].toLocaleLowerCase());
def(["upper"], (a) => a[0].toLocaleUpperCase());
def(["capitalize"], (a) => a[0].charAt(0).toUpperCase() + a[0].slice(1));
def(["round"], (a) => Math.round(n(a[0])).toString());
def(["floor"], (a) => Math.floor(n(a[0])).toString());
def(["ceil"], (a) => Math.ceil(n(a[0])).toString());
def(["abs"], (a) => Math.abs(n(a[0])).toString());
def(["remaind"], (a) => (n(a[0]) % n(a[1])).toString());
def(["previouschatlog"], (a, c) => msgs(c.env)[n(a[0])]?.data ?? "Out of range");
def(["tonumber"], (a) => [...a[0]].filter((v) => !isNaN(Number(v)) || v === ".").join(""));
def(["pow"], (a) => Math.pow(n(a[0]), n(a[1])).toString());
def(["arrayelement"], (a) => {
  const el = parseArray(a[0]).at(n(a[1])) ?? "null";
  return typeof el === "object" ? JSON.stringify(el) : String(el);
});
def(["dictelement", "objectelement"], (a) => {
  const el = parseDict(a[0])[a[1]] ?? "null";
  return typeof el === "object" ? JSON.stringify(el) : String(el);
});
def(["objectassert", "dictassert"], (a) => {
  const d = parseDict(a[0]);
  if (!d[a[1]]) d[a[1]] = a[2];
  return JSON.stringify(d);
});
def(["element", "ele"], (a) => {
  try {
    let cur: unknown = a[0];
    for (const k of a.slice(1)) {
      const p = JSON.parse(String(cur));
      if (p === null || typeof p !== "object") return "null";
      cur = (p as Record<string, unknown>)[k];
      if (!cur) return "null";
    }
    return typeof cur === "object" ? JSON.stringify(cur) : String(cur);
  } catch {
    return "null";
  }
});
def(["arrayshift"], (a) => makeArray(parseArray(a[0]).slice(1)));
def(["arraypop"], (a) => makeArray(parseArray(a[0]).slice(0, -1)));
def(["arraypush"], (a) => makeArray([...parseArray(a[0]), a[1]]));
def(["arraysplice"], (a) => {
  const arr = parseArray(a[0]);
  arr.splice(n(a[1]), n(a[2]), a[3]);
  return makeArray(arr);
});
def(["arrayassert"], (a) => {
  const arr = parseArray(a[0]);
  if (n(a[1]) >= arr.length) arr[n(a[1])] = a[2];
  return makeArray(arr);
});
def(["makearray", "array", "a"], (a) => makeArray(a));
def(["makedict", "dict", "d", "makeobject", "object", "o"], (a) => {
  const out: Record<string, string> = {};
  for (const cur of a) {
    const i = cur.indexOf("=");
    if (i !== -1) out[cur.slice(0, i)] = cur.slice(i + 1);
  }
  return JSON.stringify(out);
});
def(["emotionlist"], (_, c) => makeArray(c.env.emotions ?? []));
def(["assetlist"], (_, c) => makeArray(c.env.assets ?? []));
def(["prefillsupported", "prefill"], () => "0");
def(["screenwidth"], () => (typeof window !== "undefined" ? String(window.innerWidth) : "0"));
def(["screenheight"], () => (typeof window !== "undefined" ? String(window.innerHeight) : "0"));
def(["cbr", "cnl", "cnewline"], (a, _c, raw) => (a.length ? raw.repeat(n(a[0]) < 1 ? 1 : n(a[0])) : "\\n"));
def(["decbo", "displayescapedcurlybracketopen"], () => "");
def(["decbc", "displayescapedcurlybracketclose"], () => "");
def(["bo", "ddecbo"], () => "");
def(["bc", "ddecbc"], () => "");
def(["displayescapedbracketopen", "debo", "("], () => "");
def(["displayescapedbracketclose", "debc", ")"], () => "");
def(["displayescapedanglebracketopen", "deabo", "<"], () => "");
def(["displayescapedanglebracketclose", "deabc", ">"], () => "");
def(["displayescapedcolon", "dec", ":"], () => "");
def(["displayescapedsemicolon", ";"], () => "");
def(["history", "messages"], (a, c) => (a.length ? makeArray(msgs(c.env).map((f) => (a.includes("role") ? f.role + ": " : "") + f.data)) : makeArray([{ role: "char", data: c.env.firstMessage ?? "" }, ...msgs(c.env)].map((v) => JSON.stringify(v)))));
def(["range"], (a) => {
  const arr = parseArray(a[0]).map(Number);
  const [start, end, step] = arr.length > 1 ? [arr[0], arr[1], arr[2] ?? 1] : [0, arr[0], 1];
  const out: string[] = [];
  for (let i = start; i < end && out.length < 10000; i += step || 1) out.push(String(i));
  return makeArray(out);
});
def(["moduleenabled"], () => "0");
def(["filter"], (a) => {
  const arr = parseArray(a[0]);
  const t = Math.max(0, ["all", "nonempty", "unique"].indexOf(a[1]));
  return makeArray(arr.filter((f, i) => (t === 0 ? f !== "" && i === arr.indexOf(f) : t === 1 ? f !== "" : i === arr.indexOf(f))));
});
def(["all"], (a) => (listOf(a).every((f) => f === "1") ? "1" : "0"));
def(["any"], (a) => (listOf(a).some((f) => f === "1") ? "1" : "0"));
def(["min"], (a) => Math.min(...listOf(a).map(num0)).toString());
def(["max"], (a) => Math.max(...listOf(a).map(num0)).toString());
def(["sum"], (a) => listOf(a).map(num0).reduce((x, y) => x + y, 0).toString());
def(["average"], (a) => {
  const v = listOf(a).map(num0);
  return (v.reduce((x, y) => x + y, 0) / v.length).toString();
});
def(["fixnum", "fixnumber"], (a) => n(a[0]).toFixed(n(a[1])));
def(["unicodeencode"], (a) => a[0].charCodeAt(a[1] ? n(a[1]) : 0).toString());
def(["unicodedecode"], (a) => String.fromCharCode(n(a[0])));
def(["u", "unicodedecodefromhex", "ue", "unicodeencodefromhex"], (a) => String.fromCharCode(parseInt(a[0], 16)));
def(["hash"], (a) => (pickHashRand(0, a[0]) * 10000000 + 1).toFixed(0).padStart(7, "0"));
def(["randint"], (a) => {
  const [lo, hi] = [n(a[0]), n(a[1])];
  return isNaN(lo) || isNaN(hi) ? "NaN" : (Math.floor(Math.random() * (hi - lo + 1)) + lo).toString();
});
def(["dice"], (a) => rollN(a, () => Math.random()));
def(["roll"], (a) => rollN(a, () => Math.random()));
def(["rollp", "rollpick"], (a, c) => rollN(a, (i) => pickHashRand(msgs(c.env).length + i * 15, c.env.seed ?? "")));
def(["random"], (a) => randPick(a, Math.random()));
def(["pick"], (a, c) => randPick(a, pickHashRand(msgs(c.env).length, c.env.seed ?? "")));
def(["fromhex"], (a) => Number.parseInt(a[0], 16).toString());
def(["tohex"], (a) => Number.parseInt(a[0]).toString(16));
def(["metadata"], (a, c) => {
  switch (a[0].toLocaleLowerCase()) {
    case "mobile": return typeof window !== "undefined" && window.innerWidth < 768 ? "1" : "0";
    case "local": case "node": return "0";
    case "version": return c.env.version ?? "0";
    case "majorversion": case "majorver": case "major": return (c.env.version ?? "0").split(".")[0];
    case "language": case "locale": case "lang": return c.env.lang ?? "ko";
    case "browserlanguage": case "browserlocale": case "browserlang": return typeof navigator !== "undefined" ? navigator.language : "ko";
    default: return "null";
  }
});
def(["iserror"], (a) => (a[0].toLocaleLowerCase().startsWith("error:") ? "1" : "0"));
def(["xor", "xorencrypt", "xorencode", "xore"], (a) => {
  const buf = new TextEncoder().encode(a[0]).map((b) => b ^ 0xff);
  return btoa(String.fromCharCode(...buf));
});
def(["xordecrypt", "xordecode", "xord"], (a) => new TextDecoder().decode(Uint8Array.from(atob(a[0]), (ch) => ch.charCodeAt(0) ^ 0xff)));
def(["crypt", "crypto", "caesar", "encrypt", "decrypt"], (a) => {
  let shift = a[1] ? n(a[1]) : 32768;
  if (isNaN(shift)) shift = 32768;
  let out = "";
  for (const ch of a[0]) {
    const code = ch.charCodeAt(0);
    out += code > 65535 ? ch : String.fromCharCode((code + shift) % 65536);
  }
  return out;
});
def(["hiddenkey"], () => "");
def(["reverse"], (a) => [...(a[0] ?? "")].reverse().join(""));
def(["comment"], (a, c) => (c.env.displaying ? `<div class="risu-comment">${a[0]}</div>` : ""));
def(["tex", "latex", "katex"], (a) => `$$${a[0]}$$`);
def(["ruby", "furigana"], (a) => `<ruby>${a[0]}<rp> (</rp><rt>${a[1]}</rt><rp>) </rp></ruby>`);
def(["codeblock"], (a) => `<pre><code>${a[a.length - 1].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
def(["bkspc"], (_, c) => {
  let root = c.getNested()[0];
  if (!root) return "";
  root = root.trimEnd();
  let p = root.length - 1;
  for (; p >= 0; p--) if (p === 0 || root[p] === " " || root[p] === "\n" || root[p] === "\t") break;
  c.setNestedRoot(root.substring(0, Math.max(0, p)).trimEnd());
  return "";
});
def(["erase"], (_, c) => {
  let root = c.getNested()[0];
  if (!root) return "";
  root = root.trimEnd();
  let p = root.length - 1;
  let found = false;
  for (; p >= 0; p--) {
    if (".!?\n".includes(root[p])) {
      found = true;
      break;
    }
    if (p === 0) break;
  }
  if (found) p += 1;
  c.setNestedRoot(root.substring(0, Math.max(0, p)).trimEnd());
  return "";
});
def(["declare"], (a, c) => ((c.vars[`__declared_${a[0]}__`] = "1"), ""));
def(["//"], () => "");

function matcher(p1: string, c: Ctx): string | null {
  try {
    if (p1.startsWith("? ")) return calcString(p1.slice(2), c.env).toString();
    if (p1.startsWith("//")) return "";
    const ci = p1.indexOf(":");
    const split = ci !== -1 && p1[ci + 1] === ":" ? p1.split("::") : p1.split(":");
    const name = split[0].toLocaleLowerCase().replace(/[\s_-]/g, "");
    const fn = FN.get(name);
    if (fn) return fn(split.slice(1), c, p1);
  } catch {
    /* 함수 오류는 원문 유지 */
  }
  return null;
}

/* ---------------- 블록 ---------------- */
type BlockType = "ignore" | "parse" | "nothing" | "ifpure" | "pure" | "each" | "function" | "pure-display" | "normalize" | "escape" | "newif" | "newif-falsy";
interface Block {
  type: BlockType;
  type2?: string;
  funcArg?: string[];
  mode?: string;
}
const truthy = (s: string) => s === "true" || s === "1";
function blockStart(p1: string, env: CbsEnv): Block {
  if (p1.startsWith("#if") || p1.startsWith("#if_pure ")) {
    const state = p1.split(" ", 2)[1];
    return truthy(state) ? { type: p1.startsWith("#if_pure") ? "ifpure" : "parse" } : { type: "ignore" };
  }
  if (p1.startsWith("#when")) {
    if (p1.startsWith("#when ")) return { type: truthy(p1.split(" ", 2)[1]) ? "newif" : "newif-falsy" };
    if (!p1.startsWith("#when::")) return { type: "newif-falsy" };
    const st = p1.split("::").slice(1);
    if (st.length === 1) return { type: truthy(st[0]) ? "newif" : "newif-falsy" };
    let mode: "normal" | "keep" | "legacy" = "normal";
    const tg = (k: string) => env.getGlobal("toggle_" + k);
    while (st.length > 1) {
      const cond = st.pop()!;
      const op = st.pop()!;
      const push = (b: boolean) => st.push(b ? "1" : "0");
      switch (op) {
        case "not": push(!truthy(cond)); break;
        case "keep": mode = "keep"; st.push(cond); break;
        case "legacy": mode = "legacy"; st.push(cond); break;
        case "and": push(truthy(cond) && truthy(st.pop()!)); break;
        case "or": { const c2 = st.pop()!; push(truthy(cond) || truthy(c2)); break; }
        case "is": push(cond === st.pop()); break;
        case "isnot": push(cond !== st.pop()); break;
        case "var": push(truthy(env.getVar(cond))); break;
        case "toggle": push(truthy(tg(cond))); break;
        case "vis": push(env.getVar(st.pop()!) === cond); break;
        case "visnot": push(env.getVar(st.pop()!) !== cond); break;
        case "tis": push(tg(st.pop()!) === cond); break;
        case "tisnot": push(tg(st.pop()!) !== cond); break;
        case ">": push(parseFloat(st.pop()!) > parseFloat(cond)); break;
        case "<": push(parseFloat(st.pop()!) < parseFloat(cond)); break;
        case ">=": push(parseFloat(st.pop()!) >= parseFloat(cond)); break;
        case "<=": push(parseFloat(st.pop()!) <= parseFloat(cond)); break;
        default: push(truthy(cond));
      }
    }
    const ok = truthy(st[0]);
    if (mode === "legacy") return { type: ok ? "parse" : "ignore" };
    return { type: ok ? "newif" : "newif-falsy", ...(mode === "keep" ? { type2: "keep" } : {}) };
  }
  if (p1 === "#pure") return { type: "pure" };
  if (p1 === "#pure_display" || p1 === "#puredisplay") return { type: "pure-display" };
  if (p1 === "#code") return { type: "normalize" };
  if (p1.startsWith("#escape")) return { type: "escape", mode: p1.slice(7).trim() === "::keep" ? "keep" : undefined };
  if (p1.startsWith("#each") || p1.startsWith(":each")) {
    let t2 = p1.slice(5).trim();
    let mode: string | undefined;
    if (t2.startsWith("::keep ")) [mode, t2] = ["keep", t2.slice(7).trim()];
    if (t2.startsWith("as ")) t2 = t2.slice(3).trim();
    return { type: "each", type2: t2, mode };
  }
  if (p1.startsWith("#func")) {
    const s = p1.split(" ");
    if (s.length > 1) return { type: "function", funcArg: s.slice(1) };
  }
  return { type: "nothing" };
}
const trimLines = (p: string) => p.split("\n").map((v) => v.trimStart()).join("\n").trim();
function blockEnd(p1: string, b: Block): string {
  const t = p1.trim();
  switch (b.type) {
    case "pure": case "pure-display": case "function": return t;
    case "parse": return trimLines(t);
    case "each": return b.mode === "keep" ? p1 : trimLines(t);
    case "ifpure": return p1;
    case "newif": case "newif-falsy": {
      const lines = p1.split("\n");
      if (lines.length === 1) {
        const e = p1.indexOf("{{:else}}");
        if (e !== -1) return b.type === "newif" ? p1.slice(0, e) : p1.slice(e + 9);
        return b.type === "newif" ? p1 : "";
      }
      const el = lines.findIndex((v) => v.trim() === "{{:else}}");
      if (el !== -1 && b.type === "newif") lines.splice(el);
      if (el !== -1 && b.type === "newif-falsy") lines.splice(0, el + 1);
      if (el === -1 && b.type === "newif-falsy") return "";
      if (b.type2 !== "keep") {
        while (lines.length && !lines[0].trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      }
      return lines.join("\n");
    }
    case "normalize":
      return t.replaceAll("\n", "").replaceAll("\t", "").replace(/\\u([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, (_, ch: string) => ({ n: "\n", r: "\r", t: "\t" })[ch] ?? ch);
    case "escape": return risuEscape(b.mode === "keep" ? p1 : t);
    default: return "";
  }
}
const PURE_BLOCKS: BlockType[] = ["ignore", "pure", "each", "function", "pure-display", "escape"];

/** CBS 처리. 결과에는 표시용 이스케이프 문자(…)가 남을 수 있으니 화면에 낼 때 risuUnescape */
export function parseCbs(input: string, env: CbsEnv, functions: Map<string, { data: string; arg: string[] }> = new Map(), callStack = 0): string {
  if (!input || !input.includes("{") && !/<(user|char|bot)>/i.test(input)) return input ?? "";
  if (callStack > 20) return "ERROR: Call stack limit reached";
  let da = input.replace(/<(user|char|bot)>/gi, "{{$1}}");
  let pointer = 0;
  let nested: string[] = [""];
  const stackType = new Uint8Array(4096);
  const pureNest = new Map<number, boolean>();
  const blockNest = new Map<number, Block>();
  let vars: Record<string, string> = {};
  const ctx: Ctx = { env, vars, getNested: () => nested, setNestedRoot: (v) => (nested[0] = v) };
  const isPure = () => pureNest.size > 0;
  while (pointer < da.length) {
    const ch = da[pointer];
    if (ch === "{") {
      if (da[pointer + 1] !== "{" && da[pointer + 1] !== "#") nested[0] += ch;
      else {
        pointer++;
        nested.unshift("");
        if (nested.length >= stackType.length) return input; // 너무 깊은 중첩
        stackType[nested.length] = 1;
      }
    } else if (ch === "#") {
      // 옛 {#if …#} 문법
      if (da[pointer + 1] !== "}" || nested.length === 1 || stackType[nested.length] !== 1) nested[0] += ch;
      else {
        pointer++;
        const dat = nested.shift()!;
        const bn = dat.indexOf("\n");
        let out: string | null = null;
        if (bn !== -1) {
          const st = dat.slice(0, bn).split(" ", 2);
          if (st[0] === "if") out = ["", "0", "-1"].includes(st[1]) ? "" : dat.slice(bn + 1).trim();
        }
        nested[0] += out ?? `{#${dat}#}`;
      }
    } else if (ch === "}") {
      if (da[pointer + 1] !== "}" || nested.length === 1 || stackType[nested.length] !== 1) nested[0] += ch;
      else {
        pointer++;
        const dat = nested.shift()!;
        let handled = false;
        if (dat.startsWith("#") || dat.startsWith(":")) {
          handled = true;
          if (isPure()) {
            nested[0] += `{{${dat}}}`;
            if (dat !== ":else") {
              nested.unshift("");
              stackType[nested.length] = 6;
            }
          } else {
            const b = blockStart(dat, env);
            if (b.type === "nothing") nested[0] += `{{${dat}}}`;
            else {
              nested.unshift("");
              stackType[nested.length] = 5;
              blockNest.set(nested.length, b);
              if (PURE_BLOCKS.includes(b.type)) pureNest.set(nested.length, true);
            }
          }
        } else if (dat.startsWith("/") && !dat.startsWith("//")) {
          if (stackType[nested.length] === 5) {
            handled = true;
            const b = blockNest.get(nested.length)!;
            if (PURE_BLOCKS.includes(b.type)) pureNest.delete(nested.length);
            blockNest.delete(nested.length);
            const inner = nested.shift()!;
            const r = blockEnd(inner, b);
            if (b.type === "each") {
              const t2 = b.type2 ?? "";
              const asI = t2.lastIndexOf(" as ");
              let sub = t2.slice(asI + 4).trim();
              let arr = parseArray(t2.slice(0, asI));
              let ok = true;
              if (asI === -1) {
                const si = t2.lastIndexOf(" ");
                if (si === -1) ok = false;
                else [sub, arr] = [t2.slice(si + 1), parseArray(t2.slice(0, si))];
              }
              if (ok) {
                let added = "";
                for (const el of arr.slice(0, 1000)) added += r.replaceAll(`{{slot::${sub}}}`, typeof el === "string" ? el : JSON.stringify(el));
                da = da.slice(0, pointer + 1) + (b.mode === "keep" ? added : added.trim()) + da.slice(pointer + 1);
              }
            } else if (b.type === "function") functions.set(b.funcArg![0], { data: r, arg: b.funcArg!.slice(1) });
            else if (b.type === "pure-display") nested[0] += r.replaceAll("{{", "\\{\\{").replaceAll("}}", "\\}\\}");
            else nested[0] += r;
          } else if (stackType[nested.length] === 6) {
            handled = true;
            const sft = nested.shift()!;
            nested[0] += sft + `{{${dat}}}`;
          }
        }
        if (!handled && dat.startsWith("call::")) {
          const a = dat.split("::").slice(1);
          const f = functions.get(a[0]);
          if (f) {
            handled = true;
            let data = f.data;
            a.forEach((v, i) => (data = data.replaceAll(`{{arg::${i}}}`, v)));
            nested[0] += parseCbs(data, env, functions, callStack + 1);
          }
        }
        if (!handled) {
          const mc = isPure() ? null : matcher(dat, ctx);
          if (mc === null) nested[0] += `{{${dat}}}`;
          else nested[0] += mc;
          if (vars.__force_return__) return vars.__return__ ?? "null";
        }
      }
    } else nested[0] += ch;
    pointer++;
    vars = ctx.vars;
  }
  if (nested.length === 1) return nested[0];
  let result = "";
  while (nested.length > 1) result = (stackType[nested.length] === 1 ? "{{" : "<") + nested.shift() + result;
  return nested[0] + result;
}

/* ---------------- 토글 (RisuAI 사이드바 토글 문법) ---------------- */
export type Toggle =
  | { type: "group"; label: string; children: Toggle[] }
  | { type: "caption"; label: string }
  | { type: "divider"; label: string }
  | { type: "select"; key: string; label: string; options: string[] }
  | { type: "text" | "textarea" | "check"; key: string; label: string };
/** "key=이름=select=가,나" 줄 목록 → 토글 (group…groupEnd 묶음) */
export function parseToggles(src: string): Toggle[] {
  const out: Toggle[] = [];
  let group: Extract<Toggle, { type: "group" }> | null = null;
  for (const line of (src ?? "").split("\n")) {
    const [key, value, type, option] = line.split("=");
    let t: Toggle | null = null;
    if (type === "groupEnd") {
      group = null;
      continue;
    } else if (type === "group") {
      group = { type: "group", label: value ?? "", children: [] };
      out.push(group);
      continue;
    } else if (type === "divider") t = { type: "divider", label: value ?? "" };
    else if (type === "caption" && value) t = { type: "caption", label: value };
    else if (key && value) t = type === "select" ? { type: "select", key, label: value, options: option?.split(",") ?? [] } : { type: type === "text" || type === "textarea" ? type : "check", key, label: value };
    if (t) (group ? group.children : out).push(t);
  }
  return out;
}
/** 기본 변수 "key=value" 줄 목록 */
export function parseKeyValue(src: string): [string, string][] {
  return (src ?? "")
    .split("\n")
    .map((l) => l.split("="))
    .filter(([k, v]) => k && v)
    .map(([k, v]) => [k, v]);
}
