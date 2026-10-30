import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextRegion } from '../src/text-region';

function fixture(background: number[], ink: number[]) {
  const width = 600, height = 400, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, color: number[]) => data.set([...color, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, background);
  // Two lines of separated H glyphs, with a remote text block that must stay out.
  for (const [left, top, length] of [[120, 100, 8], [132, 124, 6], [440, 280, 5]]) {
    for (let i = 0; i < length; i++) for (let y = 0; y < 16; y++) for (let x = 0; x < 10; x++) {
      if (x < 2 || x >= 8 || (y >= 7 && y < 9)) paint(left + i * 15 + x, top + y, ink);
    }
  }
  return { data, width, height };
}
for (const [name, background, ink] of [
  ['black text on white', [255, 255, 255], [0, 0, 0]],
  ['white text on dark', [25, 20, 40], [250, 250, 250]],
  ['dark text on colored', [230, 170, 80], [30, 20, 10]],
] as const) {
  test(`finds nearby multiline ${name}`, () => {
    const f = fixture([...background], [...ink]);
    const r = findTextRegion(f.data, f.width, f.height, 170, 110);
    assert.deepEqual(r, { x: 112, y: 92, width: 131, height: 56 });
  });
}
test('rejects blank images and clicks far from lettering', () => {
  assert.throws(() => findTextRegion(new Uint8ClampedArray(600 * 400 * 4).fill(255), 600, 400, 200, 200), /No contrasting text/);
  const f = fixture([255, 255, 255], [0, 0, 0]);
  assert.throws(() => findTextRegion(f.data, f.width, f.height, 320, 220), /Could not confidently/);
});
