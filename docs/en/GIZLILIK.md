🇹🇷 [Türkçe](../GIZLILIK.md) · **English** · [Deutsch](../de/GIZLILIK.md) · [Français](../fr/GIZLILIK.md) · [Español](../es/GIZLILIK.md) · [Русский](../ru/GIZLILIK.md)

# Privacy

**Summary: ARCOD Grab collects no data and sends nothing to any server.**
There is no backend that either the developer or third parties could access.

## Data that is not collected

- Personal information, account information, email, IP
- Download history, listening history, search history
- Usage statistics, crash reports, telemetry
- Cookies (the extension neither reads nor writes any cookie)

## Data that stays in the browser

Only in the `localStorage` of the `player.arcod.xyz` origin:

| Key | Content |
|---|---|
| `arcodgrab.cfg.v1` | Quality ceiling, file name template, save mode, panel position, Easy Mode, "now playing" preference |
| `arcodgrab.queue.v1` | IDs and names of the tracks in the download queue |

These two keys are deleted together with the browser's site data. When you remove the extension, they go away together with the site data kept for ARCOD. They are never sent to a server.

## Network access

The extension talks only to the following addresses:

| Address | Purpose |
|---|---|
| `https://player.arcod.xyz/api/player/*` | Album data and stream ticket |
| ARCOD's stream CDN (the address returned by the ticket) | Audio stream |

The only `host_permissions` entry in `manifest.json` is `https://player.arcod.xyz/*`. No other site can be read or modified.

## Stream addresses (ticket)

For each download a short-lived stream address is obtained from ARCOD. This address:

- is held in memory only while the download runs,
- is **not** written to disk, `localStorage` or the console,
- is released when the download finishes.

## Permissions

| Permission | Why |
|---|---|
| `downloads` | Hand the file to the browser's download manager, open it, show the folder |
| `host_permissions: player.arcod.xyz` | Place the panel on the page and request the stream from the page origin |

Permissions such as `tabs`, `storage`, `webRequest`, `cookies` and `scripting` are **not requested**. The tab URL is read only on a toolbar click, to verify the address of the current tab.

## Changes

If this policy changes, the version number and `CHANGELOG.md` are updated. Because the whole source code is in this repository, every claim can be audited:

```bash
grep -rn "fetch(" *.js      # only /api/player and the ticket address
grep -rn "sendBeacon\|XMLHttpRequest" *.js
```
