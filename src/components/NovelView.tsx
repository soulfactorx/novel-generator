import { useEffect, useRef, useState, type ReactNode } from "react";
import { downloadBlob, novelToEpub, novelToTxt, safeFileName, type ExportImages } from "../lib/exporters";
import { charCount, EPISODE_LENGTHS, episodeLength } from "../lib/novel";
import { uid } from "../lib/id";
import DiagnosisDialog from "./DiagnosisDialog";
import { formatUsd } from "../lib/pricing";
import { contextFor, loadImageData, novelCbs, novelPoolFor, deleteLastEpisode, diagnoseEpisode, dismissNovelError, getState, editEpisode, generateOutline, stopNovel, updateNovel, updateSettings, useApp, writeEpisode, writeEpisodes } from "../lib/store";
import type { EpisodeLength, Novel } from "../lib/types";
import type { NovelError, NovelLive } from "../lib/store";
import CastPicker from "./CastPicker";
import { RoomModules } from "./ModulePicker";
import CoverPanel from "./CoverPanel";
import RisuText from "./RisuText";
import { htmlToBlocks, imagePool, novelPool, renderRisu, type ImagePool } from "../lib/images";

type Tab = "plan" | "outline" | "manuscript";

export default function NovelView({ onMenu, onOpenLibrary, onOpenSettings }: { onMenu: () => void; onOpenLibrary: () => void; onOpenSettings: (tab?: string) => void }) {
  const novel = useApp((s) => (s.activeNovelId ? s.novels[s.activeNovelId] : null));
  const live = useApp((s) => s.novelLive);
  const error = useApp((s) => s.novelError);
  const width = useApp((s) => s.settings.readWidth);
  const [tab, setTab] = useState<Tab>("plan");
  const [reading, setReading] = useState<number | null>(null);
  const novelId = novel?.id;
  useEffect(() => {
    // 소설을 바꾸면 진행 단계에 맞는 탭으로
    const n = novelId ? getState().novels[novelId] : null;
    setReading(null);
    setTab(!n ? "plan" : n.episodes.length ? "manuscript" : n.outline.length ? "outline" : "plan");
  }, [novelId]);

  if (!novel)
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-stone-200 px-2 dark:border-stone-800">
          <button className="btn-ghost px-2 md:hidden" onClick={onMenu} aria-label="메뉴">☰</button>
          <span className="font-bold">소설</span>
        </header>
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm space-y-3">
            <div className="text-4xl">📖</div>
            <p className="font-bold">AI와 함께 연재 소설을 써 보세요</p>
            <p className="hint">기획을 적으면 AI가 회차별 개요를 짜고, 한 화씩(또는 끝까지 연속으로) 원고를 씁니다. 완성된 소설은 TXT·EPUB으로 내보낼 수 있습니다.</p>
            <p className="hint">왼쪽 메뉴의 [+ 새 소설]로 시작하세요.</p>
          </div>
        </div>
      </div>
    );

  const mine = live?.novelId === novel.id ? live : null;
  const tabs: [Tab, string][] = [["plan", "기획"], ["outline", `개요 ${novel.outline.length}`], ["manuscript", `원고 ${novel.episodes.length}/${novel.episodeCount}`]];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 px-2 dark:border-stone-800">
        <button className="btn-ghost px-2 md:hidden" onClick={onMenu} aria-label="메뉴">☰</button>
        <input className="min-w-0 flex-1 bg-transparent px-1 font-bold outline-none" value={novel.title} placeholder="제목 없는 소설" onChange={(e) => updateNovel(novel.id, { title: e.target.value })} aria-label="소설 제목" />
        <ExportMenu novel={novel} />
      </header>
      <div className="flex shrink-0 gap-1 border-b border-stone-200 px-2 py-1.5 dark:border-stone-800">
        {tabs.map(([id, label]) => (
          <button key={id} className={`btn flex-1 py-1.5 ${tab === id ? "bg-violet-600 text-white" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`} onClick={() => { setTab(id); setReading(null); }}>{label}</button>
        ))}
      </div>
      {mine && tab !== (mine.task === "outline" ? "outline" : "manuscript") && (
        <button className="flex items-center gap-2 bg-violet-50 px-4 py-1.5 text-left text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" onClick={() => setTab(mine.task === "outline" ? "outline" : "manuscript")}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" /> {mine.task === "outline" ? "개요 작성 중…" : `${mine.index + 1}화 집필 중…`} (보기)
        </button>
      )}
      {error?.novelId === novel.id && <NovelErrorBox error={error} busy={!!live} onOutline={() => setTab("outline")} />}
      <div className="flex-1 overflow-y-auto">
        <div className={`content-width mx-auto px-4 py-5 lg:px-8 cw-${width}`}>
          {tab === "plan" && <PlanTab novel={novel} onOpenLibrary={onOpenLibrary} onNext={() => setTab("outline")} />}
          {tab === "outline" && <OutlineTab novel={novel} live={mine?.task === "outline" ? mine : null} busy={!!live} onWrite={() => setTab("manuscript")} />}
          {tab === "manuscript" &&
            (reading !== null && novel.episodes[reading] ? (
              <Reader novel={novel} index={reading} busy={!!live} onIndex={setReading} onClose={() => setReading(null)} />
            ) : (
              <ManuscriptTab novel={novel} live={mine?.task === "episode" ? mine : null} busy={!!live} onRead={setReading} onOutline={() => setTab("outline")} onOpenSettings={onOpenSettings} />
            ))}
        </div>
      </div>
    </div>
  );
}

