import { useEffect, useSyncExternalStore } from "react";
import { getImageData } from "./db";
import type { ImageMeta } from "./types";

/** 이미지 id → blob: 주소 캐시 (필요할 때 IndexedDB에서 읽음) */
const urls = new Map<string, string>();
const loading = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  subs.forEach((f) => f());
};

export async function ensureImageUrls(metas: (ImageMeta | undefined)[]) {
  const todo = metas.filter((m): m is ImageMeta => !!m && !urls.has(m.id) && !loading.has(m.id));
  if (!todo.length) return;
  todo.forEach((m) => loading.add(m.id));
  await Promise.all(
    todo.map(async (m) => {
      try {
        const data = await getImageData(m.id);
        if (data) urls.set(m.id, URL.createObjectURL(new Blob([data as BlobPart], { type: m.mime })));
      } catch {
        /* 못 읽은 그림은 표시하지 않음 */
      } finally {
        loading.delete(m.id);
      }
    }),
  );
  bump();
}
export function forgetImageUrl(id: string) {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
}

/** 컴포넌트에서: 주어진 이미지들의 주소 (아직 못 읽은 것은 빠져 있음) */
export function useImageUrls(metas: (ImageMeta | undefined)[]): Record<string, string> {
  useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => version);
  const key = metas.map((m) => m?.id ?? "").join(",");
  useEffect(() => {
    void ensureImageUrls(metas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out: Record<string, string> = {};
  for (const m of metas) if (m && urls.has(m.id)) out[m.id] = urls.get(m.id)!;
  return out;
}
