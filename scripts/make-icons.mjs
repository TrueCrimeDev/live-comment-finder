// Generates the extension icons: a magnifier-over-speech-bubble glyph on a dark tile.
// Run: node scripts/make-icons.mjs
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x14, 0x14, 0x14]; // #141414 dark tile
const ACCENT = [0x5b, 0x9f, 0xef]; // #5B9FEF ocean blue
const INK = [0xe8, 0xed, 0xf4]; // near-white

function set(png, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  // simple alpha-over onto existing pixel
  const ia = a / 255;
  png.data[i] = Math.round(png.data[i] * (1 - ia) + r * ia);
  png.data[i + 1] = Math.round(png.data[i + 1] * (1 - ia) + g * ia);
  png.data[i + 2] = Math.round(png.data[i + 2] * (1 - ia) + b * ia);
  png.data[i + 3] = 255;
}

function draw(size) {
  const png = new PNG({ width: size, height: size });
  const s = size;
  // rounded-tile background
  const radius = s * 0.22;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const inCorner =
        (x < radius && y < radius && Math.hypot(radius - x, radius - y) > radius) ||
        (x > s - radius && y < radius && Math.hypot(x - (s - radius), radius - y) > radius) ||
        (x < radius && y > s - radius && Math.hypot(radius - x, y - (s - radius)) > radius) ||
        (x > s - radius && y > s - radius && Math.hypot(x - (s - radius), y - (s - radius)) > radius);
      const i = (s * y + x) << 2;
      if (inCorner) {
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
        png.data[i + 3] = 0;
      } else {
        png.data[i] = BG[0];
        png.data[i + 1] = BG[1];
        png.data[i + 2] = BG[2];
        png.data[i + 3] = 255;
      }
    }
  }
  // speech bubble (accent rounded rect) in the upper-left area
  const bx = s * 0.16,
    by = s * 0.2,
    bw = s * 0.5,
    bh = s * 0.36,
    br = s * 0.09;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const inRect = px >= bx && px <= bx + bw && py >= by && py <= by + bh;
      // tail
      const inTail = px >= bx + bw * 0.16 && px <= bx + bw * 0.4 && py >= by + bh && py <= by + bh + s * 0.1 && px - (bx + bw * 0.16) < by + bh + s * 0.1 - py + 4;
      if (inRect) {
        // rounded corners
        const cx = Math.min(Math.max(px, bx + br), bx + bw - br);
        const cy = Math.min(Math.max(py, by + br), by + bh - br);
        if (Math.hypot(px - cx, py - cy) <= br) set(png, x, y, ACCENT);
      } else if (inTail) {
        set(png, x, y, ACCENT);
      }
    }
  }
  // magnifier: ring + handle in the lower-right, drawn in ink
  const mx = s * 0.62,
    my = s * 0.62,
    mr = s * 0.18,
    thick = Math.max(1.5, s * 0.06);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const d = Math.hypot(px - mx, py - my);
      if (Math.abs(d - mr) <= thick / 2) set(png, x, y, INK);
    }
  }
  // handle
  const hx0 = mx + mr * 0.7,
    hy0 = my + mr * 0.7,
    hx1 = s * 0.9,
    hy1 = s * 0.9;
  const steps = Math.ceil(s);
  for (let t = 0; t <= steps; t++) {
    const px = hx0 + ((hx1 - hx0) * t) / steps;
    const py = hy0 + ((hy1 - hy0) * t) / steps;
    for (let oy = -thick; oy <= thick; oy++)
      for (let ox = -thick; ox <= thick; ox++)
        if (Math.hypot(ox, oy) <= thick / 2) set(png, Math.round(px + ox), Math.round(py + oy), INK);
  }
  return PNG.sync.write(png);
}

mkdirSync(new URL('../src/icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = draw(size);
  writeFileSync(new URL(`../src/icons/icon${size}.png`, import.meta.url), buf);
  console.log(`wrote icon${size}.png (${buf.length} bytes)`);
}
