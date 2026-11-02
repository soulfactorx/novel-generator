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
}
const poolCache = new WeakMap<object, Map<string, ImagePool>>();
/** 같은 이미지 목록·같은 인물(수정 시각 포함)이면 같은 객체를 돌려준다 (화면 다시 그리기 최소화) */
export function imagePool(ctx: StoryContext, images: Record<string, ImageMeta> | ImageMeta[]): ImagePool {
  const owners = [...ctx.characters, ...(ctx.world ? [ctx.world] : [])];
  const key = owners.map((o) => `${o.id}:${o.updatedAt}`).join(",");
  let byKey = poolCache.get(images);
  if (!byKey) poolCache.set(images, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const pool = buildPool(owners, Array.isArray(images) ? images : Object.values(images), ctx);
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
export function findAsset(name: string, list: ImageMeta[], fuzzy = true): ImageMeta | undefined {
  const n = name.trim().toLowerCase();
  const exact = list.find((m) => m.name.toLowerCase() === n);
  if (exact || !fuzzy) return exact;
  let best: ImageMeta | undefined;
  let bestD = Infinity;
  const t = trimName(n);
  for (const m of list) {
    const d = editDistance(t, trimName(m.name.toLowerCase()));
    if (d < bestD) [best, bestD] = [m, d];
  }
  return bestD <= MAX_DIFF ? best : undefined;
}

/* ---------------- 정규식 스크립트 ---------------- */
export type ScriptMode = "editinput" | "editoutput" | "editprocess" | "editdisplay";
/** 반환: 바뀐 글, @@emo 로 고른 감정 이미지 이름 */
export function runScripts(text: string, scripts: RegexScript[], mode: ScriptMode): { text: string; emotion?: string } {
  let data = text;
  let emotion: string | undefined;
  const parsed = scripts
    .filter((s) => s && s.type === mode && s.in)
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
      re = new RegExp(s.in, flag);
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
        else data = data.replace(re, out);
      } else data = data.replace(re, out);
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
export function renderRisu(text: string, pool: ImagePool): { html: string; ids: string[]; emotion?: string } {
  const ids = new Set<string>();
  const r = runScripts(text, pool.scripts, "editdisplay");
  let html = r.text.replace(EMOTION_TAG, (_, n: string) => `{{emotion::${n}}}`);
  if (r.emotion) html = `{{emotion::${r.emotion}}}\n${html}`;
  html = html.replace(ASSET_TAG, (_, type: string, name: string) => {
    const hit = type === "emotion" ? findAsset(name, pool.emotions, false) ?? findAsset(name, pool.assets, false) : findAsset(name, pool.assets) ?? findAsset(name, pool.emotions, false);
    if (!hit) return "";
    ids.add(hit.id);
    const src = imgToken(hit.id);
    if (type === "raw" || type === "path") return src;
    if (type === "img" || type === "emotion" || type === "asset") return `<img src="${src}" alt="${esc(hit.name)}" class="risu-img">\n`;
    if (type === "image") return `<div class="risu-inlay"><img src="${src}" alt="${esc(hit.name)}"></div>\n`;
    return ""; // 영상·음악·배경은 쓰지 않음
  });
  return { html, ids: [...ids], emotion: r.emotion };
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- 안전한 HTML (스크립트·외부 주소 제거) ---------------- */
const TAGS = new Set("div span p br b i u s strong em small big sub sup mark hr blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption img details summary font center pre code ruby rt rp q cite abbr del ins figure figcaption".split(" "));
const DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form", "input", "button", "textarea", "select", "svg", "math", "template", "audio", "video", "source", "noscript", "title"]);
const safeUrl = (u: string) => /^(blob:|data:image\/(png|jpe?g|gif|webp|avif);)/i.test(u.trim());
function safeStyle(css: string): string {
  if (/expression\s*\(|@import|javascript:|behavior\s*:/i.test(css)) return "";
  return css
    .split(";")
    .filter((d) => {
      const urls = [...d.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]);
      return urls.every(safeUrl) && !/position\s*:\s*fixed/i.test(d);
    })
    .join(";");
}
/** urls: 그림 id → 실제 주소. 브라우저(DOM)에서만 사용 */
export function sanitizeHtml(html: string, urls: Record<string, string>): string {
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
        const keep = n === "style" ? safeStyle(a.value) : tag === "img" && n === "src" ? (safeUrl(a.value) ? a.value : "") : ["alt", "title", "colspan", "rowspan", "open", "align", "color", "size", "width", "height", "class"].includes(n) ? a.value : "";
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
  return tpl.innerHTML;
}

/* ---------------- 프롬프트 ---------------- */
const RULE_HINT = /\{\{(?:img|image|asset|emotion|raw|path|bg)::|<img\b|<Emotion=|\{\{(?:assetlist|emotionlist)\}\}/i;
/** 봇 스스로 그림 쓰는 법을 정해 두었는지 (설명·로어북·스크립트에 그림 표시가 있으면) */
export function hasOwnImageRules(ctx: StoryContext, pool: ImagePool): boolean {
  if (pool.scripts.some((s) => s.type !== "editinput" && (RULE_HINT.test(s.out) || /nvimg|<img/i.test(s.out)))) return true;
  const texts = [...ctx.characters.flatMap((c) => [c.profile, c.speech, ...c.lore.map((l) => l.content)]), ...(ctx.world ? [ctx.world.description, ctx.world.rules, ...ctx.world.lore.map((l) => l.content)] : [])];
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
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  return null;
}
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
