# Scan Translator

A personal Chrome Manifest V3 extension: drag over a visible comic region, then read its English translation in the side panel. Auto-detects the source language; French → English is the initial use case. One OpenAI vision request performs both recognition and translation. No backend or accounts.

## Cost before use

Building and loading the extension requires no paid service. Translation uses **your paid OpenAI API account** with `gpt-5.4-mini`.

Official rates checked October 30, 2026: **US$0.75 per million input tokens and US$4.50 per million output tokens**. Image input is tokenized and billed as input. An illustrative request with 2,000 total input tokens and 500 output tokens costs **$0.00375** (about **$3.75 for 1,000 such requests**). This is an example, not a fixed quote or cap. Actual costs depend on image dimensions and output length. Failed/time-out requests that reached the provider may still incur charges. There are no automatic retries.

Settings display this quote and require the paid-use checkbox before any image request. No paid requests were made during development.

Official references:
- [GPT-5.4 mini: model identifier, pricing, image input and structured output support](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Images and vision: image data URLs and input costs](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured output format](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Chrome tab capture](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
- [Chrome side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

## Build

Requires Node.js **22.12+** and npm, Chrome **120+** desktop.

```sh
git clone https://github.com/Ardee7/scan-translator.git
cd scan-translator
npm ci
npm run build
npm test
```

The complete unpacked extension is generated in `dist/`. Generated files are not committed; run the build after cloning. No environment file or secret in source is needed. `npm run check` runs TypeScript separately.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select:
   the `dist` folder inside your cloned repository
4. Pin **Scan Translator** using Chrome's Extensions menu.
5. Open a normal HTTP/HTTPS comic page and **click the Scan Translator toolbar icon on that tab**. This opens the side panel and grants temporary `activeTab` access. Do this again when moving to a different tab/site.
6. In Settings, paste your personal OpenAI API key, review the pricing, check the paid-use checkbox, and click **Save settings**. Saving does not call the API.

After rebuilding, click Reload on the extension card in `chrome://extensions`, then reopen its side panel.

## Use

1. Scroll until the panel/dialogue is visible. Wait for comic images to load.
2. Press **⌘⇧S** on Mac or **Ctrl+Shift+Y** on Windows/Linux to open the panel and start snipping, or click **Select area to translate**. Chrome must be focused. Change or assign the shortcut at `chrome://extensions/shortcuts` if another extension has claimed it. The side panel shows the actual assigned shortcut.
3. Drag over the region. **Releasing sends that crop to OpenAI and can incur an API charge.** Press Escape to cancel before release.
4. Read the numbered English dialogue. Expand **Recognized source** for each bubble. Unreadable portions are marked rather than intentionally guessed; AI can still make recognition/translation mistakes.
5. Each selected area appears as a readable card with its own Copy button and collapsible original text. New cards stack above earlier ones. Use **Copy all** to copy history in chronological order, **Clear history** to delete saved translations, or **Translate an area** to continue.
6. While a translation runs, press the snip shortcut again to select the next bubble. Up to three requests may run at once; the controls pause at that limit. Clear history and Settings are disabled until all running work finishes. Each scan is billed normally; no extra concurrency fee is added by the extension.
7. After an error, fix the cause in Settings if needed, then use **Retry** and draw a new selection. Screenshots are discarded, so Retry deliberately requires reselection.

No full-page scan or image URL fetching occurs. Browser-restricted pages (including Chrome settings and the Web Store), DRM and protected content are not bypassed. Normal browser zoom is supported; reset trackpad pinch zoom before selection. Selection cancels if the viewport scrolls or resizes. Page animations may still change content; use a stable visible panel.

## Optional click-to-translate mode

Open the extension from its toolbar icon on the comic tab, then enable **Click-to-translate mode**. Enabling it makes no API request. Click white space **inside a fully visible white speech bubble**. A local pixel detector finds the connected white interior, and the existing single vision request translates that crop. English appears in a temporary page overlay and is also saved in history.

- Overlay text fits the available space at 24–48 CSS pixels, with centered dialogue and scrolling for long text. Browser zoom still affects its on-screen size.
- Hover the overlay to reveal the original; focus/click it to read or scroll longer translations. Double-click dismisses that overlay.
- **Esc** or switching the toggle off removes the overlays and restores normal clicking. Navigation turns the mode off. The mode is for one tab at a time.
- Snipping and **⌘⇧S** remain available. While click mode is on, a manual snip displays its translation in a nearby popup, useful for colored or irregular bubbles.
- Detection is conservative: white page backgrounds, clipped, tiny or unreliable regions fail locally without an API request. It is not semantic bubble recognition and can mistake other enclosed white shapes for bubbles. Check the recognized source.
- This draws a plain white overlay; it does not erase pixels, reconstruct artwork or match comic fonts. Long translations can scroll. Overlays follow ordinary document scrolling, and are removed after resize/layout-size changes or nested scrolling to avoid stale placement. Saved side-panel history remains.
- Existing three-request concurrency, history, copy controls and settings remain available. Repeated clicks with an exactly identical crop reuse a small in-memory cache (up to 100 crops' text results/hashes). No images are cached. Cache is cleared with history and does not survive service-worker suspension; changed zoom/pixels can require a new paid call.
- No image-editing provider or extra paid service is used. Each uncached translation has the same API pricing as manual snipping.

## Privacy and architecture

- `src/selection.ts`: injected on demand in Chrome's isolated content-script world; captures viewport CSS coordinates, removes its overlay, then waits for paint. Receives no API key or image data.
- `src/worker.ts`: coordinates `captureVisibleTab`, validates the active tab/viewport before and after capture, crops with `OffscreenCanvas`, then makes the single request from the service worker. Selection and capture are serialized, but up to three translation requests can run concurrently. Capture calls are spaced at least 550 ms apart. Each running or failed scan has its own status; results are ordered by scan time, not completion time. History writes are serialized to prevent lost results. Temporary keepalive activity only runs during an explicit selection/request.
- `src/crop.ts`: maps CSS coordinates using actual screenshot width/viewport width and height/viewport height. This incorporates DPR and browser zoom without double-scaling; document scroll offsets are not added to viewport coordinates.
- `src/api.ts`: OpenAI Responses API, `gpt-5.4-mini`, no reasoning delay, strict JSON output, `store: false`, no tools, no automatic retries. Requests time out after 25 seconds to stay within MV3 fetch lifecycle limits; select a smaller area if needed. Image text is explicitly treated as untrusted translation content.
- `src/sidepanel.ts`: settings and safe text-only result rendering. Source and translation text are never rendered as HTML.
- Key lives only in `chrome.storage.local`, restricted with `TRUSTED_CONTEXTS`, never sync storage. It is a locally stored personal secret, **not encrypted vault storage**. Only the service worker uses it for provider requests. No key logging or export. Remove it in Settings.
- Full captures and crops exist only temporarily in memory; they are not written to disk or extension storage. Only the crop is transmitted. Recognized source text and English translations are saved in extension-local storage, newest area first, until you click Clear history. They survive panel closure, service-worker suspension and browser restarts. No screenshots or page URLs are saved in history. Clear history removes the saved text but preserves your API key and settings.
- `store: false` disables saved Responses API state; it does not promise zero provider retention. OpenAI's API data policies apply to sent images.
- Permissions: `activeTab` for user-granted access/capture, `scripting` for the selector, `storage` for settings, `sidePanel` for UI. The only persistent host permission is `https://api.openai.com/*`.

## Validation and remaining manual checks

`npm run build` and `npm test` pass. Automated tests cover Retina/fractional zoom crop coordinates, scrolled viewport coordinates, edge rounding, invalid selections, the request shape, output validation, and useful API error messages. A worker integration harness verifies crop-only transmission, duplicate prevention, invalid-key recovery, preserved settings, new selections, Clear and tab-change rejection. The harness uses test-only browser/API stubs; these are **not shipped** and do not establish real visual capture or translation quality.

**Original manual checklist (the user has since confirmed the core snipping/translation flow works):** unpacked installation, real Chrome overlay/capture/crop alignment, clipboard access, live OpenAI authentication, live French recognition/translation, rate-limit responses, and repeated live captures on Webtoon. Chrome is available, but live extension testing was not performed and no personal key or paid request was used.

Manual acceptance checklist:

- Load `dist`, save your key, reopen the panel and confirm Settings says “Key saved.”
- Translate a small French bubble; check source text, translation, reading order and that no selection border appears in the captured region.
- Repeat after scrolling, at browser zoom 80%, 100%, 125%, and on a Retina display; include selections near viewport edges and reverse-direction drags.
- Select another area without reloading. Rapid clicks must not send multiple requests.
- Escape and click without dragging: no request should be sent.
- Switch tabs/resize during selection: selection must fail safely; retry on the original tab.
- Try a deliberately invalid key to see the useful error, restore the real key, and retry. This involves provider requests.
- Verify Copy, Clear, empty-text handling and restricted-page errors. Clear must preserve Settings.

Click-mode automated checks cover closed-bubble detection with dark lettering, refusal of open backgrounds/clipped bubbles/tiny highlights, authorized versus forged click messages, crop-only submission, cached repeats, manual snipping with overlays hidden, and navigation cleanup. Live Chrome rendering, white-bubble detection on actual Webtoon art, hover/popup interaction and overlay alignment still need a manual check. No live paid calls were used to test this feature.
