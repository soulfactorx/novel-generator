import { useMemo, useState } from "react";
import { ARCHIVE } from "../lib/folders";
import { clearAutoFolders, getState, organizeNow, planFolders, updateSettings, useApp, type FolderKind } from "../lib/store";
import type { OrganizeRule } from "../lib/types";
import Dialog from "./Dialog";

const BY: [OrganizeRule["by"], string, string][] = [
  ["none", "기준 없음", "보관함만 씁니다 (켜 두었을 때)"],
  ["character", "등장인물별", "첫 번째 등장인물 이름으로 묶습니다"],
  ["world", "세계관별", "세계관 이름으로 묶습니다"],
  ["activity", "최근 활동별", "이번 주 · 이번 달 · 그 전"],
  ["status", "연재 상태별", "연재 중 · 완결"],
];
const DAYS = [0, 7, 14, 30, 60, 90, 180];

/** 사이드바 자동 정리 설정 · 미리보기 · 지금 정리 */
export default function OrganizeDialog({ kind, onClose }: { kind: FolderKind; onClose: () => void }) {
  const saved = useApp((s) => s.settings.organize[kind]);
  const list = useApp((s) => s[kind]); // 목록이 바뀌면 미리보기 갱신
  const [rule, setRule] = useState<OrganizeRule>(saved);
  const [includeManual, setIncludeManual] = useState(false);
  const [msg, setMsg] = useState("");
  const what = kind === "rooms" ? "이야기" : "소설";
  const plan = useMemo(() => planFolders(kind, rule, { includeManual }), [kind, rule, includeManual, list]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => {
    const m = new Map<string, number>();
    let out = 0;
    for (const p of plan.values()) {
      if (p.folder) m.set(p.folder, (m.get(p.folder) ?? 0) + 1);
      else out++;
    }
    return { folders: [...m.entries()].sort((a, b) => (a[0] === ARCHIVE ? 1 : b[0] === ARCHIVE ? -1 : a[0].localeCompare(b[0], "ko"))), out };
  }, [plan]);
  // 다른 종류(이야기·소설)의 규칙은 최신 값 그대로 두고 저장
  const save = () => updateSettings({ organize: { ...getState().settings.organize, [kind]: rule } });
  const run = () => {
    save();
    const n = organizeNow(kind, { includeManual, rule });
    setMsg(n ? `✅ ${what} ${n}개를 정리했습니다.` : "바꿀 것이 없습니다.");
  };
  return (
    <Dialog
      title={`🗂 ${what} 폴더 자동 정리`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={run}>지금 정리</button>
          <button className="btn-ghost border border-stone-300 dark:border-stone-700" onClick={() => { save(); setMsg("✅ 설정을 저장했습니다."); }}>설정만 저장</button>
          <button className="btn-ghost ml-auto" title="자동 정리가 넣은 폴더를 모두 풀고 직접 넣은 것만 남깁니다" onClick={() => { const n = clearAutoFolders(kind); setMsg(n ? `자동으로 넣은 ${n}개를 폴더 밖으로 뺐습니다.` : "자동으로 넣은 것이 없습니다."); }}>자동 폴더 모두 풀기</button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="label">묶는 기준</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {BY.filter(([b]) => kind === "novels" || b !== "status").map(([b, label, hint]) => (
              <label key={b} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${rule.by === b ? "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40" : "border-stone-200 dark:border-stone-800"}`}>
                <input type="radio" className="mt-1" checked={rule.by === b} onChange={() => setRule({ ...rule, by: b })} />
                <span>{label} <span className="hint block">{hint}</span></span>
              </label>
            ))}
          </div>
          <p className="hint mt-1">같은 묶음이 2개 이상일 때만 폴더를 만듭니다 (최근 활동은 1개도). 내가 직접 넣거나 뺀 {what}은 건드리지 않습니다.</p>
        </div>
        <label className="block">
          <span className="label">오래 안 쓴 {what}은 {ARCHIVE}으로</span>
          <select className="input" value={rule.archiveDays} onChange={(e) => setRule({ ...rule, archiveDays: Number(e.target.value) })}>
            {DAYS.map((d) => <option key={d} value={d}>{d ? `${d}일 넘게 안 쓰면` : "보관 안 함"}</option>)}
          </select>
          <span className="hint">다시 쓰면 원래 폴더로 돌아갑니다. 직접 넣은 폴더에 있던 것도 보관합니다.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={rule.auto} onChange={(e) => setRule({ ...rule, auto: e.target.checked })} />
          <span>자동으로 계속 정리 <span className="hint block">새로 만들거나 내용이 바뀌면 이 기준대로 바로 폴더에 넣고, 시간이 지나면 보관함으로 옮깁니다. 끄면 [지금 정리]를 누를 때만 정리합니다.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={includeManual} onChange={(e) => setIncludeManual(e.target.checked)} />
          <span>직접 정한 것도 다시 정리 (이번 한 번) <span className="hint block">내가 직접 넣거나 뺀 {what}까지 위 기준대로 다시 나눕니다.</span></span>
        </label>
        <div className="rounded-lg bg-stone-100 p-3 dark:bg-stone-800/60">
          <div className="font-semibold">미리보기</div>
          {plan.size === 0 ? (
            <p className="hint">지금 기준으로는 바뀌는 것이 없습니다.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {preview.folders.map(([name, n]) => <li key={name}>{/^\p{Extended_Pictographic}/u.test(name) ? name : `📁 ${name}`} ← {n}개</li>)}
              {preview.out > 0 && <li>폴더 밖으로 ← {preview.out}개</li>}
            </ul>
          )}
        </div>
        {msg && <p className="font-semibold text-emerald-600">{msg}</p>}
      </div>
    </Dialog>
  );
}

