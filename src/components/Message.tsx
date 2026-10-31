import { useState } from "react";
import type { Message } from "../lib/types";

export function StoryText({ text }: { text: string }) {
  return (
    <div className="story space-y-3 whitespace-pre-wrap">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export default function MessageView({ m, onDelete, onEdit, onRetry }: { m: Message; onDelete: () => void; onEdit: (t: string) => void; onRetry?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [showThink, setShowThink] = useState(false);

  if (m.error)
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <div className="font-bold">⚠️ 생성 실패</div>
        <div className="mt-1 break-words">{m.error}</div>
        <div className="mt-2 flex gap-2">
          {onRetry && <button className="btn-ghost px-2 py-1 text-xs" onClick={onRetry}>다시 시도</button>}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onDelete}>지우기</button>
        </div>
      </div>
    );

  const user = m.role === "user";
  return (
    <div className={`group flex ${user ? "justify-end" : "justify-start"}`}>
      <div className={user ? "max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-white" : "w-full"}>
        {m.thinking && !user && (
          <button className="mb-2 text-xs font-semibold text-stone-500 hover:text-violet-600" onClick={() => setShowThink(!showThink)}>
            💭 AI의 사고 과정 {showThink ? "접기 ▲" : "보기 ▼"}
          </button>
        )}
        {showThink && m.thinking && <div className="mb-3 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400">{m.thinking}</div>}
        {editing ? (
          <div className="space-y-2">
            <textarea className="input min-h-40 text-stone-800 dark:text-stone-100" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => { setDraft(m.text); setEditing(false); }}>취소</button>
              <button className="btn-primary" onClick={() => { onEdit(draft.trim()); setEditing(false); }}>저장</button>
            </div>
          </div>
        ) : user ? (
          <div className="whitespace-pre-wrap break-words text-sm">{m.text}</div>
        ) : (
          <StoryText text={m.text} />
        )}
        {!editing && (
          <div className={`mt-1 flex gap-1 text-xs opacity-0 transition group-hover:opacity-100 ${user ? "justify-end text-violet-100" : "text-stone-400"}`}>
            <button className="hover:underline" onClick={() => navigator.clipboard?.writeText(m.text)}>복사</button>
            <button className="hover:underline" onClick={() => setEditing(true)}>편집</button>
            <button className="hover:underline" onClick={onDelete}>삭제</button>
            {m.model && !user && <span className="ml-auto font-mono">{m.model}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
