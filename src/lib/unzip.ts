/* ---------------- ZIP 읽기 (STORE · DEFLATE, 앞에 다른 데이터가 붙은 ZIP도 지원) ---------------- */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  read: () => Promise<Uint8Array>;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("이 브라우저는 압축 해제를 지원하지 않습니다.");
  const stream = new Response(data as BlobPart).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP 끝(중앙 디렉터리)을 찾는다. 없으면 null. JPEG 뒤에 붙은 ZIP(charx-jpeg)도 찾는다. */
export function findZip(b: Uint8Array): { eocd: number; base: number; count: number; cdOffset: number } | null {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) !== 0x06054b50) continue;
    const count = u16(b, i + 10);
    const cdSize = u32(b, i + 12);
    const cdOffset = u32(b, i + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("ZIP64 형식은 지원하지 않습니다.");
    const base = i - cdSize - cdOffset; // 앞에 다른 데이터가 붙어 있으면 그만큼 밀린다
    if (base < 0) continue;
    return { eocd: i, base, count, cdOffset };
  }
  return null;
}

export function listZip(b: Uint8Array): ZipEntry[] {
  const z = findZip(b);
  if (!z) throw new Error("ZIP 파일이 아닙니다.");
  const out: ZipEntry[] = [];
  let p = z.base + z.cdOffset;
  const dec = new TextDecoder();
  for (let n = 0; n < z.count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("ZIP 목록이 손상되었습니다.");
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = z.base + u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    out.push({
      name,
      method,
      compressedSize,
      size,
      read: async () => {
        if (u32(b, local) !== 0x04034b50) throw new Error(`ZIP 항목이 손상되었습니다: ${name}`);
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const raw = b.subarray(start, start + compressedSize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`지원하지 않는 압축 방식입니다: ${name}`);
      },
    });
  }
  return out;
}
