import { uid } from "./id";
import { parseKeys } from "./lore";
import type { Character, Entity, LoreEntry, Message, Persona, Room, Settings, World } from "./types";

/** E.No.S Studio 백업 JSON(전체 백업·자동 백업 파일) → 이야기방 + 라이브러리 + (선택) 설정 */
export interface LegacyImport {
  rooms: Room[];
  library: Entity[];
  settingsPatch: Partial<Settings>;
  extra: { worlds: unknown[]; characters: unknown[]; personas: unknown[]; novels: unknown[] };
}

type Any = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/* 필드 이름 → 한국어 라벨 (알려진 것만, 나머지는 원래 이름으로) */
const LABEL: Record<string, string> = {
  age: "나이", gender: "성별", job: "직업", appearance_desc: "외모", appearance: "외모", body_type: "체형", hair_style: "머리", eyes: "눈", outfit: "옷차림", accessories: "소지품",
  personality_tags: "성격", personality: "성격", mental_state: "심리 상태", hobbies: "취미", features: "특징", relationships: "관계", description: "설명", background: "배경", other: "기타",
};
const SKIP = new Set(["id", "name", "image", "avatar", "icon", "emoji", "sample_dialogue", "speech", "entries", "lorebook", "createdAt", "updatedAt", "isLoreCharacter", "worldId", "characterIds", "keywords", "loreTriggerKeywords", "deleted", "isDeleted"]);

function fieldLines(o: Any, skip: Set<string> = SKIP): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (skip.has(k)) continue;
    const val = Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : str(v);
    if (!val.trim() || val.length > 4000 || val.startsWith("data:")) continue;
    lines.push(`${LABEL[k] ?? k}: ${val.trim()}`);
  }
  return lines;
}

function loreFrom(list: unknown): LoreEntry[] {
  return arr(list)
    .filter((e) => str(e.content).trim())
    .map((e) => {
      const keys = Array.isArray(e.keywords) ? e.keywords.map(String) : parseKeys(str(e.keywords) || str(e.keys));
      return { id: uid("l"), title: str(e.title) || str(e.name) || keys[0] || "", keys, content: str(e.content).trim(), enabled: e.enabled !== false, ...(keys.length ? {} : { always: true }) };
    });
}

