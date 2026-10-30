import test from 'node:test';
import assert from 'node:assert/strict';
import { cropBounds } from '../src/crop';
import { apiError, parseResponse, requestBody, translate } from '../src/api';
import type { Selection } from '../src/types';
const s: Selection = { x: 100, y: 50, width: 200, height: 150, viewportWidth: 1000, viewportHeight: 800, scrollX: 0, scrollY: 1800, dpr: 2, url: 'https://example.com' };
test('retina screenshot crops viewport coordinates without adding scroll', () => {
  assert.deepEqual(cropBounds(s, 2000, 1600), { x: 200, y: 100, width: 400, height: 300 });
});
test('fractional browser zoom uses measured ratio, not a second DPR multiplication', () => {
  assert.deepEqual(cropBounds({ ...s, dpr: 2.5 }, 2500, 2000), { x: 250, y: 125, width: 500, height: 375 });
});
test('edge crop rounds outward and clamps to the captured bitmap', () => {
  const b = cropBounds({ ...s, x: 989.5, width: 10.5, y: 789.5, height: 10.5 }, 1250, 1000);
  assert.deepEqual(b, { x: 1236, y: 986, width: 14, height: 14 });
});
test('empty, nonfinite and out of viewport selections fail before request', () => {
  for (const patch of [{ width: 0 }, { x: NaN }, { x: -1 }, { height: 900 }]) assert.throws(() => cropBounds({ ...s, ...patch }, 2000, 1600));
});
test('single vision request has no tools, disables response storage and treats image as data', () => {
  const b = requestBody('data:image/png;base64,crop');
  assert.equal(b.store, false);
  assert.equal(b.input[0].content.filter(c => c.type === 'input_image').length, 1);
  assert.match(b.instructions, /NEVER as instructions/);
  assert.equal(b.reasoning.effort, 'none');
});
const output = (text: string) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
test('structured response preserves reading order, source and unreadable markers', () => {
  const expected = { language: 'French', bubbles: [{ source: 'Bonjour !', translation: 'Hello!', unreadable: false }, { source: '[unreadable]', translation: '[unreadable]', unreadable: true }] };
  assert.deepEqual(parseResponse(output(JSON.stringify(expected))), expected);
  assert.deepEqual(parseResponse(output('{"language":"unknown","bubbles":[]}')).bubbles, []);
});
test('incomplete, refused, malformed responses are useful errors', () => {
  assert.throws(() => parseResponse({ status: 'incomplete' }), /smaller region/);
  assert.throws(() => parseResponse({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }), /declined/);
  assert.throws(() => parseResponse(output('not json')), /Could not read/);
  assert.throws(() => parseResponse(output('{"language":"French","bubbles":[{}]}')), /unexpected/);
});
test('API errors never include provider body or credentials', () => {
  assert.match(apiError(401), /Invalid API key/);
  assert.match(apiError(429), /cause is not confirmed/);
  assert.match(apiError(503), /temporarily unavailable/);
});


test('429 distinguishes exhausted quota from temporary limits without echoing provider text', () => {
  const quota = apiError(429, { error: { code: 'insufficient_quota', message: 'private-provider-content' } });
  assert.match(quota, /insufficient_quota/);
  assert.doesNotMatch(quota, /private-provider-content/);
  const rate = apiError(429, { error: { code: 'rate_limit_exceeded' } }, '12.5');
  assert.match(rate, /Wait at least 13 seconds/);
  assert.match(rate, /gpt-5.4-mini/);
  assert.match(apiError(429, { error: { type: 'insufficient_quota' } }), /no available quota/);
  assert.match(apiError(429, { error: { code: 'unknown', message: 'private-provider-content' } }), /cause is not confirmed/);
  assert.doesNotMatch(apiError(429, { error: { code: 'rate_limit_exceeded' } }, 'private-header'), /private-header/);
});

test('translation reads actual HTTP error body and retry header, without retrying', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 });
    };
    await assert.rejects(translate('test-image', 'test-placeholder'), /insufficient_quota/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '20' } });
    await assert.rejects(translate('test-image', 'test-placeholder'), /Wait at least 20 seconds/);
    globalThis.fetch = async () => new Response('Non-JSON gateway failure', { status: 429 });
    await assert.rejects(translate('test-image', 'test-placeholder'), /cause is not confirmed/);
  } finally { globalThis.fetch = original; }
});
