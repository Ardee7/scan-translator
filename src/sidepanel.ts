import './style.css';
import type { State, Translation } from './types';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = element<HTMLButtonElement>('select');
const retry = element<HTMLButtonElement>('retry');
const copy = element<HTMLButtonElement>('copy');
const clear = element<HTMLButtonElement>('clear');
const key = element<HTMLInputElement>('key');
const consent = element<HTMLInputElement>('consent');
const status = element<HTMLParagraphElement>('status');
let current: State;
let starting = false;
const send = (message: object) => chrome.runtime.sendMessage(message);
let renderedHistory = '';
const translationText = (result: Translation) => result.bubbles.map(b => b.translation).join('\n\n');
async function copyText(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = label; }, 1500);
  } catch { status.textContent = 'Clipboard access failed. Select and copy the text manually.'; }
}
function languageName(language: string) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language; }
  catch { return language; }
}
function render(state: State) {
  current = state;
  element<HTMLInputElement>('click-mode').checked = !!state.clickMode;
  element<HTMLInputElement>('click-mode').disabled = !!state.captureBusy;
  const history = state.history ?? [];
  const busy = !!state.captureBusy || (state.activeRequests ?? 0) > 0;
  const full = (state.activeRequests ?? 0) >= 3;
  select.disabled = retry.disabled = !!state.captureBusy || full;
  clear.disabled = busy || (!history.length && !state.jobs?.length);
  element<HTMLFormElement>('settings-form').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(el => el.disabled = busy);
  copy.disabled = !history.length;
  retry.hidden = state.phase !== 'error';
  select.textContent = state.captureBusy ? (state.phase === 'selecting' ? 'Draw your selection…' : 'Capturing…') : full ? '3 translations running…' : 'Translate an area';
  status.textContent = state.message;
  const jobs = element('jobs');
  jobs.replaceChildren();
  for (const job of [...(state.jobs ?? [])].reverse()) {
    const row = document.createElement('p');
    row.className = `scan-job ${job.status}`;
    const time = new Date(job.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    row.textContent = `${time} · ${job.message}`;
    if (job.status === 'error') row.append(' Select the area again to retry.');
    jobs.append(row);
  }
  status.dataset.phase = state.phase;
  element('history-count').textContent = `${history.length} ${history.length === 1 ? 'area' : 'areas'}`;
  element('empty').hidden = history.length > 0;
  // Preserve expanded source text and scroll position during requests/errors.
  const signature = history.map(entry => entry.id).join(',');
  if (signature === renderedHistory) return;
  renderedHistory = signature;
  const results = element<HTMLDivElement>('results');
  results.replaceChildren();
  for (const [index, entry] of history.entries()) {
    const card = document.createElement('article'); card.className = 'translation-card';
    const header = document.createElement('header');
    const heading = document.createElement('h3'); heading.textContent = `Area ${history.length - index}`;
    const copyArea = document.createElement('button'); copyArea.textContent = 'Copy';
    copyArea.setAttribute('aria-label', `Copy area ${history.length - index}`);
    copyArea.onclick = () => void copyText(translationText(entry.result), copyArea);
    header.append(heading, copyArea);
    const meta = document.createElement('p'); meta.className = 'card-meta';
    meta.textContent = `${languageName(entry.result.language)} → English · ${new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const list = document.createElement('ol'); list.className = 'dialogue';
    for (const bubble of entry.result.bubbles) {
      const item = document.createElement('li');
      const translation = document.createElement('p'); translation.className = 'translation';
      translation.textContent = bubble.translation; item.append(translation);
      if (bubble.unreadable) {
        const warning = document.createElement('small');
        warning.textContent = 'Some text was unreadable'; item.append(warning);
      }
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Original text';
      const source = document.createElement('p'); source.textContent = bubble.source;
      details.append(summary, source); item.append(details); list.append(item);
    }
    card.append(header, meta, list); results.append(card);
  }
}
async function settingsStatus() {
  const saved = await send({ type: 'settingsStatus' });
  consent.checked = saved.paidConsent;
  if (!saved.hasKey) element<HTMLDetailsElement>('settings').open = true;
  element('key-status').textContent = saved.hasKey ? 'Key saved. Leave blank to keep it.' : 'No API key saved.';
}
async function start() {
  if (starting || current?.captureBusy || (current?.activeRequests ?? 0) >= 3) return;
  starting = true;
  try {
    const window = await chrome.windows.getCurrent();
    await send({ type: 'start', windowId: window.id });
  } catch { status.textContent = 'Could not start. Reopen the extension and try again.'; }
  finally { starting = false; }
}
select.onclick = retry.onclick = start;
clear.onclick = () => void send({ type: 'clear' });
copy.onclick = () => void copyText([...(current.history ?? [])].reverse().map(entry => translationText(entry.result)).join('\n\n────\n\n'), copy);
element<HTMLFormElement>('settings-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const response = await send({ type: 'saveSettings', key: key.value, paidConsent: consent.checked });
    if (response?.error) throw new Error(response.error);
    key.value = '';
    await settingsStatus();
    status.textContent = 'Settings saved. Ready to select an area.';
    element<HTMLDetailsElement>('settings').open = false;
  } catch { status.textContent = 'Settings could not be saved. Please try again.'; }
};
element('remove').onclick = async () => {
  await send({ type: 'removeKey' }); key.value = ''; await settingsStatus();
  status.textContent = 'API key removed.';
};
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'state') render(message.state);
});
void Promise.all([send({ type: 'getState' }).then(render), settingsStatus()]).catch(() => { status.textContent = 'Could not connect. Reload the extension from chrome://extensions.'; });

void chrome.commands.getAll().then(commands => {
  const shortcut = commands.find(command => command.name === 'select-area')?.shortcut;
  element('shortcut').textContent = shortcut
    ? `Snip: ${shortcut} · Esc to cancel`
    : 'Assign a snip shortcut at chrome://extensions/shortcuts. Esc cancels selection.';
});

element<HTMLInputElement>('click-mode').onchange = async () => {
  const toggle = element<HTMLInputElement>('click-mode');
  toggle.disabled = true;
  try {
    const win = await chrome.windows.getCurrent();
    await send({ type: 'setClickMode', enabled: toggle.checked, windowId: win.id });
  } catch { toggle.checked = !!current?.clickMode; status.textContent = 'Could not change mode. Reopen the panel and try again.'; }
  finally { toggle.disabled = !!current?.captureBusy; }
};
