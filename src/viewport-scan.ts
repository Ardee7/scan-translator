import { edgeTextCandidates } from './edge-text';
import type { Selection } from './types';

type Rect = Pick<Selection, 'x' | 'y' | 'width' | 'height'>;
type Candidate = Rect & { confidence: 'high' | 'uncertain' };

// Visit each color-connected component once, rather than simulating page clicks.
// Enclosed contrasting marks are a cheap text hint, not OCR; users review results.
export function scanBubbles(data: Uint8ClampedArray, width: number, height: number): Candidate[] {
  const labels = new Int32Array(width * height), queue = new Int32Array(width * height);
  const candidates: { rect: Rect; luminance: number }[] = [];
  let label = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed]) continue;
    label++;
    const color = [data[seed * 4], data[seed * 4 + 1], data[seed * 4 + 2]];
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
    queue[0] = seed; labels[seed] = label;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const n = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || labels[n]) continue;
        if (color.every((c, ch) => Math.abs(data[n * 4 + ch] - c) <= 36)) { labels[n] = label; queue[tail++] = n; }
      }
    }
    const w = right - left + 1, h = bottom - top + 1;
    if (left > 0 && top > 0 && right < width - 1 && bottom < height - 1 && w >= 32 && h >= 24
      && w * h <= width * height * .5 && tail / (w * h) >= .3) {
      candidates.push({ rect: { x: left, y: top, width: w, height: h }, luminance: .299 * color[0] + .587 * color[1] + .114 * color[2] });
    }
  }
  const results: Candidate[] = [];
  for (const { rect: r, luminance } of candidates) {
    const seen = new Uint8Array(r.width * r.height);
    const marks: Rect[] = [];
    const ink = (x: number, y: number) => {
      const p = ((r.y + y) * width + r.x + x) * 4;
      const value = .299 * data[p] + .587 * data[p + 1] + .114 * data[p + 2];
      return luminance > 128 ? value < luminance - Math.max(70, luminance * .45)
        : value > luminance + Math.max(70, (255 - luminance) * .65);
    };
    for (let sy = 0; sy < r.height && marks.length < 100; sy++) for (let sx = 0; sx < r.width && marks.length < 100; sx++) {
      const seed = sy * r.width + sx;
      if (seen[seed] || !ink(sx, sy)) continue;
      let head = 0, tail = 1, left = r.width, right = 0, top = r.height, bottom = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % r.width, y = Math.floor(p / r.width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const n = ny * r.width + nx;
          if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height || seen[n]) continue;
          if (ink(nx, ny)) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      if (left > 0 && top > 0 && right < r.width - 1 && bottom < r.height - 1 && right - left >= 1 && bottom - top >= 3
        && right - left < r.width * .6 && bottom - top < Math.min(64, r.height * .7) && tail >= 6
        && right - left <= (bottom - top) * 3) marks.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
    }
    // Ignore pieces of the bubble outline near its bounding rectangle.
    const interior = marks.filter(m => m.x >= r.width * .025 && m.y >= r.height * .025
      && m.x + m.width <= r.width * .975 && m.y + m.height <= r.height * .975);
    // Several similarly sized, aligned glyphs are stronger evidence than random holes.
    const aligned = interior.filter(a => interior.filter(b => {
      const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return overlap >= Math.min(a.height, b.height) * .5 && b.height / a.height >= .5 && b.height / a.height <= 2
        && Math.abs(a.x - b.x) <= a.height * 8;
    }).length >= 4);
    if (aligned.length < 5 || aligned.length / interior.length < .6) continue;
    const left = Math.min(...aligned.map(m => m.x)), top = Math.min(...aligned.map(m => m.y));
    const right = Math.max(...aligned.map(m => m.x + m.width)), bottom = Math.max(...aligned.map(m => m.y + m.height));
    const margin = Math.min(left / r.width, top / r.height, (r.width - right) / r.width, (r.height - bottom) / r.height);
    const confidence = aligned.length / interior.length >= .7 && margin >= .025 ? 'high' : 'uncertain';
    results.push({ ...r, confidence });

  }
  const partial = edgeTextCandidates(data, width, height);
  for (const r of partial) {
    const overlap = results.some(b => Math.max(0, Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x))
      * Math.max(0, Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y)) > r.width * r.height * .5);
    if (!overlap) results.push({ ...r, confidence: 'uncertain' });
  }
  // Remove nested/overlapping detections so the preview never bills the same area twice.
  const distinct: Candidate[] = [];
  for (const r of results.sort((a, b) => b.width * b.height - a.width * a.height)) {
    if (!distinct.some(b => {
      const overlap = Math.max(0, Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x))
        * Math.max(0, Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y));
      return overlap > Math.min(r.width * r.height, b.width * b.height) * .5;
    })) distinct.push(r);
  }
  return distinct.sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 20);
}

export async function scanScreenshot(image: string, viewport: Selection): Promise<Selection[]> {
  const bytes = Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const scale = Math.min(1, 1200 / viewport.viewportWidth);
    const width = Math.round(viewport.viewportWidth * scale), height = Math.round(viewport.viewportHeight * scale);
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return scanBubbles(ctx.getImageData(0, 0, width, height).data, width, height).map(r => ({ ...viewport,
      confidence: r.confidence, x: r.x * viewport.viewportWidth / width, y: r.y * viewport.viewportHeight / height,
      width: r.width * viewport.viewportWidth / width, height: r.height * viewport.viewportHeight / height,
    }));
  } finally { bitmap.close(); }
}
