/**
 * RisuAI 방식의 이미지 사용
 *  - 봇(캐릭터 카드·모듈)의 설명·로어북이 AI에게 {{img::이름}}, <img="이름">, <Emotion="이름"> 같은 표시를 쓰게 하고
 *  - 봇의 정규식 스크립트(editinput / editoutput / editprocess / editdisplay)가 그 표시를 바꾸고
 *  - 에셋 표시 {{img|image|asset|emotion|raw|path::이름}} 를 실제 그림으로 바꾼다. (이름이 조금 달라도 가장 비슷한 에셋)
 * 원본: RisuAI src/ts/process/scripts.ts · parser.svelte.ts 의 동작을 이 앱에 맞게 다시 구현
 */
import type { StoryContext } from "./prompt";
import type { ImageMeta, RegexScript } from "./types";

/* ---------------- 이 이야기에서 쓸 수 있는 이미지 ---------------- */
export interface ImagePool {
  assets: ImageMeta[]; // 이름으로 부르는 그림 (에셋·대표 이미지)
  emotions: ImageMeta[]; // 감정 이미지
  scripts: RegexScript[];
  emotionMode: boolean; // <Emotion="…"> 로 감정 이미지를 고르게 함
  emotionPanel: boolean; // 감정 이미지를 본문 대신 옆 패널에 (RisuAI 기본 감정 화면)
}
const poolCache = new WeakMap<object, Map<string, ImagePool>>();
/** 같은 이미지 목록·같은 인물(수정 시각 포함)이면 같은 객체를 돌려준다 (화면 다시 그리기 최소화) */
export function imagePool(ctx: StoryContext, images: Record<string, ImageMeta> | ImageMeta[], scripts = true): ImagePool {
  const owners = [...ctx.characters, ...(ctx.world ? [ctx.world] : [])];
  const key = owners.map((o) => `${o.id}:${o.updatedAt}`).join(",") + (scripts ? "" : "|noscripts");
  let byKey = poolCache.get(images);
  if (!byKey) poolCache.set(images, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const built = buildPool(owners, Array.isArray(images) ? images : Object.values(images), ctx);
  const pool = scripts ? built : { ...built, scripts: [] }; // 설정에서 정규식 스크립트를 끈 경우
  if (byKey.size > 50) byKey.clear();
  byKey.set(key, pool);
  return pool;
}
function buildPool(owners: (StoryContext["characters"][number] | NonNullable<StoryContext["world"]>)[], all: ImageMeta[], ctx: StoryContext): ImagePool {
  const mine = owners.flatMap((o) => all.filter((m) => m.ownerId === o.id).sort((a, b) => a.createdAt - b.createdAt));
  return {
    assets: mine.filter((m) => m.kind !== "emotion"),
    emotions: mine.filter((m) => m.kind === "emotion"),
    scripts: owners.flatMap((o) => o.scripts ?? []),
    emotionMode: ctx.characters.some((c) => c.emotionMode && all.some((m) => m.ownerId === c.id && m.kind === "emotion")),
    emotionPanel: ctx.characters.some((c) => c.risu?.emotionPanel && all.some((m) => m.ownerId === c.id && m.kind === "emotion")),
  };
}
export const poolIsEmpty = (p: ImagePool) => !p.assets.length && !p.emotions.length && !p.scripts.length;

/* ---------------- 이름 찾기 (RisuAI와 같은 규칙) ---------------- */
export function editDistance(a: string, b: string): number {
  const w = b.length + 1;
  let prev = Array.from({ length: w }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j < w; j++) cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1);
    prev = cur;
  }
  return prev[w - 1];
}
const trimName = (s: string) => s.replace(/\.(webp|png|jpe?g|gif|avif|mp4|webm|mp3|wav|ogg)$/i, "").trim().replace(/[_ \-.]/g, "");
const MAX_DIFF = 4; // RisuAI 기본값
const lcp = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
};
/** 가장 비슷한 이름 (글자 차이가 적은 순, 같으면 앞부분이 더 많이 같은 것) */
function closest<T>(q: string, items: T[], key: (x: T) => string): { item?: T; d: number } {
  let item: T | undefined;
  let d = Infinity;
  let p = -1;
  for (const x of items) {
    const k = key(x);
    const dd = editDistance(q, k);
    const pp = lcp(q, k);
    if (dd < d || (dd === d && pp > p)) [item, d, p] = [x, dd, pp];
  }
  return { item, d };
}

