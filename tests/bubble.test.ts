import test from 'node:test';
import assert from 'node:assert/strict';
import { findBubble } from '../src/bubble';

function canvas(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, paint(x: number, y: number, value = 255) {
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = value; data[p + 3] = 255;
  } };
}
test('detects a closed white speech bubble including dark lettering', () => {
  const c = canvas(400, 300);
  for (let y = 50; y <= 200; y++) for (let x = 80; x <= 280; x++) {
    if (((x - 180) / 100) ** 2 + ((y - 125) / 75) ** 2 <= 1) c.paint(x, y);
  }
  for (let y = 110; y < 120; y++) for (let x = 150; x < 160; x++) c.paint(x, y, 0);
  assert.deepEqual(findBubble(c.data, 400, 300, 180, 125), { x: 80, y: 50, width: 201, height: 151 });
  assert.deepEqual(findBubble(c.data, 400, 300, 155, 115), { x: 80, y: 50, width: 201, height: 151 });
});
test('rejects page backgrounds, clipped bubbles and nonwhite artwork', () => {
  assert.throws(() => findBubble(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100, 50, 50), /boundary/);
  assert.throws(() => findBubble(new Uint8ClampedArray(100 * 100 * 4), 100, 100, 50, 50), /No white/);
  const c = canvas(200, 200);
  for (let y = 0; y < 50; y++) for (let x = 40; x < 100; x++) c.paint(x, y);
  assert.throws(() => findBubble(c.data, 200, 200, 60, 25), /boundary/);
});
test('rejects tiny white highlights rather than submitting an unreliable crop', () => {
  const c = canvas(200, 200);
  for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) c.paint(x, y);
  assert.throws(() => findBubble(c.data, 200, 200, 45, 45), /too small/);
});

test('skips enclosed white letter centers to find the surrounding bubble', () => {
  const c = canvas(400, 300);
  for (let y = 50; y <= 200; y++) for (let x = 80; x <= 280; x++) {
    if (((x - 180) / 100) ** 2 + ((y - 125) / 75) ** 2 <= 1) c.paint(x, y);
  }
  // An O-shaped glyph with a small white interior isolated from the bubble.
  for (let y = 115; y <= 135; y++) for (let x = 172; x <= 188; x++) {
    if (x <= 175 || x >= 185 || y <= 118 || y >= 132) c.paint(x, y, 0);
  }
  const expected = { x: 80, y: 50, width: 201, height: 151 };
  assert.deepEqual(findBubble(c.data, 400, 300, 180, 125), expected);
  assert.deepEqual(findBubble(c.data, 400, 300, 175, 125), expected);
});
