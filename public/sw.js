/* Novel Generator 서비스 워커: 오프라인 실행용 캐시
 * - 같은 출처의 GET 요청만 다룸. AI·GitHub API 등 다른 출처 요청은 절대 가로채지 않음
 * - 페이지(HTML): 네트워크 우선(최신 버전) → 실패·지연 시 캐시
 * - 아이콘·매니페스트: 캐시 우선 */
const CACHE = "novel-generator-v1";
const CORE = ["./", "./manifest.webmanifest", "./favicon.svg", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await Promise.race([fetch(req), timeout(5000)]);
          if (res.ok) await cache.put("./", res.clone());
          return res;
        } catch {
          return (await cache.match("./")) || (await cache.match(req)) || Response.error();
        }
      })(),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }),
    ),
  );
});
