import { vi } from "vitest";

export function sseResponse(chunks: string[], init: ResponseInit = {}) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
}
export const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

/** fetch 모의: 호출 기록 + 순서대로 응답 */
export function mockFetch(...responses: (Response | ((url: string, body: any) => Response))[]) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body, headers: (init.headers || {}) as Record<string, string> });
    const r = responses.shift();
    if (!r) throw new Error("unexpected fetch " + url);
    return typeof r === "function" ? r(String(url), body) : r;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export const claudeStream = (text: string, extra: { stop?: string; details?: object; model?: string } = {}) => {
  const ev = (type: string, o: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
  return sseResponse([
    ev("message_start", { message: { model: extra.model || "claude-sonnet-5-5", usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...(text ? [ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(0, 5) } }), ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(5) } })] : []),
    ev("message_delta", { delta: { stop_reason: extra.stop || "end_turn", stop_details: extra.details }, usage: { output_tokens: 42 } }),
    ev("message_stop", {}),
  ]);
};

/** 메모리 위의 가짜 GitHub Gist API (api.github.com + gist.githubusercontent.com raw) */
export function fakeGitHub(token = "tok", login = "tester") {
  type F = { content: string };
  const gists = new Map<string, { id: string; description: string; public: boolean; files: Record<string, F> }>();
  const calls: string[] = [];
  let seq = 0;
  const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const view = (g: { id: string; description: string; files: Record<string, F> }, withContent: boolean) => ({
    id: g.id,
    description: g.description,
    html_url: `https://gist.github.com/${g.id}`,
    files: Object.fromEntries(
      Object.entries(g.files).map(([name, f]) => [
        name,
        withContent ? { filename: name, content: f.content.length > 1_000_000 ? f.content.slice(0, 1_000_000) : f.content, truncated: f.content.length > 1_000_000, raw_url: `https://gist.githubusercontent.com/${login}/${g.id}/raw/${name}` } : { filename: name },
      ]),
    ),
  });
  const handler = async (input: string, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    calls.push(`${method} ${u.hostname === "api.github.com" ? "" : u.hostname}${u.pathname}`);
    if (u.hostname === "gist.githubusercontent.com") {
      const [, , id, , name] = u.pathname.split("/");
      const f = gists.get(id)?.files[name];
      return f ? new Response(f.content) : new Response("", { status: 404 });
    }
    const auth = (init.headers as Record<string, string> | undefined)?.authorization;
    if (auth !== `Bearer ${token}`) return j({ message: "Bad credentials" }, 401);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname === "/user") return j({ login });
    if (u.pathname === "/gists" && method === "GET") return j([...gists.values()].map((g) => view(g, false)));
    if (u.pathname === "/gists" && method === "POST") {
      const g = { id: `g${++seq}`, description: body.description, public: body.public, files: {} as Record<string, F> };
      for (const [n, f] of Object.entries(body.files as Record<string, F>)) g.files[n] = { content: f.content };
      gists.set(g.id, g);
      return j(view(g, true), 201);
    }
    const m = /^\/gists\/([^/]+)$/.exec(u.pathname);
    const g = m && gists.get(m[1]);
    if (!g) return j({ message: "Not Found" }, 404);
    if (method === "GET") return j(view(g, true));
    if (method === "PATCH") {
      for (const [n, f] of Object.entries(body.files as Record<string, F | null>)) {
        if (f === null) delete g.files[n];
        else g.files[n] = { content: f.content };
      }
      return j(view(g, true));
    }
    return j({ message: "unsupported" }, 400);
  };
  return { handler, gists, calls };
}
