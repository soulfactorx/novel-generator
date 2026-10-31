import type { PayloadMeta } from "./codec";

/** GitHub Gist 를 동기화 저장소로 사용 (api.github.com 은 브라우저 직접 호출(CORS) 허용) */
const API = "https://api.github.com";
export const GIST_DESCRIPTION = "Novel Generator sync — 앱이 자동 관리합니다. 직접 수정하지 마세요.";
export const META_FILE = "novel-generator-sync.json";
const CHUNK = 900_000; // Gist API 는 파일당 1MB 까지만 내용을 바로 돌려줌 → 그보다 작게 나눔
const MAX_FILES = 290;

export interface RemoteMeta {
  app: "novel-generator";
  payload: PayloadMeta;
  chunks: string[];
  updatedAt: number;
  device?: string;
}

export class GistError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

type GistFile = { filename?: string; content?: string; truncated?: boolean; raw_url?: string };
type Gist = { id: string; description?: string; html_url?: string; files: Record<string, GistFile>; updated_at?: string };

export class GistClient {
  constructor(private token: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(API + path, {
        ...init,
        headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2026-03-10", ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch (e) {
      throw new GistError(`GitHub에 연결하지 못했습니다. 네트워크를 확인해 주세요. (${(e as Error)?.message || e})`);
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      const m = j.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new GistError(`GitHub 토큰이 올바르지 않거나 만료됐습니다. (${m})`, 401);
      if (res.status === 403 || res.status === 404) throw new GistError(`GitHub 토큰에 Gist 권한이 없거나 동기화 Gist를 찾을 수 없습니다. 토큰 권한(Gists: 읽기·쓰기 / classic은 gist)을 확인해 주세요. (${m})`, res.status);
      if (res.status === 422) throw new GistError(`GitHub가 요청을 거부했습니다. 데이터가 너무 클 수 있습니다. (${m})`, 422);
      throw new GistError(`GitHub 오류 (${m})`, res.status);
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  async user(): Promise<string> {
    return (await this.req<{ login: string }>("/user")).login;
  }

  /** 설명(description)으로 동기화 Gist 찾기 → 두 번째 기기는 토큰만 넣으면 됨 */
  async find(): Promise<string | null> {
    for (let page = 1; page <= 5; page++) {
      const list = await this.req<Gist[]>(`/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.files?.[META_FILE] && (g.description ?? "").startsWith("Novel Generator sync"));
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  private async content(f: GistFile): Promise<string> {
    if (!f.truncated && typeof f.content === "string") return f.content;
    if (!f.raw_url) throw new GistError("Gist 파일 내용을 읽지 못했습니다.");
    const res = await fetch(f.raw_url);
    if (!res.ok) throw new GistError(`Gist 파일을 내려받지 못했습니다. (HTTP ${res.status})`, res.status);
    return res.text();
  }

  /** 반환: 메타·본문 (Gist 가 없거나 비어 있으면 null) */
  async read(id: string): Promise<{ meta: RemoteMeta; body: string; url?: string; files: string[] } | null> {
    const g = await this.req<Gist>(`/gists/${id}`);
    const mf = g.files?.[META_FILE];
    if (!mf) return null;
    const meta = JSON.parse(await this.content(mf)) as RemoteMeta;
    if (meta.app !== "novel-generator") throw new GistError("동기화 Gist 형식이 아닙니다.");
    const parts: string[] = [];
    for (const name of meta.chunks) {
      const f = g.files[name];
      if (!f) throw new GistError(`동기화 데이터 조각(${name})이 없습니다. 다른 기기에서 동기화 중이었을 수 있으니 잠시 후 다시 시도해 주세요.`);
      parts.push(await this.content(f));
    }
    return { meta, body: parts.join(""), url: g.html_url, files: Object.keys(g.files) };
  }

  /** 쓰기 (id 가 없으면 새 비공개 Gist 생성). oldFiles 중 더 이상 안 쓰는 조각은 삭제 */
  async write(id: string | null, meta: Omit<RemoteMeta, "chunks">, body: string, oldFiles: string[] = []): Promise<{ id: string; url?: string }> {
    const chunks: string[] = [];
    for (let i = 0; i < body.length || i === 0; i += CHUNK) chunks.push(body.slice(i, i + CHUNK) || " ");
    if (chunks.length > MAX_FILES) throw new GistError(`동기화 데이터가 너무 큽니다 (${Math.round(body.length / 1e6)}MB). 오래된 이야기·소설 표지를 정리해 주세요.`);
    const names = chunks.map((_, i) => `data-${String(i + 1).padStart(3, "0")}.txt`);
    const files: Record<string, { content: string } | null> = { [META_FILE]: { content: JSON.stringify({ ...meta, chunks: names }, null, 2) } };
    names.forEach((n, i) => (files[n] = { content: chunks[i] }));
    for (const f of oldFiles) if (f !== META_FILE && !names.includes(f)) files[f] = null;
    const g = id
      ? await this.req<Gist>(`/gists/${id}`, { method: "PATCH", body: JSON.stringify({ description: GIST_DESCRIPTION, files }) })
      : await this.req<Gist>("/gists", { method: "POST", body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files }) });
    return { id: g.id, url: g.html_url };
  }
}
