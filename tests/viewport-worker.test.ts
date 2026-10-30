import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFixture } from './scan-fixture';
import type { State, Selection } from '../src/types';

test('viewport capture previews free, submits only approved crops, skips repeats, limits concurrency and stops queued work', async () => {
  const fixture = scanFixture();
  let listener: any, state: State | undefined, captures = 0, requests = 0;
  let preview: { regions: Selection[]; resolve: (v: any) => void } | undefined;
  const replies: ((r: Response) => void)[] = [];
  const storage: Record<string, any> = { apiKey: 'test-key', paidConsent: true };
  const session: Record<string, any> = {};
  const viewport = { viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 0, dpr: 1, url: 'https://comic.test/', visible: true, scale: 1 };
  const tab = { id: 7, windowId: 1, url: viewport.url };
  const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html' };
  const events = { addListener() {} };
  const oldFetch = globalThis.fetch;
  Object.assign(globalThis, {
    chrome: {
      storage: { local: { setAccessLevel: async () => {}, get: async () => ({ ...storage }), set: async (v: object) => Object.assign(storage, v), remove: async (key: string) => { delete storage[key]; } },
        session: { get: async () => ({ ...session }), set: async (v: object) => Object.assign(session, v), remove: async (key: string) => { delete session[key]; } } },
      sidePanel: { setPanelBehavior: async () => {}, open: async () => {} }, action: { onClicked: events }, commands: { onCommand: events },
      runtime: { id: 'test', getURL: (s: string) => `chrome-extension://test/${s}`, getPlatformInfo: async () => ({}), sendMessage: async (m: any) => { state = m.state; }, onMessage: { addListener: (fn: any) => { listener = fn; } } },
      tabs: { onUpdated: events, onRemoved: events, query: async () => [tab], captureVisibleTab: async () => { captures++; return 'data:image/png;base64,RlVMTA=='; } },
      scripting: { executeScript: async (call: any) => {
        if (call.func.name === 'viewportState') return [{ result: { ...viewport } }];
        if (call.func.name === 'previewScan') return new Promise(resolve => { preview = { regions: call.args[0], resolve: result => { preview = undefined; resolve([{ result }]); } }; });
        return [{}];
      } },
    },
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    OffscreenCanvas: class {
      crop = '';
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: (_: any, ...args: number[]) => { this.crop = JSON.stringify(args); }, getImageData: () => ({ data: fixture.data }) }; }
      async convertToBlob() { return new Blob([this.crop]); }
    },
    fetch: async (_: string, init: RequestInit) => {
      const image = JSON.parse(init.body as string).input[0].content[1].image_url;
      const bounds = JSON.parse(atob(image.split(',')[1]));
      assert.equal(bounds.length, 8); assert.equal(bounds[2], 150); assert.equal(bounds[3], 100);
      requests++; return new Promise<Response>(r => replies.push(r));
    },
  });
  const send = (message: object) => listener(message, sender, () => {});
  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 1000 && !check(); i++) await new Promise(r => setTimeout(r, 5));
    assert.ok(check());
  };
  const response = () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ language: 'fr', bubbles: [{ source: 'Bonjour', translation: 'Hello', unreadable: false }] }) }] }] }));
  try {
    await import('../src/worker');
    send({ type: 'scanViewport', windowId: 1 });
    await wait(() => !!preview);
    assert.equal(captures, 1); assert.equal(requests, 0); assert.equal(preview!.regions.length, 4);
    preview!.resolve([]);
    await wait(() => !state?.batch);
    assert.equal(requests, 0); assert.match(state!.message, /cancelled/);

    send({ type: 'scanViewport', windowId: 1 });
    await wait(() => !!preview);
    preview!.resolve([0, 2, 2, -1, 999]); // Deduplicate and validate approval indices.
    await wait(() => requests === 2);
    assert.equal(state!.activeRequests, 2); assert.equal(captures, 2);
    replies.splice(0).forEach(r => r(response()));
    await wait(() => !state?.batch);
    assert.equal(state!.history!.length, 2);
    send({ type: 'scanViewport', windowId: 1 });
    await wait(() => !!preview);
    assert.deepEqual(preview!.regions.map(r => r.x), [350, 350]);
    assert.equal(requests, 2);
    preview!.resolve([]); await wait(() => !state?.batch);

    send({ type: 'clear' }); await wait(() => state!.history!.length === 0);
    send({ type: 'scanViewport', windowId: 1 }); await wait(() => !!preview);
    preview!.resolve([0, 1, 2, 3]); await wait(() => requests === 5);
    assert.equal(state!.activeRequests, 3);
    send({ type: 'start', windowId: 1 }); // Cannot exceed batch concurrency through manual UI.
    send({ type: 'stopBatch' });
    replies.splice(0).forEach(r => r(response()));
    await wait(() => !state?.batch);
    assert.equal(requests, 5); assert.equal(state!.history!.length, 3);
    assert.match(state!.message, /Stopped/);

    send({ type: 'clear' }); await wait(() => state!.history!.length === 0);
    send({ type: 'scanViewport', windowId: 1 }); await wait(() => !!preview);
    preview!.resolve([0, 1, 2, 3]); await wait(() => requests === 8);
    replies.shift()!(new Response('{}', { status: 401 }));
    await wait(() => !!state!.batch?.cancelled);
    replies.splice(0).forEach(r => r(response()));
    await wait(() => !state?.batch);
    assert.equal(requests, 8); assert.equal(state!.history!.length, 2);
    assert.match(state!.message, /stopped after an error/);
    assert.equal(storage.apiKey, 'test-key');

    send({ type: 'clear' }); await wait(() => state!.history!.length === 0);
    send({ type: 'scanViewport', windowId: 1 }); await wait(() => !!preview);
    viewport.scrollY = 20; preview!.resolve([0]);
    await wait(() => !state?.batch);
    assert.equal(requests, 8); assert.match(state!.message, /page moved/i);
  } finally { globalThis.fetch = oldFetch; }
});
