import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanBubbles } from '../src/viewport-scan';

// The user's comic screenshots stay outside the repository. To repeat this check,
// convert them in attachment order to uncompressed 24/32-bit BMPs named 1.bmp–6.bmp
// and set SCAN_SAMPLE_DIR. These annotations describe dialogue, not artwork.
const annotations = [
  [[319, 157, 246, 164], [159, 921, 265, 194]],
  [[323, 257, 244, 167], [178, 774, 265, 179]],
  [[324, 87, 266, 186], [178, 508, 232, 156], [240, 1119, 239, 185]],
  [[141, 53, 255, 239], [148, 760, 421, 527]],
  [[229, 61, 281, 198], [316, 1083, 270, 234]],
  [[213, 132, 277, 310], [142, 677, 226, 171], [330, 1228, 220, 76], [185, 1400, 235, 76]],
];
for (const [index, expected] of annotations.entries()) test(`user sample ${index + 1}: dialogue coverage without extra artwork selections`, { skip: !process.env.SCAN_SAMPLE_DIR }, () => {
  const bmp = readFileSync(join(process.env.SCAN_SAMPLE_DIR!, `${index + 1}.bmp`));
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  const offset = bmp.readUInt32LE(10), width = bmp.readInt32LE(18), signedHeight = bmp.readInt32LE(22);
  const height = Math.abs(signedHeight), bits = bmp.readUInt16LE(28), compression = bmp.readUInt32LE(30);
  assert.ok(width > 0 && height > 0 && [24, 32].includes(bits) && (compression === 0 || compression === 3));
  if (compression === 3) assert.deepEqual([54, 58, 62].map(p => bmp.readUInt32LE(p)), [0xff0000, 0xff00, 0xff]);
  const stride = Math.ceil(width * bits / 32) * 4;
  assert.ok(bmp.length >= offset + stride * height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = offset + (signedHeight > 0 ? height - 1 - y : y) * stride + x * bits / 8;
    data.set([bmp[p + 2], bmp[p + 1], bmp[p], 255], (y * width + x) * 4);
  }
  const found = scanBubbles(data, width, height);
  assert.equal(found.length, expected.length);
  for (const [i, [x, y, w, h]] of expected.entries()) {
    const b = found[i];
    const overlap = Math.max(0, Math.min(x + w, b.x + b.width) - Math.max(x, b.x))
      * Math.max(0, Math.min(y + h, b.y + b.height) - Math.max(y, b.y));
    assert.ok(overlap / (w * h + b.width * b.height - overlap) >= .65, `Dialogue ${i + 1} was missed or cropped incorrectly`);
    assert.equal(b.confidence, index === 5 && i !== 1 ? 'uncertain' : 'high');
  }
});
