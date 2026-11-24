import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ARCHIVE, cleanFolderName, folderList } from "../lib/folders";
import { charCount } from "../lib/novel";
import { promptInstall, usePwa } from "../lib/pwa";
import { syncNow, createNovel, deleteNovel, deleteRoom, dissolveFolder, moveToFolder, renameFolder, selectNovel, selectRoom, setView, useApp, type FolderKind } from "../lib/store";
import type { Novel, Room } from "../lib/types";
import OrganizeDialog from "./OrganizeDialog";

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
  const [query, setQuery] = useState("");
  const [organize, setOrganize] = useState(false);
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
        <div className="mt-2 flex items-center gap-1 px-3">
          <input className="input min-w-0 flex-1 py-1 text-sm" type="search" placeholder={`🔍 ${view === "rooms" ? "이야기" : "소설"} 찾기`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="목록에서 찾기" />
          <button className="btn-ghost shrink-0 px-2 text-sm" title="폴더 자동 정리" onClick={() => setOrganize(true)}>🗂 정리</button>
        </div>
        {view === "novels" ? (
          <FolderedList
            kind="novels"
            items={novelList}
            query={query}
            empty={<p className="hint px-2 py-4">아직 소설이 없습니다. [+ 새 소설]로 기획부터 시작하세요.</p>}
            title={(n) => n.title || "제목 없는 소설"}
            render={(n, extra) => (
              <div key={n.id} className={`group rounded-lg ${n.id === activeNovel ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/x-ng-item", n.id)}>
                <div className="flex items-center">
                  {n.cover && <img src={n.cover.dataUrl} alt="" className="ml-2 h-12 w-8 shrink-0 rounded-sm object-cover shadow-sm" />}
                  <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { selectNovel(n.id); onClose(); }}>
                    <div className="truncate text-sm font-semibold">{writing === n.id && "✒️ "}{n.title || "제목 없는 소설"}</div>
                    <div className="truncate text-xs text-stone-500">{extra}{n.episodes.length}/{n.episodeCount}화 · {n.episodes.reduce((a, e) => a + charCount(e.text), 0).toLocaleString()}자 · {new Date(n.updatedAt).toLocaleDateString("ko-KR")}</div>
                  </button>
                  <MoveButton kind="novels" item={n} />
                  <button className="btn-danger mr-1 px-2 opacity-60 group-hover:opacity-100" title="소설 삭제" onClick={() => confirm(`'${n.title || "제목 없는 소설"}'을(를) 삭제할까요? 되돌릴 수 없습니다.`) && deleteNovel(n.id)}>🗑</button>
                </div>
                <MovePanel kind="novels" item={n} />
              </div>
            )}
          />
        ) : (
          <FolderedList
            kind="rooms"
            items={list}
            query={query}
            empty={<p className="hint px-2 py-4">아직 이야기가 없습니다. 새 이야기를 시작하거나 [데이터]에서 기존 백업을 가져오세요.</p>}
            title={(r) => r.title}
            render={(r, extra) => (
              <div key={r.id} className={`group rounded-lg ${r.id === active ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/x-ng-item", r.id)}>
                <div className="flex items-center">
                  <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => { selectRoom(r.id); onClose(); }}>
                    <div className="truncate text-sm font-semibold">{r.branchOf && <span className="text-stone-400" title="분기한 이야기">⑂ </span>}{r.title}</div>
                    <div className="truncate text-xs text-stone-500">{extra}{r.worldId && lib[r.worldId] ? `🌍 ${lib[r.worldId].name} · ` : ""}{r.messages.length}개 메시지 · {new Date(r.updatedAt).toLocaleDateString("ko-KR")}</div>
                  </button>
                  <MoveButton kind="rooms" item={r} />
                  <button className="btn-danger mr-1 px-2 opacity-60 group-hover:opacity-100" title="이야기 삭제" onClick={() => confirm(`'${r.title}' 이야기를 삭제할까요? 되돌릴 수 없습니다.`) && deleteRoom(r.id)}>🗑</button>
                </div>
                <MovePanel kind="rooms" item={r} />
              </div>
            )}
          />
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
        {/* 줄바꿈 없이 한 줄로: 글자가 긴 '라이브러리'에 폭을 조금 더 */}
        <div className="flex gap-0.5 border-t border-stone-200 p-2 text-sm dark:border-stone-800">
          <button className="btn-ghost flex-[1.4] gap-1 whitespace-nowrap px-1" onClick={() => { onOpenLibrary(); onClose(); }}>📚 라이브러리</button>
          <button className="btn-ghost flex-1 gap-1 whitespace-nowrap px-1" onClick={() => onOpenSettings("ai")}>⚙️ 설정</button>
          <button className="btn-ghost flex-1 gap-1 whitespace-nowrap px-1" onClick={() => onOpenSettings("data")}>📦 데이터</button>
        </div>
      </aside>
      {/* 사이드바(transform) 밖에 띄워야 화면 가운데 제 크기로 열림 */}
      {organize && <OrganizeDialog kind={view === "novels" ? "novels" : "rooms"} onClose={() => setOrganize(false)} />}
    </>
  );
}

/* ---------------- 폴더 ---------------- */
/** 접은 폴더 (이 기기에만 저장). 보관함은 처음에 접혀 있음 */
const FOLD_KEY = "sidebarFolded";
function loadFolded(): Record<string, boolean> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(FOLD_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function useFolded() {
  const [folded, set] = useState(loadFolded);
  const toggle = (key: string, now: boolean) => {
    const next = { ...folded, [key]: !now };
    set(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
    } catch {
      /* 저장 못 해도 이번에는 접힘 */
    }
  };
  return { isFolded: (key: string, def: boolean) => folded[key] ?? def, toggle };
}

/** 열린 '폴더로 옮기기' 칸 (한 번에 하나) */
let openMoveId: string | null = null;
const moveSubs = new Set<() => void>();
const setOpenMove = (id: string | null) => ((openMoveId = id), moveSubs.forEach((f) => f()));
const subMove = (f: () => void) => (moveSubs.add(f), () => void moveSubs.delete(f));
const useOpenMove = (id: string) => useSyncExternalStore(subMove, () => openMoveId === id);

type Item = (Room | Novel) & { id: string };
function FolderedList<T extends Item>({ kind, items, query, empty, title, render }: { kind: FolderKind; items: T[]; query: string; empty: ReactNode; title: (x: T) => string; render: (x: T, extra: string) => ReactNode }) {
  const { isFolded, toggle } = useFolded();
  const [over, setOver] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const drop = (name: string | undefined) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-ng-item")) return;
      e.preventDefault();
      setOver(name ?? "");
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData("text/x-ng-item");
      setOver(null);
      if (id) moveToFolder(kind, [id], name);
    },
  });
  if (!items.length) return <nav className="mt-2 flex-1 overflow-y-auto px-2">{empty}</nav>;
  // 찾기: 폴더 없이 한 줄로, 폴더 이름도 함께 찾음
  if (q) {
    const hits = items.filter((x) => title(x).toLowerCase().includes(q) || (x.folder ?? "").toLowerCase().includes(q));
    return (
      <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-2">
        {hits.length === 0 && <p className="hint px-2 py-4">찾는 항목이 없습니다.</p>}
        {hits.map((x) => render(x, x.folder ? `📁 ${x.folder} · ` : ""))}
      </nav>
    );
  }
  const folders = folderList(items);
  const loose = items.filter((x) => !x.folder);
  return (
    <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-2">
      {folders.map(({ name, count }) => {
        const key = `${kind}:${name}`;
        const folded = isFolded(key, name === ARCHIVE);
        return (
          <div key={name} className={`rounded-lg ${over === name ? "ring-2 ring-violet-400" : ""}`} {...drop(name)}>
            <div className="group/f flex items-center rounded-lg text-sm hover:bg-stone-200/70 dark:hover:bg-stone-800">
              <button className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left font-semibold" onClick={() => toggle(key, folded)} aria-expanded={!folded}>
                <span className="w-3 shrink-0 text-xs text-stone-400">{folded ? "▸" : "▾"}</span>
                <span className="truncate">{/^\p{Extended_Pictographic}/u.test(name) ? name : `📁 ${name}`}</span>
                <span className="ml-1 shrink-0 text-xs font-normal text-stone-400">{count}</span>
              </button>
              <button className="btn-ghost px-1.5 text-xs opacity-60 group-hover/f:opacity-100" title="폴더 이름 바꾸기" onClick={() => {
                const to = cleanFolderName(prompt("새 폴더 이름", name) ?? "");
                if (to) renameFolder(kind, name, to);
              }}>✏️</button>
              <button className="btn-ghost px-1.5 text-xs opacity-60 group-hover/f:opacity-100" title="폴더 풀기 (안의 항목은 지우지 않고 폴더 밖으로)" onClick={() => confirm(`'${name}' 폴더를 풀까요? 안의 ${count}개는 지워지지 않고 폴더 밖으로 나옵니다.`) && dissolveFolder(kind, name)}>✕</button>
            </div>
            {!folded && <div className="ml-3 space-y-1 border-l border-stone-200 pl-1 dark:border-stone-800">{items.filter((x) => x.folder === name).map((x) => render(x, ""))}</div>}
          </div>
        );
      })}
      {folders.length > 0 && loose.length > 0 && (
        <div className={`mt-2 rounded-lg px-2 pt-1 text-xs font-semibold text-stone-400 ${over === "" ? "ring-2 ring-violet-400" : ""}`} {...drop(undefined)}>폴더 밖</div>
      )}
      {loose.map((x) => render(x, ""))}
    </nav>
  );
}

