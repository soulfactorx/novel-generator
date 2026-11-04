/** 파일 가져오기 진행률: 큰 파일 읽기(%) · 분석 중 · 그림 n / 전체 저장 */

export type Progress = { label: string; pct: number | null };

/** 큰 파일은 FileReader로 읽으며 진행률(%)을 알린다 */
export function readWithProgress(f: File, onPct: (pct: number) => void): Promise<Uint8Array> {
  if (typeof FileReader === "undefined" || f.size < 2_000_000) return f.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => rej(r.error ?? new Error("파일을 읽지 못했습니다."));
    onPct(0);
    r.readAsArrayBuffer(f);
  });
}

export const readingLabel = (f: File) => `파일 읽는 중 (${(f.size / 1048576).toFixed(1)}MB)`;
export const imageProgress = (d: number, t: number): Progress => ({ label: `이미지 ${d} / ${t}장 저장 중`, pct: Math.round((d / t) * 100) });

export function ProgressBar({ progress, label = "가져오기 진행률" }: { progress: Progress; label?: string }) {
  return (
    <div className="space-y-1" role="progressbar" aria-valuenow={progress.pct ?? undefined} aria-label={label}>
      <div className="flex justify-between text-xs text-stone-500"><span>⏳ {progress.label}</span>{progress.pct !== null && <b>{progress.pct}%</b>}</div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div className={`h-full rounded-full bg-violet-600 transition-all ${progress.pct === null ? "w-1/3 animate-pulse" : ""}`} style={progress.pct !== null ? { width: `${progress.pct}%` } : undefined} />
      </div>
    </div>
  );
}
