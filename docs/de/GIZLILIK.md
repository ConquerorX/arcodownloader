🇹🇷 [Türkçe](../GIZLILIK.md) · [English](../en/GIZLILIK.md) · **Deutsch** · [Français](../fr/GIZLILIK.md) · [Español](../es/GIZLILIK.md) · [Русский](../ru/GIZLILIK.md)

# Datenschutz

**Kurzfassung: ARCOD Grab erhebt keine Daten und sendet nichts an irgendeinen Server.**
Es gibt kein Backend, auf das weder der Entwickler noch Dritte zugreifen könnten.

## Nicht erhobene Daten

- Persönliche Angaben, Kontodaten, E-Mail, IP
- Download-, Hör- und Suchverlauf
- Nutzungsstatistiken, Absturzberichte, Telemetrie
- Cookies (die Erweiterung liest oder schreibt keine Cookies)

## Daten, die im Browser bleiben

Nur im `localStorage` des Origins `player.arcod.xyz`:

| Schlüssel | Inhalt |
|---|---|
| `arcodgrab.cfg.v1` | Qualitätsobergrenze, Dateinamen-Vorlage, Speichermodus, Panelposition, Einfacher Modus, Einstellung „Wird gerade gespielt“ |
| `arcodgrab.queue.v1` | IDs und Namen der Titel in der Download-Warteschlange |

Diese beiden Schlüssel werden zusammen mit den Websitedaten des Browsers gelöscht. Auch beim Entfernen der Erweiterung verschwinden sie zusammen mit den für ARCOD gespeicherten Websitedaten. Sie werden nie an einen Server gesendet.

## Netzwerkzugriff

Die Erweiterung kommuniziert nur mit diesen Adressen:

| Adresse | Zweck |
|---|---|
| `https://player.arcod.xyz/api/player/*` | Albumdaten und Stream-Ticket |
| ARCODs Stream-CDN (die vom Ticket zurückgegebene Adresse) | Audiostream |

Der einzige Eintrag unter `host_permissions` in `manifest.json` ist `https://player.arcod.xyz/*`. Keine andere Website kann gelesen oder verändert werden.

## Stream-Adressen (Ticket)

Für jeden Download wird von ARCOD eine kurzlebige Stream-Adresse bezogen. Diese Adresse:

- wird nur während des Downloads im Arbeitsspeicher gehalten,
- wird **nicht** auf die Festplatte, in den `localStorage` oder in die Konsole geschrieben,
- wird nach Abschluss des Downloads freigegeben.

## Berechtigungen

| Berechtigung | Grund |
|---|---|
| `downloads` | Datei an den Download-Manager des Browsers übergeben, öffnen, Ordner anzeigen |
| `host_permissions: player.arcod.xyz` | Das Panel in die Seite einfügen und den Stream vom Origin der Seite anfordern |

Berechtigungen wie `tabs`, `storage`, `webRequest`, `cookies` und `scripting` werden **nicht angefordert**. Die Tab-URL wird nur bei einem Klick auf die Symbolleiste gelesen, um die Adresse des aktuellen Tabs zu prüfen.

## Änderungen

Ändert sich diese Richtlinie, werden Versionsnummer und `CHANGELOG.md` aktualisiert. Da der gesamte Quellcode in diesem Repository liegt, lässt sich jede Aussage überprüfen:

```bash
grep -rn "fetch(" *.js      # nur /api/player und die Ticket-Adresse
grep -rn "sendBeacon\|XMLHttpRequest" *.js
```
