/**
 * Generates placeholder app icons for Expo.
 * Run once: node scripts/generate-assets.mjs
 * Replace the output PNGs with real artwork before App Store submission.
 */

import Jimp from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../assets");

const BG = 0x0a0a0aff;       // near-black background
const ACCENT = 0xc8e84cff;    // lime accent

async function makeIcon(width, height, filename) {
  const img = new Jimp(width, height, BG);

  // Draw a rounded-ish accent square in the center (simple cross/plus mark)
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const size = Math.floor(Math.min(width, height) * 0.35);
  const thick = Math.floor(size * 0.18);

  // Horizontal bar
  for (let y = cy - thick; y <= cy + thick; y++) {
    for (let x = cx - size; x <= cx + size; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) img.setPixelColor(ACCENT, x, y);
    }
  }
  // Vertical bar
  for (let x = cx - thick; x <= cx + thick; x++) {
    for (let y = cy - size; y <= cy + size; y++) {
      if (x >= 0 && x < width && y >= 0 && y < height) img.setPixelColor(ACCENT, x, y);
    }
  }

  await img.writeAsync(path.join(OUT, filename));
  console.log(`✓ ${filename} (${width}×${height})`);
}

await makeIcon(1024, 1024, "icon.png");
await makeIcon(1024, 1024, "adaptive-icon.png");
await makeIcon(1284, 2778, "splash.png");

console.log("\nDone! Replace these with real artwork before App Store submission.");
