import { useEffect, useState } from "react";
import { init, useApp } from "./lib/store";
import { formatUsd } from "./lib/pricing";
import { monthRange, summarize } from "./lib/usage";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SettingsDialog from "./components/SettingsDialog";
import LibraryDialog from "./components/LibraryDialog";
import NewRoomDialog from "./components/NewRoomDialog";
import RisuDialogView from "./components/RisuDialogView";
import NovelView from "./components/NovelView";

export default function App() {
  const ready = useApp((s) => s.ready);
  const theme = useApp((s) => s.settings.theme);
  const storageError = useApp((s) => s.storageError);
  const view = useApp((s) => s.view);
  const budget = useApp((s) => s.settings.monthlyBudget);
  const usage = useApp((s) => s.usage);
  const spent = budget ? summarize(usage, ...monthRange()).total.usd : 0;
  const [menu, setMenu] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const openLibrary = () => { setNewRoom(false); setLibrary(true); };

  useEffect(() => void init(), []);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && !!mq?.matches));
    apply();
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, [theme]);

  // 설정에서 고른 대사 색
  const dialogueColor = useApp((s) => s.settings.dialogueColor);
  useEffect(() => {
    if (dialogueColor) document.documentElement.style.setProperty("--dlg-user", dialogueColor);
    else document.documentElement.style.removeProperty("--dlg-user");
  }, [dialogueColor]);

  if (!ready) return <div className="grid h-full place-items-center text-sm text-stone-500">불러오는 중…</div>;
  return (
    <div className="flex h-full">
      <Sidebar open={menu} onClose={() => setMenu(false)} onOpenSettings={(t) => setSettingsTab(t ?? "ai")} onNewStory={() => setNewRoom(true)} onOpenLibrary={openLibrary} />
      <main className="flex min-w-0 flex-1 flex-col">
        {budget > 0 && spent >= budget && (
          <button className="bg-rose-100 px-4 py-2 text-left text-xs text-rose-900 dark:bg-rose-900/40 dark:text-rose-200" onClick={() => setSettingsTab("usage")}>
            💸 이번 달 예상 비용 {formatUsd(spent)}이(가) 설정한 월 예산 {formatUsd(budget)}을(를) 넘었습니다. (사용량 보기)
          </button>
        )}
        {storageError && <div className="bg-amber-100 px-4 py-2 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">⚠️ {storageError}</div>}
        {view === "novels" ? (
          <NovelView onMenu={() => setMenu(true)} onOpenSettings={(t) => setSettingsTab(t ?? "ai")} onOpenLibrary={openLibrary} />
        ) : (
          <ChatView onMenu={() => setMenu(true)} onOpenSettings={(t) => setSettingsTab(t ?? "ai")} onOpenLibrary={openLibrary} onNewStory={() => setNewRoom(true)} />
        )}
      </main>
      {settingsTab && <SettingsDialog initialTab={settingsTab} onClose={() => setSettingsTab(null)} />}
      {newRoom && <NewRoomDialog onClose={() => setNewRoom(false)} onOpenLibrary={openLibrary} />}
      {library && <LibraryDialog onClose={() => setLibrary(false)} />}
      <RisuDialogView />
    </div>
  );
}
