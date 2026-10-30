import type { Selection } from './types';

export function cropBounds(s: Selection, imageWidth: number, imageHeight: number) {
  if (![s.x, s.y, s.width, s.height, s.viewportWidth, s.viewportHeight, imageWidth, imageHeight].every(Number.isFinite)
    || s.viewportWidth <= 0 || s.viewportHeight <= 0 || s.width < 8 || s.height < 8
    || s.x < 0 || s.y < 0 || s.x + s.width > s.viewportWidth + 1 || s.y + s.height > s.viewportHeight + 1) {
    throw new Error('Select a larger rectangle inside the visible page.');
  }
  // Actual bitmap / CSS viewport ratios incorporate devicePixelRatio and browser zoom.
  // client coordinates already exclude document scrolling: do not add scrollX/Y.
  const sx = imageWidth / s.viewportWidth;
  const sy = imageHeight / s.viewportHeight;
  const x = Math.max(0, Math.floor(s.x * sx));
  const y = Math.max(0, Math.floor(s.y * sy));
  const right = Math.min(imageWidth, Math.ceil((s.x + s.width) * sx));
  const bottom = Math.min(imageHeight, Math.ceil((s.y + s.height) * sy));
  return { x, y, width: right - x, height: bottom - y };
}

export async function cropScreenshot(dataUrl: string, selection: Selection): Promise<string> {
  // Decode locally; no network fetch or original image URL access.
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const b = cropBounds(selection, bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(b.width, b.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not crop the screenshot. Please try again.');
    ctx.drawImage(bitmap, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (let i = 0; i < png.length; i += 8192) binary += String.fromCharCode(...png.subarray(i, i + 8192));
    canvas.width = canvas.height = 1;
    return `data:image/png;base64,${btoa(binary)}`;
  } finally {
    bitmap.close();
  }
}
