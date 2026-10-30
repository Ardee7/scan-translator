import type { Selection } from './types';

type Rect = Pick<Selection, 'x' | 'y' | 'width' | 'height'>;

// A clipped bubble can merge with the page background through an open tail.
// Recover only text-like rows on a very plain light/dark patch near a viewport edge.
// These are text crops, not verified bubble boundaries, and must remain unchecked.
export function edgeTextCandidates(data: Uint8ClampedArray, width: number, height: number): Rect[] {
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < gray.length; p++) gray[p] = .299 * data[p * 4] + .587 * data[p * 4 + 1] + .114 * data[p * 4 + 2];
  const result: Rect[] = [];
  for (const lightInk of [false, true]) {
    const seen = new Uint8Array(gray.length), queue = new Int32Array(gray.length), glyphs: Rect[] = [];
    const ink = (p: number) => lightInk ? gray[p] > 200 : gray[p] < 100;
    for (let seed = 0; seed < gray.length; seed++) {
      if (seen[seed] || !ink(seed)) continue;
      let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % width, y = Math.floor(p / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, n = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && !seen[n] && ink(n)) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      const w = right - left + 1, h = bottom - top + 1;
      if (left > 0 && top > 0 && right < width - 1 && bottom < height - 1 && h >= 6 && h <= 48 && w >= 2 && w <= h * 3 && tail >= 8) {
        glyphs.push({ x: left, y: top, width: w, height: h });
      }
    }
    const rows: { box: Rect; count: number; size: number }[] = [];
    for (const g of glyphs.sort((a, b) => a.x - b.x)) {
      const row = rows.find(({ box: b, size }) => Math.min(g.y + g.height, b.y + b.height) - Math.max(g.y, b.y) >= Math.min(g.height, b.height) * .5
        && g.height / size >= .5 && g.height / size <= 2 && g.x - b.x - b.width <= size * 2);
      if (row) { row.box = merge(row.box, g); row.count++; }
      else rows.push({ box: g, count: 1, size: g.height });
    }
    const lines = rows.filter(r => r.count >= 4), used = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      let block = lines[i].box, count = lines[i].count;
      const size = lines[i].size; used.add(i);
      for (let pass = 0; pass < lines.length; pass++) for (let j = 0; j < lines.length; j++) {
        if (used.has(j)) continue;
        const b = lines[j].box;
        const gap = Math.max(b.y - block.y - block.height, block.y - b.y - b.height);
        if (gap >= 0 && gap <= size * 1.5 && lines[j].size / size >= .5 && lines[j].size / size <= 2
          && Math.min(b.x + b.width, block.x + block.width) - Math.max(b.x, block.x) > Math.min(b.width, block.width) * .3) {
          block = merge(block, b); count += lines[j].count; used.add(j);
        }
      }
      if (count < 8 || (block.y > height * .25 && block.y + block.height < height * .75)) continue;
      const pad = Math.max(8, size), x = Math.max(0, block.x - pad), y = Math.max(0, block.y - pad);
      const w = Math.min(width, block.x + block.width + pad) - x, h = Math.min(height, block.y + block.height + pad) - y;
      let plain = 0;
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        const value = gray[py * width + px]; if (lightInk ? value < 45 : value > 210) plain++;
      }
      if (plain / (w * h) >= .8) result.push({ x, y, width: w, height: h });
    }
  }
  return result;
}
function merge(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
