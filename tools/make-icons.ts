/* Génère les icônes PNG de l'application sans dépendance externe.
   npm run icons
   La marque : carré arrondi bleu de travail, et les douze barres
   d'étapes du chantier réduites à trois traits blancs. */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

type RGB = [number, number, number];

/* ---------- encodeur PNG minimal (RGBA, 8 bits) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w: number, h: number, rgba: Buffer): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                      // filtre "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // profondeur
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- dessin ---------- */
const BLUE: RGB = [0x26, 0x47, 0x6e];
const PAPER: RGB = [0xfb, 0xfb, 0xf9];
const ORANGE: RGB = [0xe2, 0x4f, 0x17];

/* Couverture d'un pixel par un rectangle à coins arrondis, échantillonnée
   en 3x3 pour adoucir les bords sans bibliothèque graphique. */
function coverage(px: number, py: number, x0: number, y0: number, x1: number, y1: number, r: number): number {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3, y = py + (sy + 0.5) / 3;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 9;
}

function blend(buf: Buffer, i: number, color: RGB, a: number): void {
  if (a <= 0) return;
  const inv = 1 - a;
  buf[i]     = Math.round(buf[i]     * inv + color[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * inv + color[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * inv + color[2] * a);
  buf[i + 3] = Math.round(buf[i + 3] * inv + 255 * a);
}

function icon(size: number, { bleed }: { bleed: boolean }): Buffer {
  const buf = Buffer.alloc(size * size * 4, 0);
  const S = size;
  const pad = bleed ? 0 : S * 0.055;               // iOS applique son propre masque
  const radius = bleed ? 0 : S * 0.22;

  /* fond */
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      blend(buf, (y * S + x) * 4, BLUE, coverage(x, y, pad, pad, S - pad, S - pad, radius));

  /* trois barres d'avancement, longueurs décroissantes, la première
     en orange de traçage comme l'étape en cours dans l'application */
  const bw = S * 0.60, bh = S * 0.085, br = bh / 2;
  const left = (S - bw) / 2;
  const top = S * 0.30;
  const gap = S * 0.135;
  const widths = [1, 0.72, 0.44];
  widths.forEach((f, i) => {
    const y0 = top + i * gap;
    const color = i === 0 ? ORANGE : PAPER;
    for (let y = Math.floor(y0) - 1; y <= Math.ceil(y0 + bh) + 1; y++) {
      if (y < 0 || y >= S) continue;
      for (let x = Math.floor(left) - 1; x <= Math.ceil(left + bw) + 1; x++) {
        if (x < 0 || x >= S) continue;
        blend(buf, (y * S + x) * 4, color, coverage(x, y, left, y0, left + bw * f, y0 + bh, br));
      }
    }
  });

  return encodePNG(S, S, buf);
}

const out = fileURLToPath(new URL("../apps/web/public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });
const files: [string, number, { bleed: boolean }][] = [
  ["icon-192.png", 192, { bleed: false }],
  ["icon-512.png", 512, { bleed: false }],
  ["apple-touch-icon.png", 180, { bleed: true }],
  ["favicon-64.png", 64, { bleed: false }]
];
files.forEach(([name, size, opt]) => {
  writeFileSync(out + name, icon(size, opt));
  console.log("public/icons/" + name + "  " + size + "×" + size);
});
