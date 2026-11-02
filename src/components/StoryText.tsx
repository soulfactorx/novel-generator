export default function StoryText({ text }: { text: string }) {
  return (
    <div className="story space-y-3 whitespace-pre-wrap">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
