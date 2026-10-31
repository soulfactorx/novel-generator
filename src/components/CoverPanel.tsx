import { useRef, useState } from "react";
import { buildCoverPrompt, COVER_MODELS, fileToDataUrl, generateCoverImage, renderCover } from "../lib/cover";
import { formatUsd } from "../lib/pricing";
import { contextFor, getState, recordExternalUsage, setCover, updateSettings, useApp } from "../lib/store";
import type { Novel, NovelCover } from "../lib/types";

export default function CoverPanel({ novel: n }: { novel: Novel }) {
  const settings = useApp((s) => s.settings);
  const lib = useApp((s) => s.library);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<null | "ai">(null);
  const [prompt, setPrompt] = useState("");
  const [showTitle, setShowTitle] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const save = (dataUrl: string, source: NovelCover["source"], p?: string) => setCover(n.id, { dataUrl, source, ...(p ? { prompt: p } : {}), createdAt: Date.now() });
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setMsg({ ok: false, text: `❌ ${(e as Error)?.message || e}` });
    } finally {
      setBusy("");
    }
  };
  const design = () => run("표지 만드는 중…", async () => save(await renderCover({ title: n.title || "제목 없음", author: n.author, genre: n.genre, showTitle: true }), "design"));
  const upload = (f: File) => run("이미지 처리 중…", async () => save(await renderCover({ background: await fileToDataUrl(f), title: n.title, author: n.author, genre: n.genre, showTitle }), "upload"));
  const drawAi = () =>
    run("AI가 표지를 그리는 중… (10~30초)", async () => {
      abort.current = new AbortController();
      const img = await generateCoverImage({ key: getState().settings.keys.gemini, model: settings.coverModel, prompt, signal: abort.current.signal });
      const usd = img.usage ? recordExternalUsage("cover", "gemini", img.model, img.usage) : undefined;
      save(await renderCover({ background: `data:${img.mime};base64,${img.base64}`, title: n.title, author: n.author, genre: n.genre, showTitle }), "ai", prompt);
      setMode(null);
      setMsg({ ok: true, text: `✅ 표지를 만들었습니다.${usd !== undefined ? ` (${formatUsd(usd)})` : ""}` });
    });

  return (
    <div className="card space-y-3">
      <div className="flex gap-4">
        <div className="aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-md bg-stone-200 shadow dark:bg-stone-800">
          {n.cover ? <img src={n.cover.dataUrl} alt="표지" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center p-2 text-center text-xs text-stone-500">표지 없음</div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-bold">🎨 표지</div>
          <p className="hint">EPUB 내보내기와 서고 목록에 쓰입니다.</p>
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-primary px-2.5 py-1.5 text-xs" disabled={!!busy} onClick={() => { setPrompt(n.cover?.source === "ai" && n.cover.prompt ? n.cover.prompt : buildCoverPrompt(n, contextFor(n, lib))); setMode(mode === "ai" ? null : "ai"); }}>✨ AI로 그리기</button>
            <button className="btn-ghost border border-stone-300 px-2.5 py-1.5 text-xs dark:border-stone-700" disabled={!!busy} onClick={() => fileRef.current?.click()}>🖼 이미지 올리기</button>
            <button className="btn-ghost border border-stone-300 px-2.5 py-1.5 text-xs dark:border-stone-700" disabled={!!busy} onClick={design}>🔤 글자 표지</button>
            {n.cover && <button className="btn-danger px-2.5 py-1.5 text-xs" disabled={!!busy} onClick={() => confirm("표지를 지울까요?") && setCover(n.id, null)}>지우기</button>}
          </div>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} /> 그림 위에 제목·지은이 넣기</label>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      {mode === "ai" && (
        <div className="space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          {!settings.keys.gemini && <p className="text-xs font-semibold text-amber-600">⚠️ AI 표지는 Google Gemini API 키가 필요합니다 (다른 제공업체로 글을 써도, 키만 입력해 두면 됩니다).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto py-1 text-sm" value={settings.coverModel} onChange={(e) => updateSettings({ coverModel: e.target.value })} aria-label="표지 모델">
              {COVER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
            </select>
          </div>
          <textarea className="input min-h-32 font-mono text-xs" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="표지 프롬프트" />
          <p className="hint">기획·세계관·인물로 자동 작성한 프롬프트입니다. 원하는 분위기·구도·색감을 더해 고칠 수 있습니다. 표지는 소설의 수위 설정과 관계없이 전체 이용가로 요청합니다.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setMode(null)}>취소</button>
            <button className="btn-primary" disabled={!!busy || !prompt.trim() || !settings.keys.gemini} onClick={drawAi}>그리기</button>
          </div>
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" /> {busy}
          {busy.startsWith("AI") && <button className="btn-danger ml-auto px-2 py-0.5 text-xs" onClick={() => abort.current?.abort()}>중단</button>}
        </div>
      )}
      {msg && <p className={`text-xs font-semibold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
    </div>
  );
}
