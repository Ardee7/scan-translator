import type { Selection } from './types';

// Self-contained function injected in the isolated world. Only translated text,
// coordinates and a per-document capability token cross into this content script.
export function bubbleMode(action: 'enable' | 'disable' | 'hide' | 'show' | 'result' | 'status', token = '', selection?: Selection | null, text = '', popup = false) {
  const win = window as typeof window & { __scanBubbleMode?: any };
  let mode = win.__scanBubbleMode;
  if (action === 'disable') { mode?.cleanup(); return; }
  if (action === 'hide' || action === 'show') {
    if (mode) mode.host.style.visibility = action === 'hide' ? 'hidden' : 'visible';
    return;
  }
  if (action === 'status') {
    if (mode?.token === token) mode.status(text);
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
    .bubble { position:fixed; box-sizing:border-box; pointer-events:auto; background:white; color:#15263c; border:2px solid #7299d8; border-radius:20px; padding:16px; font:24px/1.4 system-ui; font-weight:500; display:flex; flex-direction:column; overflow:auto; white-space:pre-wrap; text-align:center; box-shadow:0 2px 8px #0002; }
    .translation { flex:none; margin:auto 0; width:100%; overflow-wrap:anywhere; }
    .loading { position:fixed; left:16px; top:16px; display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:16px; background:#17283e; color:white; font:14px system-ui; pointer-events:none; }
    .loading[hidden] { display:none; }
    .spinner { width:14px; height:14px; border:2px solid #ffffff55; border-top-color:white; border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { .spinner { animation:none; } }
    .bubble:hover { opacity:0; } .bubble:focus { opacity:1; outline:3px solid #2458b8; }
    </style><div class="loading" hidden role="status"><span class="spinner"></span><span class="loading-text"></span></div><div class="note">Click inside a bubble to translate · Esc exits · Hover translation to see original</div>`;
  document.documentElement.append(host);
  const loading = shadow.querySelector<HTMLElement>('.loading')!;
  const loadingText = shadow.querySelector<HTMLElement>('.loading-text')!;
  const pointer = (e: MouseEvent) => {
    loading.style.left = `${Math.max(0, Math.min(e.clientX + 18, innerWidth - loading.offsetWidth - 8))}px`;
    loading.style.top = `${Math.max(0, Math.min(e.clientY + 20, innerHeight - loading.offsetHeight - 8))}px`;
  };
  const cards: { node: HTMLElement; x: number; y: number }[] = [];
  const layout = () => {
    for (const card of cards) { card.node.style.left = `${card.x - scrollX}px`; card.node.style.top = `${card.y - scrollY}px`; }
  };
  const clear = () => { cards.splice(0).forEach(card => card.node.remove()); };
  const scroll = (e: Event) => { if (e.composedPath().includes(host)) return; if (e.target !== document) clear(); else layout(); };
  const click = (e: MouseEvent) => {
    if (!e.isTrusted || e.button !== 0 || e.composedPath().includes(host) || host.style.visibility === 'hidden') return;
    if (visualViewport && visualViewport.scale !== 1) return;
    pointer(e);
    e.preventDefault(); e.stopImmediatePropagation();
    void chrome.runtime.sendMessage({ type: 'bubbleClick', token, selection: {
      x: e.clientX, y: e.clientY, width: 8, height: 8, viewportWidth: innerWidth, viewportHeight: innerHeight,
      scrollX, scrollY, dpr: devicePixelRatio, url: location.href,
    } }).catch(() => {});
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && host.style.visibility !== 'hidden') { cleanup(); void chrome.runtime.sendMessage({ type: 'bubbleExit', token }).catch(() => {}); } };
  function cleanup() {
    host.remove(); window.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', clear);
    window.removeEventListener('pointermove', pointer, true);
    observer.disconnect();
    delete win.__scanBubbleMode;
  }
  const observer = new ResizeObserver(clear);
  observer.observe(document.documentElement);
  window.addEventListener('pointermove', pointer, true);
  window.addEventListener('click', click, true); window.addEventListener('keydown', key, true);
  window.addEventListener('scroll', scroll, true); window.addEventListener('resize', clear);
  win.__scanBubbleMode = { token, host, cleanup, status(text: string) { loadingText.textContent = text; loading.hidden = !text; }, add(s: Selection, translation: string, popup: boolean) {
    const node = document.createElement('div'); node.className = 'bubble'; node.tabIndex = 0;
    node.title = 'Hover to reveal the original. Click to keep text visible and scroll. Double-click to dismiss.';
    const content = document.createElement('div'); content.className = 'translation'; content.textContent = translation; node.append(content);
    node.style.width = `${popup ? Math.min(320, innerWidth - 24) : s.width}px`; node.style.height = `${popup ? 160 : s.height}px`;
    node.ondblclick = () => { node.remove(); const index = cards.findIndex(c => c.node === node); if (index >= 0) cards.splice(index, 1); };
    cards.push({ node, x: (popup ? Math.max(12, Math.min(s.x, innerWidth - 332)) : s.x) + s.scrollX, y: (popup ? Math.max(12, Math.min(s.y + s.height + 8, innerHeight - 172)) : s.y) + s.scrollY }); shadow.append(node); layout();
    // Fit to the actual rendered text, keeping a readable floor for long dialogue.
    // Auto margins center short text and collapse to zero when scrolling is needed.
    for (let size = 48; size >= 24; size--) {
      node.style.fontSize = `${size}px`;
      if (content.scrollHeight <= node.clientHeight - 32 && content.scrollWidth <= node.clientWidth - 32) break;
    }
  } };
}
