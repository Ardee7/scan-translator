import type { Selection } from './types';

// Self-contained injected UI: no screenshots or credentials enter the page.
export function previewScan(regions: Selection[]): Promise<number[]> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      button { font:16px/1.4 system-ui; cursor:pointer; }
      .region { position:fixed; box-sizing:border-box; border:3px solid #2563eb; border-radius:10px; background:#60a5fa33; color:#102342; text-align:left; vertical-align:top; }
      .region[aria-pressed="false"] { border:3px dashed #777; background:#8882; }
      .number { position:absolute; top:0; left:0; padding:2px 7px; background:#fff; border-radius:5px; }
      .controls { position:fixed; bottom:16px; left:16px; max-width:440px; padding:16px; border-radius:12px; background:#17283e; color:white; font:16px/1.5 system-ui; box-shadow:0 2px 12px #0005; }
      .controls button { padding:8px 12px; margin:8px 8px 0 0; }
      </style><div class="regions"></div><div class="controls" role="dialog" aria-label="Review detected bubbles">
      Click a highlighted region to include or exclude it. Press Space to translate your selection. Detection can mistake artwork for text.
      <div id="count" aria-live="polite"></div><div id="estimate"></div><small>Each selected bubble uses one normal paid translation request. Actual cost varies with image size and dialogue.</small><br>
      <button id="translate"></button><button id="cancel">Cancel (Esc)</button></div>`;
    const selected = new Set(regions.map((_, i) => i));
    const confirm = root.querySelector<HTMLButtonElement>('#translate')!;
    const refresh = () => {
      root.querySelector('#count')!.textContent = `${selected.size} of ${regions.length} bubbles selected`;
      root.querySelector('#estimate')!.textContent = `Example total: ~$${(selected.size * .00375).toFixed(4)} at 2,000 input + 500 output tokens per bubble, using the rates in Settings. This is not a spending cap.`;
      confirm.textContent = `Translate ${selected.size} bubbles (Space)`; confirm.disabled = !selected.size;
    };
    regions.forEach((r, i) => {
      const button = document.createElement('button'); button.className = 'region';
      button.setAttribute('aria-label', `Include bubble ${i + 1}`); button.setAttribute('aria-pressed', 'true');
      Object.assign(button.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      const number = document.createElement('span'); number.className = 'number'; number.textContent = `${i + 1}`; button.append(number);
      button.onclick = () => { if (selected.has(i)) selected.delete(i); else selected.add(i); button.setAttribute('aria-pressed', String(selected.has(i))); refresh(); };
      root.querySelector('.regions')!.append(button);
    });
    const finish = (indices: number[]) => {
      clearTimeout(timer); host.remove(); window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', cancel, true); window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel); resolve(indices);
    };
    const cancel = () => finish([]);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
      if ((e.code === 'Space' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        // One deliberate press approves the preview; page-generated events cannot submit.
        if (e.isTrusted && !e.repeat && selected.size) finish([...selected].sort((a, b) => a - b));
      }
    };
    const timer = setTimeout(cancel, 60_000);
    confirm.onclick = () => finish([...selected].sort((a, b) => a - b)); root.querySelector('#cancel')!.addEventListener('click', cancel);
    window.addEventListener('keydown', key, true); window.addEventListener('scroll', cancel, true); window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    refresh(); document.documentElement.append(host); confirm.focus();
  });
}