/**
 * 이름으로 그림 찾기: 정확히 → 기호·확장자 무시 → 앞부분이 같은 것(happy → happy smile)
 * → '인물_구분_복장_표정' 같은 이름은 칸별로(마지막 칸만 비슷하게, 그 복장이 없으면 같은 인물의 다른 복장)
 * → 비슷한 이름. RisuAI는 글자 4개 차이까지 허용하지만 긴 이름에서 happy → sad 처럼 다른 감정이 골라지므로 더 엄격하게.
 */
export function findAsset(name: string, list: ImageMeta[], fuzzy = true): ImageMeta | undefined {
  const n = name.trim().toLowerCase();
  const exact = list.find((m) => m.name.toLowerCase() === n);
  if (exact || !fuzzy) return exact;
  const t = trimName(n);
  if (!t) return undefined;
  const trimmed = list.map((m) => ({ m, t: trimName(m.name.toLowerCase()), seg: m.name.toLowerCase().split("_").map(trimName) }));
  const same = trimmed.find((x) => x.t === t);
  if (same) return same.m;
  const prefix = trimmed.filter((x) => x.t.startsWith(t) && t.length >= 4).sort((a, b) => a.t.length - b.t.length)[0];
  if (prefix) return prefix.m;
  const seg = n.replace(/\.(webp|png|jpe?g|gif|avif)$/i, "").split("_").map(trimName);
  if (seg.length >= 3) {
    const last = seg[seg.length - 1];
    const ok = (d: number) => d <= Math.max(1, Math.floor(last.length * 0.45));
    const pick = (cands: typeof trimmed) => {
      const pre = cands.find((x) => x.seg[x.seg.length - 1].startsWith(last) && last.length >= 3);
      if (pre) return pre.m;
      const c = closest(last, cands, (x) => x.seg[x.seg.length - 1]);
      return c.item && ok(c.d) ? c.item.m : undefined;
    };
    const sameHead = trimmed.filter((x) => x.seg.length === seg.length && x.seg.slice(0, -1).join("_") === seg.slice(0, -1).join("_"));
    const hit = sameHead.length ? pick(sameHead) : pick(trimmed.filter((x) => x.seg.length === seg.length && x.seg[0] === seg[0]));
    if (hit) return hit;
  }
  const c = closest(t, trimmed, (x) => x.t);
  return c.item && c.d <= Math.min(MAX_DIFF, Math.floor(t.length * 0.15)) ? c.item.m : undefined;
}

/* ---------------- 정규식 스크립트 ---------------- */
export type ScriptMode = "editinput" | "editoutput" | "editprocess" | "editdisplay";
/** 반환: 바뀐 글, @@emo 로 고른 감정 이미지 이름 */
export function runScripts(text: string, scripts: RegexScript[], mode: ScriptMode, cbs?: (s: string) => string): { text: string; emotion?: string } {
  // RisuAI처럼: 먼저 CBS, 그리고 스크립트를 적용할 때마다 다시 CBS
  let data = cbs ? cbs(text) : text;
  let emotion: string | undefined;
  const parsed = scripts
    .filter((s) => s && s.type === mode && s.in && !s.disabled)
    .map((s, i) => {
      const actions: string[] = [];
      let order = 0;
      let flag = s.ableFlag ? s.flag || "g" : "g";
      if (s.ableFlag && s.flag?.includes("<"))
        flag = s.flag.replace(/<(.+?)>/g, (_, p1: string) => {
          for (const m of p1.split(",").map((v) => v.trim())) m.startsWith("order ") ? (order = parseInt(m.slice(6)) || 0) : actions.push(m);
          return "";
        });
      return { s, actions, order, flag, i };
    })
    .sort((a, b) => b.order - a.order || a.i - b.i);
  for (const { s, actions, flag: rawFlag } of parsed) {
    let out = s.out.replaceAll("$n", "\n");
    let flag = rawFlag;
    const move = out.startsWith("@@move_top") || out.startsWith("@@move_bottom") || actions.includes("move_top") || actions.includes("move_bottom");
    if (move) flag = flag.replace("g", "");
    if (out.endsWith(">") && !actions.includes("no_end_nl")) out += "\n";
    flag = [...new Set(flag.trim().replace(/[^dgimsuvy]/g, ""))].join("") || "u";
    let re: RegExp;
    try {
      re = new RegExp(actions.includes("cbs") && cbs ? cbs(s.in) : s.in, flag);
    } catch {
      continue; // 이 브라우저에서 못 쓰는 정규식은 건너뜀
    }
    try {
      if (out.startsWith("@@") || actions.length) {
        if (!re.test(data)) continue;
        re.lastIndex = 0;
        if (out.startsWith("@@emo ")) emotion = s.out.slice(6).trim();
        else if (move) {
          const top = out.startsWith("@@move_top") || actions.includes("move_top");
          const m = data.match(re);
          data = data.replace(re, "");
          if (m) {
            const moved = out.replace(/^@@move_(top|bottom) /, "").replace(/(?<!\$)\$(\d+)/g, (v, k: string) => m[Number(k)] ?? v).replace(/\$&/g, m[0]);
            data = top ? `${moved}\n${data}` : `${data}\n${moved}`;
          }
        } else if (out.startsWith("@@inject") || out.startsWith("@@repeat_back") || actions.includes("inject") || actions.includes("repeat_back")) continue; // 채팅 기록을 고치는 동작은 지원하지 않음
        else data = cbs ? cbs(data.replace(re, out)) : data.replace(re, out);
      } else data = cbs ? cbs(data.replace(re, out)) : data.replace(re, out);
    } catch {
      /* 잘못된 치환식 무시 */
    }
  }
  return { text: data, emotion };
}

