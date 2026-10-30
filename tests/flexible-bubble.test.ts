import test from 'node:test';
import assert from 'node:assert/strict';
import { findFlexibleBubble } from '../src/flexible-bubble';

function fixture(color: number[], ink: number[], shape: 'oval' | 'angular') {
  const width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, rgb: number[]) => data.set([...rgb, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, [110, 150, 100]);
  for (let y = 50; y <= 200; y++) for (let x = 80; x <= 280; x++) {
    const inside = shape === 'oval' ? ((x - 180) / 100) ** 2 + ((y - 125) / 75) ** 2 <= 1
      : y <= 160 || Math.abs(x - 180) <= (200 - y) / 2;
    if (inside) paint(x, y, color);
  }
  // Enclosed O glyphs; clicks on letters must still choose the whole bubble.
  for (let i = 0; i < 4; i++) for (let y = 115; y <= 135; y++) for (let x = 140 + i * 22; x <= 156 + i * 22; x++) {
    if (x <= 143 + i * 22 || x >= 153 + i * 22 || y <= 118 || y >= 132) paint(x, y, ink);
  }
  return { data, width, height };
}
for (const [name, color, ink] of [
  ['white', [255, 255, 255], [0, 0, 0]],
  ['yellow', [245, 190, 70], [20, 20, 20]],
  ['dark', [20, 25, 35], [255, 255, 255]],
] as const) for (const shape of ['oval', 'angular'] as const) {
  test(`${name} ${shape}: clicking empty background far from text detects the entire image bubble`, () => {
    const f = fixture([...color], [...ink], shape);
    const expected = { x: 80, y: 50, width: 201, height: 151 };
    assert.deepEqual(findFlexibleBubble(f.data, f.width, f.height, 180, 65), expected);
    assert.deepEqual(findFlexibleBubble(f.data, f.width, f.height, 148, 125), expected);
    assert.deepEqual(findFlexibleBubble(f.data, f.width, f.height, 142, 125), expected);
  });
}
test('rejects unbounded backgrounds and tiny regions', () => {
  assert.throws(() => findFlexibleBubble(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100, 50, 50), /closed bubble/);
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 45; y < 55; y++) for (let x = 45; x < 55; x++) data.fill(255, (y * 100 + x) * 4, (y * 100 + x) * 4 + 4);
  assert.throws(() => findFlexibleBubble(data, 100, 100, 50, 50), /closed bubble/);
});
