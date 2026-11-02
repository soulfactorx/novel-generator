/**
 * RisuAI 파일 가져오기 · 내보내기
 * - 캐릭터 카드: .charx(ZIP: card.json + module.risum + assets/), .json(Character Card V1/V2/V3), .png(tEXt chara/ccv3)
 * - 모듈: .risum(RisuAI 모듈 바이너리), 모듈 JSON(type: risuModule)
 * - 로어북 JSON(type: risu / SillyTavern world info), 채팅 JSON(type: risuChat / risuAllChats)
 * 이미지 에셋·정규식 스크립트는 가져오고, 트리거·Lua·배경 HTML은 이 앱에서 쓰지 않으므로 가져오지 않는다.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * RPack 변환표는 RisuAI(https://github.com/kwaroran/RisuAI, src/ts/rpack)의 rpack_map.bin과 같은 값이다.
 * Rpack.js는 MIT / AGPL-3.0 이중 라이선스이며 RisuAI 밖에서 쓰는 경우 AGPL-3.0을 따르므로, 이 프로젝트도 AGPL-3.0으로 배포한다.
 */
import { zip } from "./exporters";
import { uid } from "./id";
import { fillAssetLists } from "./images";
import type { Character, Entity, ImageMeta, LoreEntry, Message, RegexScript, Room, World } from "./types";
import { findZip, listZip } from "./unzip";

type Any = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).map((s) => s.trim()).filter(Boolean) : []);

/* ---------------- RPack: RisuAI .risum 에 쓰이는 바이트 치환 (원본: RisuAI src/ts/rpack, 호환을 위한 변환표) ---------------- */
// prettier-ignore
const RPACK_ENCODE = new Uint8Array([196,13,30,11,189,43,63,85,252,69,110,245,102,83,79,26,224,187,48,148,134,186,107,191,65,80,111,155,239,222,183,16,97,23,32,223,50,137,168,157,109,171,201,144,0,12,93,175,210,193,86,229,22,100,145,130,101,116,151,202,35,214,82,209,255,180,160,232,47,138,88,56,90,96,25,150,73,219,215,200,59,62,67,75,165,99,71,170,106,41,146,244,21,207,98,52,120,211,29,60,226,5,142,42,87,14,27,205,76,45,242,64,44,37,121,72,15,178,122,181,167,108,55,230,156,123,84,126,254,135,220,154,2,228,51,162,235,177,46,3,221,153,166,176,231,213,136,24,131,124,246,190,225,92,159,195,33,70,31,8,78,208,118,18,95,238,253,143,68,234,163,94,139,40,9,53,158,105,204,10,199,133,7,173,74,243,119,233,103,212,218,132,128,147,182,77,115,250,39,38,127,4,198,251,241,114,57,81,194,54,169,104,172,248,237,197,185,203,206,117,164,61,129,217,66,112,28,149,17,188,216,140,152,249,89,161,19,247,20,125,179,236,113,192,227,141,240,1,174,91,49,6,36,34,58,184]);
const RPACK_DECODE = (() => {
  const d = new Uint8Array(256);
  RPACK_ENCODE.forEach((v, i) => (d[v] = i));
  return d;
})();
const rpack = (data: Uint8Array, map: Uint8Array) => data.map((b) => map[b]);
export const rpackEncode = (data: Uint8Array) => rpack(data, RPACK_ENCODE);

/** .risum → 모듈 JSON + 에셋 바이트(모듈의 assets[i] 순서) */
export function readRisum(b: Uint8Array): { module: Any; assets: number; assetData: Uint8Array[] } {
  if (b.length < 6 || b[0] !== 111) throw new Error("RisuAI 모듈(.risum) 파일이 아닙니다.");
  if (b[1] !== 0) throw new Error("지원하지 않는 .risum 버전입니다.");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const len = view.getUint32(2, true);
  if (6 + len > b.length) throw new Error(".risum 파일이 손상되었습니다.");
  const main = JSON.parse(new TextDecoder().decode(rpack(b.subarray(6, 6 + len), RPACK_DECODE)));
  if (main?.type !== "risuModule" || !main.module) throw new Error("RisuAI 모듈 데이터가 아닙니다.");
  let p = 6 + len;
  const assetData: Uint8Array[] = [];
  while (p + 5 <= b.length && b[p] === 1) {
    const n = view.getUint32(p + 1, true);
    assetData.push(rpack(b.subarray(p + 5, p + 5 + n), RPACK_DECODE));
    p += 5 + n;
  }
  return { module: main.module, assets: assetData.length, assetData };
}

