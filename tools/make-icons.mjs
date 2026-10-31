#!/usr/bin/env node
// 앱 아이콘 PNG 생성 (의존성 없음): 보라색 그라데이션 + 흰 펜촉. 결과물은 public/icons 에 커밋.
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// 펜촉 도형 (0~1 좌표, 중심 기준 회전 전): 위가 넓고 아래로 뾰족한 촉 + 가운데 홈 + 구멍
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const NIB = [[0.5, 0.86], [0.33, 0.52], [0.36, 0.3], [0.64, 0.3], [0.67, 0.52]];
function nibAt(u, v) {
  // 45도 기울임
  const a = -Math.PI / 4, cx = u - 0.5, cy = v - 0.5;
  const x = cx * Math.cos(a) - cy * Math.sin(a) + 0.5, y = cx * Math.sin(a) + cy * Math.cos(a) + 0.5;
  if (!inPoly(x, y, NIB)) return false;
  if (Math.abs(x - 0.5) < 0.012 && y > 0.5 && y < 0.84) return false; // 홈
  if ((x - 0.5) ** 2 + (y - 0.5) ** 2 < 0.035 ** 2) return false; // 구멍
  if (y < 0.36 && y > 0.34) return false; // 띠
  return true;
}

function icon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const r = maskable ? 0 : size * 0.22; // 모서리 둥글기 (maskable 은 꽉 채움)
  const scale = maskable ? 0.72 : 0.9; // maskable 은 안전 영역 안에
  const S = 4; // 슈퍼샘플링
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          const dx = Math.max(r - px, 0, px - (size - r)), dy = Math.max(r - py, 0, py - (size - r));
          if (r && dx * dx + dy * dy > r * r) continue;
          bg++;
          const u = (px / size - 0.5) / scale + 0.5, v = (py / size - 0.5) / scale + 0.5;
          if (nibAt(u, v)) fg++;
        }
      const t = (x + y) / (2 * size);
      const c0 = [139, 92, 246], c1 = [91, 33, 182]; // violet-500 → violet-800
      const bgc = c0.map((c, i) => c + (c1[i] - c) * t);
      const f = fg / (S * S), a = bg / (S * S);
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i++) buf[o + i] = Math.round(bgc[i] * (1 - f / Math.max(a, 1e-9)) + 255 * (f / Math.max(a, 1e-9)));
      buf[o + 3] = Math.round(255 * a);
    }
  return png(size, size, buf);
}

const out = new URL("../public/icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), icon(192));
writeFileSync(new URL("icon-512.png", out), icon(512));
writeFileSync(new URL("maskable-512.png", out), icon(512, { maskable: true }));
writeFileSync(new URL("apple-touch-icon.png", out), icon(180, { maskable: true }));
console.log("icons written");
