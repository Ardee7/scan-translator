import { cropScreenshot } from './crop';
import { translate } from './api';
import { selectArea, viewportState } from './selection';
import type { HistoryEntry, ScanJob, Selection, State } from './types';

const protectedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
// Handle the action explicitly so the click invokes activeTab before opening the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    update({ phase: 'error', message: 'Could not open the side panel. Click the extension toolbar icon again.' });
  });
});
let state: State = { phase: 'idle', message: 'Save your API key, then select a visible comic region.' };
let history: HistoryEntry[] = [];
const historyReady = protectedStorage.then(async () => {
  const saved = await chrome.storage.local.get('history');
  history = Array.isArray(saved.history) ? saved.history as HistoryEntry[] : [];
  state = { ...state, history };
});
let busy = false; // Only selection/capture owns this lock; API calls may overlap.
let jobs: ScanJob[] = [];
const activeRequests = () => jobs.filter(job => job.status === 'translating').length;
let lastCaptureAt = 0;
let lastScanAt = 0;
let historyWrite = Promise.resolve();
let openingFromShortcut = false;
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'select-area' || !tab?.id || busy || activeRequests() >= 3 || openingFromShortcut) return;
  openingFromShortcut = true;
  // Open directly in the keyboard gesture; awaiting other work first can lose that gesture.
  void chrome.sidePanel.open({ windowId: tab.windowId }).then(async () => {
    // Let the panel's opening resize finish before measuring the selection viewport.
    await new Promise(resolve => setTimeout(resolve, 300));
    openingFromShortcut = false;
    void run(tab.windowId, tab.id);
  }).catch(() => {
    update({ phase: 'error', message: 'Could not open the side panel. Click the Scan Translator toolbar icon and try the shortcut again.' });
  }).finally(() => { openingFromShortcut = false; });
});
function update(next: State) {
  // A completed background request must not replace instructions for the current selection.
  const visible = busy && (next.phase === 'success' || next.phase === 'error')
    ? { ...next, phase: state.phase, message: state.message } : next;
  state = { ...visible, history, jobs: [...jobs], captureBusy: busy, activeRequests: activeRequests() };
  void chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
}
async function assertSameViewport(tab: chrome.tabs.Tab, s: Selection) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) throw new Error('The active tab changed. Return to the comic and select again.');
  const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: viewportState });
  const v = frame.result;
  if (!v || !v.visible || v.scale !== 1 || (['viewportWidth', 'viewportHeight', 'scrollX', 'scrollY', 'dpr', 'url'] as const).some(k => v[k] !== s[k])) {
    throw new Error('The page moved, navigated or zoom changed. Select the region again.');
  }
}
async function run(windowId: number, expectedTabId?: number) {
  if (busy || activeRequests() >= 3) return;
  busy = true; // Acquire before any await: duplicate side panels cannot submit twice.
  // Chrome API activity keeps MV3 alive while selecting and awaiting the provider.
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  let ownsCapture = true;
  let job: ScanJob | undefined;
  let screenshot = '';
  let cropped = '';
  try {
    await historyReady;
    const { apiKey, paidConsent } = await chrome.storage.local.get(['apiKey', 'paidConsent']);
    if (typeof apiKey !== 'string' || !apiKey) throw new Error('Add your personal OpenAI API key in Settings first.');
    if (!paidConsent) throw new Error('Review the API pricing and enable paid requests in Settings first.');
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (expectedTabId !== undefined && tab?.id !== expectedTabId) throw new Error('The active tab changed. Press the shortcut again on your comic tab.');
    if (!tab?.id) throw new Error('No active tab found. Switch to your comic tab and try again.');
    if (!tab.url) throw new Error('Access to this tab has not been granted. Close this side panel, then click the Scan Translator S icon in Chrome’s toolbar on the comic tab. Opening the panel from Chrome’s side-panel menu does not grant tab access.');
    if (!/^https?:\/\//.test(tab.url)) throw new Error('This page is restricted. Open an HTTP/HTTPS comic page, then click the Scan Translator toolbar icon.');
    update({ phase: 'selecting', message: 'Drag a rectangle on the page. Release to send the selected region to OpenAI. Esc cancels.' });
    let selection;
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectArea });
      selection = frame.result;
    } catch {
      throw new Error('Chrome could not select on this page. Click the extension toolbar icon on the comic tab and retry. Chrome Web Store and other protected pages cannot be captured.');
    }
    if (!selection) throw new Error('The page closed or changed. Select again.');
    if ('error' in selection) throw new Error(selection.error);
    update({ phase: 'translating', message: 'Capturing the selected region and translating…' });
    // Chrome permits at most two captures per second, even with overlapping API calls.
    const delay = Math.max(0, 550 - (Date.now() - lastCaptureAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await assertSameViewport(tab, selection);
    lastCaptureAt = Date.now();
    try { screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
    catch { throw new Error('Chrome blocked capture. Click the toolbar icon on this tab and retry on an unrestricted HTTP/HTTPS page.'); }
    await assertSameViewport(tab, selection);
    cropped = await cropScreenshot(screenshot, selection);
    screenshot = '';
    lastScanAt = Math.max(Date.now(), lastScanAt + 1);
    job = { id: crypto.randomUUID(), createdAt: lastScanAt, status: 'translating', message: 'Translating…' };
    jobs = [...jobs, job];
    busy = false;
    ownsCapture = false;
    update({ phase: 'translating', message: 'Translation running. You can snip another area.' });
    const result = await translate(cropped, apiKey);
    cropped = '';
    jobs = jobs.filter(item => item.id !== job!.id);
    let message = 'No text found. Try a closer selection.';
    if (result.bubbles.length) {
      history = [{ id: job.id, createdAt: job.createdAt, result }, ...history].sort((a, b) => b.createdAt - a.createdAt);
      message = 'Translation added to your history.';
      const snapshot = history;
      const write = historyWrite.catch(() => {}).then(() => chrome.storage.local.set({ history: snapshot }));
      historyWrite = write;
      try { await write; }
      catch { message = 'Translated, but local history could not be saved. Copy your translations before closing Chrome.'; }
    }
    update({ phase: 'success', message, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong. Please select again.';
    if (job) jobs = jobs.map(item => item.id === job!.id ? { ...item, status: 'error', message } : item);
    if (ownsCapture) { busy = false; ownsCapture = false; }
    update({ phase: 'error', message });
  } finally {
    screenshot = cropped = '';
    clearInterval(keepAlive);
    if (ownsCapture) busy = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only the bundled side panel may initiate capture, change settings or read state.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html')) return;
  if (message.type === 'getState') {
    void historyReady.then(() => respond(state)).catch(() => respond({ ...state, phase: 'error', message: 'Could not load local history. Reopen the extension to retry.' }));
    return true;
  }
  if (message.type === 'clear' && !busy && activeRequests() === 0) {
    busy = true;
    void (async () => {
      await historyReady;
      await historyWrite.catch(() => {});
      await chrome.storage.local.remove('history');
      history = [];
      jobs = [];
      busy = false;
      update({ phase: 'idle', message: 'History cleared. Ready for another area.' });
      respond({ ok: true });
    })().catch(() => {
      busy = false;
      update({ phase: 'error', message: 'Could not clear saved history. Please try again.' });
      respond({ error: true });
    }).finally(() => { busy = false; });
    return true;
  }
  if (message.type === 'start' && Number.isInteger(message.windowId)) {
    void run(message.windowId); respond({ ok: true }); return;
  }
  if (message.type === 'settingsStatus') {
    void protectedStorage.then(() => chrome.storage.local.get(['apiKey', 'paidConsent'])).then(v => respond({ hasKey: !!v.apiKey, paidConsent: !!v.paidConsent }));
    return true;
  }
  if (message.type === 'saveSettings' && !busy && activeRequests() === 0) {
    void (async () => {
      await protectedStorage;
      const key = typeof message.key === 'string' ? message.key.trim() : '';
      if (key) await chrome.storage.local.set({ apiKey: key, paidConsent: message.paidConsent === true });
      else await chrome.storage.local.set({ paidConsent: message.paidConsent === true });
      respond({ ok: true });
    })().catch(() => respond({ error: 'Could not save settings. Try again.' }));
    return true;
  }
  if (message.type === 'removeKey' && !busy && activeRequests() === 0) {
    void protectedStorage.then(() => chrome.storage.local.remove(['apiKey', 'paidConsent'])).then(() => respond({ ok: true }));
    return true;
  }
});
