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
