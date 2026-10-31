import { useState } from "react";
import { updateRoom } from "../lib/store";
import type { Room } from "../lib/types";
import Dialog from "./Dialog";

export default function RoomDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const [premise, setPremise] = useState(room.premise);
  const [memory, setMemory] = useState(room.memory);
  return (
    <Dialog
      title="이야기 설정 · 장기 기억"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={() => { updateRoom(room.id, { premise, memory }); onClose(); }}>저장</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="premise">이야기 설정 (세계관 · 등장인물 · 배경 · 규칙)</label>
          <textarea id="premise" className="input min-h-48" value={premise} onChange={(e) => setPremise(e.target.value)} placeholder={"예)\n배경: 비가 자주 오는 항구 도시, 현대\n주인공: 서도윤(24), 신입 기자. 호기심이 많고 말이 빠르다.\n강서율(29): 재벌가 상무. 차갑지만 책임감이 강하다. 존댓말을 쓴다."} />
          <p className="hint mt-1">AI가 매 응답마다 참고합니다. 인물의 말투 예시를 적어 두면 더 일관되게 씁니다.</p>
        </div>
        <div>
          <label className="label" htmlFor="memory">장기 기억 (지금까지의 줄거리 요약)</label>
          <textarea id="memory" className="input min-h-36" value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="오래된 대화 중 기억해야 할 사건·관계·약속을 적어 두세요. (자동 정리 기능은 다음 버전에서 추가됩니다)" />
        </div>
      </div>
    </Dialog>
  );
}
