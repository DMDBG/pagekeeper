// Draws the Pagekeeper icon (an open book with a ribbon bookmark) as PNGs, using only Node's built-ins.
// Writes web/icons/icon-{180,192,512}.png and the iPhone app icon (1024).
// Usage: node scripts/make-icon.js [extra-output.png]   (extra file is a 1024px copy)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const root = path.join(__dirname, "..");

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, rgb){
  const row = size * 3 + 1, raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) { raw[y * row] = 0; rgb.copy(raw, y * row + 1, y * size * 3, (y + 1) * size * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
// Signed distance to a rounded rectangle (icon units 0..1).
function rrect(x, y, cx, cy, hw, hh, r){
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const clamp01 = v => Math.min(1, Math.max(0, v));
const C = {
  bgTop: hex("#4672E8"), bgBot: hex("#1A2C66"), glow: hex("#6E92F2"),
  page: hex("#FFFFFF"), pageEdge: hex("#DCE3F3"), line: hex("#BFCBEA"), lineDim: hex("#D3DBEF"),
  ribbon: hex("#F5B941"), ribbonDark: hex("#D9952A"), shadow: hex("#0E1838"), cover: hex("#16244F")
};

// Colour of one point of the icon (no anti-aliasing; we supersample instead).
function shade(x, y){
  // background: diagonal gradient with a soft light from the top left
  let c = mix(C.bgTop, C.bgBot, clamp01(y * .85 + x * .15));
  c = mix(c, C.glow, clamp01(.35 - Math.hypot(x - .25, y - .18)) * .9);

  const PY = .53, PH = .215; // page centre and half height
  // soft shadow under the book
  const sd = rrect(x, y, .5, PY + .045, .335, PH + .01, .05);
  c = mix(c, C.shadow, clamp01(1 - (sd + .01) / .07) * .45);
  // the cover peeking out under the pages
  if (rrect(x, y, .5, PY + .012, .325, PH + .006, .04) < 0) c = C.cover;

  // two pages, each slightly curved: shaded darker toward the spine
  for (const side of [-1, 1]) {
    const cx = .5 + side * .157;
    const curve = .012 * Math.cos((x - cx) / .155 * Math.PI / 2); // pages bulge up a little in the middle
    if (rrect(x, y + curve, cx, PY, .152, PH, .03) < 0) {
      const toSpine = clamp01(1 - Math.abs(x - .5) / .155);
      c = mix(C.page, C.pageEdge, Math.pow(toSpine, 3) * .9);
      // lines of text
      const lines = [.41, .465, .52, .575, .63];
      lines.forEach((ly, i) => {
        if (side === 1 && i === 0) return;                       // room for the ribbon
        const len = (side === -1 && i === 4) || (side === 1 && i === 4) ? .06 : .095;
        const lx = cx - .095 + len;                               // left-aligned text
        if (rrect(x, y + curve, lx, ly, len, .0085, .0085) < 0) c = mix(C.line, C.lineDim, toSpine);
      });
    }
  }
  // ribbon bookmark hanging from the top of the right page, with a V notch
  const rx = .74, top = PY - PH - .035, bottom = PY - PH + .14;
  if (Math.abs(x - rx) < .03 && y > top && y < bottom - (.03 - Math.abs(x - rx)) * 1.1) {
    c = mix(C.ribbon, C.ribbonDark, clamp01((x - rx + .03) / .06) * .55);
  }
  return c;
}

function draw(size){
  const out = Buffer.alloc(size * size * 3);
  const N = size >= 512 ? 3 : 4; // supersamples per axis
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const c = shade((i + (sx + .5) / N) / size, (j + (sy + .5) / N) / size);
      r += c[0]; g += c[1]; b += c[2];
    }
    const k = (j * size + i) * 3, n = N * N;
    out[k] = Math.round(r / n); out[k + 1] = Math.round(g / n); out[k + 2] = Math.round(b / n);
  }
  return png(size, out);
}

const targets = [
  [path.join(root, "web/icons/icon-180.png"), 180],
  [path.join(root, "web/icons/icon-192.png"), 192],
  [path.join(root, "web/icons/icon-512.png"), 512],
  [path.join(root, "ios/Pagekeeper/Assets.xcassets/AppIcon.appiconset/icon-1024.png"), 1024]
];
if (process.argv[2]) targets.push([path.resolve(process.argv[2]), 1024]);
const cache = {};
for (const [file, size] of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cache[size] ||= draw(size));
  console.log("wrote", file);
}
