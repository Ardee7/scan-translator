import test from 'node:test';
import assert from 'node:assert/strict';
import type { State } from '../src/types';

test('worker workflow: crop only, duplicate guard, errors, retry, trusted storage and clear', async () => {
  let listener: any;
  let actionListener: any;
  let commandListener: any;
  let openedWindow: number | undefined;
  let tabUrl: string | undefined = 'https://example.com';
  let state: State | undefined;
  let requests = 0;
  let captures = 0;
  let httpStatus = 200;
  let activeId = 7;
  let accessLevel = '';
  let selectGate: (() => void) | undefined;
  let waitSelection = false;
  const savedEntry = { id: 'saved-before-worker-start', createdAt: 1, result: { language: 'French', bubbles: [{ source: 'Salut', translation: 'Hi', unreadable: false }] } };
  const storage: Record<string, unknown> = { apiKey: 'test-only-placeholder', paidConsent: true, history: [savedEntry] };
  const viewport = { viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 900, dpr: 2, url: 'https://example.com', visible: true, scale: 1 };
  const selection = { ...viewport, x: 100, y: 50, width: 200, height: 150 };
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, {
    chrome: {
      storage: { local: {
        setAccessLevel: async (v: any) => { accessLevel = v.accessLevel; },
        get: async () => ({ ...storage }),
        set: async (v: any) => Object.assign(storage, v),
        remove: async (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storage[k]),
      } },
      sidePanel: { setPanelBehavior: async (v: any) => assert.equal(v.openPanelOnActionClick, false), open: async (v: any) => { openedWindow = v.windowId; } },
      commands: { onCommand: { addListener: (fn: any) => { commandListener = fn; } } },
      action: { onClicked: { addListener: (fn: any) => { actionListener = fn; } } },
      runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test/${p}`, getPlatformInfo: async () => ({}),
        sendMessage: async (v: any) => { state = v.state; }, onMessage: { addListener: (fn: any) => { listener = fn; } } },
      tabs: {
        query: async () => [{ id: activeId, windowId: 1, url: tabUrl }],
        captureVisibleTab: async () => { captures++; return 'data:image/png;base64,RlVMTA=='; },
      },
      scripting: { executeScript: async (v: any) => {
        if (v.func.name === 'selectArea') {
          if (waitSelection) await new Promise<void>(r => { selectGate = r; });
          return [{ result: selection }];
        }
        return [{ result: viewport }];
      } },
    },
    createImageBitmap: async () => ({ width: 2000, height: 1600, close() {} }),
    OffscreenCanvas: class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: (_: unknown, ...args: number[]) => assert.deepEqual(args, [200, 100, 400, 300, 0, 0, 400, 300]) }; }
      async convertToBlob() { return new Blob(['CROP']); }
    },
    fetch: async (_url: string, init: RequestInit) => {
      requests++;
      const body = JSON.parse(init.body as string);
      assert.equal(body.input[0].content[1].image_url, 'data:image/png;base64,Q1JPUA==');
      assert.equal(body.store, false);
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ language: 'French', bubbles: [{ source: 'Bonjour', translation: 'Hello', unreadable: false }] }) }] }] }), { status: httpStatus });
    },
  });
  const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html' };
  const send = (message: object, from = sender) => listener(message, from, () => {});
  const until = async (phase: string) => {
    for (let i = 0; i < 100 && state?.phase !== phase; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(state?.phase, phase);
  };
  try {
    await import('../src/worker');
    actionListener({ id: 7, windowId: 1 });
    assert.equal(openedWindow, 1);
    tabUrl = undefined;
    send({ type: 'start', windowId: 1 });
    await until('error');
    assert.match(state!.message, /Access to this tab has not been granted/);
    assert.equal(captures, 0);
    assert.equal(requests, 0);
    state = undefined;
    tabUrl = 'chrome://extensions/';
    send({ type: 'start', windowId: 1 });
    await until('error');
    assert.match(state!.message, /This page is restricted/);
    tabUrl = viewport.url;
    send({ type: 'start', windowId: 1 }, { id: 'test', url: 'https://example.com' });
    assert.equal(captures, 0);
    waitSelection = true;
    commandListener('select-area', { id: 7, windowId: 1 });
    commandListener('select-area', { id: 7, windowId: 1 });
    await until('selecting');
    assert.equal(requests, 0); // Shortcut alone must not transmit an image.
    assert.equal(state!.history?.[0].id, savedEntry.id); // Restored on worker startup.
    send({ type: 'start', windowId: 1 });
    await new Promise(r => setTimeout(r, 0));
    selectGate!();
    await until('success');
    assert.equal(requests, 1);
    assert.equal(captures, 1);
    assert.equal(accessLevel, 'TRUSTED_CONTEXTS');
    assert.equal(state!.result?.bubbles[0].translation, 'Hello');
    assert.equal(state!.history?.length, 2);
    assert.equal(state!.history?.[1].id, savedEntry.id);
    assert.deepEqual(storage.history, state!.history);
    assert.doesNotMatch(JSON.stringify(storage.history), /data:image/);
    waitSelection = false;
    httpStatus = 401;
    send({ type: 'start', windowId: 1 });
    await until('error');
    assert.match(state!.message, /Invalid API key/);
    assert.equal(state!.history?.length, 2); // API failure does not erase prior results.
    assert.equal(storage.apiKey, 'test-only-placeholder');
    httpStatus = 200;
    send({ type: 'start', windowId: 1 });
    await until('success');
    assert.equal(requests, 3);
    assert.equal(state!.history?.length, 3);
    send({ type: 'clear' });
    await until('idle');
    assert.deepEqual(state!.history, []);
    assert.equal(storage.history, undefined);
    assert.equal(storage.apiKey, 'test-only-placeholder');
    assert.equal(state!.result, undefined);
    waitSelection = true;
    send({ type: 'start', windowId: 1 });
    await until('selecting');
    await new Promise(r => setTimeout(r, 0));
    activeId = 8;
    selectGate!();
    await until('error');
    assert.match(state!.message, /active tab changed/);
    assert.equal(requests, 3);
  } finally { globalThis.fetch = originalFetch; }
});
