🇹🇷 [Türkçe](../MIMARI.md) · **English** · [Deutsch](../de/MIMARI.md) · [Français](../fr/MIMARI.md) · [Español](../es/MIMARI.md) · [Русский](../ru/MIMARI.md)

# Architecture

The extension deliberately consists of three small layers. Each layer does one job and does not extend the privileges of the others.

```
┌─────────────────────────────────────────────────────────────────────┐
│  player.arcod.xyz                                                   │
│                                                                     │
│  ┌───────────────────────┐        ┌──────────────────────────────┐  │
│  │ arcod-grab.js         │        │ relay.js                     │  │
│  │ MAIN world            │◄──────►│ ISOLATED world               │  │
│  │                       │postMsg │                              │  │
│  │ • panel + CSS         │        │ • two-way bridge             │  │
│  │ • fetch + FLAC reading│        │ • chrome.runtime access      │  │
│  │ • queue + template    │        │                              │  │
│  └───────────────────────┘        └───────────────┬──────────────┘  │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ sendMessage
                                    ┌───────────────▼──────────────┐
                                    │ background.js                │
                                    │ MV3 service worker           │
                                    │ • downloads API              │
                                    │ • badge (ON / queue count)   │
                                    │ • tab lifecycle              │
                                    └───────────────┬──────────────┘
                                                    │
                                          browser download manager
```

## Layers

### 1. `arcod-grab.js` — MAIN world

Runs in the page's own JavaScript context. There is a single reason for this: **the request must originate from the page's origin.** ARCOD rejects non-browser clients (curl, PowerShell, Node) with 502; so the `fetch` call must look like a normal page request, not like one forced through CDP.

Responsibilities:

- Build the panel inside a shadow DOM (`attachShadow`) — the page's CSS doesn't affect the panel, and the panel's CSS doesn't affect the page.
- Call the `/api/player/get-album` and `/api/player/stream/{id}` endpoints.
- Read the first ~64 KB of the stream and parse the FLAC header (`readFlacHead`).
- Keep quality, file name template and queue in `localStorage` (the ARCOD origin).
- Either stream the download straight to disk (`showSaveFilePicker`) or hand it over to `background.js`.

### 1b. `media-hook.js` — MAIN world, document_start

Passively records the audio elements the site creates (including `new Audio`) and the Web Audio output (the main `GainNode`); it is exposed to `arcod-grab.js` only through a narrow `CustomEvent` handshake for reading/setting volume. It takes no automatic action, even while the panel is closed.

### 2. `relay.js` — ISOLATED world

The MAIN world cannot reach the `chrome.*` APIs, and the service worker cannot write to the page directly. `relay.js` is the **single, narrow channel** between these two sides:

```js
// page  →  extension
window.postMessage({ __arcodgrab: true, type: 'request', id, req, args })
// extension  →  page
window.postMessage({ __arcodgrab: true, type: 'response', id, ok, res })
```

Only whitelisted `arcodgrab:*` message types are forwarded; no script on the page can make an arbitrary `chrome.*` call. When the toolbar button is clicked, `arcodgrab:toggle` travels down through this same channel.

### 3. `background.js` — service worker

- Executes the `chrome.downloads.download` / `open` / `show` / `showDefaultFolder` calls.
- Accepts only `https://player.arcod.xyz/` addresses.
- Manages the tab badge: **ON** while the panel is open, a number if there are jobs in the queue.
- Covers the differences between the Chrome (callback) and Firefox (Promise) `downloads` APIs with a single `callApi` wrapper.

## Message protocol

| Type | Direction | Job |
|---|---|---|
| `arcodgrab:toggle` | background → page | Show/hide the panel |
| `arcodgrab:panel-ready` | page → background | Set the badge to `ON` |
| `arcodgrab:queue-count` | page → background | Write the queue count on the badge (`ON` if `0`) |
| `arcodgrab:download` | page → background | Hand the stream address to the download manager |
| `arcodgrab:open` | page → background | Open the downloaded file in the operating system |
| `arcodgrab:show` | page → background | Show the download in the list |
| `arcodgrab:show-folder` | page → background | Open the downloads folder |
| `arcodgrab:commands` | page → background | Lists the assigned `commands` keys |
| `arcodgrab:open-shortcuts` | page → background | Opens the browser's shortcut settings tab |
| `arcodgrab:command` | background → page | Forwards an assigned command to the page (`prev`, `next`, `volUp`, `volDown`) |

