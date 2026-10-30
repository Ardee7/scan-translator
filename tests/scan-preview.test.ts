import test from 'node:test';
import assert from 'node:assert/strict';
import { previewScan } from '../src/scan-preview';
import type { Selection } from '../src/types';

test('Space confirms only the selected bubbles; repeats, modifiers and synthetic events cannot approve', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const listeners = new Map<string, (e: any) => void>();
  let root: ElementStub;
  class ElementStub {
    style: any = {}; children: ElementStub[] = []; removed = false; disabled = false;
    innerHTML = ''; textContent = ''; className = ''; onclick?: () => void;
    nodes = new Map<string, ElementStub>();
    attachShadow() { root = new ElementStub(); return root; }
    querySelector(selector: string) { if (!this.nodes.has(selector)) this.nodes.set(selector, new ElementStub()); return this.nodes.get(selector)!; }
    append(child: ElementStub) { this.children.push(child); }
    setAttribute() {}
    addEventListener(_type: string, handler: () => void) { this.onclick = handler; }
    remove() { this.removed = true; }
    focus() {}
  }
  Object.assign(globalThis, {
    window: { addEventListener: (type: string, handler: any) => listeners.set(type, handler), removeEventListener: (type: string) => listeners.delete(type) },
    document: { createElement: () => new ElementStub(), documentElement: new ElementStub(), addEventListener() {}, removeEventListener() {} },
  });
  const regions = [0, 1].map(i => ({ x: i * 100, y: 10, width: 90, height: 80 } as Selection));
  const space = (extra: object = {}) => {
    const e = { key: ' ', code: 'Space', isTrusted: true, repeat: false, prevented: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
    listeners.get('keydown')!(e); return e;
  };
  try {
    const result = previewScan(regions);
    root!.querySelector('.regions').children[0].onclick!(); // Deselect first region.
    space({ repeat: true }); space({ ctrlKey: true }); space({ metaKey: true }); space({ shiftKey: true }); space({ isTrusted: false });
    assert.ok(listeners.has('keydown'));
    assert.equal(space().prevented, true);
    assert.deepEqual(await result, [1]);
    assert.equal(listeners.has('keydown'), false); // Space no longer intercepted after review.

    const empty = previewScan(regions);
    root!.querySelector('.regions').children.forEach(button => button.onclick!());
    assert.equal(root!.querySelector('#translate').disabled, true);
    space(); assert.ok(listeners.has('keydown'));
    listeners.get('keydown')!({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(await empty, []);
  } finally {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
  }
});
