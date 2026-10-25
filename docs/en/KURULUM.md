🇹🇷 [Türkçe](../KURULUM.md) · **English** · [Deutsch](../de/KURULUM.md) · [Français](../fr/KURULUM.md) · [Español](../es/KURULUM.md) · [Русский](../ru/KURULUM.md)

# Installation

## Quick way (from the source folder)

1. Download the repository: **Code ▸ Download ZIP** or `git clone https://github.com/ConquerorX/arcodownloader.git`
2. Extract the ZIP to a permanent folder (don't use a temporary folder on the desktop; if you delete it, the extension is lost).
3. Open the extensions page in your browser:

   | Browser | Address |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Turn on **Developer mode**.
5. Click **Load unpacked** ▸ select the folder that contains `manifest.json`.

> `manifest.json` must be directly visible inside the folder. If you pick a parent folder created by extracting the ZIP, the browser will say "manifest not found".

## Chrome / Edge

Chrome 111 or later is required (for `content_scripts.world: "MAIN"` support). Edge is Chromium-based, so the same version rule applies.

After installation:

1. Open <https://player.arcod.xyz/>.
2. Click the ARCOD icon in the toolbar. If it isn't pinned, it is inside the puzzle menu; right-click the icon and choose **Pin**.
3. On an album page the panel appears at the top right.

## Firefox (experimental)

Requirement: **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Load Temporary Add-on  ▸  manifest.json
```

A `Temporary` install is removed when the browser closes. A permanent install needs a signed `.xpi`:

```bash
# at the repository root
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Then `about:config` ▸ `xpinstall.signatures.required` → `false` (developer edition only) or have it signed through Firefox Add-ons.

Since `showSaveFilePicker` doesn't exist in Firefox, the extension automatically uses the browser's download manager.

## Enterprise / bulk deployment

Forced installation is possible with `policies.json`. Place the file in the browser's installation directory:

- Windows: `%ProgramFiles%\Google\Chrome\Application\policies.json` (or the registry `HKLM\SOFTWARE\Policies\Google\Chrome`)
- macOS: `/Library/Application Support/Google/Chrome/policies/managed/`
- Linux: `/etc/opt/chrome/policies/managed/`

```json
{
  "policies": {
    "ExtensionSettings": {
      "arcodgrab@localhost": {
        "installation_mode": "force_installed",
        "update_url": "https://example.com/arcodownloader/updates.xml"
      }
    }
  }
}
```

> The `policies.json` in the repository is a local example used only during development; it contains an absolute path, so it is excluded via `.gitignore`.

## Updating

```bash
git pull
```

Then click the **↻** button on the extension's card in the extensions page. If you installed from a ZIP, extract the new ZIP into the same folder and click ↻ again.

## Uninstalling

Click **Remove** on the extensions page. Settings and the queue are kept in the ARCOD origin's `localStorage`, so for a full cleanup also delete the site data in the ARCOD tab.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel doesn't open | Reload the page, then click the icon. The extension reloads the tab once automatically. |
| Icon is grey / inactive | The tab is not on `player.arcod.xyz`. Clicking the icon opens ARCOD. |
| "manifest not found" | The wrong folder was selected; pick the folder where `manifest.json` is directly visible. |
| Download 502 | Reload the page, play the player once, try again. |
| File name is broken | `? : * \| " < >` are forbidden on Windows; simplify the template. |
| "This extension is corrupted" (Chrome) | Files in the folder are missing; extract the ZIP again. |
