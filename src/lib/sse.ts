/** Server-Sent Events 파서. \n · \r\n · \r 줄바꿈과 청크 경계를 모두 안전하게 처리합니다. */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let data: string[] = [];
  let event = "";
  const flush = () => {
    if (data.length) onEvent(event, data.join("\n"));
    data = [];
    event = "";
  };
  const line = (l: string) => {
    if (l === "") return flush();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  };
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let keepCR = false;
      if (buf.endsWith("\r")) {
        buf = buf.slice(0, -1);
        keepCR = true;
      }
      const parts = buf.split(/\r\n|\r|\n/);
      buf = parts.pop()! + (keepCR ? "\r" : "");
      parts.forEach(line);
    }
    if (signal?.aborted) throw abortError();
    buf += decoder.decode();
    if (buf) buf.split(/\r\n|\r|\n/).forEach(line);
    flush();
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function abortError(): Error {
  const e = new Error("생성을 중단했습니다.");
  e.name = "AbortError";
  return e;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
