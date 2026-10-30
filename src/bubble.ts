import { findFlexibleBubble } from './flexible-bubble';
import type { Selection } from './types';

// Flood-fill the white interior around a click. Reject open/oversized regions rather
// than accidentally sending a page background or a large section of a comic.
export function findBubble(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const white = (p: number) => data[p * 4] >= 225 && data[p * 4 + 1] >= 225 && data[p * 4 + 2] >= 225;
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let foundWhite = false;
  // A click on lettering can land in the enclosed white center of a letter.
  // Skip those tiny components and look for the surrounding bubble interior.
  for (let radius = 0; radius <= 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const sx = Math.round(x) + dx, sy = Math.round(y) + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const seed = sy * width + sx;
      if (seen[seed] || !white(seed)) continue;
      foundWhite = true;
      let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], px = p % width, py = Math.floor(p / width);
        left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1 || tail > width * height * .35) {
          throw new Error('That region has no reliable bubble boundary. Use drag selection instead.');
        }
        for (const n of [p - 1, p + 1, p - width, p + width]) {
          if (!seen[n] && white(n)) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      const w = right - left + 1, h = bottom - top + 1;
      if (w >= 24 && h >= 20 && tail / (w * h) >= .45) return { x: left, y: top, width: w, height: h };
    }
  }
  throw new Error(foundWhite
    ? 'Bubble too small or irregular. Use drag selection instead.'
    : 'No white bubble found. Click the white space inside a bubble, or use drag selection.');
}

export async function detectBubble(image: string, s: Selection, flexible = false): Promise<Selection> {
  const bytes = Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    // Detect at at most CSS resolution; crop the original bitmap for text clarity.
    const scale = Math.min(1, 1200 / s.viewportWidth);
    const width = Math.round(s.viewportWidth * scale), height = Math.round(s.viewportHeight * scale);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const r = (flexible ? findFlexibleBubble : findBubble)(ctx.getImageData(0, 0, width, height).data, width, height, s.x * scale, s.y * scale);
    return { ...s, x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale };
  } finally { bitmap.close(); }
}