export function writeRisum(module: Any): Uint8Array {
  const main = rpack(new TextEncoder().encode(JSON.stringify({ module, type: "risuModule" }, null, 2)), RPACK_ENCODE);
  const out = new Uint8Array(6 + main.length + 1);
  out[0] = 111;
  out[1] = 0;
  new DataView(out.buffer).setUint32(2, main.length, true);
  out.set(main, 6);
  out[out.length - 1] = 0; // 에셋 없음 · 끝
  return out;
}

/* ---------------- 공통 변환 ---------------- */
const USER_NAME = "주인공";
/** {{char}}·<char>·{{user}}·<user> 치환 */
export function fillMacros(s: string, charName: string): string {
  return s
    .replace(/\{\{\s*char\s*\}\}|<char>|<bot>/gi, charName)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, USER_NAME)
    .replace(/\r\n/g, "\n")
    .trim();
}
/** RisuAI 로어 데코레이터(@@depth 0 등) 줄 제거 */
const stripDecorators = (s: string) => s.replace(/^@@@?[a-z_]+[^\n]*\n?/gim, "").trim();

interface RawLore {
  title: string;
  keys: string[];
  content: string;
  always: boolean;
  enabled: boolean;
  regex: boolean;
}
/** late: @@depth 0~2 데코레이터 — RisuAI에서 대화 맨 끝(응답 직전)에 넣는 항목 */
type ImportedLore = LoreEntry & { late?: true };
function toLore(r: RawLore, name: string): ImportedLore | null {
  const late = /^@@@?depth\s+[0-2]\b/m.test(r.content);
  const content = fillMacros(stripDecorators(r.content), name);
  if (!content) return null;
  // 정규식 키는 이 앱에서 매칭할 수 없음 → 키 없이 꺼 둔 상태로 보관
  const keys = r.regex ? [] : [...new Set(r.keys.map((k) => fillMacros(k, name)).filter(Boolean))];
  const always = r.always || (!r.regex && !keys.length);
  return { id: uid("l"), title: fillMacros(r.title, name) || keys[0] || "", keys, content, enabled: r.enabled && !(r.regex && !r.always), ...(always ? { always: true } : {}), ...(late ? { late: true as const } : {}) };
}
/**
 * 상시(항상 켜짐) 로어는 이 앱의 로어북 글자 예산에 걸리지 않도록 본문으로 옮긴다.
 * RisuAI 봇은 설명을 비우고 설정 전부를 상시 로어에 넣는 경우가 많다.
 *  - body: 프로필(세계관 설명)로 / late(@@depth 0~2): 응답 직전 지시로 / lore: 키워드 로어로 남김
 */
function splitLore(list: ImportedLore[]): { body: string; late: string; lore: LoreEntry[] } {
  const sec = (l: LoreEntry) => (l.title ? `### ${l.title}\n${l.content}` : l.content);
  const on = (l: ImportedLore) => l.always && l.enabled;
  return {
    body: list.filter((l) => on(l) && !l.late).map(sec).join("\n\n"),
    late: list.filter((l) => on(l) && l.late).map(sec).join("\n\n"),
    lore: list.filter((l) => !on(l)).map(({ late: _, ...l }) => l),
  };
}
const splitKeys = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** RisuAI 로어북 항목(모듈·캐릭터 globalLore·로어북 JSON) */
const fromRisuLore = (list: unknown, name: string) =>
  arr(list)
    .filter((e) => e.mode !== "folder")
    .map((e) => toLore({ title: str(e.comment), keys: splitKeys(str(e.key)), content: str(e.content), always: !!e.alwaysActive || e.mode === "constant", enabled: true, regex: !!e.useRegex }, name))
    .filter((x): x is ImportedLore => !!x);