/* ---------------- 에셋 표시 → 그림 ---------------- */
export const ASSET_TAG = /\{\{(raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source)::(.+?)\}\}/gs;
export const EMOTION_TAG = /<Emotion="(.+?)">/gi;
/** 그림 자리 표시(나중에 실제 주소로 바꿈) */
export const imgToken = (id: string) => `nvimg:${id}`;
const IMG_TOKEN = /nvimg:([a-z0-9]+)/gi;
export const hasMarkup = (s: string) => /<[a-z!/]/i.test(s) || /nvimg:[a-z0-9]/i.test(s);

/**
 * 표시용 변환: editdisplay 스크립트 → <Emotion> → 에셋 표시를 <img src="nvimg:ID"> 로.
 * 반환 html은 아직 안전 처리 전이며 그림 주소는 토큰 상태.
 */
/**
 * mode "back": 배경 HTML용 ({{bg::}}가 화면 배경 그림이 됨). 반환 emotions: 본문에 나온 감정 이미지 이름(옆 패널용)
 */
export function renderRisu(text: string, pool: ImagePool, cbs?: (s: string) => string, mode: "normal" | "back" = "normal"): { html: string; ids: string[]; emotion?: string; emotions: string[] } {
  const ids = new Set<string>();
  const emotions: string[] = [];
  const r = runScripts(text, pool.scripts, "editdisplay", cbs);
  let html = r.text.replace(EMOTION_TAG, (_, n: string) => `{{emotion::${n}}}`);
  if (r.emotion) html = `{{emotion::${r.emotion}}}\n${html}`;
  html = html.replace(ASSET_TAG, (_, type: string, name: string) => {
    const hit = type === "emotion" ? findAsset(name, pool.emotions, false) ?? findAsset(name, pool.assets, false) : findAsset(name, pool.assets) ?? findAsset(name, pool.emotions, false);
    if (!hit) return "";
    if (type === "emotion" && pool.emotionPanel) {
      emotions.push(hit.name); // 옆 패널에 보여 주고 본문에서는 뺌
      ids.add(hit.id);
      return "";
    }
    ids.add(hit.id);
    const src = imgToken(hit.id);
    const video = isVideo(hit);
    const audio = isAudio(hit);
    switch (type) {
      case "raw":
      case "path":
        return src;
      case "img":
      case "emotion":
        return video ? `<video src="${src}" autoplay muted loop playsinline class="risu-img"></video>\n` : `<img src="${src}" alt="${esc(hit.name)}" class="risu-img">\n`;
      case "asset":
        return video ? `<video src="${src}" autoplay muted loop playsinline class="risu-img"></video>\n` : audio ? `<audio src="${src}" controls></audio>\n` : `<img src="${src}" alt="${esc(hit.name)}" class="risu-img">\n`;
      case "image":
        return `<div class="risu-inlay"><img src="${src}" alt="${esc(hit.name)}"></div>\n`;
      case "video":
        return `<video src="${src}" controls autoplay loop playsinline class="risu-img"></video>\n`;
      case "video-img":
        return `<video src="${src}" autoplay muted loop playsinline class="risu-img"></video>\n`;
      case "audio":
        return `<audio src="${src}" controls autoplay loop></audio>\n`;
      case "bgm":
        return `<div risu-ctrl="bgm___auto___${src}" style="display:none"></div>\n`; // 화면이 배경 음악으로 재생
      case "bg":
        return mode === "back" ? `<div class="risu-bgimg" style="background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url(${src})"></div>` : "";
    }
    return "";
  });
  // <img src="에셋이름"> · <img="에셋이름">: 주소가 아니라 이름이면 에셋으로 (봇 스크립트가 없어도 그림이 나오게)
  const byName = (name: string) => {
    const hit = findAsset(name, pool.assets) ?? findAsset(name, pool.emotions, false);
    if (hit) ids.add(hit.id);
    return hit;
  };
  html = html
    .replace(/<img=["']([^"'<>]+)["']\s*\/?>/gi, (m, name: string) => {
      const hit = byName(name);
      return hit ? `<img src="${imgToken(hit.id)}" alt="${esc(hit.name)}" class="risu-img">` : m;
    })
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi, (m, pre: string, q: string, src: string) => {
      if (!src.trim() || /^(nvimg:|blob:|data:|https?:|\/)/i.test(src.trim())) return m;
      const hit = byName(src);
      return hit ? `${pre}${q}${imgToken(hit.id)}${q}` : m;
    });
  return { html, ids: [...ids], emotion: r.emotion, emotions };
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- 안전한 HTML (스크립트·외부 주소 제거) ---------------- */
const TAGS = new Set("div span p br b i u s strong em small big sub sup mark hr blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption img details summary font center pre code ruby rt rp q cite abbr del ins figure figcaption button section article header footer nav aside main label form input select option optgroup textarea fieldset legend audio video source progress meter dl dt dd kbd var samp time".split(" "));
const DROP = new Set(["script", "iframe", "object", "embed", "link", "meta", "base", "svg", "math", "template", "noscript", "title", "frame", "frameset", "applet", "portal"]);
const ATTRS = new Set(["alt", "title", "colspan", "rowspan", "open", "align", "color", "size", "width", "height", "class", "role", "tabindex", "risu-trigger", "risu-btn", "risu-id", "risu-form", "risu-ctrl", "risu-mark", "risu-change-var-name", "risu-change-var-value", "type", "name", "value", "placeholder", "checked", "selected", "disabled", "readonly", "min", "max", "step", "multiple", "rows", "cols", "for", "id", "maxlength", "minlength", "required", "label", "controls", "loop", "muted", "autoplay", "playsinline", "preload", "poster", "loading", "decoding", "datetime", "dir", "lang", "start", "reversed"]);
const isAria = (n: string) => n.startsWith("aria-") || n.startsWith("data-");
// 그림 주소: 이 앱이 만든 blob 주소, data 그림(svg 포함 — 그림으로 그릴 때는 스크립트가 실행되지 않음)
const safeUrl = (u: string) => /^(blob:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,])/i.test(u.trim());
/** 봇 CSS의 @import 중 글꼴(Google Fonts)만 허용 */
const FONT_IMPORT = /^@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/css2?\?[^'")\s]+)['"]?\s*\)\s*;?$/i;
/**
 * 봇 CSS 한 덩어리를 안전하게.
 * - position:fixed → 이야기 화면(.risu-stage) 안에서만 고정 (그 밖에서는 메시지 안 absolute)
 * - 화면 단위(vh·vw·dvh…) → 이야기 화면 크기 단위(cqh·cqw): 봇이 "화면"으로 여기는 곳이 앱 전체가 아니라 이야기 화면
 */
function safeStyle(css: string): string {
  if (/expression\s*\(|@import|javascript:|behavior\s*:/i.test(css)) return "";
  return css
    .split(";")
    .filter((d) => [...d.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]).every(safeUrl))
    .map((d) => {
      d = d.replace(/(position\s*:\s*)fixed\b/i, "$1var(--risu-fixed,absolute)");
      return /url\(/i.test(d) ? d : d.replace(/(\d*\.?\d)[dsl]?v(h|w|min|max)\b/gi, (_, n: string, u: string) => `${n}cq${u.toLowerCase()}`);
    })
    .join(";");
}
/** urls: 그림 id → 실제 주소. 브라우저(DOM)에서만 사용 */
/**
 * 봇의 <style>을 이 메시지 안에서만 적용되게: 모든 선택자 앞에 범위(scope)를 붙이고,
 * 페이지 전체를 건드리는 html/body/:root 규칙, @import·@font-face, 외부 url()은 버린다.
 */
export function scopeCss(css: string, scope: string): string {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const imports: string[] = [];
  let i = 0;
  /** i부터 chars 중 하나가 처음 나오는 위치 (따옴표 문자열·괄호 안은 건너뜀). 없으면 -1 */
  const next = (chars: string, from = i): number => {
    let paren = 0;
    for (let k = from; k < src.length; k++) {
      const ch = src[k];
      if (ch === '"' || ch === "'") {
        const end = src.indexOf(ch, k + 1);
        k = end === -1 ? src.length : end;
      } else if (ch === "(") paren++;
      else if (ch === ")") paren = Math.max(0, paren - 1);
      else if (!paren && chars.includes(ch)) return k;
    }
    return -1;
  };
  const skipBlock = () => {
    let depth = 1; // '{' 다음부터 짝이 맞는 '}' 까지
    while (i < src.length && depth) {
      const k = next("{}");
      if (k === -1) return void (i = src.length);
      depth += src[k] === "{" ? 1 : -1;
      i = k + 1;
    }
  };
  const block = (): string => {
    let out = "";
    while (i < src.length) {
      const k = next("{};");
      if (k === -1) break;
      if (src[k] === "}") {
        i = k + 1;
        return out; // 이 블록 끝
      }
      const head = src.slice(i, k).trim();
      i = k + 1;
      if (src[k] === ";") {
        const font = FONT_IMPORT.exec(head + ";");
        if (font) imports.push(`@import url("${font[1]}");`);
        continue; // 그 밖의 @import · @charset 등 중괄호 없는 규칙은 버림
      }
      if (/^@(media|supports|container|layer)\b/i.test(head)) {
        const inner = block();
        if (inner.trim()) out += `${head}{${inner}}`;
      } else if (/^@(-\w+-)?keyframes\b/i.test(head)) {
        const start = i;
        skipBlock();
        out += `${head}{${src.slice(start, i - 1)}}`;
      } else if (head.startsWith("@")) skipBlock(); // @font-face 등: 버림
      else {
        const end = next("}");
        const body = safeStyle(src.slice(i, end === -1 ? src.length : end));
        i = end === -1 ? src.length : end + 1;
        const sels = head.split(",").map((x) => x.trim()).filter((x) => x && !/^(html|body|:root)\b/i.test(x) && !/\*\s*$/.test(x));
        if (sels.length && body.trim()) out += `${sels.map((x) => `.${scope} ${x}`).join(",")}{${body}}`;
      }
    }
    return out;
  };
  const body = block();
  return imports.join("") + body; // @import는 맨 앞이어야 함
}

export function sanitizeHtml(html: string, urls: Record<string, string>, scope?: string): string {
  const withUrls = html.replace(IMG_TOKEN, (_, id: string) => urls[id] ?? "");
  const tpl = document.createElement("template");
  tpl.innerHTML = withUrls;
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) {
        child.remove();
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "style") {
        const css = scope ? scopeCss(el.textContent ?? "", scope) : "";
        if (css) el.textContent = css;
        else el.remove();
        for (const a of [...el.attributes]) el.removeAttribute(a.name);
        continue;
      }
      if (DROP.has(tag)) {
        el.remove();
        continue;
      }
      if (!TAGS.has(tag)) {
        walk(el);
        el.replaceWith(...el.childNodes); // 모르는 태그는 벗기고 내용만
        continue;
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const media = (tag === "img" || tag === "audio" || tag === "video" || tag === "source") && n === "src";
        const keep = n === "style" ? safeStyle(a.value) : media ? (safeUrl(a.value) ? a.value : "") : n === "poster" ? (safeUrl(a.value) ? a.value : "") : (ATTRS.has(n) || isAria(n)) && !n.startsWith("on") ? a.value : "";
        if (keep) el.setAttribute(n, keep);
        else el.removeAttribute(a.name);
      }
      if (tag === "img" && !el.getAttribute("src")) {
        el.remove();
        continue;
      }
      walk(el);
    }
  };
  walk(tpl.content);
  // 태그 사이의 공백·줄바꿈만 있는 글 조각은 지운다 (pre-wrap에서 빈 줄로 보이지 않게)
  const isBlock = (n: Node | null) => !!n && n.nodeType === 1 && !["b", "i", "u", "s", "strong", "em", "small", "big", "sub", "sup", "mark", "span", "font", "q", "cite", "abbr", "del", "ins", "code", "ruby"].includes((n as Element).tagName.toLowerCase());
  const prune = (node: Node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 3 && !c.textContent!.trim() && c.textContent!.includes("\n") && (isBlock(c.previousSibling) || isBlock(c.nextSibling) || !c.previousSibling || !c.nextSibling)) c.remove();
      else if (c.nodeType === 3) {
        // 블록(그림·상자)과 맞닿은 쪽의 줄바꿈은 빈 줄이 되므로 지운다
        let t = c.textContent!;
        if (!c.previousSibling || isBlock(c.previousSibling)) t = t.replace(/^\s*\n/, "");
        if (!c.nextSibling || isBlock(c.nextSibling)) t = t.replace(/\n\s*$/, "");
        if (t !== c.textContent) c.textContent = t;
      } else if (c.nodeType === 1) prune(c);
    }
  };
  tpl.content.normalize(); // 벗겨 낸 태그 자리에서 쪼개진 글 조각 합치기
  prune(tpl.content);
  return tpl.innerHTML;
}

