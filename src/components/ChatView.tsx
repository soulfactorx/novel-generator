import { useEffect, useRef, useState } from "react";
import { deleteMessage, editMessage, regenerate, send, stopGeneration, updateRoom, useApp } from "../lib/store";
import { PROVIDER_LABEL } from "../lib/providers/catalog";
import MessageView, { StoryText } from "./Message";
import RoomDialog from "./RoomDialog";

export default function ChatView({ onMenu, onOpenSettings }: { onMenu: () => void; onOpenSettings: (tab?: string) => void }) {
  const room = useApp((s) => (s.activeRoomId ? s.rooms[s.activeRoomId] : null));
  const live = useApp((s) => s.live);
  const settings = useApp((s) => s.settings);
  const [input, setInput] = useState("");
  const [roomDialog, setRoomDialog] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = live !== null;
  const myLive = live && room && live.roomId === room.id ? live : null;
  const hasKey = settings.provider === "openai" ? !!settings.keys.openai || /localhost|127\.0\.0\.1/.test(settings.openaiBaseUrl) : !!settings.keys[settings.provider];

  useEffect(() => endRef.current?.scrollIntoView?.({ block: "end" }), [room?.messages.length, myLive?.text]);

  if (!room)
    return (
      <div className="flex flex-1 flex-col">
        <Header onMenu={onMenu} title="Novel Generator" />
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm space-y-3">
            <div className="text-4xl">✒️</div>
            <p className="font-bold">AI와 함께 이야기를 써 보세요</p>
            <p className="hint">왼쪽 메뉴에서 새 이야기를 만들거나, 기존 E.No.S 백업을 [데이터]에서 가져올 수 있습니다.</p>
            {!hasKey && <button className="btn-primary" onClick={() => onOpenSettings("ai")}>먼저 AI 연결 설정하기</button>}
          </div>
        </div>
      </div>
    );

  const last = room.messages[room.messages.length - 1];
  const submit = (text: string) => {
    if (busy || (!text.trim() && room.messages.length > 0)) return;
    setInput("");
    void send(room.id, text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header onMenu={onMenu} title={room.title} onTitle={(t) => updateRoom(room.id, { title: t })} right={
        <>
          <button className="btn-ghost px-2 text-xs" onClick={() => setRoomDialog(true)} title="설정·장기 기억">📝 설정·기억</button>
          <button className="btn-ghost hidden px-2 text-xs sm:inline-flex" onClick={() => onOpenSettings("ai")} title="AI 모델">{PROVIDER_LABEL[settings.provider]} · {settings.models[settings.provider]}</button>
        </>
      } />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {room.messages.length === 0 && !myLive && (
            <div className="card space-y-2 text-sm">
              <p className="font-bold">이야기 시작하기</p>
              <p className="hint">상단 [📝 설정·기억]에 세계관·등장인물·배경을 적어 두면 AI가 계속 참고합니다. 첫 장면을 직접 써도 되고, 아무것도 입력하지 않고 보내면 AI가 시작합니다.</p>
            </div>
          )}
          {room.messages.map((m) => (
            <MessageView key={m.id} m={m} onDelete={() => deleteMessage(room.id, m.id)} onEdit={(t) => editMessage(room.id, m.id, t)} onRetry={m === last ? () => void regenerate(room.id) : undefined} />
          ))}
          {myLive && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
                {myLive.status || (myLive.text ? `작성 중 · ${myLive.text.length.toLocaleString()}자` : myLive.thinking ? "생각하는 중…" : "응답 기다리는 중…")}
              </div>
              {!myLive.text && myLive.thinking && <div className="line-clamp-3 text-xs italic text-stone-500">{myLive.thinking.slice(-300)}</div>}
              {myLive.text && <StoryText text={myLive.text} />}
            </div>
          )}
          {!busy && last?.role === "assistant" && !last.error && (
            <div className="space-y-2">
              {last.choices && last.choices.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {last.choices.map((c, i) => (
                    <button key={i} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-violet-400 hover:bg-violet-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-violet-950/40" onClick={() => setInput(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <button className="btn-ghost text-xs" onClick={() => void regenerate(room.id)}>↻ 이 응답 다시 생성</button>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="border-t border-stone-200 bg-stone-50/90 p-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="input max-h-48 min-h-11 flex-1 resize-none"
            rows={2}
            placeholder={hasKey ? "주인공의 행동이나 대사, 원하는 전개를 입력하세요 (Ctrl+Enter 전송)" : "먼저 [설정]에서 AI API 키를 입력하세요"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit(input);
              }
            }}
          />
          {busy ? (
            <button className="btn-danger border border-rose-300" onClick={stopGeneration}>■ 중단</button>
          ) : (
            <button className="btn-primary" disabled={!hasKey} onClick={() => submit(input)}>보내기</button>
          )}
        </div>
      </div>
      {roomDialog && <RoomDialog room={room} onClose={() => setRoomDialog(false)} />}
    </div>
  );
}

function Header({ onMenu, title, onTitle, right }: { onMenu: () => void; title: string; onTitle?: (t: string) => void; right?: React.ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 px-2 dark:border-stone-800">
      <button className="btn-ghost px-2 md:hidden" onClick={onMenu} aria-label="메뉴">☰</button>
      {onTitle ? (
        <input className="min-w-0 flex-1 bg-transparent px-1 font-bold outline-none" value={title} onChange={(e) => onTitle(e.target.value)} aria-label="이야기 제목" />
      ) : (
        <span className="flex-1 px-1 font-bold">{title}</span>
      )}
      {right}
    </header>
  );
}
