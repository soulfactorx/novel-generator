import { createRoom, deleteRoom, selectRoom, useApp } from "../lib/store";

export default function Sidebar({ open, onClose, onOpenSettings }: { open: boolean; onClose: () => void; onOpenSettings: (tab?: string) => void }) {
  const rooms = useApp((s) => s.rooms);
  const active = useApp((s) => s.activeRoomId);
  const list = Object.values(rooms).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-stone-200 bg-stone-100 transition-transform md:static md:translate-x-0 dark:border-stone-800 dark:bg-stone-900 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-extrabold tracking-tight">✒️ Novel Generator</span>
          <button className="btn-ghost px-2 md:hidden" onClick={onClose} aria-label="메뉴 닫기">✕</button>
        </div>
        <div className="px-3">
          <button className="btn-primary w-full" onClick={() => { createRoom(); onClose(); }}>+ 새 이야기</button>
        </div>
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-2">
          {list.length === 0 && <p className="hint px-2 py-4">아직 이야기가 없습니다. 새 이야기를 시작하거나 [데이터]에서 기존 백업을 가져오세요.</p>}
          {list.map((r) => (
            <div key={r.id} className={`group flex items-center rounded-lg ${r.id === active ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`}>
              <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { selectRoom(r.id); onClose(); }}>
                <div className="truncate text-sm font-semibold">{r.title}</div>
                <div className="truncate text-xs text-stone-500">{r.messages.length}개 메시지 · {new Date(r.updatedAt).toLocaleDateString("ko-KR")}</div>
              </button>
              <button className="btn-danger mr-1 px-2 opacity-60 group-hover:opacity-100" title="이야기 삭제" onClick={() => confirm(`'${r.title}' 이야기를 삭제할까요? 되돌릴 수 없습니다.`) && deleteRoom(r.id)}>🗑</button>
            </div>
          ))}
        </nav>
        <div className="flex gap-1 border-t border-stone-200 p-2 dark:border-stone-800">
          <button className="btn-ghost flex-1" onClick={() => onOpenSettings("ai")}>⚙️ 설정</button>
          <button className="btn-ghost flex-1" onClick={() => onOpenSettings("data")}>📦 데이터</button>
        </div>
      </aside>
    </>
  );
}
