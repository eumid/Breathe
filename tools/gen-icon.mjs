// Рисует icon-180.png (иконка на домашнем экране) без внешних зависимостей.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 180, R = 40; // размер и радиус скругления

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// RGBA-полотно: тёмно-зелёный фон, три светлых кольца («дыхание»).
const raw = Buffer.alloc(S * (1 + S * 4));
const cx = (S - 1) / 2, cy = (S - 1) / 2;
for (let y = 0; y < S; y++) {
  const row = y * (1 + S * 4);
  raw[row] = 0; // фильтр None
  for (let x = 0; x < S; x++) {
    const i = row + 1 + x * 4;
    // скругление углов
    const qx = Math.max(R - x, x - (S - 1 - R), 0);
    const qy = Math.max(R - y, y - (S - 1 - R), 0);
    const corner = Math.hypot(qx, qy);
    const alpha = corner <= R ? 255 : 0;

    const t = y / (S - 1);
    let [r, g, b] = [Math.round(10 + 8 * t), Math.round(96 + 22 * t), Math.round(88 + 20 * t)];

    const d = Math.hypot(x - cx, y - cy);
    for (const [rad, w, op] of [[30, 3.5, 1], [48, 3.5, 0.6], [66, 3.5, 0.32]]) {
      const k = Math.max(0, 1 - Math.abs(d - rad) / w) * op;
      if (k > 0) { r += (235 - r) * k; g += (255 - g) * k; b += (245 - b) * k; }
    }
    if (d <= 14) { r = 235; g = 255; b = 245; }

    raw[i] = Math.round(r); raw[i + 1] = Math.round(g); raw[i + 2] = Math.round(b); raw[i + 3] = alpha;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../icon-180.png', import.meta.url), png);
console.log(`icon-180.png: ${png.length} байт`);