/* ---------------- 프롬프트 ---------------- */
const RULE_HINT = /\{\{(?:img|image|asset|emotion|raw|path|bg)::|<img\b|<Emotion=|\{\{(?:assetlist|emotionlist)\}\}/i;
/** 봇 스스로 그림 쓰는 법을 정해 두었는지 (설명·로어북·스크립트에 그림 표시가 있으면) */
export function hasOwnImageRules(ctx: StoryContext, pool: ImagePool): boolean {
  if (pool.scripts.some((s) => s.type !== "editinput" && (RULE_HINT.test(s.out) || /nvimg|<img/i.test(s.out)))) return true;
  const texts = [...ctx.characters.flatMap((c) => [c.profile, c.speech, c.instructions ?? "", ...c.lore.map((l) => l.content)]), ...(ctx.world ? [ctx.world.description, ctx.world.rules, ...ctx.world.lore.map((l) => l.content)] : [])];
  return texts.some((t) => RULE_HINT.test(t));
}

/** 시스템 프롬프트에 붙일 그림 안내 (없으면 빈 배열) */
export function imagePromptSection(ctx: StoryContext, pool: ImagePool, mode: "chat" | "novel"): string[] {
  const out: string[] = [];
  const own = hasOwnImageRules(ctx, pool);
  if (own) out.push("", "## 그림 사용", mode === "chat" ? "설정에 정해진 그림 표시 규칙(태그 형식·이름)을 지켜서, 장면에 맞을 때 그림 표시를 쓴다." : "설정에 정해진 그림 표시 규칙(태그 형식·이름)을 소설 원고에서도 지킨다. 그림 표시는 해당 장면의 문단 바로 다음에 별도 줄로 쓰고, 한 회차에 너무 많이 넣지 않는다.");
  else if (pool.assets.length) {
    const names = pool.assets.filter((m) => m.kind !== "icon").map((m) => m.name);
    if (names.length)
      out.push(
        "",
        "## 그림 사용",
        `장면·인물·장소에 잘 맞는 그림이 아래 목록에 있으면, 해당 문단 바로 다음에 {{img::이름}} 한 줄을 따로 쓴다. 이름은 목록과 똑같이 쓰고, ${mode === "chat" ? "한 응답에 1개 이하" : "한 회차에 3개 이하"}로, 어울리는 그림이 없으면 쓰지 않는다.`,
        `그림 목록: ${names.slice(0, 150).join(", ")}`,
      );
  }
  if (pool.emotionMode && pool.emotions.length) {
    const list = [...new Set(pool.emotions.map((m) => m.name))].slice(0, 150).join(", ");
    out.push(
      "",
      "## 감정 이미지",
      mode === "chat"
        ? `응답 맨 끝에, 이번 응답에서 인물의 감정에 맞는 감정 이미지를 <Emotion="이름"> 형식으로 하나 쓴다. 이름은 목록에서만 고르고, 앞선 응답과 같은 것만 반복하지 않는다. 목록: ${list}`
        : `인물의 감정이 크게 드러나는 장면에서는 그 문단 바로 다음 줄에 <Emotion="이름"> 을 쓸 수 있다(한 회차에 3개 이하). 이름은 목록에서만 고른다. 목록: ${list}`,
    );
  }
  return out;
}

/** {{assetlist}} · {{emotionlist}} 를 실제 이름 목록(JSON 배열)으로 */
export function fillAssetLists(s: string, assets: string[], emotions: string[]): string {
  return s.replace(/\{\{\s*assetlist\s*\}\}/gi, JSON.stringify(assets)).replace(/\{\{\s*emotionlist\s*\}\}/gi, JSON.stringify(emotions));
}

/* ---------------- 내보내기용: HTML → 문단 · 그림 ---------------- */
export type Block = { type: "text"; text: string } | { type: "image"; id: string };
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** DOM 없이 단순 변환 (EPUB·TXT) */
export function htmlToBlocks(html: string): Block[] {
  const s = html
    .replace(/<img\b[^>]*?src="nvimg:([a-z0-9]+)"[^>]*>/gi, "\n\u0001$1\u0001\n")
    .replace(/nvimg:[a-z0-9]+/gi, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/?(p|div|li|h\d|tr|blockquote|details|summary|table|figure)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
  const out: Block[] = [];
  for (const part of s.split(/\n{2,}|\n(?=\u0001)|(?<=\u0001)\n/)) {
    const m = /^\s*\u0001([a-z0-9]+)\u0001\s*$/i.exec(part);
    if (m) out.push({ type: "image", id: m[1] });
    else if (part.trim()) out.push({ type: "text", text: part.trim() });
  }
  return out;
}

/* ---------------- 저장 ---------------- */
/** 바이트로 이미지 형식 판별 */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /^avi[fs]/.test(String.fromCharCode(...b.subarray(8, 12)))) return "image/avif";
  return null;
}
/** 그림·소리·영상 판별 (ext: 파일 확장자 힌트) */
export function sniffMedia(b: Uint8Array, ext = ""): string | null {
  const img = sniffImage(b);
  if (img && img !== "image/avif") return img;
  const s = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ext !== "aac")) return "audio/mpeg";
  if (s(0, 4) === "OggS") return /ogv/i.test(ext) ? "video/ogg" : "audio/ogg";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "audio/wav";
  if (s(0, 4) === "fLaC") return "audio/flac";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return /weba/i.test(ext) ? "audio/webm" : "video/webm";
  if (s(4, 4) === "ftyp") {
    const brand = s(8, 4);
    if (/^avi[fs]/.test(brand)) return "image/avif";
    if (/^M4A|^M4B/.test(brand) || /m4a|aac/i.test(ext)) return "audio/mp4";
    if (/^qt/.test(brand) || /mov/i.test(ext)) return "video/quicktime";
    return "video/mp4";
  }
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/aac";
  return img;
}
export const isAudio = (m: { mime: string }) => m.mime.startsWith("audio/");
export const isVideo = (m: { mime: string }) => m.mime.startsWith("video/");
export const extOfMime = (mime: string) => (mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "png");

/** 같은 주인 안에서 이름이 겹치지 않게 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toLowerCase()));
  const base = name.replace(/[{}<>\n]/g, " ").trim() || "image";
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
}

/** 큰 그림은 저장 전에 줄인다 (1.2MB 넘을 때 긴 변 1600px로, 움직이는 GIF는 그대로). canvas가 없으면 원본 */
export async function shrinkImage(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (bytes.length < 1_200_000 || mime === "image/gif" || typeof document === "undefined" || typeof createImageBitmap === "undefined") return { bytes, mime };
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.88));
    if (!blob || blob.size >= bytes.length) return { bytes, mime };
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/webp" };
  } catch {
    return { bytes, mime };
  }
}
