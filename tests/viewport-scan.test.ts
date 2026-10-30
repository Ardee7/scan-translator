import test from 'node:test';
import assert from 'node:assert/strict';
import { scanBubbles } from '../src/viewport-scan';

import { scanFixture } from './scan-fixture';

test('viewport scanner finds distinct colored and dark text regions in reading order, rejecting solid artwork and page background', () => {
  const f = scanFixture();
  assert.deepEqual(scanBubbles(f.data, f.width, f.height), f.boxes.map(b => ({ ...b, confidence: 'high' })));
  assert.deepEqual(scanBubbles(new Uint8ClampedArray(200 * 200 * 4).fill(255), 200, 200), []);
});
