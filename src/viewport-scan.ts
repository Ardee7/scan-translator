import type { Selection } from './types';

type Rect = Pick<Selection, 'x' | 'y' | 'width' | 'height'>;

// Visit each color-connected component once, rather than simulating page clicks.
// Enclosed contrasting marks are a cheap text hint, not OCR; users review results.
export function scanBubbles(data: Uint8ClampedArray, width: number, height: number): Rect[] {
  const labels = new Int32Array(width * height), queue = new Int32Array(width * height);
  const candidates: { rect: Rect; label: number }[] = [];
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
      candidates.push({ rect: { x: left, y: top, width: w, height: h }, label });
    }
  }
  const results: Rect[] = [];
  for (const { rect: r, label: background } of candidates) {
    const seen = new Uint8Array(r.width * r.height);
    const marks: Rect[] = [];
    for (let sy = 0; sy < r.height && marks.length < 100; sy++) for (let sx = 0; sx < r.width && marks.length < 100; sx++) {
      const seed = sy * r.width + sx;
      if (seen[seed] || labels[(r.y + sy) * width + r.x + sx] === background) continue;
      let head = 0, tail = 1, left = r.width, right = 0, top = r.height, bottom = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % r.width, y = Math.floor(p / r.width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const n = ny * r.width + nx;
          if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height || seen[n]) continue;
          if (labels[(r.y + ny) * width + r.x + nx] !== background) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      if (left > 0 && top > 0 && right < r.width - 1 && bottom < r.height - 1 && right - left >= 1 && bottom - top >= 3
        && right - left < r.width * .6 && bottom - top < Math.min(64, r.height * .7) && tail >= 6
        && right - left <= (bottom - top) * 3) marks.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
    }
    // Require a short row of similarly sized marks, not just random holes in artwork.
    const hasTextRow = marks.some(a => marks.filter(b => {
      const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return overlap >= Math.min(a.height, b.height) * .5 && b.height / a.height >= .5 && b.height / a.height <= 2
        && Math.abs(a.x - b.x) <= a.height * 8;
    }).length >= 3);
    if (hasTextRow) results.push(r);
  }
  // Remove nested/overlapping detections so the preview never bills the same area twice.
  const distinct: Rect[] = [];
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
      x: r.x * viewport.viewportWidth / width, y: r.y * viewport.viewportHeight / height,
      width: r.width * viewport.viewportWidth / width, height: r.height * viewport.viewportHeight / height,
    }));
  } finally { bitmap.close(); }
}
