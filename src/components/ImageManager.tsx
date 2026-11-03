/**
 * 라이브러리 이미지 관리: 찾기 · 종류별 보기 · 정렬 · 썸네일 크기 · 여러 장 선택(삭제 · 종류 바꾸기 · ZIP 내려받기)
 * 그리고 크게 보기(뷰어): 이전/다음 · 키보드 ←/→/Esc · 밀어서 넘기기 · 이름·종류 바꾸기 · 삭제 · 내려받기 · 태그 복사
 * 이미지가 많아도 가볍게: 한 번에 PAGE 장씩만 주소를 만든다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadBlob, safeFileName, zip } from "../lib/exporters";
import { isAudio, isVideo } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { addImages, deleteImages, loadImageData, renameImage, useApp } from "../lib/store";
import type { ImageMeta } from "../lib/types";

const KIND_LABEL: Record<ImageMeta["kind"], string> = { asset: "에셋", emotion: "감정", icon: "대표" };
type Filter = "all" | ImageMeta["kind"] | "media";
type Sort = "added" | "name" | "size";
const PAGE = 60;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/flac": "flac", "audio/mp4": "m4a", "audio/webm": "weba", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv" };
const fileName = (m: ImageMeta) => `${safeFileName(m.name) || m.id}.${EXT[m.mime] ?? "bin"}`;
const fmt = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const tagOf = (m: ImageMeta) => (m.kind === "emotion" ? `{{emotion::${m.name}}}` : `{{img::${m.name}}}`);

async function downloadOne(m: ImageMeta) {
  const data = await loadImageData(m.id);
  if (data) downloadBlob(fileName(m), data as BlobPart, m.mime);
}

export function ImageGallery({ ownerId }: { ownerId: string }) {
  const all = useApp((s) => s.images);
  const owned = useMemo(() => Object.values(all).filter((m) => m.ownerId === ownerId), [all, ownerId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(owned.length <= 24);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("added");
  const [big, setBig] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<string | null>(null); // 크게 보는 이미지 id

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const out = owned.filter((m) => (filter === "all" ? true : filter === "media" ? isAudio(m) || isVideo(m) : m.kind === filter && !isAudio(m) && !isVideo(m)) && (!k || m.name.toLowerCase().includes(k)));
    return out.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "ko", { numeric: true }) : sort === "size" ? b.size - a.size : a.createdAt - b.createdAt || a.name.localeCompare(b.name)));
  }, [owned, q, filter, sort]);
  useEffect(() => setShown(PAGE), [q, filter, sort]);
  const page = open ? list.slice(0, shown) : [];
  const urls = useImageUrls(page);
  const counts = useMemo(() => ({ all: owned.length, asset: owned.filter((m) => m.kind === "asset" && !isAudio(m) && !isVideo(m)).length, emotion: owned.filter((m) => m.kind === "emotion" && !isAudio(m) && !isVideo(m)).length, icon: owned.filter((m) => m.kind === "icon" && !isAudio(m) && !isVideo(m)).length, media: owned.filter((m) => isAudio(m) || isVideo(m)).length }), [owned]);

  const add = async (files: FileList) => {
    setBusy("저장 중…");
    await addImages([...files].map((f) => ({ ownerId, name: f.name.replace(/\.[^.]+$/, ""), kind: "asset" as const, load: async () => new Uint8Array(await f.arrayBuffer()) })));
    setBusy("");
  };
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const chosen = list.filter((m) => sel.has(m.id));
  const zipDownload = async (items: ImageMeta[], label: string) => {
    if (!items.length) return;
    setBusy("ZIP 만드는 중…");
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      const used = new Set<string>();
      for (const m of items) {
        const data = await loadImageData(m.id);
        if (!data) continue;
        let name = fileName(m);
        for (let i = 2; used.has(name); i++) name = fileName(m).replace(/(\.[^.]+)$/, `_${i}$1`);
        used.add(name);
        files.push({ name, data });
      }
      downloadBlob(`${safeFileName(label) || "images"}.zip`, zip(files) as BlobPart, "application/zip");
    } finally {
      setBusy("");
    }
  };
  const removeChosen = async () => {
    if (!chosen.length || !confirm(`선택한 이미지 ${chosen.length}장을 삭제할까요?`)) return;
    await deleteImages(chosen.map((m) => m.id));
    setSel(new Set());
  };
  const kindChosen = async (kind: ImageMeta["kind"]) => {
    for (const m of chosen) await renameImage(m.id, m.name, kind);
  };

  const viewIndex = view ? list.findIndex((m) => m.id === view) : -1;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mb-0">🖼 이미지 {owned.length > 0 && `${owned.length}장`}</span>
        {owned.length > 24 && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(!open)}>{open ? "접기" : "펼치기"}</button>}
        <span className="ml-auto flex gap-1">
          {open && owned.length > 0 && <button className={`btn-ghost px-2 py-0.5 text-xs ${selecting ? "bg-violet-100 dark:bg-violet-950" : ""}`} onClick={() => { setSelecting(!selecting); setSel(new Set()); }}>{selecting ? "선택 끝" : "선택"}</button>}
          <button className="btn-ghost px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy || "+ 이미지 추가"}</button>
        </span>
        <input ref={fileRef} type="file" accept="image/*,audio/*,video/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
      </div>
      {owned.length === 0 && <p className="hint">AI가 {"{{img::이름}}"} 으로 부를 수 있는 그림입니다. RisuAI 캐릭터 카드(charx)를 가져오면 봇의 에셋·감정 이미지가 여기에 들어옵니다.</p>}
      {open && owned.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <input className="input w-36 flex-1 px-2 py-1 text-xs" placeholder="이름 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이미지 이름 찾기" />
            <select className="input w-auto px-2 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="종류">
              <option value="all">전체 {counts.all}</option>
              {counts.asset > 0 && <option value="asset">에셋 {counts.asset}</option>}
              {counts.emotion > 0 && <option value="emotion">감정 {counts.emotion}</option>}
              {counts.icon > 0 && <option value="icon">대표 {counts.icon}</option>}
              {counts.media > 0 && <option value="media">소리·영상 {counts.media}</option>}
            </select>
            <select className="input w-auto px-2 py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
              <option value="added">추가한 순</option>
              <option value="name">이름순</option>
              <option value="size">큰 파일 순</option>
            </select>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setBig(!big)} title="썸네일 크기">{big ? "▦ 작게" : "▢ 크게"}</button>
            <button className="btn-ghost px-2 py-1 text-xs" disabled={!!busy || !list.length} onClick={() => void zipDownload(list, `images-${list.length}`)} title="지금 보이는 목록 전체를 ZIP으로">⬇ ZIP</button>
          </div>
          {selecting && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-violet-50 px-2 py-1.5 text-xs dark:bg-violet-950/40">
              <span className="font-semibold">{chosen.length}장 선택</span>
              <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setSel(new Set(list.map((m) => m.id)))}>모두 선택 ({list.length})</button>
              <button className="btn-ghost px-2 py-0.5 text-xs" disabled={!chosen.length} onClick={() => setSel(new Set())}>선택 해제</button>
              <span className="flex-1" />
              <select className="input w-auto px-2 py-0.5 text-xs" value="" disabled={!chosen.length} onChange={(e) => e.target.value && void kindChosen(e.target.value as ImageMeta["kind"])} aria-label="선택한 이미지 종류 바꾸기">
                <option value="">종류 바꾸기…</option>
                {(Object.keys(KIND_LABEL) as ImageMeta["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <button className="btn-ghost px-2 py-0.5 text-xs" disabled={!chosen.length || !!busy} onClick={() => void zipDownload(chosen, `images-selected-${chosen.length}`)}>⬇ ZIP</button>
              <button className="btn-ghost px-2 py-0.5 text-xs text-rose-600" disabled={!chosen.length} onClick={() => void removeChosen()}>삭제</button>
            </div>
          )}
          {list.length === 0 ? (
            <p className="hint">조건에 맞는 이미지가 없습니다.</p>
          ) : (
            <div className={`grid gap-2 ${big ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-5"}`}>
              {page.map((m) => {
                const on = sel.has(m.id);
                return (
                  <div key={m.id} className={`space-y-1 rounded-lg border p-1 ${on ? "border-violet-500 ring-2 ring-violet-500/30" : "border-stone-200 dark:border-stone-800"}`}>
                    <button className="relative block aspect-square w-full overflow-hidden rounded bg-stone-100 dark:bg-stone-800" onClick={() => (selecting ? toggle(m.id) : setView(m.id))} aria-label={selecting ? `${m.name} 선택` : `${m.name} 크게 보기`}>
                      {urls[m.id] && (isVideo(m) ? <video src={urls[m.id]} muted loop playsInline className="h-full w-full object-cover" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} /> : isAudio(m) ? <span className="grid h-full place-items-center text-3xl">🎵</span> : <img src={urls[m.id]} alt={m.name} className="h-full w-full object-cover" loading="lazy" />)}
                      {selecting && <span className={`absolute left-1 top-1 grid h-5 w-5 place-items-center rounded border text-xs ${on ? "border-violet-600 bg-violet-600 text-white" : "border-white bg-black/30 text-transparent"}`}>✓</span>}
                      {m.kind !== "asset" && <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[10px] text-white">{KIND_LABEL[m.kind]}</span>}
                    </button>
                    <div className="truncate px-0.5 text-[11px]" title={m.name}>{m.name}</div>
                  </div>
                );
              })}
            </div>
          )}
          {list.length > shown && (
            <div className="flex justify-center gap-2">
              <button className="btn-ghost text-xs" onClick={() => setShown(shown + PAGE)}>더 보기 ({shown} / {list.length})</button>
              <button className="btn-ghost text-xs" onClick={() => setShown(list.length)}>모두 보기</button>
            </div>
          )}
        </>
      )}
      {view && viewIndex >= 0 && <Viewer list={list} index={viewIndex} onIndex={(i) => { setView(list[i]?.id ?? null); if (i >= shown) setShown(Math.ceil((i + 1) / PAGE) * PAGE); }} onClose={() => setView(null)} />}
    </div>
  );
}

/** 크게 보기 */
function Viewer({ list, index, onIndex, onClose }: { list: ImageMeta[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = list[index];
  const n = list.length;
  const go = (d: number) => onIndex((index + d + n) % n);
  // 지금 것과 앞뒤 한 장씩만 읽어 둠 (넘길 때 바로 보이게)
  const near = [list[index], list[(index + 1) % n], list[(index - 1 + n) % n]];
  const urls = useImageUrls(near);
  const [name, setName] = useState(m.name);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setName(m.name);
    setCopied(false);
  }, [m.id, m.name]);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "ArrowRight") goRef.current(1);
      else if (e.key === "ArrowLeft") goRef.current(-1);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  const touch = useRef<number | null>(null);
  const saveName = () => {
    if (name.trim() && name !== m.name) void renameImage(m.id, name.trim());
  };
  const remove = async () => {
    if (!confirm(`'${m.name}' 이미지를 삭제할까요?`)) return;
    if (n <= 1) onClose();
    else onIndex(index < n - 1 ? index + 1 : index - 1); // 지우기 전에 옆 이미지로 옮겨 둠
    await deleteImages([m.id]);
  };
  const url = urls[m.id];
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-label="이미지 크게 보기"
      onClick={onClose}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const x0 = touch.current;
        touch.current = null;
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="font-mono text-xs text-white/70">{index + 1} / {n}</span>
        <input className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-sm outline-none focus:bg-white/20" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="이미지 이름" title="AI가 이 이름으로 그림을 부릅니다" />
        <select className="rounded bg-white/10 px-1 py-1 text-xs" value={m.kind} onChange={(e) => void renameImage(m.id, m.name, e.target.value as ImageMeta["kind"])} aria-label="이미지 종류">
          {(Object.keys(KIND_LABEL) as ImageMeta["kind"][]).map((k) => <option key={k} value={k} className="text-black">{KIND_LABEL[k]}</option>)}
        </select>
        <button className="rounded px-2 py-1 hover:bg-white/10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        <button className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 px-3 py-6 text-2xl hover:bg-white/25 sm:left-3" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="이전 이미지">‹</button>
        <div className="flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {!url ? (
            <span className="text-white/60">불러오는 중…</span>
          ) : isVideo(m) ? (
            <video key={m.id} src={url} controls autoPlay loop playsInline className="max-h-[calc(100dvh-8rem)] max-w-full" />
          ) : isAudio(m) ? (
            <div className="space-y-3 text-center"><div className="text-6xl">🎵</div><audio key={m.id} src={url} controls autoPlay /></div>
          ) : (
            <img src={url} alt={m.name} className="max-h-[calc(100dvh-8rem)] max-w-full select-none object-contain" draggable={false} />
          )}
        </div>
        <button className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 px-3 py-6 text-2xl hover:bg-white/25 sm:right-3" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="다음 이미지">›</button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-xs" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/60">{KIND_LABEL[m.kind]} · {m.mime.replace(/^\w+\//, "")} · {fmt(m.size)}</span>
        <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => { void navigator.clipboard?.writeText(tagOf(m)); setCopied(true); }} title="본문·설정에 이 그림을 넣는 태그">{copied ? "복사됨 ✓" : `태그 복사 ${tagOf(m)}`}</button>
        <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => void downloadOne(m)}>⬇ 내려받기</button>
        <button className="rounded bg-rose-500/30 px-2 py-1 hover:bg-rose-500/50" onClick={() => void remove()}>삭제</button>
        <span className="hidden text-white/40 sm:inline">← → 넘기기 · Esc 닫기</span>
      </div>
    </div>,
    document.body,
  );
}
