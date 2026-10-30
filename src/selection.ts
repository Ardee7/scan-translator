import type { Selection } from './types';

// Serialized by chrome.scripting.executeScript into an isolated content-script world.
// Keep this function self-contained; it never receives a key or screenshot.
export async function selectArea(): Promise<Selection | { error: string }> {
  if (window.visualViewport && (window.visualViewport.scale !== 1 || window.visualViewport.offsetLeft !== 0 || window.visualViewport.offsetTop !== 0)) {
    return { error: 'Reset pinch zoom before selecting. Normal browser zoom is supported.' };
  }
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; } .overlay { position:fixed; inset:0; cursor:crosshair; background:#0002; touch-action:none; user-select:none; }
      .hint { position:absolute; top:16px; left:50%; transform:translateX(-50%); padding:10px 16px; background:#17202e; color:white; border-radius:8px; font:14px system-ui; pointer-events:none; }
      .box { position:fixed; border:2px solid #38bdf8; background:#38bdf822; box-sizing:border-box; pointer-events:none; }
      </style><div class="overlay"><div class="hint">Drag to translate • Release to send • Esc to cancel</div><div class="box" hidden></div></div>`;
    document.documentElement.append(host);
    const overlay = shadow.querySelector<HTMLDivElement>('.overlay')!;
    const box = shadow.querySelector<HTMLDivElement>('.box')!;
    const initial = { viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY, dpr: devicePixelRatio, url: location.href };
    let start: { x: number; y: number } | undefined;
    let finished = false;
    const stopScroll = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish({ error: 'Selection cancelled. Choose another area when ready.' }); }
      else if ([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
    };
    const changed = () => finish({ error: 'The page moved or resized. Select the area again.' });
    const hidden = () => { if (document.hidden) finish({ error: 'Tab changed. Return to the comic and select again.' }); };
    const timer = setTimeout(() => finish({ error: 'Selection timed out. Please try again.' }), 120_000);
    function finish(value: Selection | { error: string }) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      host.remove();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', stopScroll, true);
      window.removeEventListener('touchmove', stopScroll, true);
      window.removeEventListener('resize', changed);
      window.removeEventListener('scroll', changed, true);
      document.removeEventListener('visibilitychange', hidden);
      // Wait for overlay removal to be painted before allowing capture.
      if ('error' in value) { resolve(value); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(value), 80)));
      // If the tab becomes hidden between frames, do not leave the worker busy forever.
      setTimeout(() => resolve({ error: 'Capture was interrupted. Select the area again.' }), 2000);
    }
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', stopScroll, { capture: true, passive: false });
    window.addEventListener('touchmove', stopScroll, { capture: true, passive: false });
    window.addEventListener('resize', changed);
    window.addEventListener('scroll', changed, true);
    document.addEventListener('visibilitychange', hidden);
    overlay.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      overlay.setPointerCapture(e.pointerId);
      box.hidden = false;
    };
    const rect = (e: PointerEvent) => {
      const x = Math.max(0, Math.min(innerWidth, e.clientX));
      const y = Math.max(0, Math.min(innerHeight, e.clientY));
      return { x: Math.min(start!.x, x), y: Math.min(start!.y, y), width: Math.abs(x - start!.x), height: Math.abs(y - start!.y) };
    };
    overlay.onpointermove = e => {
      if (!start) return;
      const r = rect(e);
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    overlay.onpointerup = e => {
      if (!start) return;
      const r = rect(e);
      finish(r.width < 8 || r.height < 8 ? { error: 'Empty selection. Drag a rectangle at least 8 × 8 pixels.' } : { ...r, ...initial });
    };
    overlay.onpointercancel = () => finish({ error: 'Selection cancelled. Please try again.' });
  });
}

export function viewportState() {
  return { viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY, dpr: devicePixelRatio, url: location.href, visible: !document.hidden, scale: visualViewport?.scale ?? 1 };
}
