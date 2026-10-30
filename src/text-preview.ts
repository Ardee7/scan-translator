import type { Selection } from './types';

// Runs in the isolated world. No image or API key is passed to the page.
export function confirmTextRegion(s: Selection): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .box { position:fixed; border:3px solid #2563eb; box-sizing:border-box; background:#60a5fa22; }
      .note { position:fixed; bottom:20px; left:20px; max-width:420px; padding:16px; border-radius:12px; background:#17283e; color:white; font:16px/1.5 system-ui; }
      button { margin:8px 8px 0 0; padding:8px 12px; font:inherit; cursor:pointer; }
      </style><div class="box"></div><div class="note">Translate the highlighted text? Uses your existing API credits.<br><button id="confirm">Translate (Enter)</button><button id="cancel">Cancel (Esc)</button></div>`;
    const box = root.querySelector<HTMLElement>('.box')!;
    Object.assign(box.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.width}px`, height: `${s.height}px` });
    const finish = (ok: boolean) => {
      clearTimeout(timer); host.remove(); window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', cancel, true); window.removeEventListener('resize', cancel);
      resolve(ok);
    };
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); finish(e.key === 'Enter');
    };
    const timer = setTimeout(cancel, 30_000);
    root.querySelector('#confirm')!.addEventListener('click', e => { e.stopPropagation(); finish(true); });
    root.querySelector('#cancel')!.addEventListener('click', cancel);
    window.addEventListener('keydown', key, true); window.addEventListener('scroll', cancel, true); window.addEventListener('resize', cancel);
    document.documentElement.append(host);
    (root.querySelector('#confirm') as HTMLButtonElement).focus();
  });
}
