import { useState } from "react";
import { clampTune, defaultTune, T, TUNE_DEFS, type TuneDef } from "../lib/tuning";
import { updateSettings, useApp } from "../lib/store";

/** 설정 → 세부 수치: 결과에 영향을 주는 숫자(응답 길이·로어북 예산·장기 기억 기준 등)를 보고 바꾸고 기본값으로 되돌린다 */
export default function TuningTab() {
  const tuning = useApp((x) => x.settings.tuning);
  const changed = Object.keys(tuning).length;
  const groups = [...new Set(TUNE_DEFS.map((d) => d.group))];
  const set = (d: TuneDef, v: number | null) => {
    const next = { ...tuning };
    if (v === null || clampTune(d, v) === d.def) delete next[d.id];
    else next[d.id] = clampTune(d, v);
    updateSettings({ tuning: next });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="hint flex-1">결과에 영향을 주는 숫자들입니다. 바꾸면 바로 다음 요청부터 쓰이고, 설정과 함께 백업·동기화됩니다. 잘 모르겠으면 기본값을 그대로 두세요.</p>
        <button className="btn-ghost text-xs text-rose-600" disabled={!changed} onClick={() => confirm(`바꾼 수치 ${changed}개를 모두 기본값으로 되돌릴까요?`) && updateSettings({ tuning: {} })}>모두 기본값으로 ({changed})</button>
      </div>
      {groups.map((g) => (
        <section key={g} className="card space-y-3">
          <div className="font-bold">{g}</div>
          {TUNE_DEFS.filter((d) => d.group === g).map((d) => (
            <Row key={d.id} d={d} value={T(d.id)} changed={d.id in tuning} onChange={(v) => set(d, v)} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Row({ d, value, changed, onChange }: { d: TuneDef; value: number; changed: boolean; onChange: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null); // 입력 중인 글자 (벗어날 때 범위 안으로 정리)
  const commit = (s: string) => {
    setText(null);
    const n = Number(s.replace(/,/g, ""));
    if (s.trim() && Number.isFinite(n)) onChange(n);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {d.label}
          {changed && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">바꿈</span>}
        </div>
        <div className="hint text-xs">{d.hint ? `${d.hint} · ` : ""}기본 {defaultTune(d.id).toLocaleString()}{d.unit ?? ""} · {d.min.toLocaleString()}~{d.max.toLocaleString()}</div>
      </div>
      <input
        type="number"
        className="input w-28 py-1 text-right font-mono"
        min={d.min}
        max={d.max}
        step={d.step ?? 1}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        aria-label={d.label}
      />
      <span className="w-8 text-xs text-stone-500">{d.unit}</span>
      <button className="btn-ghost w-20 px-2 py-0.5 text-xs" disabled={!changed} onClick={() => onChange(null)}>기본값으로</button>
    </div>
  );
}
