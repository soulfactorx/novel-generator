import { useEffect, useRef, useState } from "react";
import type { DiagnosisResult } from "../lib/store";
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

export default function DiagnosisDialog({ title, run, last, applyLabel, canApply = true, onApply, onClose }: { title: string; run: (onText: (all: string) => void) => Promise<DiagnosisResult>; last?: DiagnosisResult & { at: number }; applyLabel: string; canApply?: boolean; onApply: (directive: string) => void; onClose: () => void }) {
  const [result, setResult] = useState<(DiagnosisResult & { at?: number }) | null>(last ?? null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [directive, setDirective] = useState(last?.directive ?? "");
  const started = useRef(false);
  const start = async () => {
    setError("");
    setStreaming("");
    try {
      const r = await run((all) => setStreaming(all.split("[다음 지시]")[0]));
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
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-600"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" /> 진단하는 중…</div>
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