function F({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

function PlanTab({ novel: n, onOpenLibrary, onNext }: { novel: Novel; onOpenLibrary: () => void; onNext: () => void }) {
  const up = (p: Partial<Novel>) => updateNovel(n.id, p);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="장르"><input className="input" value={n.genre} onChange={(e) => up({ genre: e.target.value })} placeholder="예) 현대 판타지, 로맨스, 미스터리" aria-label="장르" /></F>
        <F label="지은이 (내보내기에 표시)"><input className="input" value={n.author} onChange={(e) => up({ author: e.target.value })} aria-label="지은이" /></F>
      </div>
      <F label="기획 · 시놉시스" hint="어떤 이야기인지, 꼭 넣고 싶은 장면, 결말 방향, 분위기 등을 자유롭게 적으세요. 구체적일수록 개요가 좋아집니다.">
        <textarea className="input min-h-44" value={n.brief} onChange={(e) => up({ brief: e.target.value })} placeholder={"예) 비가 그치지 않는 항구 도시. 신입 조사관 도윤이 밀수 사건을 쫓다 조합의 비밀에 다가간다.\n- 감찰관 서율과는 처음엔 대립, 점점 신뢰\n- 중반에 도윤의 과거와 사건이 연결되는 반전\n- 결말은 씁쓸하지만 희망적으로"} aria-label="기획" />
      </F>
      <CastPicker value={{ worldId: n.worldId, characterIds: n.characterIds, personaId: n.personaId }} onChange={(c) => up(c)} onOpenLibrary={onOpenLibrary} personaLabel="🙋 주인공" />
      <RoomModules characterIds={n.characterIds} worldId={n.worldId} moduleIds={n.moduleIds ?? []} offModules={n.offModules ?? []} onChange={(m) => up(m)} where="소설" />
      <div className="grid gap-3 sm:grid-cols-2">
        <F label={`목표 회차 수: ${n.episodeCount}화`}>
          <input type="range" min={1} max={50} value={Math.min(50, n.episodeCount)} onChange={(e) => up({ episodeCount: Number(e.target.value) })} className="w-full accent-violet-600" aria-label="회차 수" />
        </F>
        <F label="회차당 분량">
          <select className="input" value={n.episodeLength} onChange={(e) => up({ episodeLength: e.target.value as EpisodeLength })} aria-label="회차 분량">
            {EPISODE_LENGTHS.map((k) => <option key={k} value={k}>{episodeLength(k).label}</option>)}
          </select>
        </F>
      </div>
      <p className="hint">문체(시점·전개 속도·대사 비중)와 콘텐츠 수위는 [⚙️ 설정]의 값을 따릅니다.</p>
      <CoverPanel novel={n} />
      <button className="btn-primary" onClick={onNext}>다음: 개요 →</button>
    </div>
  );
}

function OutlineTab({ novel: n, live, busy, onWrite }: { novel: Novel; live: NovelLive | null; busy: boolean; onWrite: () => void }) {
  const written = n.episodes.length;
  const setItem = (i: number, p: { title?: string; summary?: string }) => updateNovel(n.id, { outline: n.outline.map((o, k) => (k === i ? { ...o, ...p } : o)) });
  const canMake = !!(n.brief.trim() || n.worldId || n.characterIds.length);
  if (live) return <OutlineProgress live={live} />;
  return (
    <div className="space-y-4">
      {n.outline.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm">기획을 바탕으로 {n.episodeCount}화 분량의 회차별 개요를 만듭니다.</p>
          {!canMake && <p className="hint">먼저 [기획]에 시놉시스를 적거나 세계관·인물을 골라 주세요.</p>}
          <button className="btn-primary" disabled={busy || !canMake} onClick={() => void generateOutline(n.id, 0)}>✨ AI로 개요 만들기</button>
          <p className="hint">직접 쓰려면 아래 [+ 회차 추가]를 누르세요.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost border border-stone-300 dark:border-stone-700" disabled={busy} onClick={() => confirm(written ? `이미 쓴 ${written}화까지는 유지하고, ${written + 1}화부터 개요를 다시 짤까요?` : "개요 전체를 다시 만들까요? 직접 고친 내용도 바뀝니다.") && void generateOutline(n.id, written)}>
            ↻ {written ? `${written + 1}화부터 다시 짜기` : "전체 다시 만들기"}
          </button>
          {n.outline.length < n.episodeCount && <button className="btn-ghost border border-stone-300 dark:border-stone-700" disabled={busy} onClick={() => void generateOutline(n.id, n.outline.length)}>✨ {n.outline.length + 1}~{n.episodeCount}화 개요 이어 만들기</button>}
          <button className="btn-primary ml-auto" onClick={onWrite}>원고 쓰기 →</button>
        </div>
      )}
      <ol className="space-y-3">
        {n.outline.map((o, i) => (
          <li key={o.id} className={`card space-y-2 ${i < written ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-bold text-violet-600">{i + 1}화</span>
              <input className="input py-1 font-semibold" value={o.title} onChange={(e) => setItem(i, { title: e.target.value })} aria-label={`${i + 1}화 제목`} />
              {i < written ? <span className="shrink-0 text-xs text-emerald-600">✓ 집필됨</span> : <button className="btn-danger shrink-0 px-2 py-1 text-xs" onClick={() => updateNovel(n.id, { outline: n.outline.filter((_, k) => k !== i) })} aria-label={`${i + 1}화 개요 삭제`}>✕</button>}
            </div>
            <textarea className="input min-h-16 text-sm" value={o.summary} onChange={(e) => setItem(i, { summary: e.target.value })} aria-label={`${i + 1}화 개요`} />
          </li>
        ))}
      </ol>
      <button className="btn-ghost text-sm" onClick={() => updateNovel(n.id, { outline: [...n.outline, { id: uid("o"), title: `${n.outline.length + 1}화`, summary: "" }], episodeCount: Math.max(n.episodeCount, n.outline.length + 1) })}>+ 회차 추가</button>
    </div>
  );
}

/** 지난 시간 (1초마다 갱신) */
function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - since) / 1000));
}
const secText = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`);

const OUTLINE_STEPS = ["설정 정리 중", "AI에게 요청 보내는 중", "AI가 구상하는 중", "개요 받는 중", "개요 읽는 중", "개요 저장 중"];

/** 개요 만들기 진행 상황: 단계 · 받은 회차 수 · 지난 시간 · 받는 글 */
function OutlineProgress({ live }: { live: NovelLive }) {
  const sec = useElapsed(live.startedAt);
  const total = live.total ?? 0, done = live.done ?? 0;
  const at = Math.max(0, OUTLINE_STEPS.indexOf(live.stage ?? ""));
  // 받는 중이면 회차 수로, 그 전에는 단계로 진행률을 어림한다
  const pct = live.stage === "개요 받는 중" && total ? 15 + Math.round((done / total) * 80) : at >= 4 ? 97 : [3, 8, 12][at] ?? 10;
  return (
    <div className="space-y-3">
      <div className="card space-y-2" role="progressbar" aria-valuenow={pct} aria-label="개요 만들기 진행률">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300" aria-live="polite">
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
          <span className="flex-1">{live.index ? `${live.index + 1}화부터 ` : ""}개요 만드는 중 · {live.stage}{live.stage === "개요 받는 중" && total ? ` (${done} / ${total}화)` : ""}</span>
          <span className="text-xs font-normal text-stone-500">{secText(sec)}</span>
          <button className="btn-danger border border-rose-300 px-2 py-1 text-xs" onClick={stopNovel}>■ 중단</button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div className="h-full rounded-full bg-violet-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {OUTLINE_STEPS.map((st, i) => (
            <li key={st} className={i < at ? "text-emerald-600" : i === at ? "font-semibold text-violet-700 dark:text-violet-300" : "text-stone-400"}>{i < at ? "✓" : i === at ? "▶" : "·"} {st}</li>
          ))}
        </ol>
        {live.status && <p className="text-xs text-amber-700 dark:text-amber-300">ℹ️ {live.status}</p>}
        {!live.text && sec >= 30 && <p className="hint">설정이 많은 봇은 AI가 읽고 구상하는 데 시간이 걸립니다. 조금만 기다려 주세요.</p>}
      </div>
      {live.thinking && !live.text && <div className="line-clamp-4 text-xs italic text-stone-500">💭 {live.thinking.slice(-400)}</div>}
      {live.text && <pre className="whitespace-pre-wrap font-sans text-sm text-stone-600 dark:text-stone-300">{live.text}</pre>}
    </div>
  );
}

/** 소설 작업 오류: 무엇을 하다가, 왜, 어떻게 하면 되는지 + AI가 보낸 응답 */
function NovelErrorBox({ error: e, busy, onOutline }: { error: NovelError; busy: boolean; onOutline: () => void }) {
  const [open, setOpen] = useState(false);
  const partial = e.task === "outline" && e.message.includes("만 받았습니다");
  const facts = [
    e.stage && `단계: ${e.stage}`,
    e.model && `모델: ${e.model}`,
    e.stopReason && `끝난 이유: ${STOP_TEXT[e.stopReason] ?? e.stopReason}`,
    e.elapsed !== undefined && `걸린 시간: ${secText(Math.round(e.elapsed / 1000))}`,
    e.raw !== undefined && `받은 응답: ${e.raw.length.toLocaleString()}자`,
  ].filter(Boolean) as string[];
  return (
    <div className={`space-y-1 px-4 py-2 text-sm ${partial ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"}`} role="alert">
      <div className="flex items-start gap-2">
        <span className="flex-1 break-words font-semibold">⚠️ {e.task === "outline" ? "개요 만들기" : e.task === "episode" ? "원고 쓰기" : "작업"}{partial ? "" : " 실패"}: {e.message}</span>
        <button className="text-xs underline" onClick={dismissNovelError}>닫기</button>
      </div>
      {e.hint && <p className="text-xs">💡 {e.hint}</p>}
      {facts.length > 0 && <p className="text-xs opacity-80">{facts.join(" · ")}</p>}
      <div className="flex flex-wrap gap-2 text-xs">
        {(e.raw || e.thinking) && <button className="underline" onClick={() => setOpen((v) => !v)}>{open ? "AI 응답 접기" : "AI가 보낸 응답 보기"}</button>}
        {e.task === "outline" && !partial && <button className="underline" disabled={busy} onClick={() => { onOutline(); void generateOutline(e.novelId, e.index ?? 0); }}>↻ 다시 시도</button>}
      </div>
      {open && (
        <div className="space-y-2">
          {e.thinking && <details><summary className="cursor-pointer text-xs">💭 AI의 생각 ({e.thinking.length.toLocaleString()}자)</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-xs text-stone-700 dark:bg-black/30 dark:text-stone-300">{e.thinking}</pre></details>}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-xs text-stone-700 dark:bg-black/30 dark:text-stone-300">{e.raw || "(본문 없음)"}</pre>
        </div>
      )}
    </div>
  );
}
const STOP_TEXT: Record<string, string> = { max_tokens: "길이 한도", length: "길이 한도", MAX_TOKENS: "길이 한도", end_turn: "정상 종료", stop: "정상 종료", STOP: "정상 종료", SAFETY: "안전 정책", refusal: "거부" };

function LiveHeader({ label, live }: { label: string; live: { text: string; status: string; thinking: string } }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-violet-600" aria-live="polite">
      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
      <span className="flex-1">{label} · {live.status || (live.text ? `${charCount(live.text).toLocaleString()}자` : live.thinking ? "구상하는 중…" : "응답 기다리는 중…")}</span>
      <button className="btn-danger border border-rose-300 px-2 py-1 text-xs" onClick={stopNovel}>■ 중단</button>
    </div>
  );
}

function ManuscriptTab({ novel: n, live, busy, onRead, onOutline, onOpenSettings }: { novel: Novel; live: { text: string; status: string; thinking: string; index: number; until?: number } | null; busy: boolean; onRead: (i: number) => void; onOutline: () => void; onOpenSettings: (t?: string) => void }) {
  const settings = useApp((s) => s.settings);
  const endRef = useRef<HTMLDivElement>(null);
  const next = n.episodes.length;
  const total = n.episodes.reduce((a, e) => a + charCount(e.text), 0);
  const hasKey = settings.provider === "openai" ? !!settings.keys.openai || /localhost|127\.0\.0\.1/.test(settings.openaiBaseUrl) : !!settings.keys[settings.provider];
  const lastIdx = Math.min(n.outline.length, n.episodeCount) - 1;
  useEffect(() => { if (live?.text) endRef.current?.scrollIntoView?.({ block: "end" }); }, [live?.text]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{n.episodes.length}/{n.episodeCount}화</span>
        <span className="hint">· 총 {total.toLocaleString()}자</span>
      </div>
      {n.outline.length === 0 && <div className="card text-sm">먼저 개요가 필요합니다. <button className="btn-primary ml-2" onClick={onOutline}>개요 만들기</button></div>}
      <ol className="space-y-1">
        {n.episodes.map((e, i) => (
          <li key={e.id}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-stone-200/70 dark:hover:bg-stone-800" onClick={() => onRead(i)}>
              <span className="w-10 shrink-0 text-sm font-bold text-violet-600">{i + 1}화</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.title}</span>
              {e.incomplete && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">미완성</span>}
              <span className="shrink-0 text-xs text-stone-500">{charCount(e.text).toLocaleString()}자{e.usage?.usd !== undefined && ` · ${formatUsd(e.usage.usd)}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {live ? (
        <div className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <LiveHeader label={`${live.index + 1}화 「${n.outline[live.index]?.title ?? ""}」 집필 중${live.until !== undefined && live.until > live.index ? ` (${live.until + 1}화까지 연속)` : ""}`} live={live} />
          {live.text ? <RisuText text={live.text} pool={novelPoolFor(n)} cbs={novelCbs(n)} /> : live.thinking && <div className="line-clamp-4 text-xs italic text-stone-500">{live.thinking.slice(-400)}</div>}
          <div ref={endRef} />
        </div>
      ) : (
        next <= lastIdx && (
          <div className="card space-y-3">
            <div className="text-sm"><b>다음: {next + 1}화 「{n.outline[next].title}」</b><p className="hint mt-1 line-clamp-3">{n.outline[next].summary}</p></div>
            {!hasKey && <button className="btn-ghost border border-stone-300 text-sm dark:border-stone-700" onClick={() => onOpenSettings("ai")}>먼저 AI 연결 설정하기</button>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy || !hasKey} onClick={() => void writeEpisode(n.id, next)}>✒️ {next + 1}화 쓰기</button>
              {lastIdx > next && <button className="btn-ghost border border-stone-300 dark:border-stone-700" disabled={busy || !hasKey} onClick={() => confirm(`${next + 1}화부터 ${lastIdx + 1}화까지 ${lastIdx - next + 1}개 회차를 연속으로 씁니다. 언제든 중단할 수 있습니다. 진행할까요?`) && void writeEpisodes(n.id, lastIdx)}>⏩ {lastIdx + 1}화까지 연속 집필</button>}
            </div>
            <p className="hint">회차당 {episodeLength(n.episodeLength).label} · 집필 중에는 화면이 자동으로 꺼지지 않게 유지합니다. 다른 앱으로 전환하면 생성이 끊길 수 있습니다.</p>
          </div>
        )
      )}
      {!live && n.outline.length > 0 && next > lastIdx && next < n.episodeCount && <div className="card text-sm">{next + 1}화의 개요가 아직 없습니다. <button className="btn-primary ml-2" onClick={onOutline}>개요 이어 만들기</button></div>}
      {!live && n.episodes.length >= n.episodeCount && n.episodeCount > 0 && <div className="card text-center text-sm">🎉 목표한 {n.episodeCount}화를 모두 썼습니다. 오른쪽 위 [내보내기]로 TXT·EPUB 파일을 만들 수 있습니다. 더 이어 가려면 [기획]에서 회차 수를 늘리세요.</div>}
    </div>
  );
}

function Reader({ novel: n, index, busy, onIndex, onClose }: { novel: Novel; index: number; busy: boolean; onIndex: (i: number) => void; onClose: () => void }) {
  const e = n.episodes[index];
  const fontSize = useApp((s) => s.settings.readerFontSize);
  const lib = useApp((s) => s.library);
  const images = useApp((s) => s.images);
  const scriptsOn = useApp((s) => s.settings.risu.scripts);
  const pool = novelPool(imagePool(contextFor(n, lib), images, scriptsOn));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.text);
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [diag, setDiag] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setEditing(false); setRewrite(null); setDraft(e.text); topRef.current?.scrollIntoView?.(); }, [index, e.text]);
  const isLast = index === n.episodes.length - 1;
  return (
    <div className="space-y-4">
      <div ref={topRef} className="flex flex-wrap items-center gap-1">
        <button className="btn-ghost px-2 text-sm" onClick={onClose}>← 목록</button>
        <select className="input w-auto max-w-56 py-1 text-sm" value={index} onChange={(x) => onIndex(Number(x.target.value))} aria-label="회차 선택">
          {n.episodes.map((x, i) => <option key={x.id} value={i}>{i + 1}화 {x.title}</option>)}
        </select>
        <span className="ml-auto flex items-center gap-1">
          <button className="btn-ghost px-2 text-sm" onClick={() => updateSettings({ readerFontSize: fontSize - 1 })} aria-label="글자 작게">가-</button>
          <button className="btn-ghost px-2 text-base" onClick={() => updateSettings({ readerFontSize: fontSize + 1 })} aria-label="글자 크게">가+</button>
        </span>
      </div>
      <h2 className="text-center text-xl font-bold">{index + 1}화 · {e.title}</h2>
      {e.incomplete && <p className="rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">끝까지 쓰지 못한 회차입니다. 직접 마무리하거나 [다시 쓰기]를 눌러 주세요.</p>}
      {editing ? (
        <div className="space-y-2">
          <textarea className="input story min-h-[60vh]" style={{ fontSize }} value={draft} onChange={(x) => setDraft(x.target.value)} aria-label="원고 편집" />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => { setDraft(e.text); setEditing(false); }}>취소</button>
            <button className="btn-primary" onClick={() => { editEpisode(n.id, index, { text: draft.trim(), incomplete: false }); setEditing(false); }}>저장</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize }}><RisuText text={e.text} pool={pool} cbs={novelCbs(n)} /></div>
      )}
      {diag && <DiagnosisDialog title={`🩺 ${index + 1}화 진단`} run={(onText) => diagnoseEpisode(n.id, index, onText)} applyLabel="진단 반영해 다시 쓰기" canApply={!busy} onApply={(d) => setRewrite(d)} onClose={() => setDiag(false)} />}
      {e.summary && !editing && <details className="hint"><summary className="cursor-pointer">이 회차 요약 (다음 회차 집필에 사용)</summary><textarea className="input mt-2 min-h-20 text-xs" value={e.summary} onChange={(x) => editEpisode(n.id, index, { summary: x.target.value })} aria-label="회차 요약" /></details>}
      {rewrite !== null && (
        <div className="card space-y-2">
          <label className="label" htmlFor="rw-note">다시 쓸 때 반영할 요청 (선택)</label>
          <textarea id="rw-note" className="input min-h-20" value={rewrite} onChange={(x) => setRewrite(x.target.value)} placeholder="예) 대화를 더 늘리고, 마지막 장면의 긴장감을 높여 줘." />
          <p className="hint">{isLast ? "현재 원고는 새 원고로 바뀝니다." : "이 회차만 바뀝니다. 다음 회차들과 내용이 어긋날 수 있습니다."}</p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setRewrite(null)}>취소</button>
            <button className="btn-primary" disabled={busy} onClick={() => { const note = rewrite; setRewrite(null); onClose(); void writeEpisode(n.id, index, note); }}>다시 쓰기</button>
          </div>
        </div>
      )}
      {!editing && rewrite === null && (
        <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <button className="btn-ghost" disabled={index === 0} onClick={() => onIndex(index - 1)}>← 이전 화</button>
          <button className="btn-ghost" onClick={() => setEditing(true)}>✏️ 편집</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setRewrite("")}>↻ 다시 쓰기</button>
          <button className="btn-ghost" onClick={() => setDiag(true)}>🩺 진단</button>
          {isLast && <button className="btn-danger" onClick={() => { if (confirm(`${index + 1}화 원고를 삭제할까요? 개요는 남습니다.`)) { deleteLastEpisode(n.id); onClose(); } }}>삭제</button>}
          <button className="btn-ghost ml-auto" disabled={isLast} onClick={() => onIndex(index + 1)}>다음 화 →</button>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ novel: n }: { novel: Novel }) {
  const [open, setOpen] = useState(false);
  const has = n.episodes.some((e) => e.text.trim());
  const name = safeFileName(n.title);
  return (
    <div className="relative">
      <button className="btn-ghost px-2 text-xs" disabled={!has} onClick={() => setOpen(!open)} title={has ? "내보내기" : "아직 쓴 회차가 없습니다"}>⬇ 내보내기</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => { setOpen(false); void exportImages(novelPoolFor(n), n).then((ex) => downloadBlob(`${name}.epub`, novelToEpub(n, new Date(), ex) as BlobPart, "application/epub+zip")); }}>📚 EPUB (전자책)</button>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => { setOpen(false); void exportImages(novelPoolFor(n), n, false).then((ex) => downloadBlob(`${name}.txt`, novelToTxt(n, ex), "text/plain;charset=utf-8")); }}>📄 TXT (텍스트)</button>
          </div>
        </>
      )}
    </div>
  );
}

/** 내보내기용: 봇의 표시 스크립트·그림 표시를 반영해 문단·그림으로 나누고, 쓰인 그림의 바이트를 읽는다 */
async function exportImages(pool: ImagePool, n: Novel, withBytes = true): Promise<ExportImages | undefined> {
  if (!pool.assets.length && !pool.emotions.length && !pool.scripts.length) return undefined;
  const ids = new Set<string>();
  const cbs = novelCbs(n);
  n.episodes.forEach((e) => renderRisu(e.text, pool, cbs).ids.forEach((id) => ids.add(id)));
  const images: ExportImages["images"] = {};
  const metas = getState().images;
  if (withBytes)
    for (const id of ids) {
      const bytes = await loadImageData(id).catch(() => null);
      if (bytes && metas[id]) images[id] = { bytes, mime: metas[id].mime };
    }
  return { blocks: (text) => htmlToBlocks(renderRisu(text, pool, cbs).html), images };
}
