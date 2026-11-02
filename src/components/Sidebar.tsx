import { charCount } from "../lib/novel";
import { promptInstall, usePwa } from "../lib/pwa";
import { syncNow, createNovel, deleteNovel, deleteRoom, selectNovel, selectRoom, setView, useApp } from "../lib/store";

export default function Sidebar({ open, onClose, onOpenSettings, onNewStory, onOpenLibrary }: { open: boolean; onClose: () => void; onOpenSettings: (tab?: string) => void; onNewStory: () => void; onOpenLibrary: () => void }) {
  const rooms = useApp((s) => s.rooms);
  const lib = useApp((s) => s.library);
  const view = useApp((s) => s.view);
  const novels = useApp((s) => s.novels);
  const activeNovel = useApp((s) => s.activeNovelId);
  const writing = useApp((s) => s.novelLive?.novelId);
  const pwa = usePwa();
  const sync = useApp((s) => s.sync);
  const novelList = Object.values(novels).sort((a, b) => b.updatedAt - a.updatedAt);
  const active = useApp((s) => s.activeRoomId);
  const list = Object.values(rooms).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-stone-200 bg-stone-100 transition-transform md:static md:translate-x-0 dark:border-stone-800 dark:bg-stone-900 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-extrabold tracking-tight">✒️ Novel Generator <span className="align-middle text-[10px] font-semibold text-stone-400" title="앱 버전 (웹페이지가 업데이트됐는지 확인할 때)">v{__APP_VERSION__}</span></span>
          <button className="btn-ghost px-2 md:hidden" onClick={onClose} aria-label="메뉴 닫기">✕</button>
        </div>
        <div className="mx-3 mb-2 grid grid-cols-2 gap-1 rounded-lg bg-stone-200/70 p-1 dark:bg-stone-800">
          {([["rooms", "💬 이야기"], ["novels", "📖 소설"]] as const).map(([v, l]) => (
            <button key={v} className={`rounded-md py-1.5 text-sm font-semibold ${view === v ? "bg-white shadow-sm dark:bg-stone-950" : "text-stone-500"}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <div className="px-3">
          {view === "rooms" ? <button className="btn-primary w-full" onClick={() => { onNewStory(); onClose(); }}>+ 새 이야기</button> : <button className="btn-primary w-full" onClick={() => { createNovel(); onClose(); }}>+ 새 소설</button>}
        </div>
        {view === "novels" ? (
          <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-2">
            {novelList.length === 0 && <p className="hint px-2 py-4">아직 소설이 없습니다. [+ 새 소설]로 기획부터 시작하세요.</p>}
            {novelList.map((n) => (
              <div key={n.id} className={`group flex items-center rounded-lg ${n.id === activeNovel ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`}>
                {n.cover && <img src={n.cover.dataUrl} alt="" className="ml-2 h-12 w-8 shrink-0 rounded-sm object-cover shadow-sm" />}
                <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { selectNovel(n.id); onClose(); }}>
                  <div className="truncate text-sm font-semibold">{writing === n.id && "✒️ "}{n.title || "제목 없는 소설"}</div>
                  <div className="truncate text-xs text-stone-500">{n.episodes.length}/{n.episodeCount}화 · {n.episodes.reduce((a, e) => a + charCount(e.text), 0).toLocaleString()}자 · {new Date(n.updatedAt).toLocaleDateString("ko-KR")}</div>
                </button>
                <button className="btn-danger mr-1 px-2 opacity-60 group-hover:opacity-100" title="소설 삭제" onClick={() => confirm(`'${n.title || "제목 없는 소설"}'을(를) 삭제할까요? 되돌릴 수 없습니다.`) && deleteNovel(n.id)}>🗑</button>
              </div>
            ))}
          </nav>
        ) : (
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-2">
          {list.length === 0 && <p className="hint px-2 py-4">아직 이야기가 없습니다. 새 이야기를 시작하거나 [데이터]에서 기존 백업을 가져오세요.</p>}
          {list.map((r) => (
            <div key={r.id} className={`group flex items-center rounded-lg ${r.id === active ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`}>
              <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { selectRoom(r.id); onClose(); }}>
                <div className="truncate text-sm font-semibold">{r.branchOf && <span className="text-stone-400" title="분기한 이야기">⑂ </span>}{r.title}</div>
                <div className="truncate text-xs text-stone-500">{r.worldId && lib[r.worldId] ? `🌍 ${lib[r.worldId].name} · ` : ""}{r.messages.length}개 메시지 · {new Date(r.updatedAt).toLocaleDateString("ko-KR")}</div>
              </button>
              <button className="btn-danger mr-1 px-2 opacity-60 group-hover:opacity-100" title="이야기 삭제" onClick={() => confirm(`'${r.title}' 이야기를 삭제할까요? 되돌릴 수 없습니다.`) && deleteRoom(r.id)}>🗑</button>
            </div>
          ))}
        </nav>
        )}
        {(pwa.canInstall || sync.connected || !pwa.online) && (
          <div className="flex items-center gap-2 border-t border-stone-200 px-3 py-1.5 text-xs dark:border-stone-800">
            {!pwa.online && <span className="text-amber-600" title="인터넷 연결 없음 — 글 생성·동기화는 연결 후에">● 오프라인</span>}
            {sync.connected && (
              <button className={`truncate ${sync.error ? "text-rose-600" : "text-stone-500"}`} onClick={() => (sync.error ? onOpenSettings("data") : void syncNow())} title={sync.error || "지금 동기화"}>
                {sync.running ? "🔄 동기화 중…" : sync.error ? "⚠️ 동기화 오류" : `🔄 ${sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + " 동기화됨" : "동기화"}`}
              </button>
            )}
            {pwa.canInstall && <button className="ml-auto font-semibold text-violet-600" onClick={() => void promptInstall()}>📲 앱 설치</button>}
          </div>
        )}
        <div className="flex gap-1 border-t border-stone-200 p-2 dark:border-stone-800">
          <button className="btn-ghost flex-1 px-1" onClick={() => { onOpenLibrary(); onClose(); }}>📚 라이브러리</button>
          <button className="btn-ghost flex-1 px-1" onClick={() => onOpenSettings("ai")}>⚙️ 설정</button>
          <button className="btn-ghost flex-1 px-1" onClick={() => onOpenSettings("data")}>📦 데이터</button>
        </div>
      </aside>
    </>
  );
}
