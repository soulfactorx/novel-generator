import type { StoryContext } from "./prompt";
import type { Usage } from "./providers/types";
import type { Novel } from "./types";

/** Gemini 이미지 모델 (ai.google.dev 공식 문서, 2026-10-31 확인) */
export const COVER_MODELS = [
  { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", note: "권장 · 장당 약 $0.034" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", note: "가장 빠름 · 장당 약 $0.034" },
];
export const COVER_W = 800;
export const COVER_H = 1200;

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 표지 그림 프롬프트. 표지는 누구나 보는 이미지이므로 소설의 수위와 관계없이 전체 이용가로 요청 */
export function buildCoverPrompt(n: Novel, ctx: StoryContext): string {
  const parts = [
    "Book cover illustration for a Korean web novel.",
    n.genre.trim() && `Genre: ${n.genre.trim()}.`,
    n.title.trim() && `Title (for mood only, do not write it): ${n.title.trim()}.`,
    n.brief.trim() && `Story: ${cut(n.brief.trim().replace(/\s+/g, " "), 500)}`,
    ctx.world && `Setting: ${ctx.world.name}. ${cut(ctx.world.description.replace(/\s+/g, " "), 250)}`,
    ctx.characters.length > 0 && `Main characters: ${ctx.characters.slice(0, 3).map((c) => `${c.name}${c.summary ? ` (${c.summary})` : ""}`).join(", ")}.`,
    "Style: polished digital painting, cinematic lighting, rich atmosphere, vertical book-cover composition, keep the upper third calm and uncluttered for a title.",
    "Do not include any text, letters, numbers, logos, signatures or watermarks.",
    "Safe for all ages: no nudity, no sexual content, no gore.",
  ];
  return parts.filter(Boolean).join("\n");
}

export interface CoverImage {
  mime: string;
  base64: string;
  usage?: Usage;
  model: string;
}

/** Gemini Interactions API 응답에서 마지막 이미지 꺼내기 */
export function parseImageResponse(j: unknown): { mime: string; base64: string; usage?: Usage } {
  const r = (j ?? {}) as { steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[]; usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number; total_cached_tokens?: number } };
  let img: { data?: string; mime_type?: string } | undefined;
  for (const s of r.steps ?? []) for (const c of s.content ?? []) if (c.type === "image" && c.data) img = c;
  if (!img?.data) throw new Error("그림이 돌아오지 않았습니다. 기획 내용 때문에 거절됐을 수 있으니, 프롬프트를 고쳐 다시 시도해 주세요.");
  const u = r.usage;
  return {
    mime: img.mime_type || "image/png",
    base64: img.data,
    usage: u ? { input: (u.total_input_tokens ?? 0) - (u.total_cached_tokens ?? 0), output: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0), cacheRead: u.total_cached_tokens ?? 0 } : undefined,
  };
}

