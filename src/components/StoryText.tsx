import { speakerStyle, splitDialogue } from "../lib/dialogue";
import { useSpeakers } from "./Speakers";

export default function StoryText({ text }: { text: string }) {
  const speakers = useSpeakers();
  return (
    <div className="story space-y-3 whitespace-pre-wrap">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>
          {speakers
            ? splitDialogue(p, speakers).map((x, j) =>
                x.speaker ? (
                  <span key={j} className="dlg" style={speakerStyle(x.speaker) as React.CSSProperties} title={x.speaker.name}>
                    {x.text}
                  </span>
                ) : (
                  x.text
                ),
              )
            : p}
        </p>
      ))}
    </div>
  );
}