/** Character Card V2/V3 character_book 항목 */
const fromCardLore = (list: unknown, name: string) =>
  arr(list)
    .filter((e) => e.extensions?.risu_folder !== true && e.mode !== "folder")
    .map((e) => toLore({ title: str(e.comment) || str(e.name), keys: strs(e.keys).length ? strs(e.keys) : splitKeys(str(e.keys)), content: str(e.content), always: !!e.constant, enabled: e.enabled !== false, regex: !!e.use_regex }, name))
    .filter((x): x is ImportedLore => !!x);

/** SillyTavern world info 등 외부 로어북 (entries: 객체 또는 배열) */
const fromExternalLore = (entries: unknown, name: string) =>
  arr(Array.isArray(entries) ? entries : Object.values((entries as Any) || {}))
    .map((e) => {
      const keys = strs(e.key).length ? strs(e.key) : strs(e.keys).length ? strs(e.keys) : strs(e.keywords);
      return toLore({ title: str(e.comment) || str(e.name) || str(e.displayName), keys, content: str(e.content) || str(e.entry) || str(e.text), always: !!(e.constant ?? e.forceActivation), enabled: !e.disable && e.enabled !== false, regex: false }, name);
    })
    .filter((x): x is LoreEntry => !!x);

/* ---------------- 가져오기 결과 ---------------- */
export interface RisuGreeting {
  characterId: string;
  name: string;
  greetings: string[]; // [첫 메시지, ...다른 인사말]
}
export interface RisuImport {
  source: string; // "캐릭터 카드(charx)" 등
  library: Entity[];
  rooms: Room[];
  greeting?: RisuGreeting; // 첫 메시지로 이야기를 시작할 수 있음
  images: RisuImage[]; // 에셋·감정 이미지 (가져올 때 읽음)
  skipped: string[]; // 가져오지 않은 것
}
/** 가져올 이미지: 바이트는 가져오기를 누를 때 읽는다 (charx 안의 파일 등) */
export interface RisuImage {
  ownerId: string;
  name: string;
  kind: ImageMeta["kind"];
  load: () => Promise<Uint8Array | null> | Uint8Array | null;
}
/** 에셋 주소(embeded:// · __asset: · data: · ccdefault:)를 바이트로 읽는 함수 */
type AssetLoader = (uri: string) => Promise<Uint8Array | null> | Uint8Array | null;
const IMAGE_EXT = /^(png|jpe?g|webp|gif|avif|unknown|)$/i;

