import { useState } from "react";
import { useApp } from "../lib/store";
import Dialog from "./Dialog";

/** 봇(Lua·트리거)이 띄운 알림·입력·확인·선택 창 */
export default function RisuDialogView() {
  const d = useApp((s) => s.risuDialog);
  const [text, setText] = useState("");
  if (!d) return null;
  const close = () => {
    if (d.kind === "input" || d.kind === "select") d.resolve(null);
    else if (d.kind === "confirm") d.resolve(false);
    else d.resolve();
    setText("");
  };
  const footer =
    d.kind === "input" ? (
      <>
        <button className="btn-ghost" onClick={close}>취소</button>
        <button className="btn-primary" onClick={() => { d.resolve(text); setText(""); }}>확인</button>
      </>
    ) : d.kind === "confirm" ? (
      <>
        <button className="btn-ghost" onClick={() => d.resolve(false)}>아니요</button>
        <button className="btn-primary" onClick={() => d.resolve(true)}>예</button>
      </>
    ) : d.kind === "select" ? (
      <button className="btn-ghost" onClick={close}>취소</button>
    ) : (
      <button className="btn-primary" onClick={() => d.resolve()}>확인</button>
    );
  return (
    <Dialog title={d.kind === "error" ? "⚠️ 봇 알림" : "💬 봇"} onClose={close} footer={footer}>
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{d.message}</p>
        {d.kind === "input" && <textarea autoFocus className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} aria-label="입력" />}
        {d.kind === "select" && (
          <div className="space-y-1">
            {d.options.map((o, i) => <button key={i} className="btn-ghost w-full justify-start border border-stone-200 dark:border-stone-700" onClick={() => d.resolve(String(i))}>{o}</button>)}
          </div>
        )}
      </div>
    </Dialog>
  );
}
