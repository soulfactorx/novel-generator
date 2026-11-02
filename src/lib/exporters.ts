import { dataUrlToBytes } from "./cover";
import { extOfMime, type Block } from "./images";
import type { Novel, Room } from "./types";

/* ---------------- ZIP (무압축 STORE, UTF-8 파일명) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: string | Uint8Array }[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 10, true); // version needed
    lh.setUint16(6, 0x0800, true); // UTF-8
    lh.setUint16(8, 0, true); // STORE
    lh.setUint16(10, time, true);
    lh.setUint16(12, day, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    const local = concat([new Uint8Array(lh.buffer), name, data]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 10, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, day, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cd.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

/* ---------------- TXT ---------------- */
const episodeHeading = (i: number, title: string) => `제${i + 1}화${title.trim() && title.trim() !== `${i + 1}화` ? ` ${title.trim()}` : ""}`;

/** 내보내기 옵션: 원고를 문단·그림으로 나누는 함수(봇의 표시 스크립트·그림 표시 반영)와 그림 바이트 */
export interface ExportImages {
  blocks: (text: string) => Block[];
  images: Record<string, { bytes: Uint8Array; mime: string }>;
}
const plainOf = (text: string, ex?: ExportImages) => (ex ? ex.blocks(text).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n\n") : text.trim());

export function novelToTxt(n: Novel, ex?: ExportImages): string {
  const head = [n.title || "제목 없음", n.author.trim() && `지은이: ${n.author.trim()}`, n.genre.trim() && `장르: ${n.genre.trim()}`].filter(Boolean).join("\n");
  const body = n.episodes.filter((e) => e.text.trim()).map((e, i) => `${episodeHeading(i, e.title)}\n\n${plainOf(e.text, ex)}`);
  return [head, ...body].join("\n\n\n") + "\n";
}

export function roomToTxt(r: Room, names: { user?: string } = {}): string {
  const lines = [r.title, ""];
  for (const m of r.messages) {
    if (m.error || !m.text.trim()) continue;
    lines.push(m.role === "user" ? `▶ ${names.user ? names.user + ": " : ""}${m.text.trim()}` : m.text.trim(), "");
  }
  return lines.join("\n");
}

/* ---------------- EPUB 3 (+ EPUB 2 목차 호환) ---------------- */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// XML 1.0 에서 허용되지 않는 제어 문자 제거
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
const paras = (text: string) =>
  clean(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("\n");
const xhtml = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">\n<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n${body}\n</body>\n</html>\n`;

function uuidFrom(seed: string): string {
  // 같은 소설은 같은 식별자 (재내보내기 시 리더가 같은 책으로 인식)
  let h = "";
  for (let i = 0; h.length < 32; i++) h += crc32(new TextEncoder().encode(seed + i)).toString(16).padStart(8, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function novelToEpub(n: Novel, now = new Date(), ex?: ExportImages): Uint8Array {
  const title = clean(n.title.trim() || "제목 없음");
  const author = clean(n.author.trim() || "작자 미상");
  const eps = n.episodes.map((e, i) => ({ ...e, i })).filter((e) => e.text.trim());
  const uid = `urn:uuid:${uuidFrom(n.id)}`;
  const modified = now.toISOString().replace(/\.\d+Z$/, "Z");
  const chapters = eps.map((e, k) => ({ file: `ch${String(k + 1).padStart(3, "0")}.xhtml`, id: `ch${k + 1}`, heading: clean(episodeHeading(e.i, e.title)), text: e.text }));
  let cover: { file: string; mime: string; bytes: Uint8Array } | null = null;
  if (n.cover?.dataUrl) {
    try {
      const { mime, bytes } = dataUrlToBytes(n.cover.dataUrl);
      if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) cover = { file: `cover.${mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`, mime, bytes };
    } catch {
      /* 표지가 깨졌으면 표지 없이 */
    }
  }
  // 원고 속 그림 (봇 에셋)
  const used = new Map<string, { file: string; mime: string; bytes: Uint8Array }>();
  const bodyOf = (text: string) => {
    if (!ex) return paras(text);
    return ex
      .blocks(text)
      .map((b) => {
        if (b.type === "text") return paras(b.text);
        const img = ex.images[b.id];
        if (!img || !/^image\/(jpeg|png|webp|gif)$/.test(img.mime)) return ""; // EPUB 리더가 못 여는 형식은 뺀다
        if (!used.has(b.id)) used.set(b.id, { file: `images/${b.id}.${extOfMime(img.mime)}`, mime: img.mime, bytes: img.bytes });
        return `<div class="ill"><img src="${used.get(b.id)!.file}" alt=""/></div>`;
      })
      .join("\n");
  };
  const bodies = chapters.map((c) => bodyOf(c.text));
  const css = `.ill{margin:1em 0;text-align:center;text-indent:0}.ill img{max-width:100%;max-height:90vh}body{font-family:serif;line-height:1.8;margin:0 1em;word-break:keep-all}h1{font-size:1.4em;margin:2em 0 1.5em;text-align:center}p{margin:0;text-indent:1em}p+p{margin-top:.6em}.title{text-align:center;margin-top:30%}.title h1{font-size:2em}.title p{text-indent:0;text-align:center}.cover{margin:0;padding:0;text-align:center}.cover img{max-width:100%;max-height:100vh}\n`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ko">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>ko</dc:language>
    ${n.brief.trim() ? `<dc:description>${esc(clean(n.brief.trim()).slice(0, 1000))}</dc:description>` : ""}
    <meta property="dcterms:modified">${modified}</meta>${cover ? `\n    <meta name="cover" content="cover-image"/>` : ""}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${cover ? `    <item id="cover-image" href="${cover.file}" media-type="${cover.mime}" properties="cover-image"/>\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>\n` : ""}    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${chapters.map((c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n")}
${[...used.entries()].map(([id, u]) => `    <item id="img-${id}" href="${u.file}" media-type="${u.mime}"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
${cover ? '    <itemref idref="cover" linear="yes"/>\n' : ""}    <itemref idref="title"/>
${chapters.map((c) => `    <itemref idref="${c.id}"/>`).join("\n")}
  </spine>
</package>
`;
  const nav = xhtml(title, `<nav epub:type="toc" id="toc"><h1>목차</h1><ol>\n${chapters.map((c) => `<li><a href="${c.file}">${esc(c.heading)}</a></li>`).join("\n")}\n</ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uid}"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${chapters.map((c, k) => `    <navPoint id="np${k + 1}" playOrder="${k + 1}"><navLabel><text>${esc(c.heading)}</text></navLabel><content src="${c.file}"/></navPoint>`).join("\n")}
  </navMap>
</ncx>
`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`;
  return zip(
    [
      { name: "mimetype", data: "application/epub+zip" }, // 반드시 첫 파일, 무압축
      { name: "META-INF/container.xml", data: container },
      { name: "OEBPS/content.opf", data: opf },
      { name: "OEBPS/nav.xhtml", data: nav },
      { name: "OEBPS/toc.ncx", data: ncx },
      { name: "OEBPS/style.css", data: css },
      ...(cover ? [{ name: `OEBPS/${cover.file}`, data: cover.bytes }, { name: "OEBPS/cover.xhtml", data: xhtml(title, `<div class="cover"><img src="${cover.file}" alt="${esc(title)} 표지"/></div>`) }] : []),
      { name: "OEBPS/title.xhtml", data: xhtml(title, `<div class="title"><h1>${esc(title)}</h1><p>${esc(author)}</p></div>`) },
      ...chapters.map((c, k) => ({ name: `OEBPS/${c.file}`, data: xhtml(c.heading, `<h1>${esc(c.heading)}</h1>\n${bodies[k]}`) })),
      ...[...used.values()].map((u) => ({ name: `OEBPS/${u.file}`, data: u.bytes })),
    ],
    now,
  );
}

/* ---------------- 내려받기 ---------------- */
export function safeFileName(s: string) {
  return (s.trim() || "제목 없음").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 80);
}
export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