## Download flow

```text
ticket()            →  /api/player/stream/{id}?quality={q}
                       ↓  { url, quality }
fetch(ticket.url)   →  stream (ReadableStream)
                       ↓
  saveMode = 'fsa'  →  showSaveFilePicker → writable.write(chunk) …
  saveMode = 'dl'   →  chrome.downloads.download({ url, filename })
```

In `dl` mode the stream is never buffered in memory: the address goes straight to the browser's download manager and the browser writes the file. In `fsa` mode the chunks are written to disk as a stream; since the file's full path isn't exposed to JS, the "show in folder" function opens the browser's downloads folder.

## Quality model

ARCOD's quality table defines a **ceiling**:

| Channel | Bit | kHz |
|---|---|---|
| `5` | 16 | 44.1 |
| `6` | 16 | 48 |
| `7` | 24 | 96 |
| `27` | 24 | 192 |

The server intersects the requested ceiling with the recording's own resolution. So asking for 24/192 is not an upgrade, it means "the best possible". The panel makes this difference visible by showing the **real** values read from the stream before downloading.

## Verification

`readFlacHead(u8)` looks for the following in the first bytes:

1. the `fLaC` magic signature,
2. the metadata block chain (`STREAMINFO`, `PADDING`, `SEEKTABLE`, `VORBIS_COMMENT`, `PICTURE`…),
3. from the STREAMINFO body: sample rate, channels, bit depth, total sample count and MD5.

The result is reported as one of three states: **original**, **repackaged** (MD5 is zero), **tags stripped** (no VORBIS_COMMENT).

## Design

The panel follows the Apple HIG language: semantic color tokens (automatic light/dark), `backdrop-filter` material surfaces, 0.5 px separators, an 8 pt grid. Easy Mode activates by itself on first launch with `prefers-contrast: more`.

## Shortcuts and input

- **Shortcut flow:** the manifest `commands` (`arcod-prev`, `arcod-next`, `arcod-vol-up`, `arcod-vol-down`) ship with no default key; they are assigned at `chrome://extensions/shortcuts`. `background.js` receives `onCommand` and picks the target tab in this order: playing audio, active, most recently used. If there is no ARCOD tab it stays silent. The command travels through `relay.js` as `arcodgrab:command` (whitelist: `prev`, `next`, `volUp`, `volDown`) and reaches the MAIN world as a `type: 'command'` message handled by `scCommand`. No new permission is needed.
- **Scope:** `cfg.scScope` is `'page'` (default) or `'global'`. In global scope only the `commands` keys work; custom keys assigned in the panel apply only on the page.
- **Keyboard isolation:** while typing in the panel, keys (Space included) don't leak to the page; page shortcuts don't fire while typing in the panel.
- **The context menu** also works while the panel is closed; it takes no action on its own, doesn't build the panel, and shows status as a toast. Adding to the queue goes through the single `queueAdd()` path.
- **The file name template** is edited with a block (chip) editor with drag and drop; `cfg.template` stays a string, converted by `tplParse`/`tplBuild`. The save method is `cfg.saveMode`: `'dl'` | `'fsa'` | `'auto'`; the queue always downloads through the browser.
- **Volume:** the site's volume slider is tried first, then `audio.volume`.

## Languages

All user-visible text lives in a single `I18N` dictionary inside `arcod-grab.js` (`tr`, `en`, `de`, `fr`, `es`, `ru`). `t('key', { n })` reads it; a missing key falls back to Turkish first, and if that is missing too, to the key itself. Static nodes are marked with `data-i18n*` attributes, and when the language changes `applyI18n()` rewrites all of them without a page reload. `background.js` returns a stable `code` instead of an error text; translation happens in the panel. `T()` capitalizes the first letter in a language-aware way. Steps for adding a language: [README → Languages](../../README.en.md#-languages).

## Why a single file?

`arcod-grab.js` keeps the panel, the CSS and the download engine in a single IIFE. Scripts injected into the MAIN world have no module loading, and every extra file would be an extra request per page. So it is a deliberate choice: **one script, zero dependencies, zero build.** `arcod-grab.js` is still the single main script; `media-hook.js` is separate only because it must load before the page's own scripts.
