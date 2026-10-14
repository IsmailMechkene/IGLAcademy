// Generates assets/icon.png and build/icon.ico from the logo in assets/logo.png.
// Takes the mark (the cap and books on the left of the wordmark), removes the
// flat background, centres it on a transparent square and scales it down.
// Plain Node, no image libraries: the PNG codec and resampler are below.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const source = path.join(root, 'assets', 'logo.png');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;
const MARGIN = 0.06; // transparent padding around the mark, per side

// --- PNG decode (8-bit RGB/RGBA, non-interlaced) ---
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || ![2, 6].includes(colorType) || data[12] !== 0) {
        throw new Error('logo.png must be an 8-bit, non-interlaced RGB or RGBA PNG');
      }
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 0xff;
    }
  }
  const rgba = new Float64Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rows[i * bpp];
    rgba[i * 4 + 1] = rows[i * bpp + 1];
    rgba[i * 4 + 2] = rows[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? rows[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}

// --- PNG encode (RGBA) ---
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
function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = Math.round(Math.min(255, Math.max(0, rgba[y * width * 4 + x])));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Background removal: alpha from the distance to the corner colour ---
function removeBackground(img) {
  const { rgba } = img;
  const bg = [rgba[0], rgba[1], rgba[2]];
  const LOW = 8, HIGH = 40; // channel distance: fully transparent → fully opaque
  for (let i = 0; i < rgba.length; i += 4) {
    const d = Math.max(Math.abs(rgba[i] - bg[0]), Math.abs(rgba[i + 1] - bg[1]), Math.abs(rgba[i + 2] - bg[2]));
    const a = Math.min(1, Math.max(0, (d - LOW) / (HIGH - LOW)));
    for (let c = 0; c < 3; c++) {
      // Undo the blend with the background so edges don't keep a light fringe.
      rgba[i + c] = a > 0 ? Math.min(255, Math.max(0, (rgba[i + c] - bg[c] * (1 - a)) / a)) : 0;
    }
    rgba[i + 3] = a * 255;
  }
}

// --- Locate the mark: the first block of columns with content, left to right ---
function markBounds({ width, height, rgba }) {
  const filled = (x) => {
    for (let y = 0; y < height; y++) if (rgba[(y * width + x) * 4 + 3] > 0) return true;
    return false;
  };
  let left = 0;
  while (left < width && !filled(left)) left++;
  let right = left, gap = 0;
  for (let x = left; x < width && gap < 20; x++) {
    if (filled(x)) { right = x; gap = 0; } else gap++;
  }
  let top = height, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = left; x <= right; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  if (left >= width || top > bottom) throw new Error('No logo mark found in logo.png');
  return { left, top, right, bottom };
}

// Copies the mark onto a transparent square, centred, with MARGIN padding.
function squareMark(img, { left, top, right, bottom }) {
  const w = right - left + 1, h = bottom - top + 1;
  const side = Math.ceil(Math.max(w, h) / (1 - 2 * MARGIN));
  const ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2);
  const rgba = new Float64Array(side * side * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((top + y) * img.width + left + x) * 4;
      const d = ((oy + y) * side + ox + x) * 4;
      for (let c = 0; c < 4; c++) rgba[d + c] = img.rgba[s + c];
    }
  }
  return { width: side, height: side, rgba };
}

// Area-average downscale on premultiplied colour (no dark/light halos).
function resize(img, size) {
  const { width, height } = img;
  const src = new Float64Array(img.rgba.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = img.rgba[i + 3] / 255;
    src[i] = img.rgba[i] * a; src[i + 1] = img.rgba[i + 1] * a; src[i + 2] = img.rgba[i + 2] * a;
    src[i + 3] = img.rgba[i + 3];
  }
  const pass = (data, w, h, horizontal, outLen) => {
    const inLen = horizontal ? w : h;
    const scale = inLen / outLen;
    const ow = horizontal ? outLen : w, oh = horizontal ? h : outLen;
    const out = new Float64Array(ow * oh * 4);
    for (let o = 0; o < outLen; o++) {
      const start = o * scale, end = start + scale;
      for (let i = Math.floor(start); i < Math.min(inLen, Math.ceil(end)); i++) {
        const weight = (Math.min(end, i + 1) - Math.max(start, i)) / scale;
        const lines = horizontal ? h : w;
        for (let l = 0; l < lines; l++) {
          const s = horizontal ? (l * w + i) * 4 : (i * w + l) * 4;
          const d = horizontal ? (l * ow + o) * 4 : (o * ow + l) * 4;
          for (let c = 0; c < 4; c++) out[d + c] += data[s + c] * weight;
        }
      }
    }
    return out;
  };
  const tmp = pass(src, width, height, true, size);
  const out = pass(tmp, size, height, false, size);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = a > 0 ? out[i + c] / a : 0;
  }
  return { width: size, height: size, rgba: out };
}

const logo = decodePng(fs.readFileSync(source));
removeBackground(logo);
const mark = squareMark(logo, markBounds(logo));

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), encodePng(resize(mark, PNG_SIZE)));

// --- ICO: one PNG-compressed entry per size (supported since Vista) ---
const pngs = ICO_SIZES.map((s) => encodePng(resize(mark, s)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + i * 16;
  header[e] = ICO_SIZES[i] % 256; // 0 = 256
  header[e + 1] = ICO_SIZES[i] % 256;
  header.writeUInt16LE(1, e + 4); // color planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...pngs]));

console.log('Generated assets/icon.png and build/icon.ico from assets/logo.png');
