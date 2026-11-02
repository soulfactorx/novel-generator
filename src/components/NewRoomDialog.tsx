import { useState } from "react";
import { createRoom, useApp } from "../lib/store";
import type { Character } from "../lib/types";
import CastPicker, { type Cast } from "./CastPicker";
import Dialog from "./Dialog";

const preview = (g: string) => g.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export default function NewRoomDialog({ onClose, onOpenLibrary }: { onClose: () => void; onOpenLibrary: () => void }) {
  const lib = useApp((s) => s.library);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [cast, setCast] = useState<Cast>({ characterIds: [] });
  // 고른 인물들의 인사말 (패키지에 보관된 첫 메시지)
  const options = cast.characterIds.flatMap((id) => {
    const c = lib[id];
    return c?.kind === "character" ? ((c as Character).greetings ?? []).map((g, i) => ({ key: `${id}:${i}`, label: `${c.name} ${i + 1}`, text: g })).filter((o) => o.text.trim()) : [];
  });
  const [pick, setPick] = useState<string | null>(null); // null: 첫 인사말(있으면), "": 없이 시작
  const chosen = pick === "" ? undefined : (options.find((o) => o.key === pick) ?? options[0]);
  const start = () => {
    createRoom({ title, premise, ...cast, greeting: chosen?.text });
    onClose();
  };
  return (
    <Dialog title="새 이야기" onClose={onClose} wide footer={<><button className="btn-ghost" onClick={onClose}>취소</button><button className="btn-primary" onClick={start}>시작하기</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="nr-title">제목 (비워 두면 첫 입력으로 자동 지정)</label>
          <input id="nr-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <CastPicker value={cast} onChange={setCast} onOpenLibrary={onOpenLibrary} />
        {options.length > 0 && (
          <div>
            <label className="label" htmlFor="nr-greet">첫 메시지 (인사말)</label>
            <select id="nr-greet" className="input" value={chosen?.key ?? ""} onChange={(e) => setPick(e.target.value)}>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}: {preview(o.text)}</option>)}
              <option value="">인사말 없이 시작</option>
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="nr-premise">이 이야기만의 설정 · 시작 상황 (선택)</label>
          <textarea id="nr-premise" className="input min-h-28" value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="예) 주인공은 조합에 갓 들어온 신입 조사관. 첫 출근 날, 항구에서 의문의 밀수선이 발견된다." />
        </div>
      </div>
    </Dialog>
  );
}