export async function generateCoverImage(opts: { key: string; model: string; prompt: string; signal?: AbortSignal }): Promise<CoverImage> {
  if (!opts.key) throw new Error("AI 표지는 Google Gemini API 키가 필요합니다. [⚙️ 설정 → AI 연결]에서 Gemini 키를 입력해 주세요.");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": opts.key },
    body: JSON.stringify({ model: opts.model, input: opts.prompt, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "2:3", image_size: "1K" } }),
    signal: opts.signal,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`;
    throw new Error(res.status === 401 || res.status === 403 ? `Gemini API 키를 확인해 주세요. (${msg})` : res.status === 429 ? `요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요. (${msg})` : `표지 생성 실패: ${msg}`);
  }
  return { ...parseImageResponse(j), model: opts.model };
}

export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("잘못된 이미지 데이터");
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { mime: m[1], bytes };
}

/* ---------------- 그리기 (브라우저 canvas) ---------------- */

/** 장르·제목으로 정해지는 색 조합 (같은 소설은 같은 색) */
export function coverPalette(seed: string): [string, string, string] {
  const PALETTES: [string, string, string][] = [
    ["#1e1b4b", "#6d28d9", "#f5f3ff"],
    ["#0c4a6e", "#0e7490", "#ecfeff"],
    ["#3f1d38", "#be185d", "#fdf2f8"],
    ["#1c1917", "#78350f", "#fef3c7"],
    ["#052e16", "#15803d", "#f0fdf4"],
    ["#172554", "#1d4ed8", "#eff6ff"],
    ["#450a0a", "#b91c1c", "#fef2f2"],
    ["#111827", "#4b5563", "#f9fafb"],
  ];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** 표시 폭 기준 줄바꿈 (한글 1, 영문·숫자·공백 0.55). 공백에서 우선 끊음 */
export function wrapTitle(text: string, maxUnits: number, maxLines = 3): string[] {
  const w = (c: string) => (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(c) ? 1 : 0.55);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const width = (s: string) => [...s].reduce((a, c) => a + w(c), 0);
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (width(next) <= maxUnits) cur = next;
    else if (!cur) {
      // 한 단어가 너무 길면 글자 단위로
      let part = "";
      for (const c of word) {
        if (width(part + c) > maxUnits) (lines.push(part), (part = ""));
        part += c;
      }
      cur = part;
    } else (lines.push(cur), (cur = word));
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.$/, "…");
    return kept;
  }
  return lines;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("이미지를 읽지 못했습니다."));
    img.src = src;
  });

/** 표지 그리기: 배경 그림(없으면 색 그라데이션) + (선택) 제목·지은이 → JPEG data URL */
export async function renderCover(o: { background?: string; title: string; author?: string; genre?: string; showTitle: boolean }): Promise<string> {
  const c = document.createElement("canvas");
  c.width = COVER_W;
  c.height = COVER_H;
  const g = c.getContext("2d");
  if (!g) throw new Error("이 브라우저에서는 표지를 그릴 수 없습니다.");
  const [dark, mid, light] = coverPalette(`${o.genre ?? ""}|${o.title}`);
  if (o.background) {
    const img = await loadImage(o.background);
    const s = Math.max(COVER_W / img.width, COVER_H / img.height); // 꽉 채우고 넘치는 부분은 잘라냄
    g.drawImage(img, (COVER_W - img.width * s) / 2, (COVER_H - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const grad = g.createLinearGradient(0, 0, COVER_W, COVER_H);
    grad.addColorStop(0, mid);
    grad.addColorStop(1, dark);
    g.fillStyle = grad;
    g.fillRect(0, 0, COVER_W, COVER_H);
    g.strokeStyle = light + "55";
    g.lineWidth = 3;
    g.strokeRect(40, 40, COVER_W - 80, COVER_H - 80);
    g.strokeRect(52, 52, COVER_W - 104, COVER_H - 104);
  }
  if (o.showTitle && o.title.trim()) {
    const serif = '"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", serif';
    const lines = wrapTitle(o.title, 8);
    const size = lines.length > 2 ? 72 : 88;
    if (o.background) {
      const shade = g.createLinearGradient(0, 0, 0, COVER_H * 0.5);
      shade.addColorStop(0, "rgba(0,0,0,0.65)");
      shade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = shade;
      g.fillRect(0, 0, COVER_W, COVER_H * 0.5);
    }
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 12;
    if (o.genre?.trim()) {
      g.font = `600 30px ${serif}`;
      g.fillText(o.genre.trim(), COVER_W / 2, 130);
    }
    g.font = `800 ${size}px ${serif}`;
    lines.forEach((l, i) => g.fillText(l, COVER_W / 2, 190 + i * size * 1.25));
    if (o.author?.trim()) {
      g.font = `500 34px ${serif}`;
      g.fillText(o.author.trim(), COVER_W / 2, COVER_H - 130);
    }
  }
  return c.toDataURL("image/jpeg", 0.88);
}

/** 사용자가 올린 이미지 파일 → data URL (renderCover 에서 크기 맞춤) */
export const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    if (!f.type.startsWith("image/")) return rej(new Error("이미지 파일만 올릴 수 있습니다."));
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("파일을 읽지 못했습니다."));
    r.readAsDataURL(f);
  });
