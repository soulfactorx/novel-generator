import { useMemo } from "react";
import { findDialogue, speakerStyle, type Speaker } from "../lib/dialogue";
import { useSpeakers } from "./Speakers";

/** 문단 나누기 + 화자별 대사 색 (화자는 글 전체에서 찾음 — 앞 문단에 나온 이름도 씀) */
export default function StoryText({ text }: { text: string }) {
  const speakers = useSpeakers();
  const paras = useMemo(() => {
    const found = speakers ? findDialogue(text, speakers) : [];
    const out: { key: number; parts: { text: string; speaker?: Speaker }[] }[] = [];
    const re = /\n{2,}/g;
    let at = 0;
    let fi = 0;
    const push = (from: number, to: number) => {
      const parts: { text: string; speaker?: Speaker }[] = [];
      let p = from;
      while (fi < found.length && found[fi].end <= to) {
        const f = found[fi++];
        if (f.start < from) continue;
        if (f.start > p) parts.push({ text: text.slice(p, f.start) });
        parts.push({ text: text.slice(f.start, f.end), speaker: f.speaker });
        p = f.end;
      }
      if (p < to) parts.push({ text: text.slice(p, to) });
      out.push({ key: from, parts });
    };
    for (let m; (m = re.exec(text)); ) {
      push(at, m.index);
      at = m.index + m[0].length;
    }
    push(at, text.length);
    return out;
  }, [text, speakers]);
  return (
    <div className="story space-y-3 whitespace-pre-wrap">
      {paras.map((p) => (
        <p key={p.key}>
          {p.parts.map((x, j) =>
            x.speaker ? (
              <span key={j} className="dlg" style={speakerStyle(x.speaker) as React.CSSProperties} title={x.speaker.name}>
                {x.text}
              </span>
            ) : (
              x.text
            ),
          )}
        </p>
      ))}
    </div>
  );
}
