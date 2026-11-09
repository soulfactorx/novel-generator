import { useEffect, useRef, useState } from "react";
import type { DiagEvents, DiagnosisResult } from "../lib/store";
import { stopDiagnosis } from "../lib/store";
import Dialog from "./Dialog";

/** 진단 결과(마크다운 비슷한 텍스트)를 가볍게 표시 */
function Report({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const h = /^#{1,4}\s*(.+)$/.exec(line);
        if (h) return <div key={i} className="pt-3 font-bold text-violet-700 first:pt-0 dark:text-violet-300">{h[1]}</div>;
        if (!line.trim()) return null;
        return <div key={i} className={line.trim().startsWith("-") ? "pl-2" : ""}>{line.replace(/\*\*/g, "")}</div>;
      })}
    </div>
  );
}

/** 진단 글의 항목(출력 형식의 ### 제목 순서). 받은 글에 마지막으로 나온 항목을 '쓰는 중'으로 보고 진행률을 어림한다 */
const SECTIONS = ["한 줄 평", "설정·인물 일관성", "반복·문체", "전개", "제안", "다음 지시"];
function sectionsSeen(text: string): number {
  let n = 0;
  SECTIONS.forEach((name, i) => {
    const key = name.split("·")[0].replace(/\s/g, "");
    const found = i === SECTIONS.length - 1 ? /\[다음 지시\]/.test(text) : text.split("\n").some((l) => /^#{1,4}\s*/.test(l) && l.replace(/[#\s]/g, "").includes(key));
    if (found) n = i + 1;
  });
  return n;
}

/** 진단 진행 상황: 단계 · 항목 n/6 · 지난 시간 · AI의 생각 */
function Progress({ text, thinking, status, startedAt }: { text: string; thinking: string; status: string; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.round((now - startedAt) / 1000));
  const done = Math.max(0, sectionsSeen(text) - 1); // 앞 항목들은 끝났고, 마지막으로 나온 항목을 쓰는 중
  const stage = text ? `진단 쓰는 중 · ${done + 1} / ${SECTIONS.length} 항목 (${SECTIONS[done]})` : thinking ? "AI가 원고를 읽고 생각하는 중" : "AI에게 원고를 보내는 중";
  const pct = text ? 15 + Math.round((done / SECTIONS.length) * 80) : thinking ? 10 : 4;
  return (
    <div className="space-y-2" role="progressbar" aria-valuenow={pct} aria-label="진단 진행률">
      <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300" aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
        <span className="flex-1">🩺 {stage}</span>
        <span className="font-normal text-stone-500">{sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div className="h-full rounded-full bg-violet-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {SECTIONS.map((name, i) => (
          <li key={name} className={i < done ? "text-emerald-600" : i === done && text ? "font-semibold text-violet-700 dark:text-violet-300" : "text-stone-400"}>{i < done ? "✓" : i === done && text ? "▶" : "·"} {name}</li>
        ))}
      </ol>
      {status && <p className="text-xs text-amber-700 dark:text-amber-300">ℹ️ {status}</p>}
      {!text && thinking && <div className="line-clamp-3 text-xs italic text-stone-500">💭 {thinking.slice(-300)}</div>}
      {!text && !thinking && sec >= 20 && <p className="hint">원고가 길면 AI가 읽는 데 시간이 걸립니다.</p>}
    </div>
  );
}

export default function DiagnosisDialog({ title, run, last, applyLabel, canApply = true, onApply, onClose }: { title: string; run: (on: DiagEvents) => Promise<DiagnosisResult>; last?: DiagnosisResult & { at: number }; applyLabel: string; canApply?: boolean; onApply: (directive: string) => void; onClose: () => void }) {
  const [result, setResult] = useState<(DiagnosisResult & { at?: number }) | null>(last ?? null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [full, setFull] = useState(""); // [다음 지시]까지 포함한 받은 글 (진행률 계산용)
  const [thinking, setThinking] = useState("");
  const [status, setStatus] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState("");
  const [directive, setDirective] = useState(last?.directive ?? "");
  const started = useRef(false);
  const start = async () => {
    setError("");
    setStreaming("");
    setFull("");
    setThinking("");
    setStatus("");
    setStartedAt(Date.now());
    try {
      const r = await run({ onText: (all) => (setFull(all), setStreaming(all.split("[다음 지시]")[0])), onThinking: setThinking, onStatus: setStatus });
      setResult(r);
      setDirective(r.directive);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError((e as Error)?.message || String(e));
    } finally {
      setStreaming(null);
    }
  };
  useEffect(() => {
    if (!last && !started.current) {
      started.current = true;
      void start();
    }
    return () => stopDiagnosis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const busy = streaming !== null;
  return (
    <Dialog
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {busy ? <button className="btn-danger" onClick={stopDiagnosis}>■ 중단</button> : <button className="btn-ghost" onClick={() => void start()}>↻ 다시 진단</button>}
          <button className="btn-primary" disabled={busy || !directive.trim() || !canApply} onClick={() => { onApply(directive.trim()); onClose(); }}>{applyLabel}</button>
        </>
      }
    >
      {busy ? (
        <div className="space-y-2">
          <Progress text={full} thinking={thinking} status={status} startedAt={startedAt} />
          {streaming && <Report text={streaming} />}
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600">❌ {error}</p>
      ) : result ? (
        <div className="space-y-4">
          {result.at && <p className="hint">{new Date(result.at).toLocaleString("ko-KR")}에 진단한 결과</p>}
          <Report text={result.report} />
          <div>
            <label className="label" htmlFor="directive">다음 원고에 전달할 지시 (고칠 수 있음)</label>
            <textarea id="directive" className="input min-h-24" value={directive} onChange={(e) => setDirective(e.target.value)} />
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