function dataUri(uri: string): Uint8Array | null {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (!m) return null;
  try {
    return Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
const b64 = (s: string) => {
  try {
    return Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

function toScripts(list: unknown): RegexScript[] {
  return arr(list)
    .filter((s) => typeof s.in === "string" && s.in && typeof s.type === "string")
    .map((s) => ({ comment: str(s.comment), in: s.in, out: str(s.out), type: s.type, ...(s.flag ? { flag: str(s.flag) } : {}), ...(s.ableFlag ? { ableFlag: true } : {}) }));
}

function skippedOf(m: Any, other = 0): string[] {
  const out: string[] = [];
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  if (n(m.trigger) || n(m.triggerscript)) out.push(`트리거 스크립트 ${n(m.trigger) + n(m.triggerscript)}개`);
  if (str(m.cjs).trim()) out.push("모듈 스크립트");
  if (str(m.backgroundEmbedding).trim() || str(m.backgroundHTML).trim()) out.push("배경 HTML");
  if (other) out.push(`그림이 아닌 에셋(음악·영상 등) ${other}개`);
  return out;
}

function moduleToWorld(m: Any, source: string, assetData: Uint8Array[] = []): RisuImport {
  const name = str(m.name).trim() || "RisuAI 모듈";
  const now = Date.now();
  const id = uid("w");
  const list = (Array.isArray(m.assets) ? m.assets : []) as unknown[][];
  const images: RisuImage[] = [];
  let other = 0;
  list.forEach((a, i) => {
    if (!Array.isArray(a) || !assetData[i]?.length) return;
    if (!IMAGE_EXT.test(str(a[2]))) return void other++;
    images.push({ ownerId: id, name: str(a[0]) || `asset_${i + 1}`, kind: "asset", load: () => assetData[i] });
  });
  const names = images.map((x) => x.name);
  const fix = (t: string) => fillAssetLists(fillMacros(t, name), names, []);
  const parts = splitLore(fromRisuLore(m.lorebook, name));
  const lore = parts.lore.map((l) => ({ ...l, content: fillAssetLists(l.content, names, []) }));
  const scripts = toScripts(m.regex);
  // 모듈 설명은 RisuAI에서 화면 표시용이라, 상시 로어가 있으면 그것을 세계관 설명으로 쓴다
  const world: World = { kind: "world", id, name, description: fillAssetLists(parts.body, names, []) || fix(str(m.description)), rules: fillAssetLists(parts.late, names, []), lore, ...(scripts.length ? { scripts } : {}), createdAt: now, updatedAt: now };
  return { source, library: [world], rooms: [], images, skipped: skippedOf(m, other) };
}

/** 카드의 이미지 목록: V3 data.assets, V2 RisuAI 확장(emotions · additionalAssets) */
function cardImages(card: Any, ownerId: string, load: AssetLoader): { images: RisuImage[]; other: number } {
  const images: RisuImage[] = [];
  let other = 0;
  const add = (name: string, kind: ImageMeta["kind"], uri: string) => images.push({ ownerId, name, kind, load: () => load(uri) });
  for (const a of arr(card.assets)) {
    const uri = str(a.uri);
    if (!uri) continue;
    if (!IMAGE_EXT.test(str(a.ext))) {
      other++;
      continue;
    }
    const type = str(a.type);
    add(str(a.name) || (type === "icon" ? "main" : "image"), type === "emotion" ? "emotion" : type === "icon" ? "icon" : "asset", uri);
  }
  const risu: Any = card.extensions?.risuai || {};
  if (!arr(card.assets).length) {
    for (const e of Array.isArray(risu.emotions) ? risu.emotions : []) if (Array.isArray(e) && e[1]) add(str(e[0]), "emotion", str(e[1]).startsWith("__asset:") ? str(e[1]) : `data:image/png;base64,${str(e[1])}`);
    for (const e of Array.isArray(risu.additionalAssets) ? risu.additionalAssets : []) if (Array.isArray(e) && e[1]) IMAGE_EXT.test(str(e[2])) ? add(str(e[0]), "asset", str(e[1])) : other++;
  }
  return { images, other };
}

function cardToCharacter(cardIn: Any, source: string, moduleLore?: { module: Any; assetData?: Uint8Array[] }, load: AssetLoader = dataUri): RisuImport {
  const card = cardIn.spec === "chara_card_v2" || cardIn.spec === "chara_card_v3" ? cardIn.data || {} : cardIn; // V1은 최상위에 필드가 있음
  const name = (str(card.name) || str(card.char_name)).trim() || "이름 없는 캐릭터";
  const f = (k: string) => fillMacros(str(card[k]), name);
  const description = f("description") || fillMacros(str(card.char_persona), name);
  const profile = [description, f("personality") && `성격: ${f("personality")}`, f("scenario") && `기본 상황: ${f("scenario")}`].filter(Boolean).join("\n\n");
  const speech = fillMacros(str(card.mes_example) || str(card.example_dialogue), name)
    .replace(/^<START>\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // charx: module.risum 의 로어북이 있으면 그것이 기준(RisuAI와 같음), 없으면 카드의 character_book
  const modLore = moduleLore ? fromRisuLore(moduleLore.module.lorebook, name) : [];
  const parts = splitLore(modLore.length ? modLore : fromCardLore(card.character_book?.entries, name));
  const lore = parts.lore;
  // 응답 직전 지시: post_history_instructions + @@depth 0 상시 로어 (이미지 사용 규칙이 여기 있는 봇이 많다)
  const sys = fillMacros(str(card.system_prompt), name);
  const instructions = [fillMacros(str(card.post_history_instructions), name), parts.late].filter(Boolean).join("\n\n");
  const now = Date.now();
  const tags = strs(card.tags).slice(0, 5);
  const id = uid("c");
  const risu: Any = card.extensions?.risuai || {};
  const { images, other } = cardImages(card, id, load);
  const assetNames = images.filter((x) => x.kind === "asset").map((x) => x.name); // RisuAI의 {{assetlist}} 처럼 대표 이미지는 빼고
  const emoNames = images.filter((x) => x.kind === "emotion").map((x) => x.name);
  const fix = (t: string) => fillAssetLists(t, assetNames, emoNames);
  // charx: 정규식 스크립트는 module.risum 으로 옮겨져 있음
  const scripts = [...toScripts(risu.customScripts), ...toScripts(moduleLore?.module.regex)];
  const ch: Character = {
    kind: "character", id, name, summary: str(card.nickname).trim() || tags.join(" · "), profile: fix([profile, parts.body].filter(Boolean).join("\n\n")), speech: fix(speech),
    ...(instructions ? { instructions: fix(instructions) } : {}),
    lore: lore.map((l) => ({ ...l, content: fix(l.content) })),
    ...(scripts.length ? { scripts } : {}),
    ...(risu.viewScreen === "emotion" && emoNames.length ? { emotionMode: true } : {}),
    createdAt: now, updatedAt: now,
  };
  const greetings = [str(card.first_mes) || str(card.char_greeting), ...strs(card.alternate_greetings)].map((g) => fix(fillMacros(g, name))).filter(Boolean);
  const skipped = skippedOf({ ...risu, ...(moduleLore?.module || {}) }, other);
  // system_prompt는 RisuAI의 기본 프롬프트를 통째로 바꾸는 용도라 쓰지 않음 ({{original}}만 있으면 바꾸는 것이 없음)
  if (sys.replace(/\{\{original\}\}/gi, "").trim()) skipped.unshift("시스템 프롬프트(기본 프롬프트 교체)");
  return { source, library: [ch], rooms: [], images, ...(greetings.length ? { greeting: { characterId: ch.id, name, greetings } } : {}), skipped };
}

function chatsToRooms(j: Any): RisuImport {
  const chats = arr(Array.isArray(j.data) ? j.data : [j.data]);
  const now = Date.now();
  const rooms: Room[] = chats
    .map((c, i) => {
      const list = arr(c.message).filter((m) => (m.role === "user" || m.role === "char") && !m.isComment && str(m.data).trim());
      const base = Number(c.lastDate) || now;
      const messages: Message[] = list.map((m, k) => ({ id: uid("m"), role: m.role === "user" ? "user" : "assistant", text: str(m.data).trim(), createdAt: Number(m.time) || base - (list.length - k) }));
      for (let k = 1; k < messages.length; k++) if (messages[k].createdAt <= messages[k - 1].createdAt) messages[k].createdAt = messages[k - 1].createdAt + 1;
      const last = messages[messages.length - 1]?.createdAt || now;
      return { id: uid("r"), title: str(c.name).trim() || `RisuAI 대화 ${i + 1}`, premise: str(c.note).trim(), memory: "", messages, createdAt: messages[0]?.createdAt || last, updatedAt: last, characterIds: [] } satisfies Room;
    })
    .filter((r) => r.messages.length);
  if (!rooms.length) throw new Error("가져올 대화가 없습니다.");
  return { source: "RisuAI 채팅", library: [], rooms, images: [], skipped: [] };
}

/** JSON 객체를 판별해 변환 (RisuAI 형식이 아니면 null) */
export function parseRisuJson(j: unknown): RisuImport | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Any;
  if (o.spec === "chara_card_v2" || o.spec === "chara_card_v3") return cardToCharacter(o, o.spec === "chara_card_v3" ? "캐릭터 카드(V3)" : "캐릭터 카드(V2)");
  if (o.type === "risuModule") return moduleToWorld(o.module && typeof o.module === "object" ? o.module : o, "RisuAI 모듈");
  if (o.type === "risu" && Array.isArray(o.data)) return moduleToWorld({ name: str(o.name) || "가져온 로어북", description: str(o.description), lorebook: o.data }, "RisuAI 로어북");
  if (o.type === "regex" && Array.isArray(o.data)) return moduleToWorld({ name: str(o.name) || "가져온 정규식", description: str(o.description), regex: o.data }, "RisuAI 정규식");
  if ((o.type === "risuChat" || o.type === "risuAllChats") && o.data) return chatsToRooms(o);
  if (o.entries && typeof o.entries === "object" && !o.app) {
    const name = str(o.name) || "가져온 로어북";
    const now = Date.now();
    const world: World = { kind: "world", id: uid("w"), name, description: str(o.description), rules: "", lore: fromExternalLore(o.entries, name), createdAt: now, updatedAt: now };
    if (!world.lore.length) return null;
    return { source: "로어북(World Info)", library: [world], rooms: [], images: [], skipped: [] };
  }
  // Character Card V1 · 옛 형식
  if ((o.name || o.char_name) && (o.description || o.char_persona) && (o.first_mes || o.char_greeting) && !o.app) return cardToCharacter(o, "캐릭터 카드(V1)");
  return null;
}

/** PNG의 tEXt 청크 전부 (chara · ccv3 · chara-ext-asset_:N) */
export function readPngText(b: Uint8Array): Record<string, string> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const found: Record<string, string> = {};
  const latin = new TextDecoder("latin1");
  for (let p = 8; p + 8 <= b.length; ) {
    const len = view.getUint32(p);
    const type = latin.decode(b.subarray(p + 4, p + 8));
    if (type === "tEXt") {
      const data = b.subarray(p + 8, p + 8 + len);
      const z = data.indexOf(0);
      const key = latin.decode(data.subarray(0, z));
      found[key] = latin.decode(data.subarray(z + 1));
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
  return found;
}
/** PNG 카드의 카드 JSON (ccv3 우선, 없으면 chara) */
export function readPngCard(b: Uint8Array): Any | null {
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const found = readPngText(b);
  const text = found.ccv3 || found.chara;
  if (!text) return null;
  return JSON.parse(new TextDecoder().decode(b64(text) ?? new Uint8Array()));
}

const extOf = (name: string) => name.toLowerCase().split(".").pop() || "";

/** 파일 하나를 판별해 가져오기 (charx · risum · json · png · charx-jpeg) */
export async function parseRisuFile(name: string, b: Uint8Array): Promise<RisuImport> {
  const ext = extOf(name);
  if (ext === "risum" || (b[0] === 111 && b[1] === 0 && ext !== "json")) {
    const { module, assetData } = readRisum(b);
    return moduleToWorld(module, "RisuAI 모듈(risum)", assetData);
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    const card = readPngCard(b);
    if (!card) throw new Error("이 PNG에는 캐릭터 카드 정보가 없습니다.");
    if (!(card.spec === "chara_card_v2" || card.spec === "chara_card_v3" || card.name || card.char_name)) throw new Error("PNG의 캐릭터 카드 형식을 알 수 없습니다.");
    const chunks = readPngText(b);
    // __asset:N → chara-ext-asset_:N 청크, ccdefault: → 이 PNG 자체(대표 이미지)
    const load: AssetLoader = (uri) => (uri === "ccdefault:" ? b : uri.startsWith("__asset:") ? b64(chunks[`chara-ext-asset_:${uri.slice(8)}`] ?? chunks[`chara-ext-asset_${uri.slice(8)}`] ?? "") : dataUri(uri));
    const r = cardToCharacter(card, "캐릭터 카드(PNG)", undefined, load);
    // 카드에 대표 이미지가 따로 없으면 PNG 그림 자체를 대표 이미지로
    if (!r.images.some((x) => x.kind === "icon")) r.images.unshift({ ownerId: r.library[0].id, name: "main", kind: "icon", load: () => b });
    return r;
  }
  if (ext === "charx" || (b[0] === 0x50 && b[1] === 0x4b) || ((ext === "jpg" || ext === "jpeg") && findZip(b))) {
    const files = listZip(b);
    const cardFile = files.find((f) => f.name === "card.json");
    if (!cardFile) throw new Error("charx 안에 card.json이 없습니다.");
    const card = JSON.parse(new TextDecoder().decode(await cardFile.read()));
    if (card?.spec !== "chara_card_v3") throw new Error("charx의 카드 형식(V3)이 아닙니다.");
    const modFile = files.find((f) => f.name === "module.risum");
    const mod = modFile ? readRisum(await modFile.read()) : undefined;
    const byName = new Map(files.map((f) => [f.name, f]));
    const load: AssetLoader = (uri) => (uri.startsWith("embeded://") ? byName.get(uri.slice(10))?.read() ?? null : dataUri(uri));
    return cardToCharacter(card, "캐릭터 카드(charx)", mod, load);
  }
  let j: unknown;
  try {
    j = JSON.parse(new TextDecoder().decode(b));
  } catch {
    throw new Error("지원하지 않는 파일입니다. (charx · risum · json · png)");
  }
  const r = parseRisuJson(j);
  if (!r) throw new Error("RisuAI 형식의 JSON이 아닙니다.");
  return r;
}

/** 가져오기에서 고른 인사말로 첫 메시지가 있는 이야기 만들기 */
export function greetingRoom(g: RisuGreeting, index = 0): Room {
  const now = Date.now();
  const text = g.greetings[index] ?? g.greetings[0] ?? "";
  return { id: uid("r"), title: `${g.name}와(과)의 이야기`, premise: "", memory: "", messages: text ? [{ id: uid("m"), role: "assistant", text, createdAt: now }] : [], createdAt: now, updatedAt: now, characterIds: [g.characterId] };
}

/* ---------------- 내보내기 (RisuAI에서 가져올 수 있는 형식) ---------------- */
function toCardLore(lore: LoreEntry[]) {
  return lore.map((e, i) => ({ keys: e.keys, content: e.content, extensions: {}, enabled: e.enabled, insertion_order: i, constant: !!e.always, selective: false, secondary_keys: [], name: e.title, comment: e.title, use_regex: false }));
}
function toRisuLore(lore: LoreEntry[]) {
  return lore.map((e, i) => ({ key: e.keys.join(", "), secondkey: "", insertorder: 100 - Math.min(i, 99), comment: e.title || e.keys[0] || "", content: e.content, mode: "normal", alwaysActive: !!e.always, selective: false }));
}

/** 등장인물 → Character Card V3 (JSON) */
export function characterToCard(c: Character, world?: World) {
  const t = Math.floor(Date.now() / 1000);
  const lore = [...c.lore, ...(world ? world.lore : [])].filter((e) => e.enabled);
  const description = [c.summary, c.profile, world && [`[세계관: ${world.name}]`, world.description, world.rules].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: c.name, description, personality: "", scenario: "", first_mes: "", mes_example: c.speech,
      creator_notes: "Novel Generator에서 내보낸 캐릭터", system_prompt: "", post_history_instructions: "", alternate_greetings: [], group_only_greetings: [],
      tags: [], creator: "", character_version: "1.0", nickname: "", source: [], creation_date: t, modification_date: t, assets: [], extensions: {},
      character_book: { name: c.name, entries: toCardLore(lore), extensions: {} },
    },
  };
}

/** 등장인물 → .charx (card.json + module.risum, 이미지 없음) */
export function characterToCharx(c: Character, world?: World): Uint8Array {
  const card = characterToCard(c, world);
  const module = { name: `${c.name} Module`, description: `Module for ${c.name}`, id: uid("risu"), trigger: [], regex: [], lorebook: toRisuLore([...c.lore, ...(world ? world.lore : [])].filter((e) => e.enabled)) };
  return zip([
    { name: "module.risum", data: writeRisum(module) },
    { name: "card.json", data: JSON.stringify(card, null, 4) },
  ]);
}

/** 세계관 → RisuAI 모듈 (.risum). 설명·규칙은 '항상' 로어로 넣는다. */
export function worldToModule(w: World) {
  const base: LoreEntry[] = [w.description.trim() && { id: "d", title: `${w.name} 설명`, keys: [], content: w.description.trim(), enabled: true, always: true }, w.rules.trim() && { id: "r", title: `${w.name} 규칙`, keys: [], content: `@@depth 0\n${w.rules.trim()}`, enabled: true, always: true }].filter(Boolean) as LoreEntry[];
  return { name: w.name, description: w.description.slice(0, 200), id: uid("risu"), lorebook: toRisuLore([...base, ...w.lore.filter((e) => e.enabled)]) };
}
