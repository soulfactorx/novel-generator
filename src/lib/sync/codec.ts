/** 동기화 데이터 인코딩: JSON → (gzip) → (AES-GCM 암호화) → base64 */

export interface PayloadMeta {
  format: 1;
  encoding: "gzip-base64" | "base64";
  enc?: { alg: "AES-GCM"; kdf: "PBKDF2-SHA256"; iter: number; salt: string; iv: string };
}

const KDF_ITER = 210_000;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}
const canGzip = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encodePayload(data: unknown, passphrase?: string): Promise<{ meta: PayloadMeta; body: string }> {
  let bytes: Uint8Array = new TextEncoder().encode(JSON.stringify(data));
  const gz = canGzip();
  if (gz) bytes = await pipe(bytes, new CompressionStream("gzip"));
  const meta: PayloadMeta = { format: 1, encoding: gz ? "gzip-base64" : "base64" };
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, KDF_ITER);
    bytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, bytes as BufferSource));
    meta.enc = { alg: "AES-GCM", kdf: "PBKDF2-SHA256", iter: KDF_ITER, salt: toBase64(salt), iv: toBase64(iv) };
  }
  return { meta, body: toBase64(bytes) };
}

export class PassphraseError extends Error {}

export async function decodePayload<T>(meta: PayloadMeta, body: string, passphrase?: string): Promise<T> {
  let bytes = fromBase64(body);
  if (meta.enc) {
    if (!passphrase) throw new PassphraseError("동기화 데이터가 암호로 잠겨 있습니다. 다른 기기에서 정한 동기화 암호를 입력해 주세요.");
    try {
      const key = await deriveKey(passphrase, fromBase64(meta.enc.salt), meta.enc.iter);
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(meta.enc.iv) as BufferSource }, key, bytes as BufferSource));
    } catch {
      throw new PassphraseError("동기화 암호가 맞지 않습니다. 다른 기기에서 정한 암호와 같은지 확인해 주세요.");
    }
  }
  if (meta.encoding === "gzip-base64") {
    if (!canGzip()) throw new Error("이 브라우저는 압축된 동기화 데이터를 풀 수 없습니다. 최신 브라우저를 사용해 주세요.");
    bytes = await pipe(bytes, new DecompressionStream("gzip"));
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
