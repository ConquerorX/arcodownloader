🇹🇷 [Türkçe](../KURULUM.md) · [English](../en/KURULUM.md) · **Deutsch** · [Français](../fr/KURULUM.md) · [Español](../es/KURULUM.md) · [Русский](../ru/KURULUM.md)

# Installation

## Schneller Weg (aus dem Quellordner)

1. Lade das Repository herunter: **Code ▸ Download ZIP** oder `git clone https://github.com/ConquerorX/arcodownloader.git`
2. Entpacke die ZIP-Datei in einen dauerhaften Ordner (nutze keinen temporären Ordner auf dem Desktop; wenn du ihn löschst, ist die Erweiterung weg).
3. Öffne im Browser die Erweiterungsseite:

   | Browser | Adresse |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Aktiviere den **Entwicklermodus**.
5. Klicke auf **Entpackte Erweiterung laden** ▸ wähle den Ordner, in dem `manifest.json` liegt.

> `manifest.json` muss direkt im Ordner sichtbar sein. Wählst du einen beim Entpacken entstandenen übergeordneten Ordner, meldet der Browser „Manifest nicht gefunden“.

## Chrome / Edge

Erforderlich ist Chrome 111 oder neuer (wegen der Unterstützung von `content_scripts.world: "MAIN"`). Edge basiert auf Chromium, daher gilt dieselbe Versionsregel.

Nach der Installation:

1. Öffne <https://player.arcod.xyz/>.
2. Klicke in der Symbolleiste auf das ARCOD-Symbol. Ist es nicht angeheftet, findest du es im Puzzle-Menü; per Rechtsklick auf das Symbol wählst du **Anheften**.
3. Auf einer Albumseite erscheint das Panel oben rechts.

## Firefox (experimentell)

Voraussetzung: **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Temporäres Add-on laden  ▸  manifest.json
```

Eine `temporäre` Installation wird beim Schließen des Browsers entfernt. Für eine dauerhafte Installation wird eine signierte `.xpi` benötigt:

```bash
# im Repository-Stammverzeichnis
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Danach `about:config` ▸ `xpinstall.signatures.required` → `false` (nur in der Developer Edition) oder über Firefox Add-ons signieren lassen.

Da es `showSaveFilePicker` in Firefox nicht gibt, nutzt die Erweiterung automatisch den Download-Manager des Browsers.

## Unternehmen / Massenverteilung

Mit `policies.json` lässt sich eine erzwungene Installation durchführen. Die Datei wird im Installationsverzeichnis des Browsers abgelegt:

- Windows: `%ProgramFiles%\Google\Chrome\Application\policies.json` (oder Registry `HKLM\SOFTWARE\Policies\Google\Chrome`)
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

> Die `policies.json` im Repository ist ein lokales Beispiel, das nur während der Entwicklung verwendet wird; da sie einen absoluten Pfad enthält, ist sie über `.gitignore` ausgeschlossen.

## Aktualisieren

```bash
git pull
```

Klicke danach auf der Erweiterungsseite auf der Karte der Erweiterung auf die Schaltfläche **↻**. Wenn du per ZIP installiert hast, entpacke die neue ZIP-Datei in denselben Ordner und klicke erneut auf ↻.

## Deinstallieren

Klicke auf der Erweiterungsseite auf **Entfernen**. Einstellungen und Warteschlange liegen im `localStorage` des ARCOD-Origins; für eine vollständige Bereinigung lösche daher im ARCOD-Tab auch die Websitedaten.

## Fehlerbehebung

| Symptom | Lösung |
|---|---|
| Panel öffnet sich nicht | Seite neu laden, dann auf das Symbol klicken. Die Erweiterung lädt den Tab einmal automatisch neu. |
| Symbol ist grau / inaktiv | Der Tab ist nicht auf `player.arcod.xyz`. Ein Klick auf das Symbol öffnet ARCOD. |
| „Manifest nicht gefunden“ | Falscher Ordner gewählt; wähle den Ordner, in dem `manifest.json` direkt sichtbar ist. |
| Download 502 | Seite neu laden, den Player einmal abspielen, erneut versuchen. |
| Dateiname ist kaputt | Unter Windows sind `? : * \| " < >` verboten; vereinfache die Vorlage. |
| „Diese Erweiterung ist beschädigt“ (Chrome) | Dateien im Ordner fehlen; die ZIP-Datei erneut entpacken. |
