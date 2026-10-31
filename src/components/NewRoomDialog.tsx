import { useState } from "react";
import { createRoom } from "../lib/store";
import CastPicker, { type Cast } from "./CastPicker";
import Dialog from "./Dialog";

export default function NewRoomDialog({ onClose, onOpenLibrary }: { onClose: () => void; onOpenLibrary: () => void }) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [cast, setCast] = useState<Cast>({ characterIds: [] });
  const start = () => {
    createRoom({ title, premise, ...cast });
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
        <div>
          <label className="label" htmlFor="nr-premise">이 이야기만의 설정 · 시작 상황 (선택)</label>
          <textarea id="nr-premise" className="input min-h-28" value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="예) 주인공은 조합에 갓 들어온 신입 조사관. 첫 출근 날, 항구에서 의문의 밀수선이 발견된다." />
        </div>
      </div>
    </Dialog>
  );
}
