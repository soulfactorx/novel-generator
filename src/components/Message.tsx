import { useState } from "react";
import { formatTokens, formatUsd } from "../lib/pricing";
import type { ImagePool } from "../lib/images";
import type { Message } from "../lib/types";
import RisuText from "./RisuText";
import StoryText from "./StoryText";

export { StoryText };

export interface MessageActions {
  onDelete: () => void;
  onEdit: (t: string) => void;
  onRetry?: () => void;
  onBookmark: (label: string | null) => void;
  onBranch: () => void;
  onRewind?: () => void;
}

export default function MessageView({ m, pool, cbs, onTrigger, luaDisplay, onDelete, onEdit, onRetry, onBookmark, onBranch, onRewind }: { m: Message; pool?: ImagePool; cbs?: (s: string) => string; onTrigger?: (name: string, id: string | null) => void; luaDisplay?: (t: string) => Promise<string> } & MessageActions) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [showThink, setShowThink] = useState(false);
  const [more, setMore] = useState(false);

  if (m.error)
    return (
      <div id={`msg-${m.id}`} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <div className="font-bold">⚠️ 생성 실패</div>
        <div className="mt-1 break-words">{m.error}</div>
        <div className="mt-2 flex gap-2">
          {onRetry && <button className="btn-ghost px-2 py-1 text-xs" onClick={onRetry}>다시 시도</button>}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onDelete}>지우기</button>
        </div>
      </div>
    );

  const user = m.role === "user";
  const marked = m.bookmark !== undefined;
  const act = "rounded px-1.5 py-0.5 hover:bg-stone-200/70 dark:hover:bg-stone-800";
  return (
    <div id={`msg-${m.id}`} className={`flex scroll-mt-16 ${user ? "justify-end" : "justify-start"}`}>
      <div className={`${user ? "max-w-[85%]" : "w-full"} ${marked ? "border-l-4 border-amber-400 pl-3" : ""}`}>
        {marked && <div className="mb-1 text-xs font-semibold text-amber-600">🔖 {m.bookmark || "책갈피"}</div>}
        <div className={user ? "rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-white" : ""}>
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
            <RisuText text={m.text} pool={pool} cbs={cbs} onTrigger={onTrigger} luaDisplay={luaDisplay} />
          )}
        </div>
        {!editing && (
          // 터치 화면에서도 보이도록 항상 표시 (흐리게)
          <div className={`mt-1 flex flex-wrap items-center gap-0.5 text-xs text-stone-400 ${user ? "justify-end" : ""}`}>
            <button className={act} onClick={() => navigator.clipboard?.writeText(m.text)}>복사</button>
            <button className={act} onClick={() => setEditing(true)}>편집</button>
            <button className={act} onClick={() => { if (marked) onBookmark(null); else { const l = prompt("책갈피 이름 (비워 두어도 됩니다)", ""); if (l !== null) onBookmark(l.trim()); } }} aria-label={marked ? "책갈피 해제" : "책갈피"}>{marked ? "🔖 해제" : "🔖"}</button>
            <button className={act} onClick={() => setMore(!more)} aria-label="더 보기">⋯</button>
            {more && (
              <>
                <button className={act} onClick={() => { setMore(false); onBranch(); }} title="이 메시지까지 복사한 새 이야기를 만듭니다">⑂ 여기서 분기</button>
                {onRewind && <button className={act} onClick={() => { setMore(false); onRewind(); }}>⤺ 여기까지 되돌리기</button>}
                <button className={`${act} text-rose-500`} onClick={onDelete}>삭제</button>
              </>
            )}
            {!user && (m.model || m.usage) && (
              <span className="ml-auto truncate font-mono" title={m.usage ? `입력 ${m.usage.input.toLocaleString()} · 출력 ${m.usage.output.toLocaleString()}${m.usage.cacheRead ? ` · 캐시 ${m.usage.cacheRead.toLocaleString()}` : ""} 토큰` : undefined}>
                {m.fallback && "↪ "}{m.model}{m.usage && ` · ${formatTokens(m.usage.input + (m.usage.cacheRead ?? 0))}→${formatTokens(m.usage.output)}`}{m.usage?.usd !== undefined && ` · ${formatUsd(m.usage.usd)}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
