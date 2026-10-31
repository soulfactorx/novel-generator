import { useEffect, useState } from "react";
import { init, useApp } from "./lib/store";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SettingsDialog from "./components/SettingsDialog";
import LibraryDialog from "./components/LibraryDialog";
import NewRoomDialog from "./components/NewRoomDialog";
import NovelView from "./components/NovelView";

export default function App() {
  const ready = useApp((s) => s.ready);
  const theme = useApp((s) => s.settings.theme);
  const storageError = useApp((s) => s.storageError);
  const view = useApp((s) => s.view);
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

  if (!ready) return <div className="grid h-full place-items-center text-sm text-stone-500">불러오는 중…</div>;
  return (
    <div className="flex h-full">
      <Sidebar open={menu} onClose={() => setMenu(false)} onOpenSettings={(t) => setSettingsTab(t ?? "ai")} onNewStory={() => setNewRoom(true)} onOpenLibrary={openLibrary} />
      <main className="flex min-w-0 flex-1 flex-col">
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
    </div>
  );
}
