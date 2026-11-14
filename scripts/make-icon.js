// Draws the Pagekeeper icon (an open book with a ribbon) as PNGs, using only Node's built-ins.
// Writes web/icons/icon-{180,192,512}.png and the iPhone app icon (1024).
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
// Signed distance to a rounded rectangle (all in 0..1 icon units).
function rrect(x, y, cx, cy, hw, hh, r){
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const TOP = hex("#3A63D6"), BOT = hex("#1B2F6E"), PAGE = hex("#F5F7FB"), LINE = hex("#C3CEEB"), RIBBON = hex("#F2B84B"), SPINE = hex("#D9E0F2");

function draw(size){
  const out = Buffer.alloc(size * size * 3), px = 1 / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + .5) / size, y = (j + .5) / size;
    const t = y; let c = TOP.map((v, k) => v + (BOT[k] - v) * t);
    const paint = (d, col) => { const a = Math.min(1, Math.max(0, .5 - d / px)); if (a > 0) c = c.map((v, k) => v + (col[k] - v) * a); };
    // two pages
    paint(rrect(x, y, .345, .52, .155, .22, .035), PAGE);
    paint(rrect(x, y, .655, .52, .155, .22, .035), PAGE);
    // spine shadow
    paint(rrect(x, y, .5, .52, .012, .22, .006), SPINE);
    // text lines
    for (const ly of [.40, .46, .52, .58, .64]) {
      paint(rrect(x, y, .35, ly, .095, .009, .009), LINE);
      if (ly > .43) paint(rrect(x, y, .65, ly, .095, .009, .009), LINE);
    }
    // ribbon bookmark on the right page, with a notch at the bottom
    const inRib = rrect(x, y, .735, .375, .028, .095, .004);
    const notch = (y > .43) ? (Math.abs(x - .735) - (.47 - y) * .6) : 1; // carve a V
    paint(Math.max(inRib, -notch), RIBBON);
    out[(j * size + i) * 3] = c[0]; out[(j * size + i) * 3 + 1] = c[1]; out[(j * size + i) * 3 + 2] = c[2];
  }
  return png(size, out);
}

const targets = [
  [path.join(root, "web/icons/icon-180.png"), 180],
  [path.join(root, "web/icons/icon-192.png"), 192],
  [path.join(root, "web/icons/icon-512.png"), 512],
  [path.join(root, "ios/Pagekeeper/Assets.xcassets/AppIcon.appiconset/icon-1024.png"), 1024]
];
for (const [file, size] of targets) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, draw(size)); console.log("wrote", path.relative(root, file)); }
