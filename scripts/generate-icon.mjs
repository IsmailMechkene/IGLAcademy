// Generates assets/icon.png, build/icon.ico and assets/icon.svg
// A violet rounded square with a white graduation cap, drawn pixel by pixel.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SIZE = 256;
const VIOLET = [124, 108, 240, 255];
const VIOLET_DARK = [100, 86, 210, 255];
const WHITE = [255, 255, 255, 255];

const px = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // alpha blend
  const sa = a / 255;
  px[i] = Math.round(r * sa + px[i] * (1 - sa));
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa));
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa));
  px[i + 3] = Math.max(px[i + 3], a);
}

function fillRoundedRect(x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // rounded corner test
      const cx = Math.max(x0 + radius, Math.min(x, x0 + w - 1 - radius));
      const cy = Math.max(y0 + radius, Math.min(y, y0 + h - 1 - radius));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(x, y, color);
    }
  }
}

// Background: violet rounded square with subtle vertical shading
const RADIUS = 56;
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  const c = [
    Math.round(VIOLET[0] * (1 - t) + VIOLET_DARK[0] * t),
    Math.round(VIOLET[1] * (1 - t) + VIOLET_DARK[1] * t),
    Math.round(VIOLET[2] * (1 - t) + VIOLET_DARK[2] * t),
    255,
  ];
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.max(RADIUS, Math.min(x, SIZE - 1 - RADIUS));
    const cy = Math.max(RADIUS, Math.min(y, SIZE - 1 - RADIUS));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= RADIUS * RADIUS) setPixel(x, y, c);
  }
}

// Graduation cap: diamond (mortarboard) + band + tassel
const cx = SIZE / 2;
const cy = SIZE / 2 - 18;
const R = 62; // diamond "radius"
for (let y = -R; y <= R; y++) {
  for (let x = -R; x <= R; x++) {
    if (Math.abs(x) + Math.abs(y) <= R) setPixel(cx + x, cy + y, WHITE);
  }
}
// band
fillRoundedRect(cx - 34, cy + R - 6, 68, 26, 10, WHITE);
// tassel: string + knob
for (let y = cy + 2; y < cy + 58; y++) setPixel(cx + R - 14, y, WHITE);
fillRoundedRect(cx + R - 20, cy + 56, 12, 12, 4, WHITE);

// --- PNG encode ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png);

// --- ICO (wraps PNG data, supported since Vista) ---
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // count
ico[6] = 0; // width (0 = 256)
ico[7] = 0; // height
ico[8] = 0; // colors
ico[9] = 0; // reserved
ico.writeUInt16LE(1, 10); // color planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);

// --- SVG for docs ---
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7c6cf0"/>
      <stop offset="1" stop-color="#6456d2"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <polygon points="128,66 190,110 128,154 66,110" fill="#fff"/>
  <rect x="94" y="148" width="68" height="26" rx="10" fill="#fff"/>
  <rect x="172" y="150" width="4" height="34" fill="#fff"/>
  <rect x="166" y="182" width="16" height="16" rx="4" fill="#fff"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'assets', 'icon.svg'), svg);

console.log('Generated assets/icon.png, build/icon.ico, assets/icon.svg');
