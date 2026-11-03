/**
 * 화자별 대사 색: 본문의 따옴표 대사("…", “…”, 「…」, 『…』)를 누가 말했는지 찾아 인물마다 다른 색을 입힌다.
 * 화자 찾기 (가까운 것 우선):
 *  1) 대사 바로 뒤 짧은 범위에 나오는 이름   "…" 서율이 웃었다.
 *  2) 대사 앞(직전 대사 끝까지)에 마지막으로 나온 이름   서율은 고개를 들었다. "…"
 * 이름: 등장인물·주인공 이름(세 글자 한국 이름은 이름 두 글자도), 직접 적은 별칭, 봇 화면의 이름표(.…name / .…plate).
 * 화자를 못 찾은 대사는 색을 넣지 않는다.
 */

export interface Speaker {
  name: string;
  names: string[]; // 찾을 이름들 (긴 것 먼저)
  color?: string; // 직접 고른 색 (#rrggbb)
  hue: number; // 자동 색 (색상환 각도)
}

const HUES = [210, 340, 145, 28, 275, 190, 0, 95, 245, 315, 55, 165];
const hashHue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) | 0;
  return HUES[Math.abs(h) % HUES.length];
};

/** 이름 → 찾을 이름 목록 (괄호·콜론 뒤 부제는 버림) */
export function nameVariants(name: string, extra = ""): string[] {
  const base = name.replace(/\s*[([（【].*$/, "").replace(/\s*[:：].*$/, "").trim();
  const out = new Set<string>();
  if (base) out.add(base);
  if (/^[가-힣]{3}$/.test(base)) out.add(base.slice(1)); // 임옥선 → 옥선
  for (const x of extra.split(/[,，、/]/)) if (x.trim()) out.add(x.trim());
  return [...out].filter((n) => n.length >= 1).sort((a, b) => b.length - a.length);
}

export function makeSpeakers(list: { name: string; aliases?: string; color?: string }[]): Speaker[] {
  const used = new Set<number>();
  return list
    .filter((x) => x.name.trim())
    .map((x, i) => {
      let hue = HUES[i % HUES.length];
      if (used.has(hue)) hue = hashHue(x.name);
      used.add(hue);
      return { name: x.name, names: nameVariants(x.name, x.aliases), ...(x.color ? { color: x.color } : {}), hue };
    })
    .filter((s) => s.names.length);
}

const QUOTE = /"[^"\n]{1,600}"|“[^”\n]{1,600}”|「[^」\n]{1,600}」|『[^』\n]{1,600}』/g;
const AFTER = 24; // 대사 뒤에서 이름을 찾는 범위 (글자)
const BEFORE = 120; // 대사 앞에서 이름을 찾는 범위

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameRegex(sp: Speaker[], subject = false): RegExp | null {
  const all = sp.flatMap((s) => s.names.map((n) => n)).sort((a, b) => b.length - a.length);
  if (!all.length) return null;
  // 이름 뒤에는 조사·공백·문장부호만 (다른 낱말의 일부가 아니게). subject: 주어(이·가·은·는·께서)나 이름표처럼 이름만 있을 때
  // — "주인공에게 …" 처럼 듣는 사람은 화자가 아니다
  const tail = subject ? `(?=(?:이|가|은|는|께서)(?![가-힣])|[\\s,.!?…'"」』)\\]]|$)` : `(?=[이가은는을를의도과와에께야아랑님씨]|[\\s,.!?…'"」』)\\]]|$)`;
  return new RegExp(`(?<![가-힣A-Za-z])(${all.map(esc).join("|")})${tail}`, "g");
}
const owner = (sp: Speaker[], n: string) => sp.find((s) => s.names.includes(n));

/* ---------- 목록에 없는 화자 배우기 ----------
 * 봇이 안에 따로 둔 인물(예: DMT의 임옥선·이장평)은 라이브러리 인물 목록에 없다.
 * 봇 화면의 이름표, "이장평이 말했다" 같은 말하기 표현에서 이름을 배워 두고, 같은 화면(이야기)의 다른 메시지에서도 쓴다.
 */
const learnedBy = new WeakMap<Speaker[], Map<string, Speaker>>();
const NOT_NAME = new Set("그 그녀 그는 그가 나 내 너 네 우리 저 제 당신 자네 사내 남자 여자 소녀 소년 노인 아이 사람 누군가 모두 둘 셋 상대 목소리 녀석 그놈 그것 이것 저것 이쪽 저쪽 그쪽 아무 다들 서로 모두들 할머니 할아버지 아버지 어머니 아빠 엄마 형님 누님 언니 오빠 동생".split(" "));
const SPEECH = "(?:말[했하]|물었|물으|되물|대답|답했|외쳤|소리쳤|중얼|속삭|덧붙|대꾸|투덜|웃었|웃으|입을 열|말을 이|다그쳤|재촉|타일렀|불렀|소리[를쳤])";
const TAGGED = new RegExp(`(?<![가-힣])([가-힣]{2,4}?)(?:이|가|은|는)\\s+(?:[^\\s"“「]{1,12}\\s+){0,2}${SPEECH}`, "g");
export function learnSpeaker(base: Speaker[], name: string) {
  const n = name.trim();
  if (!n || n.length > 12 || NOT_NAME.has(n) || base.some((s) => s.names.includes(n))) return;
  let m = learnedBy.get(base);
  if (!m) learnedBy.set(base, (m = new Map()));
  if (!m.has(n)) m.set(n, { name: n, names: [n], hue: hashHue(n) });
}
const withLearned = (base: Speaker[]) => [...base, ...(learnedBy.get(base)?.values() ?? [])];

/** 본문 전체에서 대사 위치와 화자 */
export function findDialogue(text: string, base: Speaker[]): { start: number; end: number; speaker: Speaker }[] {
  for (const m of text.matchAll(TAGGED)) learnSpeaker(base, m[1]);
  const speakers = withLearned(base);
  const re = nameRegex(speakers, true);
  if (!re) return [];
  const quotes = [...text.matchAll(QUOTE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const out: { start: number; end: number; speaker: Speaker }[] = [];
  let used = 0; // 앞 대사의 화자 표시("…" 도윤이 웃었다)로 쓴 곳까지 — 다음 대사의 화자로 다시 쓰지 않음
  let prev: { end: number; speaker: Speaker } | null = null;
  quotes.forEach((q, i) => {
    const nextStart = quotes[i + 1]?.start ?? text.length;
    const after = text.slice(q.end, Math.min(q.end + AFTER, nextStart));
    const lineEnd = after.search(/\n/);
    const afterLine = lineEnd === -1 ? after : after.slice(0, lineEnd);
    re.lastIndex = 0;
    const tag = re.exec(afterLine);
    let hit = tag?.[1];
    const prevUsed = used;
    used = tag ? q.end + tag.index + tag[0].length : q.end;
    if (!hit) {
      const from = Math.max(quotes[i - 1]?.end ?? 0, prevUsed, q.start - BEFORE);
      const before = text.slice(from, q.start);
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(before))) hit = m[1];
    }
    let sp = hit ? owner(speakers, hit) : undefined;
    // 같은 줄에서 이어지는 대사는 앞 대사와 같은 화자 ("…" 그녀가 숟가락을 두드렸다. "…")
    if (!sp && prev && !/\n/.test(text.slice(prev.end, q.start))) sp = prev.speaker;
    if (sp) {
      out.push({ ...q, speaker: sp });
      prev = { end: q.end, speaker: sp };
    } else prev = null;
  });
  return out;
}

/** 화자 색 (CSS) — 직접 고른 색이 있으면 그 색, 아니면 밝기 모드에 맞는 자동 색 (index.css 의 .dlg) */
export const speakerStyle = (s: Speaker): Record<string, string> => (s.color ? { color: s.color } : { "--dlg-h": String(s.hue) });
const styleAttr = (s: Speaker) => (s.color ? `color:${s.color}` : `--dlg-h:${s.hue}`);

/** 일반 글: 문단을 [글, 화자?] 조각으로 */
export function splitDialogue(text: string, speakers: Speaker[]): { text: string; speaker?: Speaker }[] {
  const found = findDialogue(text, speakers);
  if (!found.length) return [{ text }];
  const out: { text: string; speaker?: Speaker }[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at) out.push({ text: text.slice(at, f.start) });
    out.push({ text: text.slice(f.start, f.end), speaker: f.speaker });
    at = f.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

const SKIP = new Set(["STYLE", "SCRIPT", "CODE", "PRE", "BUTTON", "LABEL", "OPTION", "SELECT", "TEXTAREA", "SUMMARY"]);
/** HTML(정리된 봇 화면): 글자 노드의 대사를 <span class="dlg"> 로 감싼다. 이름표 요소의 이름도 화자로 씀 */
export function colorizeHtml(html: string, speakers: Speaker[]): string {
  if (typeof document === "undefined" || !/["“「『]/.test(html)) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  const root = box.content;
  // 봇 화면의 이름표 (예: 인물 그림 아래 이름) → 화자로 배워 둠 (다른 메시지에서도 씀)
  root.querySelectorAll<HTMLElement>("[class*='name'],[class*='plate']").forEach((el) => {
    const t = (el.textContent ?? "").trim();
    if (t && t.length <= 12 && !/["“「『\n]/.test(t)) learnSpeaker(speakers, t);
  });
  const all = speakers;
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walk = (n: Node) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) {
        nodes.push({ node: c as Text, start: text.length });
        text += (c as Text).data;
      } else if (c.nodeType === 1 && !SKIP.has((c as Element).tagName)) {
        const block = /^(P|DIV|SECTION|ARTICLE|LI|TR|H[1-6]|BLOCKQUOTE|BR|ASIDE|DETAILS)$/.test((c as Element).tagName);
        if (block) text += "\n";
        walk(c);
        if (block) text += "\n";
      }
    }
  };
  walk(root);
  const found = findDialogue(text, all);
  if (!found.length) return html;
  for (const f of [...found].reverse()) {
    for (const { node, start } of [...nodes].reverse()) {
      const len = node.data.length;
      const a = Math.max(f.start, start) - start;
      const b = Math.min(f.end, start + len) - start;
      if (a >= b || a < 0 || b > len) continue;
      if (b < len) node.splitText(b);
      const mid = a > 0 ? node.splitText(a) : node;
      const span = document.createElement("span");
      span.className = "dlg";
      span.setAttribute("style", styleAttr(f.speaker));
      span.setAttribute("title", f.speaker.name);
      mid.replaceWith(span);
      span.appendChild(mid);
    }
  }
  const out = document.createElement("div");
  out.appendChild(root);
  return out.innerHTML;
}

/** 봇 로어북의 인물 데이터에서 이름 찾기 (예: "NAME_KO: 이장평", "NAME_EN: …", "ALIASES: …", "이름: …") */
export function loreSpeakers(entries: { content: string; title?: string }[]): { name: string; aliases: string }[] {
  const out: { name: string; aliases: string }[] = [];
  // 인물용 항목(CHR·인물 등)으로 나뉘어 있으면 그것만, 아니면 장소처럼 보이는 항목을 뺀 전부
  const isChar = (e: { title?: string }) => /^(chr|char|chara|character|characters|npc|인물|캐릭터|등장인물)$/i.test((e.title ?? "").trim());
  const isPlace = (e: { content: string; title?: string }) => /^(loc|location|place|map|장소|지역|지도)$/i.test((e.title ?? "").trim()) || /^(X_PCT|Y_PCT|LOCATION|PLACE)\s*[:：]/im.test(e.content);
  const pick = entries.some(isChar) ? entries.filter(isChar) : entries.filter((e) => !isPlace(e));
  for (const e of pick) {
    const names = [...e.content.matchAll(/^(?:NAME(?:_[A-Z]{2,4})?|이름|名前)\s*[:：]\s*([^\n]{1,30})$/gim)].map((m) => m[1].trim()).filter(Boolean);
    if (!names.length) continue;
    const ko = /^NAME_KO\s*[:：]\s*(.+)$/im.exec(e.content)?.[1]?.trim();
    const aliases = /^ALIASES\s*[:：]\s*(.+)$/im.exec(e.content)?.[1] ?? "";
    const main = ko || names[0];
    out.push({ name: main, aliases: [...names.filter((n) => n !== main), ...aliases.split(/[,，、/|]/)].map((x) => x.trim()).filter(Boolean).join(",") });
  }
  return out;
}
