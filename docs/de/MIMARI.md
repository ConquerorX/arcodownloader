🇹🇷 [Türkçe](../MIMARI.md) · [English](../en/MIMARI.md) · **Deutsch** · [Français](../fr/MIMARI.md) · [Español](../es/MIMARI.md) · [Русский](../ru/MIMARI.md)

# Architektur

Die Erweiterung besteht bewusst aus drei kleinen Schichten. Jede Schicht erledigt genau eine Aufgabe und erweitert nicht die Rechte der anderen.

```
┌─────────────────────────────────────────────────────────────────────┐
│  player.arcod.xyz                                                   │
│                                                                     │
│  ┌───────────────────────┐        ┌──────────────────────────────┐  │
│  │ arcod-grab.js         │        │ relay.js                     │  │
│  │ MAIN world            │◄──────►│ ISOLATED world               │  │
│  │                       │postMsg │                              │  │
│  │ • Panel + CSS         │        │ • bidirektionale Brücke      │  │
│  │ • fetch + FLAC-Lesen  │        │ • chrome.runtime-Zugriff     │  │
│  │ • Queue + Vorlage     │        │                              │  │
│  └───────────────────────┘        └───────────────┬──────────────┘  │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ sendMessage
                                    ┌───────────────▼──────────────┐
                                    │ background.js                │
                                    │ MV3 service worker           │
                                    │ • downloads API              │
                                    │ • Badge (ON / Warteschl.)    │
                                    │ • Tab-Lebenszyklus           │
                                    └───────────────┬──────────────┘
                                                    │
                                          Download-Manager des Browsers
```

## Schichten

### 1. `arcod-grab.js` — MAIN world

Läuft im eigenen JavaScript-Kontext der Seite. Dafür gibt es nur einen Grund: **Die Anfrage muss vom Origin der Seite ausgehen.** ARCOD weist Nicht-Browser-Clients (curl, PowerShell, Node) mit 502 ab; der `fetch`-Aufruf muss also wie eine normale Seitenanfrage aussehen und nicht wie eine über CDP erzwungene.

Aufgaben:

- Das Panel in einem Shadow DOM (`attachShadow`) aufbauen — das CSS der Seite beeinflusst das Panel nicht, und das CSS des Panels beeinflusst nicht die Seite.
- Die Endpunkte `/api/player/get-album` und `/api/player/stream/{id}` aufrufen.
- Die ersten ~64 KB des Streams lesen und den FLAC-Header auswerten (`readFlacHead`).
- Qualität, Dateinamen-Vorlage und Warteschlange im `localStorage` halten (ARCOD-Origin).
- Den Download entweder direkt auf die Festplatte streamen (`showSaveFilePicker`) oder an `background.js` übergeben.

### 1b. `media-hook.js` — MAIN world, document_start

Zeichnet die von der Seite erzeugten Audio-Elemente (auch `new Audio`) und die Web-Audio-Ausgabe (den Haupt-`GainNode`) passiv auf; nur über einen schmalen `CustomEvent`-Handshake zum Lesen/Einstellen der Lautstärke ist sie für `arcod-grab.js` zugänglich. Sie führt auch bei geschlossenem Panel keine automatische Aktion aus.

### 2. `relay.js` — ISOLATED world

Die MAIN world hat keinen Zugriff auf die `chrome.*`-APIs, und der Service Worker kann nicht direkt in die Seite schreiben. `relay.js` ist der **einzige, schmale Kanal** zwischen diesen beiden Seiten:

```js
// Seite  →  Erweiterung
window.postMessage({ __arcodgrab: true, type: 'request', id, req, args })
// Erweiterung  →  Seite
window.postMessage({ __arcodgrab: true, type: 'response', id, ok, res })
```

Es werden nur `arcodgrab:*`-Nachrichtentypen auf der Whitelist weitergeleitet; kein beliebiges Skript auf der Seite kann einen willkürlichen `chrome.*`-Aufruf ausführen. Beim Klick auf die Symbolleisten-Schaltfläche läuft `arcodgrab:toggle` ebenfalls über diesen Kanal nach unten.

