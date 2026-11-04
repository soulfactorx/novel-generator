import { useState } from "react";
import { memoryBatch, pendingForMemory } from "../lib/memory";
import { getState, updateMemory, updateRoom, updateSettings, useApp } from "../lib/store";
import type { Room } from "../lib/types";
import CastPicker, { type Cast } from "./CastPicker";
import { RoomModules } from "./ModulePicker";
import Dialog from "./Dialog";

export default function RoomDialog({ room, onClose, onOpenLibrary, initialTab = "cast" }: { room: Room; onClose: () => void; onOpenLibrary: () => void; initialTab?: "cast" | "memory" }) {
  const [tab, setTab] = useState(initialTab);
  const [premise, setPremise] = useState(room.premise);
  const [memory, setMemory] = useState(room.memory);
  const [cast, setCast] = useState<Cast>({ worldId: room.worldId, characterIds: room.characterIds, personaId: room.personaId });
  const [mods, setMods] = useState({ moduleIds: room.moduleIds ?? [], offModules: room.offModules ?? [] });
  const settings = useApp((s) => s.settings);
  const job = useApp((s) => (s.memoryJob?.roomId === room.id ? s.memoryJob : null));
  const live = useApp((s) => s.rooms[room.id]);
  const [note, setNote] = useState("");
  const save = () => {
    // 대화상자가 열려 있는 동안 자동 정리로 바뀐 기억을 덮어쓰지 않도록, 직접 고친 경우에만 저장
    updateRoom(room.id, { premise, ...(memory !== room.memory ? { memory } : {}), worldId: cast.worldId, characterIds: cast.characterIds, personaId: cast.personaId, moduleIds: mods.moduleIds, offModules: mods.offModules });
    onClose();
  };
  const pending = live ? pendingForMemory(live, settings.contextMessages, "manual").length : 0;
  const autoPending = live ? live.messages.filter((m) => !m.error && m.text.trim()).length - settings.contextMessages : 0;
  const runNow = async () => {
    if (memory !== room.memory) updateRoom(room.id, { memory }); // 직접 고친 내용 먼저 반영
    setNote("");
    const r = await updateMemory(room.id, "manual");
    if (r === "updated") {
      setMemory(getState().rooms[room.id]?.memory ?? "");
      setNote("✅ 장기 기억을 갱신했습니다.");
    } else if (r === "nothing") setNote("정리할 새 대화가 없습니다. (최근 6개 메시지는 그대로 둡니다)");
    else if (r === "busy") setNote("이미 정리 중입니다.");
    else setNote("❌ " + r.error);
  };
  return (
    <Dialog title="이야기 설정" onClose={onClose} wide footer={<><button className="btn-ghost" onClick={onClose}>취소</button><button className="btn-primary" onClick={save}>저장</button></>}>
      <div className="mb-4 flex gap-1">
        {([["cast", "구성 · 설정"], ["memory", "🧠 장기 기억"]] as const).map(([id, l]) => (
          <button key={id} className={`btn flex-1 ${tab === id ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      {tab === "cast" ? (
        <div className="space-y-4">
          <CastPicker value={cast} onChange={setCast} onOpenLibrary={onOpenLibrary} />
          <RoomModules characterIds={cast.characterIds} worldId={cast.worldId} moduleIds={mods.moduleIds} offModules={mods.offModules} onChange={setMods} />
          <div>
            <label className="label" htmlFor="premise">이 이야기만의 추가 설정</label>
            <textarea id="premise" className="input min-h-40" value={premise} onChange={(e) => setPremise(e.target.value)} placeholder={"라이브러리에 없는 설정이나 시작 상황을 적어 두세요.\n예) 배경: 비가 자주 오는 항구 도시, 현대\n서도윤(24): 신입 기자. 호기심이 많고 말이 빠르다."} />
            <p className="hint mt-1">AI가 매 응답마다 참고합니다.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="hint">
            AI에게는 최근 {settings.contextMessages}개 메시지만 보내고, 그보다 오래된 내용은 이 요약으로 기억합니다.
            {settings.autoMemory ? ` 자동 정리가 켜져 있어 오래된 메시지가 ${memoryBatch()}개 쌓일 때마다 요약을 갱신합니다.` : " 자동 정리가 꺼져 있습니다."}
          </p>
          <textarea id="memory" className="input min-h-64" value={memory} onChange={(e) => setMemory(e.target.value)} aria-label="장기 기억" placeholder="아직 요약이 없습니다. 대화가 길어지면 자동으로 채워지고, 직접 써도 됩니다." />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={!!job && !job.error} onClick={runNow}>{job && !job.error ? "정리 중…" : `지금 정리하기${pending ? ` (${pending}개 메시지)` : ""}`}</button>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={settings.autoMemory} onChange={(e) => updateSettings({ autoMemory: e.target.checked })} /> 자동 정리</label>
            {room.memoryUpdatedAt && <span className="hint ml-auto">마지막 갱신 {new Date(room.memoryUpdatedAt).toLocaleString("ko-KR")}</span>}
          </div>
          {autoPending > 0 && settings.autoMemory && <p className="hint">대화창 밖으로 밀려난 메시지 {autoPending}개</p>}
          {note && <p className="text-sm font-semibold">{note}</p>}
        </div>
      )}
    </Dialog>
  );
}