export function parseLegacyBackup(json: unknown): LegacyImport {
  const j = (json && typeof json === "object" ? json : {}) as Any;
  const sessions = arr(j.sessions);
  const worldsIn = arr(j.worlds);
  if (!sessions.length && !worldsIn.length && !j.settings && !arr(j.characters).length) throw new Error("E.No.S 백업 파일 형식이 아닙니다.");
  const now = Date.now();
  const idMap = new Map<string, string>(); // 옛 id → 새 id
  const library: Entity[] = [];
  const mapId = (old: unknown, prefix: string) => {
    const k = str(old);
    if (k && idMap.has(k)) return idMap.get(k)!;
    const id = uid(prefix);
    if (k) idMap.set(k, id);
    return id;
  };

  const addCharacter = (c: Any, worldId?: string) => {
    if (!str(c.name).trim() || (c.id && idMap.has(str(c.id)))) return;
    const summary = [str(c.age) && `${str(c.age)}세`.replace(/세세$/, "세"), str(c.gender), str(c.job)].filter(Boolean).join(" · ");
    const ch: Character = {
      kind: "character", id: mapId(c.id, "c"), name: str(c.name).trim(), summary,
      profile: fieldLines(c, new Set([...SKIP, "age", "gender", "job"])).join("\n"),
      speech: str(c.sample_dialogue) || str(c.speech),
      lore: loreFrom(c.entries), ...(worldId ? { worldId } : {}), createdAt: now, updatedAt: now,
    };
    library.push(ch);
  };
  const addPersona = (p: Any) => {
    if (!str(p.name).trim() || (p.id && idMap.has(str(p.id)))) return;
    const lines = fieldLines(p);
    const lore = loreFrom(p.entries).map((e) => `${e.title}: ${e.content}`);
    library.push({ kind: "persona", id: mapId(p.id, "p"), name: str(p.name).trim(), profile: [...lines, ...lore].join("\n"), createdAt: now, updatedAt: now } satisfies Persona);
  };

  for (const w of worldsIn) {
    const id = mapId(w.id, "w");
    const rules = arr(w.aiRules).filter((r) => r.enabled !== false && str(r.content).trim()).map((r) => `- ${str(r.content).trim()}`);
    library.push({ kind: "world", id, name: str(w.name).trim() || "이름 없는 세계관", description: str(w.description).trim(), rules: rules.join("\n"), lore: loreFrom(w.lorebook), createdAt: now, updatedAt: now } satisfies World);
    arr(w.characters).forEach((c) => addCharacter(c, id));
    if (w.user && typeof w.user === "object") addPersona(w.user);
  }
  for (const c of arr(j.characters)) {
    const owner = worldsIn.find((w) => Array.isArray(w.characterIds) && w.characterIds.includes(c.id));
    addCharacter(c, owner ? idMap.get(str(owner.id)) : undefined);
  }
  arr(j.userPersonas).forEach(addPersona);

  const rooms: Room[] = sessions
    .filter((s) => Array.isArray(s.history))
    .map((s, i) => {
      const messages: Message[] = arr(s.history)
        .filter((m) => (m.role === "user" || m.role === "model") && str(m.text).trim())
        .map((m, k, all) => ({
          id: uid("m"),
          role: m.role === "user" ? "user" : "assistant",
          text: str(m.text).trim(),
          ...(Array.isArray(m.choices) && m.choices.length ? { choices: m.choices.map(String).slice(0, 6) } : {}),
          createdAt: (Number(s.updatedAt) || now) - (all.length - k),
        }));
      const world = worldsIn.find((w) => w.id === s.worldId);
      const charIds: string[] = Array.isArray(s.characterIds) && s.characterIds.length ? s.characterIds : world?.characterIds || [];
      const personaOld = str(s.activeUserId) || str(s.userPersonaId) || (world?.user?.id ? str(world.user.id) : "");
      return {
        id: uid("r"),
        title: str(s.title).trim() || `가져온 이야기 ${i + 1}`,
        premise: "",
        memory: str(s.memory),
        messages,
        createdAt: Number(s.updatedAt) || now,
        updatedAt: Number(s.updatedAt) || now,
        ...(world && idMap.has(str(world.id)) ? { worldId: idMap.get(str(world.id)) } : {}),
        characterIds: charIds.map((c) => idMap.get(str(c))).filter((x): x is string => !!x),
        ...(personaOld && idMap.has(personaOld) ? { personaId: idMap.get(personaOld) } : {}),
        // 가져온 기억은 이미 과거 대화를 반영하고 있으므로 지금까지를 정리된 것으로 간주
        ...(str(s.memory).trim() && messages.length ? { memoryCursorAt: messages[Math.max(0, messages.length - 41)].createdAt } : {}),
      };
    })
    .filter((r) => r.messages.length > 0);

  const os: Any = j.settings || {};
  const plain = (k: unknown) => (typeof k === "string" && k && !k.startsWith("enc_v1:") ? k : "");
  const keys: Partial<Settings["keys"]> = {};
  if (plain(os.apiKey)) keys.gemini = plain(os.apiKey);
  if (plain(os.anthropicApiKey)) keys.anthropic = plain(os.anthropicApiKey);
  if (plain(os.customApiKey)) keys.openai = plain(os.customApiKey);
  const settingsPatch: Partial<Settings> = {};
  if (Object.keys(keys).length) settingsPatch.keys = keys as Settings["keys"];
  if (str(os.customBaseUrl)) settingsPatch.openaiBaseUrl = os.customBaseUrl;
  return {
    rooms,
    library,
    settingsPatch,
    extra: { worlds: worldsIn, characters: arr(j.characters), personas: arr(j.userPersonas), novels: arr(j.fullNovels) },
  };
}

/** v0.1에서 가져올 때 보관만 해 둔 원본(legacyExtra)을 라이브러리로 변환 */
export function libraryFromExtra(extra: LegacyImport["extra"]): Entity[] {
  if (!extra) return [];
  return parseLegacyBackup({ worlds: extra.worlds, characters: extra.characters, userPersonas: extra.personas, settings: {} }).library;
}
