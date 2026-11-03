import { splitDialogue } from "../lib/dialogue";
import { useApp } from "../lib/store";

/** 문단 나누기 + 대사 색 */
export default function StoryText({ text }: { text: string }) {
  const color = useApp((s) => s.settings.dialogueColors);
  return (
    <div className="story space-y-3 whitespace-pre-wrap">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{color ? splitDialogue(p).map((x, j) => (x.quote ? <span key={j} className="dlg">{x.text}</span> : x.text)) : p}</p>
      ))}
    </div>
  );
}
