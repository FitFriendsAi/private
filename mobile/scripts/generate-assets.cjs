/**
 * Generates placeholder app icons for Expo using pure Node.js (no deps).
 * Run once: node scripts/generate-assets.cjs
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "../assets");

// Ensure assets dir exists
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/**
 * Create a minimal valid PNG of given dimensions filled with a solid color,
 * with a centered plus/cross shape drawn in the accent color.
 */
function makePNG(width, height, bgHex, accentHex) {
  // Parse hex colors
  function hexToRGB(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const [br, bg, bb] = hexToRGB(bgHex);
  const [ar, ag, ab] = hexToRGB(accentHex);

  // Build raw image data (RGBA rows, each preceded by filter byte 0)
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const size = Math.floor(Math.min(width, height) * 0.32);
  const thick = Math.floor(size * 0.18);

  function isAccent(x, y) {
    const inH = Math.abs(y - cy) <= thick && Math.abs(x - cx) <= size;
    const inV = Math.abs(x - cx) <= thick && Math.abs(y - cy) <= size;
    return inH || inV;
  }

  const rowLen = 1 + width * 3; // filter byte + RGB bytes (no alpha for smaller file)
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const off = y * rowLen + 1 + x * 3;
      if (isAccent(x, y)) {
        raw[off] = ar; raw[off + 1] = ag; raw[off + 2] = ab;
      } else {
        raw[off] = br; raw[off + 1] = bg; raw[off + 2] = bb;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  // PNG chunk helpers
  function crc32(buf) {
    let crc = 0xffffffff;
    for (const b of buf) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const payload = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
    return Buffer.concat([len, payload, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = "#0a0a0a";
const ACCENT = "#c8e84c";

const assets = [
  { w: 1024, h: 1024, name: "icon.png" },
  { w: 1024, h: 1024, name: "adaptive-icon.png" },
  { w: 1284, h: 2778, name: "splash.png" },
];

for (const { w, h, name } of assets) {
  const buf = makePNG(w, h, BG, ACCENT);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`✓ ${name} (${w}×${h}, ${(buf.length / 1024).toFixed(0)} KB)`);
}

console.log("\nDone! Replace with real artwork before App Store submission.");