/** 항목의 📁 버튼: 누르면 아래에 '폴더로 옮기기' 칸이 열림 */
function MoveButton({ item }: { kind: FolderKind; item: Item }) {
  const open = useOpenMove(item.id);
  return (
    <button className={`btn-ghost px-1.5 text-sm ${open ? "" : "opacity-60 group-hover:opacity-100"}`} title="폴더로 옮기기" aria-expanded={open} onClick={() => setOpenMove(open ? null : item.id)}>📁</button>
  );
}
function MovePanel({ kind, item }: { kind: FolderKind; item: Item }) {
  const open = useOpenMove(item.id);
  const all = useApp((s) => s[kind]);
  if (!open) return null;
  const names = folderList(Object.values(all)).map((f) => f.name);
  const move = (name?: string) => {
    moveToFolder(kind, [item.id], name);
    setOpenMove(null);
  };
  return (
    <div className="flex flex-wrap gap-1 px-2 pb-2 text-xs">
      {names.map((n) => (
        <button key={n} className={`rounded-full border px-2 py-0.5 ${item.folder === n ? "border-violet-400 bg-violet-100 font-semibold dark:border-violet-700 dark:bg-violet-950" : "border-stone-300 dark:border-stone-700"}`} onClick={() => move(n)}>{n}</button>
      ))}
      <button className="rounded-full border border-dashed border-stone-400 px-2 py-0.5" onClick={() => {
        const n = cleanFolderName(prompt("새 폴더 이름") ?? "");
        if (n) move(n);
      }}>＋ 새 폴더</button>
      {item.folder && <button className="rounded-full border border-stone-300 px-2 py-0.5 dark:border-stone-700" onClick={() => move(undefined)}>폴더 밖으로</button>}
    </div>
  );
}
