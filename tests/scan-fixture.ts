export function scanFixture() {
  const width = 800, height = 600, data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, c: number[]) => data.set([...c, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, [100, 130, 100]);
  const boxes = [{ x: 50, y: 50, width: 150, height: 100 }, { x: 350, y: 50, width: 150, height: 100 },
    { x: 50, y: 300, width: 150, height: 100 }, { x: 350, y: 300, width: 150, height: 100 }];
  boxes.forEach((b, i) => {
    const bg = i % 2 ? [20, 20, 20] : [250, 230, 170], ink = i % 2 ? [255, 255, 255] : [0, 0, 0];
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) paint(x, y, bg);
    for (let j = 0; j < 5; j++) for (let y = 0; y < 18; y++) for (let x = 0; x < 10; x++) {
      if (x < 2 || x >= 8 || y === 9) paint(b.x + 20 + j * 18 + x, b.y + 30 + y, ink);
    }
  });
  // A solid colored region and a clipped region should not become candidates.
  for (let y = 10; y < 100; y++) for (let x = 650; x < 750; x++) paint(x, y, [255, 255, 255]);
  return { data, width, height, boxes };
}
