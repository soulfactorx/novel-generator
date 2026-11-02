import { useId, useMemo, type MouseEvent } from "react";
import { hasMarkup, poolIsEmpty, renderRisu, sanitizeHtml, type ImagePool } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { inlineMarkdown } from "../lib/markdown";
import { useApp } from "../lib/store";
import StoryText from "./StoryText";

/**
 * AI 본문 표시 (RisuAI 순서): CBS({{…}}) → 봇의 표시 스크립트(editdisplay, 스크립트마다 CBS 다시) →
 * 그림 표시({{img::}} · <img src="이름"> · <Emotion>) → 마크다운 → 안전한 HTML.
 * 봇 버튼(risu-trigger)을 누르면 onTrigger로 알린다.
 */
export default function RisuText({ text, pool, cbs, onTrigger }: { text: string; pool?: ImagePool; cbs?: (s: string) => string; onTrigger?: (name: string, id: string | null) => void }) {
  const images = useApp((s) => s.images);
  const markdown = useApp((s) => s.settings.risu.markdown);
  const scope = "rs" + useId().replace(/[^a-z0-9]/gi, ""); // 봇 <style>을 이 메시지 안으로 한정
  const r = useMemo(() => {
    if ((!pool || poolIsEmpty(pool)) && !cbs) return null;
    const out = pool ? renderRisu(text, pool, cbs) : { html: cbs ? cbs(text) : text, ids: [] as string[] };
    return { ...out, html: markdown ? inlineMarkdown(out.html) : out.html };
  }, [text, pool, cbs, markdown]);
  const md = useMemo(() => (!r && markdown ? inlineMarkdown(text) : null), [r, markdown, text]);
  const urls = useImageUrls(r ? r.ids.map((id) => images[id]) : []);
  const html = r ? r.html : md;
  if (html === null || !hasMarkup(html)) return <StoryText text={html ?? text} />;
  const click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[risu-trigger],[risu-btn]") as HTMLElement | null;
    if (!el || !onTrigger) return;
    e.preventDefault();
    onTrigger(el.getAttribute("risu-trigger") ?? el.getAttribute("risu-btn") ?? "", el.getAttribute("risu-id"));
  };
  return <div className={`story risu-html whitespace-pre-wrap ${scope}`} onClick={click} dangerouslySetInnerHTML={{ __html: sanitizeHtml(tidy(html), urls, scope) }} />;
}

/** 그림은 블록으로 보이므로 앞뒤 빈 줄을 줄인다 (pre-wrap에서 빈 공간이 커지지 않게) */
const tidy = (html: string) =>
  html
    .trim()
    .replace(/>[ \t]*\n\s*</g, ">\n<") // 태그 사이 빈 줄 줄이기
    .replace(/[ \t]*\n+[ \t]*(<img\b[^>]*>)[ \t]*\n*/g, "\n$1")
    .replace(/(<img\b[^>]*>)\n+/g, "$1");
