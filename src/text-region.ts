type Box = { x: number; y: number; width: number; height: number };
const distance = (b: Box, x: number, y: number) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.width), Math.max(b.y - y, 0, y - b.y - b.height));
const union = (a: Box, b: Box): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) });

// Local contrast/connected-component heuristic, not OCR. Only proposes a crop:
// the user confirms it before any paid request. Test both dark and light lettering.
export function findTextRegion(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): Box {
  const left = Math.max(0, Math.floor(x - 260)), top = Math.max(0, Math.floor(y - 180));
  const w = Math.min(width, Math.ceil(x + 260)) - left, h = Math.min(height, Math.ceil(y + 180)) - top;
  const gray = new Uint8Array(w * h), histogram = new Uint32Array(256);
  let sum = 0;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const p = ((top + py) * width + left + px) * 4;
    const value = Math.round(.299 * data[p] + .587 * data[p + 1] + .114 * data[p + 2]);
    gray[py * w + px] = value; histogram[value]++; sum += value;
  }
  // Otsu threshold adapts to colored backgrounds without a network/model download.
  let threshold = 0, best = 0, count = 0, subtotal = 0;
  for (let t = 0; t < 255; t++) {
    count += histogram[t]; subtotal += t * histogram[t];
    if (!count || count === gray.length) continue;
    const separation = subtotal / count - (sum - subtotal) / (gray.length - count);
    const score = count * (gray.length - count) * separation ** 2;
    if (score > best) { best = score; threshold = t; }
  }
  if (!best) throw new Error('No contrasting text found near the click. Snip the text manually.');
  const candidates: Box[] = [];
  for (const light of [false, true]) {
    const seen = new Uint8Array(gray.length), queue = new Int32Array(gray.length);
    const letters: Box[] = [];
    for (let seed = 0; seed < gray.length; seed++) {
      if (seen[seed] || (gray[seed] > threshold) !== light) continue;
      let head = 0, tail = 1, l = w, r = 0, t = h, b = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], px = p % w, py = Math.floor(p / w);
        l = Math.min(l, px); r = Math.max(r, px); t = Math.min(t, py); b = Math.max(b, py);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, n = ny * w + nx;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && !seen[n] && (gray[n] > threshold) === light) {
            seen[n] = 1; queue[tail++] = n;
          }
        }
      }
      const bw = r - l + 1, bh = b - t + 1;
      if (l === 0 || t === 0 || r === w - 1 || b === h - 1 || bh < 6 || bh > 64 || bw < 2 || bw > bh * 3 || tail < 6 || tail / (bw * bh) < .08) continue;
      letters.push({ x: left + l, y: top + t, width: bw, height: bh });
    }
    const lines: { box: Box; count: number; glyphHeight: number }[] = [];
    for (const letter of letters.sort((a, b) => a.x - b.x)) {
      const line = lines.find(({ box, glyphHeight }) => {
        const overlap = Math.min(box.y + box.height, letter.y + letter.height) - Math.max(box.y, letter.y);
        return overlap >= Math.min(box.height, letter.height) * .5 && letter.x - box.x - box.width <= glyphHeight * 1.8
          && letter.height / glyphHeight >= .4 && letter.height / glyphHeight <= 2;
      });
      if (line) { line.box = union(line.box, letter); line.count++; }
      else lines.push({ box: letter, count: 1, glyphHeight: letter.height });
    }
    const valid = lines.filter(line => line.count >= 3);
    const nearest = valid.sort((a, b) => distance(a.box, x, y) - distance(b.box, x, y))[0];
    if (!nearest || distance(nearest.box, x, y) > 40) continue;
    let block = nearest.box;
    const included = new Set([nearest]);
    for (let pass = 0; pass < valid.length; pass++) for (const line of valid) {
      if (included.has(line)) continue;
      const overlap = Math.min(block.x + block.width, line.box.x + line.box.width) - Math.max(block.x, line.box.x);
      const gap = Math.max(line.box.y - block.y - block.height, block.y - line.box.y - line.box.height);
      if (overlap > Math.min(block.width, line.box.width) * .25 && gap >= 0 && gap <= nearest.glyphHeight * 1.1
        && line.glyphHeight / nearest.glyphHeight >= .5 && line.glyphHeight / nearest.glyphHeight <= 2) {
        block = union(block, line.box); included.add(line);
      }
    }
    candidates.push(block);
  }
  const result = candidates.sort((a, b) => distance(a, x, y) - distance(b, x, y))[0];
  if (!result) throw new Error('Could not confidently locate a text block. Use the snip shortcut to select it manually.');
  const pad = 8, rx = Math.max(0, result.x - pad), ry = Math.max(0, result.y - pad);
  return { x: rx, y: ry, width: Math.min(width, result.x + result.width + pad) - rx, height: Math.min(height, result.y + result.height + pad) - ry };
}
