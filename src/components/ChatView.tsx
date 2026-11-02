import { useEffect, useRef, useState } from "react";
import { downloadBlob, roomToTxt, safeFileName } from "../lib/exporters";
import { branchRoom, contextFor, displayCbs, displayLua, runRisuTrigger, deleteMessage, diagnoseRoom, dismissMemoryError, editMessage, novelFromRoom, regenerate, rewindTo, selectRoom, send, setBookmark, stopGeneration, updateRoom, useApp } from "../lib/store";
import DiagnosisDialog from "./DiagnosisDialog";
import Dialog from "./Dialog";
import { PROVIDER_LABEL } from "../lib/providers/catalog";
import MessageView from "./Message";
import RisuText from "./RisuText";
import { imagePool, sanitizeHtml } from "../lib/images";
import RoomDialog from "./RoomDialog";
import TogglePanel from "./TogglePanel";
import { togglesOf } from "../lib/risuRuntime";

export default function ChatView({ onMenu, onOpenSettings, onOpenLibrary, onNewStory }: { onMenu: () => void; onOpenSettings: (tab?: string) => void; onOpenLibrary: () => void; onNewStory: () => void }) {
  const room = useApp((s) => (s.activeRoomId ? s.rooms[s.activeRoomId] : null));
  const live = useApp((s) => s.live);
  const settings = useApp((s) => s.settings);
  const [input, setInput] = useState("");
  const [roomDialog, setRoomDialog] = useState<null | "cast" | "memory">(null);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState(false);
  const [bookmarks, setBookmarks] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rooms = useApp((s) => s.rooms);
  const lib = useApp((s) => s.library);
  const images = useApp((s) => s.images);
  useApp((s) => s.globals); // 토글이 바뀌면 다시 그림
  useApp((s) => s.risuTick); // 봇이 reloadDisplay를 부르면 다시 그림
  const memoryJob = useApp((s) => s.memoryJob);
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
            <p className="hint">새 이야기를 만들거나, 라이브러리에 세계관·인물을 먼저 만들어 둘 수 있습니다. 기존 E.No.S 백업은 [📦 데이터]에서 가져옵니다.</p>
            {!hasKey ? <button className="btn-primary" onClick={() => onOpenSettings("ai")}>먼저 AI 연결 설정하기</button> : <div className="flex justify-center gap-2"><button className="btn-primary" onClick={onNewStory}>+ 새 이야기</button><button className="btn-ghost border border-stone-300 dark:border-stone-700" onClick={onOpenLibrary}>📚 라이브러리</button></div>}
          </div>
        </div>
      </div>
    );

  const last = room.messages[room.messages.length - 1];
  const ctx = contextFor(room, lib);
  const pool = imagePool(ctx, images, settings.risu.scripts);
  // 봇의 배경 HTML·CSS (RisuAI backgroundHTML): 이 이야기 화면 안에서만 적용
  const bgScope = `rsbg${room.id.replace(/[^a-z0-9]/gi, "")}`;
  const bgSrc = settings.risu.background ? [...ctx.characters, ...(ctx.world ? [ctx.world] : [])].map((o) => o.risu?.backgroundHTML ?? "").filter((x) => x.trim()).join("\n") : "";
  const bgHtml = bgSrc ? sanitizeHtml(displayCbs(room, null)?.(bgSrc) ?? bgSrc, {}, bgScope) : "";
  const myMemory = memoryJob?.roomId === room.id ? memoryJob : null;
  const submit = (text: string) => {
    if (busy || (!text.trim() && room.messages.length > 0)) return;
    setInput("");
    void send(room.id, text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header onMenu={onMenu} title={room.title} onTitle={(t) => updateRoom(room.id, { title: t })} right={
        <>
          <button className="btn-ghost max-w-40 px-2 text-xs" onClick={() => setRoomDialog("cast")} title="이야기 설정">📝 <span className="truncate">{ctx.world ? ctx.world.name : "설정"}{ctx.characters.length ? ` · ${ctx.characters.length}명` : ""}</span></button>
          {togglesOf(ctx).length > 0 && <button className="btn-ghost px-2 text-xs" onClick={() => setToggleOpen(true)} title="봇 설정 (RisuAI 토글)">🎛</button>}
          <button className="btn-ghost px-2 text-xs" onClick={() => setRoomDialog("memory")} title="장기 기억">🧠{myMemory && !myMemory.error ? "…" : ""}</button>
          <MoreMenu items={[
            ["📄 대화를 TXT로 내보내기", () => downloadBlob(`${safeFileName(room.title)}.txt`, roomToTxt(room, { user: ctx.persona?.name }), "text/plain;charset=utf-8")],
            ["📖 이 이야기로 소설 기획하기", () => novelFromRoom(room.id)],
            [`🔖 책갈피 목록 (${room.messages.filter((m) => m.bookmark !== undefined).length})`, () => setBookmarks(true)],
            ["🩺 이야기 진단 (설정 붕괴·반복 점검)", () => setDiagnosis(true)],
          ]} />
          <button className="btn-ghost hidden px-2 text-xs sm:inline-flex" onClick={() => onOpenSettings("ai")} title="AI 모델">{PROVIDER_LABEL[settings.provider]} · {settings.models[settings.provider]}</button>
        </>
      } />
      <div className={`relative flex-1 overflow-y-auto ${bgScope}`}>
        {bgHtml && <div className="risu-bg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: bgHtml }} />}
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {room.branchOf && (
            <div className="text-xs text-stone-500">
              ⑂ {rooms[room.branchOf.roomId] ? <button className="underline" onClick={() => selectRoom(room.branchOf!.roomId)}>'{rooms[room.branchOf.roomId].title}'</button> : `'${room.branchOf.title}'`}에서 분기한 이야기입니다.
            </div>
          )}
          {room.messages.length === 0 && !myLive && (
            <div className="card space-y-2 text-sm">
              <p className="font-bold">이야기 시작하기</p>
              {(ctx.world || ctx.characters.length > 0 || ctx.persona) && <p className="text-sm">{ctx.world && <>🌍 {ctx.world.name} </>}{ctx.characters.length > 0 && <>🎭 {ctx.characters.map((c) => c.name).join(", ")} </>}{ctx.persona && <>🙋 {ctx.persona.name}</>}</p>}
              <p className="hint">상단 [📝]에서 세계관·등장인물·주인공과 추가 설정을 고를 수 있습니다. 첫 장면을 직접 써도 되고, 아무것도 입력하지 않고 보내면 AI가 시작합니다.</p>
            </div>
          )}
          {room.messages.map((m) => (
            <MessageView
              key={m.id}
              m={m}
              pool={pool}
              cbs={displayCbs(room, m.id)}
              luaDisplay={displayLua(room, m.id)}
              onTrigger={(name, id) => void runRisuTrigger(room.id, name, id)}
              onDelete={() => deleteMessage(room.id, m.id)}
              onEdit={(t) => editMessage(room.id, m.id, t)}
              onRetry={m === last ? () => void regenerate(room.id) : undefined}
              onBookmark={(l) => setBookmark(room.id, m.id, l)}
              onBranch={() => branchRoom(room.id, m.id)}
              onRewind={m === last || busy ? undefined : () => {
                const after = room.messages.length - room.messages.indexOf(m) - 1;
                const stale = room.memoryCursorAt !== undefined && room.memoryCursorAt > m.createdAt;
                if (confirm(`이 메시지 뒤의 ${after}개 메시지를 삭제할까요?${stale ? "\n장기 기억에 삭제될 내용이 들어 있어 기억도 비우고 다시 정리합니다." : ""}\n지우지 않고 남기려면 [여기서 분기]를 쓰세요.`)) rewindTo(room.id, m.id);
              }}
            />
          ))}
          {myLive && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
                {myLive.status || (myLive.text ? `작성 중 · ${myLive.text.length.toLocaleString()}자` : myLive.thinking ? "생각하는 중…" : "응답 기다리는 중…")}
              </div>
              {myLive.lore.length > 0 && <div className="text-xs text-stone-500" title={myLive.lore.map((h) => h.entry.title).join(", ")}>📖 참고한 로어: {myLive.lore.map((h) => h.entry.title || h.matched).join(", ")}</div>}
              {!myLive.text && myLive.thinking && <div className="line-clamp-3 text-xs italic text-stone-500">{myLive.thinking.slice(-300)}</div>}
              {myLive.text && <RisuText text={myLive.text} pool={pool} cbs={displayCbs(room, null)} />}
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
              {note === null ? (
                <div className="flex flex-wrap gap-1">
                  <button className="btn-ghost text-xs" onClick={() => void regenerate(room.id)}>↻ 이 응답 다시 생성</button>
                  <button className="btn-ghost text-xs" onClick={() => setNote("")}>✍️ 지시하고 다시 생성</button>
                </div>
              ) : (
                <div className="card space-y-2">
                  <textarea className="input min-h-16 text-sm" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 서율이 더 차갑게 반응하게, 대화를 늘려서" aria-label="다시 생성 지시" />
                  <div className="flex justify-end gap-2">
                    <button className="btn-ghost text-xs" onClick={() => setNote(null)}>취소</button>
                    <button className="btn-primary text-xs" disabled={!note.trim()} onClick={() => { const n = note; setNote(null); void regenerate(room.id, n); }}>다시 생성</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {myMemory && (
            <div className={`flex items-center gap-2 text-xs ${myMemory.error ? "text-rose-600" : "text-stone-500"}`}>
              {myMemory.error ? <>⚠️ {myMemory.error} <button className="underline" onClick={dismissMemoryError}>닫기</button></> : <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400" />🧠 오래된 대화를 장기 기억으로 정리하는 중…</>}
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
      {diagnosis && (
        <DiagnosisDialog
          title="🩺 이야기 진단"
          run={(onText) => diagnoseRoom(room.id, onText)}
          last={room.lastDiagnosis}
          applyLabel="진단 반영해 마지막 응답 다시 생성"
          canApply={last?.role === "assistant" && !last.error && !busy}
          onApply={(d) => void regenerate(room.id, d)}
          onClose={() => setDiagnosis(false)}
        />
      )}
      {bookmarks && (
        <Dialog title="🔖 책갈피" onClose={() => setBookmarks(false)}>
          {room.messages.some((m) => m.bookmark !== undefined) ? (
            <ul className="space-y-1">
              {room.messages.map((m, i) => m.bookmark !== undefined && (
                <li key={m.id}>
                  <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-200/70 dark:hover:bg-stone-800" onClick={() => { setBookmarks(false); setTimeout(() => document.getElementById(`msg-${m.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50); }}>
                    <div className="text-sm font-semibold">🔖 {m.bookmark || `${i + 1}번째 메시지`}</div>
                    <div className="truncate text-xs text-stone-500">{m.text.slice(0, 80)}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">메시지 아래의 🔖를 눌러 중요한 장면에 책갈피를 달 수 있습니다.</p>
          )}
        </Dialog>
      )}
      {toggleOpen && <Dialog title="🎛 봇 설정 (토글)" onClose={() => setToggleOpen(false)}><TogglePanel groups={togglesOf(ctx)} /></Dialog>}
      {roomDialog && <RoomDialog room={room} initialTab={roomDialog} onClose={() => setRoomDialog(null)} onOpenLibrary={() => { setRoomDialog(null); onOpenLibrary(); }} />}
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

function MoreMenu({ items }: { items: [string, () => void][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn-ghost px-2 text-xs" onClick={() => setOpen(!open)} aria-label="더 보기">⋯</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
            {items.map(([label, fn]) => (
              <button key={label} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => { setOpen(false); fn(); }}>{label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