### 3. `background.js` — Service Worker

- Führt die Aufrufe `chrome.downloads.download` / `open` / `show` / `showDefaultFolder` aus.
- Akzeptiert nur Adressen von `https://player.arcod.xyz/`.
- Verwaltet das Tab-Badge: **ON**, solange das Panel offen ist, bei Aufträgen in der Warteschlange die Anzahl.
- Gleicht die Unterschiede zwischen der `downloads`-API von Chrome (Callback) und Firefox (Promise) mit einem einzigen `callApi`-Wrapper aus.

## Nachrichtenprotokoll

| Typ | Richtung | Aufgabe |
|---|---|---|
| `arcodgrab:toggle` | background → Seite | Panel ein-/ausblenden |
| `arcodgrab:panel-ready` | Seite → background | Badge auf `ON` setzen |
| `arcodgrab:queue-count` | Seite → background | Anzahl der Warteschlange auf das Badge schreiben (bei `0` `ON`) |
| `arcodgrab:download` | Seite → background | Stream-Adresse an den Download-Manager übergeben |
| `arcodgrab:open` | Seite → background | Heruntergeladene Datei im Betriebssystem öffnen |
| `arcodgrab:show` | Seite → background | Download in der Liste anzeigen |
| `arcodgrab:show-folder` | Seite → background | Download-Ordner öffnen |
| `arcodgrab:commands` | Seite → background | Listet die zugewiesenen `commands`-Tasten auf |
| `arcodgrab:open-shortcuts` | Seite → background | Öffnet den Tab für Tastenkürzel-Einstellungen des Browsers |
| `arcodgrab:command` | background → Seite | Leitet einen zugewiesenen Befehl an die Seite weiter (`prev`, `next`, `volUp`, `volDown`) |

## Download-Ablauf

```text
ticket()            →  /api/player/stream/{id}?quality={q}
                       ↓  { url, quality }
fetch(ticket.url)   →  Stream (ReadableStream)
                       ↓
  saveMode = 'fsa'  →  showSaveFilePicker → writable.write(chunk) …
  saveMode = 'dl'   →  chrome.downloads.download({ url, filename })
```

Im Modus `dl` wird der Stream nie im Arbeitsspeicher gepuffert: Die Adresse geht direkt an den Download-Manager des Browsers, und der Browser schreibt die Datei. Im Modus `fsa` werden die Chunks als Stream auf die Festplatte geschrieben; da der vollständige Pfad der Datei für JS nicht zugänglich ist, öffnet „Im Ordner anzeigen“ den Download-Ordner des Browsers.

## Qualitätsmodell

ARCODs Qualitätstabelle definiert eine **Obergrenze**:

| Kanal | Bit | kHz |
|---|---|---|
| `5` | 16 | 44.1 |
| `6` | 16 | 48 |
| `7` | 24 | 96 |
| `27` | 24 | 192 |

Der Server bildet die Schnittmenge aus der angeforderten Obergrenze und der eigenen Auflösung der Aufnahme. 24/192 anzufordern ist also kein Upgrade, sondern bedeutet „das Bestmögliche“. Das Panel macht diesen Unterschied sichtbar, indem es vor dem Download die **tatsächlichen** aus dem Stream gelesenen Werte anzeigt.

## Verifizierung

`readFlacHead(u8)` sucht in den ersten Bytes nach:

1. der magischen Signatur `fLaC`,
2. der Kette der Metadatenblöcke (`STREAMINFO`, `PADDING`, `SEEKTABLE`, `VORBIS_COMMENT`, `PICTURE`…),
3. Abtastrate, Kanälen, Bittiefe, Gesamtzahl der Samples und MD5 aus dem STREAMINFO-Body.

