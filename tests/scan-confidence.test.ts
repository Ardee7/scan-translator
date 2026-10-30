import test from 'node:test';
import assert from 'node:assert/strict';
import { scanBubbles } from '../src/viewport-scan';

function canvas() {
  const width = 520, height = 440, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x: number, y: number, w: number, h: number, value: number) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) data.set([value, value, value, 255], (py * width + px) * 4);
  };
  const text = (x: number, y: number, ink: number) => {
    for (let i = 0; i < 6; i++) {
      rect(x + i * 16, y, 2, 15, ink); rect(x + i * 16 + 8, y, 2, 15, ink); rect(x + i * 16, y + 6, 10, 2, ink);
    }
  };
  return { width, height, data, rect, text, scan: () => scanBubbles(data, width, height) };
}
test('strong contrast finds text over faded background lines and in dark captions, without selecting scattered artwork', () => {
  const c = canvas();
  c.rect(20, 20, 210, 150, 0); c.rect(22, 22, 206, 146, 235);
  for (let y = 30; y < 160; y += 15) c.rect(22, y, 206, 2, 210);
  c.text(65, 65, 20); c.text(65, 92, 20);
  c.rect(280, 30, 210, 150, 20); c.text(330, 70, 250); c.text(330, 97, 250);
  c.rect(30, 230, 200, 140, 120);
  for (const [x, y] of [[42, 239], [80, 300], [130, 255], [180, 340]]) c.rect(x, y, 8, 12, 0);
  const regions = c.scan();
  assert.equal(regions.length, 2);
  assert.ok(regions.every(r => r.confidence === 'high'));
  assert.deepEqual(regions.map(r => [r.x, r.y, r.width, r.height]), [[22, 22, 206, 146], [280, 30, 210, 150]]);
});
test('dialogue near a clipped edge is recovered only as an unchecked text crop', () => {
  const c = canvas();
  c.text(130, 340, 0); c.text(130, 367, 0);
  const regions = c.scan();
  assert.equal(regions.length, 1);
  assert.equal(regions[0].confidence, 'uncertain');
  assert.ok(regions[0].x <= 130 && regions[0].y <= 340);
  assert.ok(regions[0].x + regions[0].width >= 220 && regions[0].y + regions[0].height >= 382);
});
test('sparse short marks are not enough to recover arbitrary edge artwork', () => {
  const c = canvas();
  c.rect(120, 350, 6, 12, 0); c.rect(150, 350, 6, 12, 0); c.rect(180, 350, 6, 12, 0);
  assert.deepEqual(c.scan(), []);
});
