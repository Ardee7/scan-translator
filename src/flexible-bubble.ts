// Find the connected background around the click, regardless of its color.
// Lettering forms holes inside this region; it is included in the returned crop.
// No oval/rectangle template or text proximity is required.
export function findFlexibleBubble(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let best: { x: number; y: number; width: number; height: number } | undefined;
  for (let radius = 0; radius <= 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const sx = Math.round(x) + dx, sy = Math.round(y) + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const seed = sy * width + sx;
      if (seen[seed]) continue;
      const color = [data[seed * 4], data[seed * 4 + 1], data[seed * 4 + 2]];
      const matches = (p: number) => color.every((c, channel) => Math.abs(data[p * 4 + channel] - c) <= 36);
      let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0, open = false;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], px = p % width, py = Math.floor(p / width);
        left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
        if (px === 0 || py === 0 || px === width - 1 || py === height - 1) open = true;
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
          const n = ny * width + nx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !seen[n] && matches(n)) {
            seen[n] = 1; queue[tail++] = n;
          }
        }
      }
      const w = right - left + 1, h = bottom - top + 1;
      // Reject page backgrounds and skinny outlines, but permit irregular bubbles.
      if (!open && w >= 24 && h >= 20 && w * h <= width * height * .5 && tail / (w * h) >= .2) {
        if (!best || w * h > best.width * best.height) best = { x: left, y: top, width: w, height: h };
      }
    }
  }
  if (best) return best;
  throw new Error('Could not find a closed bubble around this click. Try its background, or snip manually if it blends into the artwork.');
}