Das Ergebnis wird als einer von drei Zuständen gemeldet: **original**, **neu verpackt** (MD5 ist null), **Tags entfernt** (kein VORBIS_COMMENT).

## Design

Das Panel folgt der Apple-HIG-Sprache: semantische Farb-Tokens (automatisch hell/dunkel), `backdrop-filter`-Materialflächen, 0,5-px-Trennlinien, 8-pt-Raster. Der Einfache Modus aktiviert sich beim ersten Start mit `prefers-contrast: more` von selbst.

## Tastenkürzel und Eingabe

- **Kürzel-Ablauf:** Die `commands` im Manifest (`arcod-prev`, `arcod-next`, `arcod-vol-up`, `arcod-vol-down`) haben keine Standardtaste; sie werden unter `chrome://extensions/shortcuts` zugewiesen. `background.js` empfängt `onCommand` und wählt den Ziel-Tab in dieser Reihenfolge: Audio wird abgespielt, aktiv, zuletzt verwendet. Gibt es keinen ARCOD-Tab, bleibt es still. Der Befehl läuft über `relay.js` als `arcodgrab:command` (Whitelist: `prev`, `next`, `volUp`, `volDown`) und erreicht die MAIN world als Nachricht `type: 'command'`, die `scCommand` verarbeitet. Es ist keine neue Berechtigung nötig.
- **Geltungsbereich:** `cfg.scScope` ist `'page'` (Standard) oder `'global'`. Im globalen Bereich funktionieren nur die `commands`-Tasten; im Panel zugewiesene eigene Tasten gelten nur auf der Seite.
- **Tastaturisolierung:** Beim Tippen im Panel gelangen Tasten (auch Space) nicht zur Seite; Seitenkürzel werden beim Tippen im Panel nicht ausgelöst.
- **Das Kontextmenü** funktioniert auch bei geschlossenem Panel; es führt von selbst keine Aktion aus, baut das Panel nicht auf und zeigt den Status als Toast. Das Hinzufügen zur Warteschlange läuft über den einen Pfad `queueAdd()`.
- **Die Dateinamen-Vorlage** wird mit einem Block-Editor (Chips) per Drag-and-drop bearbeitet; `cfg.template` bleibt ein String, `tplParse`/`tplBuild` wandeln um. Die Speichermethode ist `cfg.saveMode`: `'dl'` | `'fsa'` | `'auto'`; die Warteschlange lädt immer über den Browser-Download.
- **Lautstärke:** Zuerst wird der Lautstärkeregler der Website versucht, dann `audio.volume`.

## Sprachen

Alle für Nutzer sichtbaren Texte stehen in einem einzigen `I18N`-Wörterbuch in `arcod-grab.js` (`tr`, `en`, `de`, `fr`, `es`, `ru`). `t('schlüssel', { n })` liest daraus; ein fehlender Schlüssel fällt zuerst auf Türkisch zurück, und wenn auch dort nicht vorhanden, auf den Schlüssel selbst. Statische Knoten werden mit `data-i18n*`-Attributen markiert; bei einem Sprachwechsel schreibt `applyI18n()` alle ohne Seitenneuladen neu. `background.js` liefert statt eines Fehlertextes einen stabilen `code`; die Übersetzung erfolgt im Panel. `T()` schreibt den ersten Buchstaben sprachabhängig groß. Schritte zum Hinzufügen einer Sprache: [README → Sprachen](../../README.de.md#-sprachen).

## Warum eine einzige Datei?

`arcod-grab.js` hält Panel, CSS und Download-Engine in einer einzigen IIFE. In die MAIN world injizierte Skripte kennen kein Modulladen, und jede zusätzliche Datei wäre eine zusätzliche Anfrage pro Seite. Das ist also eine bewusste Entscheidung: **ein Skript, null Abhängigkeiten, null Build.** `arcod-grab.js` bleibt das einzige Hauptskript; `media-hook.js` ist nur getrennt, weil es vor den Skripten der Seite geladen werden muss.
