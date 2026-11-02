import { useMemo } from "react";
import { hasMarkup, poolIsEmpty, renderRisu, sanitizeHtml, type ImagePool } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { useApp } from "../lib/store";
import StoryText from "./StoryText";

/**
 * AI 본문 표시: 봇의 표시 스크립트(editdisplay)를 거친 뒤 {{img::이름}} · <Emotion="이름"> 등을 그림으로 바꾼다.
 * 이미지·스크립트가 없는 이야기는 평소처럼 글만 보여 준다.
 */
export default function RisuText({ text, pool }: { text: string; pool?: ImagePool }) {
  const images = useApp((s) => s.images);
  const r = useMemo(() => (pool && !poolIsEmpty(pool) ? renderRisu(text, pool) : null), [text, pool]);
  const urls = useImageUrls(r ? r.ids.map((id) => images[id]) : []);
  if (!r || !hasMarkup(r.html)) return <StoryText text={r ? r.html : text} />;
  return <div className="story risu-html whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: sanitizeHtml(tidy(r.html), urls) }} />;
}

/** 그림은 블록으로 보이므로 앞뒤 빈 줄을 줄인다 (pre-wrap에서 빈 공간이 커지지 않게) */
const tidy = (html: string) => html.trim().replace(/[ \t]*\n+[ \t]*(<img\b[^>]*>)[ \t]*\n*/g, "\n$1").replace(/(<img\b[^>]*>)\n+/g, "$1");
