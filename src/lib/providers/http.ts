import { T } from "../tuning";
import { abortError, sleep } from "../sse";
import { ProviderError } from "./types";

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

/** 네트워크 오류·과부하·한도 초과 시 지수 백오프로 재시도 (retry-after 존중) */
export async function fetchRetry(
  url: string,
  init: RequestInit,
  opt: { signal?: AbortSignal; onStatus?: (m: string) => void; retries?: number; label: string },
): Promise<Response> {
  const retries = opt.retries ?? T("net.retries"); // 설정 → 세부 수치
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: opt.signal });
    } catch (e) {
      if (opt.signal?.aborted || (e as Error)?.name === "AbortError") throw abortError();
      if (attempt < retries) {
        opt.onStatus?.(`네트워크 오류 → 재시도 (${attempt + 1}/${retries})`);
        await sleep(1500 * (attempt + 1), opt.signal);
        continue;
      }
      throw new ProviderError(`${opt.label} 서버에 연결하지 못했습니다. 네트워크와 주소를 확인해 주세요. (${(e as Error)?.message || e})`, 0, "network");
    }
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt >= retries) return res;
    const ra = Number(res.headers.get("retry-after"));
    const wait = Math.min(30000, Math.max((res.status === 429 ? 4000 : 2000) * (attempt + 1), ra > 0 ? ra * 1000 : 0));
    opt.onStatus?.(`${opt.label} 응답 ${res.status} → ${Math.round(wait / 1000)}초 후 재시도 (${attempt + 1}/${retries})`);
    await sleep(wait, opt.signal);
  }
}

/** 오류 본문 파싱: 일반 JSON 또는 SSE("data: {...}") 형식 */
export async function errorBody(res: Response): Promise<{ type: string; message: string }> {
  let txt = "";
  try {
    txt = await res.text();
  } catch {
    /* ignore */
  }
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let j = parse(txt.trim());
  if (!j) {
    const m = /^\s*data:\s*(.+)$/m.exec(txt);
    j = m ? parse(m[1]) : null;
  }
  if (Array.isArray(j)) j = j[0];
  const err = j?.error ?? j ?? {};
  return { type: String(err.type || err.status || err.code || ""), message: String(err.message || (typeof j?.error === "string" ? j.error : "") || txt.slice(0, 300)) };
}

export function kindFor(status: number): ProviderError["kind"] {
  return status === 401 || status === 403 ? "auth" : status === 429 ? "rate" : status >= 500 ? "server" : "request";
}
