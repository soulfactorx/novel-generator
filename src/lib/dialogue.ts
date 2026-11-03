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
function nameRegex(sp: Speaker[]): RegExp | null {
  const all = sp.flatMap((s) => s.names.map((n) => n)).sort((a, b) => b.length - a.length);
  if (!all.length) return null;
  // 이름 뒤에는 조사·공백·문장부호만 (다른 낱말의 일부가 아니게)
  return new RegExp(`(?<![가-힣A-Za-z])(${all.map(esc).join("|")})(?=[이가은는을를의도과와에께야아랑님씨]|[\\s,.!?…'"」』)\\]]|$)`, "g");
}
const owner = (sp: Speaker[], n: string) => sp.find((s) => s.names.includes(n));

/** 본문 전체에서 대사 위치와 화자 */
export function findDialogue(text: string, speakers: Speaker[]): { start: number; end: number; speaker: Speaker }[] {
  const re = nameRegex(speakers);
  if (!re) return [];
  const quotes = [...text.matchAll(QUOTE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const out: { start: number; end: number; speaker: Speaker }[] = [];
  let used = 0; // 앞 대사의 화자 표시("…" 도윤이 웃었다)로 쓴 곳까지 — 다음 대사의 화자로 다시 쓰지 않음
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
    const sp = hit ? owner(speakers, hit) : undefined;
    if (sp) out.push({ ...q, speaker: sp });
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
  // 봇 화면의 이름표 (예: 인물 그림 아래 이름) → 그 메시지 안에서 화자로
  const extra: { name: string }[] = [];
  root.querySelectorAll<HTMLElement>("[class*='name'],[class*='plate']").forEach((el) => {
    const t = (el.textContent ?? "").trim();
    if (t && t.length <= 12 && !/["“「『\n]/.test(t)) extra.push({ name: t });
  });
  const known = new Set(speakers.flatMap((s) => s.names));
  const all = [...speakers, ...makeSpeakers(extra.filter((e) => !known.has(e.name)).filter((e, i, a) => a.findIndex((x) => x.name === e.name) === i)).map((s) => ({ ...s, hue: hashHue(s.name) }))];
  if (!all.length) return html;
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
      mid.replaceWith(span);
      span.appendChild(mid);
    }
  }
  const out = document.createElement("div");
  out.appendChild(root);
  return out.innerHTML;
}
