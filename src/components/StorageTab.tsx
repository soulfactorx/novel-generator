import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteImageData, listKV, scanImageData } from "../lib/db";
import { clearAiButtons, clearGlobals, deleteEntity, deleteImages, deleteNovel, deleteRoom, getState, requestPersistNow, resetAllData, useApp } from "../lib/store";
import { resetUiMemory } from "../lib/uiMemory";

const fmt = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)}GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(0)}KB` : `${n}B`);
const sizeOf = (v: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? "").length;
  } catch {
    return 0;
  }
};
const KV_LABEL: Record<string, string> = { settings: "설정", usage: "사용량 기록", view: "마지막 화면", sync: "동기화 연결", syncMeta: "동기화 기록", risuGlobals: "봇 전역 변수 · 토글 값", legacyExtra: "가져온 옛 백업 (라이브러리로 옮기기 전)" };
const LS_LABEL: Record<string, string> = { risuUiState: "봇 화면 상태 (탭 접기 등)", botAiButtons: "AI를 부르는 봇 버튼 기억 (✨AI 표시)" };

/** 설정 → 저장소: 이 브라우저에 저장된 데이터 확인 · 정리 */
export default function StorageTab() {
  const rooms = useApp((x) => x.rooms);
  const novels = useApp((x) => x.novels);
  const library = useApp((x) => x.library);
  const images = useApp((x) => x.images);
  const globals = useApp((x) => x.globals);
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const [kv, setKv] = useState<{ key: string; size: number }[]>([]);
  const [scan, setScan] = useState<{ total: number; orphanIds: string[]; orphanSize: number } | null>(null);
  const [ls, setLs] = useState<{ key: string; size: number }[]>([]);
  const [cacheNames, setCacheNames] = useState<string[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setEst({ usage: e?.usage, quota: e?.quota, persisted });
    } catch {
      setEst({});
    }
    setKv(await listKV().catch(() => []));
    setScan(await scanImageData(new Set(Object.keys(getState().images))).catch(() => null));
    try {
      setLs(Object.keys(localStorage).map((k) => ({ key: k, size: (localStorage.getItem(k) ?? "").length * 2 })));
    } catch {
      setLs([]);
    }
    setCacheNames(await (globalThis.caches?.keys?.() ?? Promise.resolve([])).catch(() => []));
  }, []);
  useEffect(() => void refresh(), [refresh, images]);

  const imgList = Object.values(images);
  const imgBytes = imgList.reduce((a, m) => a + (m.size || 0), 0);
  const orphanMeta = imgList.filter((m) => !library[m.ownerId]);
  const lib = Object.values(library);
  const sections = useMemo(
    () => [
      { label: "이야기", count: Object.keys(rooms).length, size: sizeOf(Object.values(rooms)) },
      { label: "소설", count: Object.keys(novels).length, size: sizeOf(Object.values(novels)) },
      { label: "라이브러리 (세계관·인물·주인공·패키지)", count: lib.length, size: sizeOf(lib) },
      { label: "이미지 · 소리 · 영상", count: imgList.length, size: scan?.total ?? imgBytes },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, novels, library, images, scan],
  );
  // 용량이 큰 항목 (이미지는 주인 항목에 합산)
  const big = useMemo(() => {
    const imgBy = new Map<string, number>();
    for (const m of imgList) imgBy.set(m.ownerId, (imgBy.get(m.ownerId) ?? 0) + (m.size || 0));
    const all = [
      ...Object.values(rooms).map((r) => ({ id: r.id, type: "room" as const, name: `💬 ${r.title}`, size: sizeOf(r) })),
      ...Object.values(novels).map((n) => ({ id: n.id, type: "novel" as const, name: `📖 ${n.title || "(제목 없음)"}`, size: sizeOf(n) })),
      ...lib.map((e) => ({ id: e.id, type: "entity" as const, name: `${e.kind === "world" ? "🌍" : e.kind === "character" ? "🎭" : "🙋"} ${e.name}`, size: sizeOf(e) + (imgBy.get(e.id) ?? 0) })),
    ];
    return all.sort((a, b) => b.size - a.size).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, novels, library, images]);

  const remove = (b: (typeof big)[number]) => {
    if (!confirm(`'${b.name.slice(2).trim()}'을(를) 삭제할까요? (${fmt(b.size)})${b.type === "entity" ? "\n이 항목의 이미지도 함께 지워집니다." : ""}`)) return;
    if (b.type === "room") deleteRoom(b.id);
    else if (b.type === "novel") deleteNovel(b.id);
    else deleteEntity(b.id);
  };
  const cleanOrphans = async () => {
    const n = orphanMeta.length + (scan?.orphanIds.length ?? 0);
    if (!n || !confirm(`쓰이지 않는 이미지 ${n}개를 지울까요?`)) return;
    if (orphanMeta.length) await deleteImages(orphanMeta.map((m) => m.id));
    if (scan?.orphanIds.length) await deleteImageData(scan.orphanIds);
    setMsg(`✅ 쓰이지 않는 이미지 ${n}개를 지웠습니다.`);
    void refresh();
  };
  const removeLs = (k: string) => {
    if (!confirm(`브라우저 저장소 항목 '${k}'을(를) 지울까요?`)) return;
    try {
      localStorage.removeItem(k);
    } catch {
      /* 무시 */
    }
    if (k === "risuUiState") resetUiMemory();
    if (k === "botAiButtons") clearAiButtons();
    void refresh();
  };
  const reset = () => {
    const word = prompt("이 브라우저에 저장된 이 앱의 모든 데이터(이야기·소설·라이브러리·이미지·설정·API 키)를 지웁니다. 되돌릴 수 없습니다.\n먼저 [데이터]에서 백업하세요.\n\n계속하려면 '초기화'라고 입력하세요.");
    if (word?.trim() === "초기화") void resetAllData();
  };

  const pct = est?.usage && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : null;
  return (
    <div className="space-y-5 text-sm">
      <section className="card space-y-2">
        <div className="font-bold">브라우저 저장 공간</div>
        {est?.usage !== undefined ? (
          <>
            <div className="flex justify-between"><span>사용 중</span><span className="font-mono">{fmt(est.usage)}{est.quota ? ` / ${fmt(est.quota)}` : ""}</span></div>
            {pct !== null && <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div className={`h-full ${pct > 80 ? "bg-rose-500" : "bg-violet-500"}`} style={{ width: `${Math.max(1, pct)}%` }} /></div>}
          </>
        ) : (
          <p className="hint">이 브라우저는 사용량을 알려 주지 않습니다.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span>영구 저장: {est?.persisted ? "✅ 켜짐 (공간이 부족해도 브라우저가 지우지 않음)" : "⚠️ 꺼짐 (공간이 부족하면 브라우저가 지울 수 있음)"}</span>
          {!est?.persisted && <button className="btn-ghost text-xs" onClick={async () => { const ok = await requestPersistNow(); setMsg(ok ? "✅ 영구 저장을 켰습니다." : "브라우저가 영구 저장을 허락하지 않았습니다. 앱을 설치하거나 자주 쓰면 허락되는 경우가 많습니다."); void refresh(); }}>영구 저장 요청</button>}
          <button className="btn-ghost text-xs" onClick={() => void refresh()}>새로 고침</button>
        </div>
      </section>

      <section className="card space-y-2">
        <div className="font-bold">저장된 데이터</div>
        <table className="w-full">
          <tbody>
            {sections.map((x) => (
              <tr key={x.label} className="border-b border-stone-200/60 last:border-0 dark:border-stone-800">
                <td className="py-1">{x.label}</td>
                <td className="py-1 text-right font-mono">{x.count.toLocaleString()}개</td>
                <td className="w-24 py-1 text-right font-mono">{fmt(x.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">크기는 대략적인 값입니다. 이미지는 이 기기에만 저장되고 동기화·백업 파일에 들어가지 않습니다.</p>
      </section>

      <section className="card space-y-2">
        <div className="font-bold">용량이 큰 항목</div>
        {big.length ? (
          <ul className="space-y-1">
            {big.map((b) => (
              <li key={b.type + b.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className="font-mono text-xs">{fmt(b.size)}</span>
                <button className="btn-ghost px-2 py-0.5 text-xs text-rose-600" onClick={() => remove(b)} aria-label={`${b.name} 삭제`}>삭제</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">저장된 항목이 없습니다.</p>
        )}
      </section>

      <section className="card space-y-2">
        <div className="font-bold">정리</div>
        <Row label="쓰이지 않는 이미지" desc="지운 인물·패키지의 이미지 중 남아 있는 것" value={`${orphanMeta.length + (scan?.orphanIds.length ?? 0)}개 · ${fmt(orphanMeta.reduce((a, m) => a + m.size, 0) + (scan?.orphanSize ?? 0))}`}>
          <button className="btn-ghost text-xs" disabled={!orphanMeta.length && !scan?.orphanIds.length} onClick={() => void cleanOrphans()}>지우기</button>
        </Row>
        <Row label="봇 전역 변수 · 토글 값" desc="🎛 토글에서 고른 값 등 (모든 이야기 공통)" value={`${Object.keys(globals).length}개`}>
          <button className="btn-ghost text-xs" disabled={!Object.keys(globals).length} onClick={() => confirm("봇 전역 변수와 토글 값을 모두 지울까요? 봇 기본값으로 돌아갑니다.") && clearGlobals()}>지우기</button>
        </Row>
        <Row label="봇 화면 상태" desc="탭 접기·펼치기 등 기억해 둔 화면 상태">
          <button className="btn-ghost text-xs" onClick={() => { resetUiMemory(); setMsg("✅ 봇 화면 상태를 지웠습니다."); void refresh(); }}>지우기</button>
        </Row>
        {cacheNames.length > 0 && (
          <Row label="앱 오프라인 캐시" desc="새 버전이 바로 안 보일 때 지우면 다음에 새로 받습니다" value={`${cacheNames.length}개`}>
            <button className="btn-ghost text-xs" onClick={async () => { await Promise.all(cacheNames.map((c) => caches.delete(c))); setMsg("✅ 오프라인 캐시를 지웠습니다. 새로고침하면 최신 버전을 받습니다."); void refresh(); }}>지우기</button>
          </Row>
        )}
      </section>

      <details className="card">
        <summary className="cursor-pointer font-bold">자세히: 저장소 항목</summary>
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 font-semibold">IndexedDB 설정·기록 (kv)</div>
            <ul className="space-y-0.5 text-xs">
              {kv.map((k) => (
                <li key={k.key} className="flex gap-2"><code className="min-w-0 flex-1 truncate">{k.key}</code><span className="hint">{KV_LABEL[k.key] ?? ""}</span><span className="w-16 text-right font-mono">{fmt(k.size)}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-semibold">localStorage</div>
            <p className="hint mb-1 text-xs">같은 주소(도메인)의 다른 앱 항목이 함께 보일 수 있습니다. 모르는 항목은 지우지 마세요.</p>
            {ls.length ? (
              <ul className="space-y-0.5 text-xs">
                {ls.map((k) => (
                  <li key={k.key} className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate">{k.key}</code><span className="hint">{LS_LABEL[k.key] ?? ""}</span><span className="w-16 text-right font-mono">{fmt(k.size)}</span><button className="btn-ghost px-1.5 py-0 text-xs text-rose-600" onClick={() => removeLs(k.key)} aria-label={`${k.key} 지우기`}>✕</button></li>
                ))}
              </ul>
            ) : (
              <p className="hint text-xs">항목 없음</p>
            )}
          </div>
        </div>
      </details>

      <section className="card space-y-2 border-rose-300 dark:border-rose-900">
        <div className="font-bold text-rose-600">전체 초기화</div>
        <p className="hint">이 브라우저에 저장된 이 앱의 모든 데이터를 지우고 처음 상태로 돌아갑니다. 먼저 [데이터] 탭에서 백업하세요.</p>
        <button className="btn-danger border border-rose-300 text-xs" onClick={reset}>모든 데이터 지우기…</button>
      </section>
      {msg && <p>{msg}</p>}
    </div>
  );
}

function Row({ label, desc, value, children }: { label: string; desc: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        <div className="hint text-xs">{desc}</div>
      </div>
      {value && <span className="font-mono text-xs">{value}</span>}
      {children}
    </div>
  );
}
