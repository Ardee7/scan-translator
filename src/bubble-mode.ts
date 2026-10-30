import type { Selection } from './types';

// Self-contained function injected in the isolated world. Only translated text,
// coordinates and a per-document capability token cross into this content script.
export function bubbleMode(action: 'enable' | 'disable' | 'hide' | 'show' | 'result', token = '', selection?: Selection, text = '', popup = false) {
  const win = window as typeof window & { __scanBubbleMode?: any };
  let mode = win.__scanBubbleMode;
  if (action === 'disable') { mode?.cleanup(); return; }
  if (action === 'hide' || action === 'show') {
    if (mode) mode.host.style.visibility = action === 'hide' ? 'hidden' : 'visible';
    return;
  }
  if (action === 'result') {
    if (!mode || mode.token !== token || !selection || selection.url !== location.href || selection.viewportWidth !== innerWidth || selection.dpr !== devicePixelRatio) return;
    mode.add(selection, text, popup); return;
  }
  mode?.cleanup();
  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .note { position:fixed; bottom:12px; left:12px; background:#17283e; color:white; padding:9px 12px; border-radius:8px; font:13px system-ui; }
    .bubble { position:fixed; box-sizing:border-box; pointer-events:auto; background:white; color:#15263c; border:2px solid #7299d8; border-radius:20px; padding:12px; font:16px/1.45 system-ui; overflow:auto; white-space:pre-wrap; text-align:center; box-shadow:0 2px 8px #0002; }
    .bubble:hover { opacity:0; } .bubble:focus { opacity:1; outline:3px solid #2458b8; }
    </style><div class="note">Click a white bubble to translate · Esc exits · Hover translation to see original</div>`;
  document.documentElement.append(host);
  const cards: { node: HTMLElement; x: number; y: number }[] = [];
  const layout = () => {
    for (const card of cards) { card.node.style.left = `${card.x - scrollX}px`; card.node.style.top = `${card.y - scrollY}px`; }
  };
  const clear = () => { cards.splice(0).forEach(card => card.node.remove()); };
  const scroll = (e: Event) => { if (e.target !== document) clear(); else layout(); };
  const click = (e: MouseEvent) => {
    if (!e.isTrusted || e.button !== 0 || e.composedPath().includes(host) || host.style.visibility === 'hidden') return;
    if (visualViewport && visualViewport.scale !== 1) return;
    e.preventDefault(); e.stopImmediatePropagation();
    void chrome.runtime.sendMessage({ type: 'bubbleClick', token, selection: {
      x: e.clientX, y: e.clientY, width: 8, height: 8, viewportWidth: innerWidth, viewportHeight: innerHeight,
      scrollX, scrollY, dpr: devicePixelRatio, url: location.href,
    } }).catch(() => {});
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { cleanup(); void chrome.runtime.sendMessage({ type: 'bubbleExit', token }).catch(() => {}); } };
  function cleanup() {
    host.remove(); window.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', clear);
    observer.disconnect();
    delete win.__scanBubbleMode;
  }
  const observer = new ResizeObserver(clear);
  observer.observe(document.documentElement);
  window.addEventListener('click', click, true); window.addEventListener('keydown', key, true);
  window.addEventListener('scroll', scroll, true); window.addEventListener('resize', clear);
  win.__scanBubbleMode = { token, host, cleanup, add(s: Selection, translation: string, popup: boolean) {
    const node = document.createElement('div'); node.className = 'bubble'; node.tabIndex = 0;
    node.title = 'Hover to reveal the original. Double-click to dismiss.';
    node.textContent = translation; node.style.width = `${popup ? Math.min(320, innerWidth - 24) : s.width}px`; node.style.height = `${popup ? 160 : s.height}px`;
    node.ondblclick = () => { node.remove(); const index = cards.findIndex(c => c.node === node); if (index >= 0) cards.splice(index, 1); };
    cards.push({ node, x: (popup ? Math.max(12, Math.min(s.x, innerWidth - 332)) : s.x) + s.scrollX, y: (popup ? Math.max(12, Math.min(s.y + s.height + 8, innerHeight - 172)) : s.y) + s.scrollY }); shadow.append(node); layout();
  } };
}
