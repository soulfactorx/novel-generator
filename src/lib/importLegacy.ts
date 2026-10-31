import { uid } from "./id";
import type { Message, Room, Settings } from "./types";

/** E.No.S Studio 백업 JSON(전체 백업·자동 백업 파일) → 이야기방 + (선택) 설정 */
export interface LegacyImport {
  rooms: Room[];
  settingsPatch: Partial<Settings>;
  extra: { worlds: unknown[]; characters: unknown[]; personas: unknown[]; novels: unknown[] };
}

type Any = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function premiseFor(session: Any, worlds: Any[], characters: Any[]): string {
  const w = worlds.find((x) => x?.id === session.worldId);
  if (!w) return "";
  const lines = [`세계관: ${str(w.name)}`];
  if (str(w.description).trim()) lines.push(str(w.description).trim());
  const ids: string[] = Array.isArray(session.characterIds) && session.characterIds.length ? session.characterIds : w.characterIds || [];
  const pool = [...characters, ...(Array.isArray(w.characters) ? w.characters : [])];
  const chars = ids.map((id) => pool.find((c) => c?.id === id)).filter(Boolean) as Any[];
  if (chars.length) {
    lines.push("", "등장인물:");
    for (const c of chars) {
      const info = [str(c.job), str(c.personality_tags), str(c.age)].filter((x) => x.trim()).join(" · ");
      lines.push(`- ${str(c.name)}${info ? ` (${info})` : ""}`);
    }
  }
  return lines.join("\n");
}

export function parseLegacyBackup(json: unknown): LegacyImport {
  const j = (json && typeof json === "object" ? json : {}) as Any;
  const sessions: Any[] = Array.isArray(j.sessions) ? j.sessions : [];
  const worlds: Any[] = Array.isArray(j.worlds) ? j.worlds : [];
  const characters: Any[] = Array.isArray(j.characters) ? j.characters : [];
  if (!sessions.length && !worlds.length && !j.settings) throw new Error("E.No.S 백업 파일 형식이 아닙니다.");
  const now = Date.now();
  const rooms: Room[] = sessions
    .filter((s) => s && Array.isArray(s.history))
    .map((s, i) => {
      const messages: Message[] = (s.history as Any[])
        .filter((m) => (m?.role === "user" || m?.role === "model") && str(m.text).trim())
        .map((m, k) => ({
          id: uid("m"),
          role: m.role === "user" ? "user" : "assistant",
          text: str(m.text).trim(),
          ...(Array.isArray(m.choices) && m.choices.length ? { choices: m.choices.map(String).slice(0, 6) } : {}),
          createdAt: (Number(s.updatedAt) || now) - (s.history.length - k),
        }));
      return {
        id: uid("r"),
        title: str(s.title).trim() || `가져온 이야기 ${i + 1}`,
        premise: premiseFor(s, worlds, characters),
        memory: str(s.memory),
        messages,
        createdAt: Number(s.updatedAt) || now,
        updatedAt: Number(s.updatedAt) || now,
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
    settingsPatch,
    extra: { worlds, characters, personas: Array.isArray(j.userPersonas) ? j.userPersonas : [], novels: Array.isArray(j.fullNovels) ? j.fullNovels : [] },
  };
}
