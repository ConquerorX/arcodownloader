🇹🇷 [Türkçe](../KURULUM.md) · [English](../en/KURULUM.md) · [Deutsch](../de/KURULUM.md) · [Français](../fr/KURULUM.md) · **Español** · [Русский](../ru/KURULUM.md)

# Instalación

## Vía rápida (desde la carpeta de origen)

1. Descarga el repositorio: **Code ▸ Download ZIP** o `git clone https://github.com/ConquerorX/arcodownloader.git`
2. Extrae el ZIP en una carpeta permanente (no uses una carpeta temporal en el escritorio; si la borras, se pierde la extensión).
3. Abre la página de extensiones en el navegador:

   | Navegador | Dirección |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Activa el **Modo de desarrollador**.
5. Pulsa **Cargar descomprimida** ▸ selecciona la carpeta que contiene `manifest.json`.

> `manifest.json` debe verse directamente dentro de la carpeta. Si eliges una carpeta superior creada al extraer el ZIP, el navegador dirá "no se encontró el manifiesto".

## Chrome / Edge

Se necesita Chrome 111 o superior (por la compatibilidad con `content_scripts.world: "MAIN"`). Edge está basado en Chromium, así que se aplica la misma regla de versión.

Tras la instalación:

1. Abre <https://player.arcod.xyz/>.
2. Pulsa el icono de ARCOD en la barra de herramientas. Si no está anclado, estará dentro del menú del puzle; haz clic derecho en el icono y elige **Anclar**.
3. En la página de un álbum, el panel aparece arriba a la derecha.

## Firefox (experimental)

Requisito: **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Cargar complemento temporal  ▸  manifest.json
```

La instalación `temporal` se elimina al cerrar el navegador. Para una instalación permanente se necesita un `.xpi` firmado:

```bash
# en la raíz del repositorio
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Después, `about:config` ▸ `xpinstall.signatures.required` → `false` (solo en la edición para desarrolladores) o haz que lo firmen en Firefox Add-ons.

Como `showSaveFilePicker` no existe en Firefox, la extensión usa automáticamente el gestor de descargas del navegador.

## Distribución empresarial / masiva

Con `policies.json` se puede hacer una instalación forzada. El archivo se coloca en el directorio de instalación del navegador:

- Windows: `%ProgramFiles%\Google\Chrome\Application\policies.json` (o el registro `HKLM\SOFTWARE\Policies\Google\Chrome`)
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

> El `policies.json` del repositorio es un ejemplo local que solo se usa durante el desarrollo; como contiene una ruta absoluta, se excluye mediante `.gitignore`.

## Actualización

```bash
git pull
```

Después, en la página de extensiones, pulsa el botón **↻** de la tarjeta de la extensión. Si instalaste con ZIP, extrae el nuevo ZIP en la misma carpeta y vuelve a pulsar ↻.

## Desinstalación

Pulsa **Quitar** en la página de extensiones. Los ajustes y la cola se guardan en el `localStorage` del origen de ARCOD, así que, si quieres una limpieza completa, borra también los datos del sitio en la pestaña de ARCOD.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| El panel no se abre | Recarga la página y luego pulsa el icono. La extensión recarga la pestaña una vez automáticamente. |
| El icono está gris / inactivo | La pestaña no está en `player.arcod.xyz`. Pulsar el icono abre ARCOD. |
| "no se encontró el manifiesto" | Se eligió la carpeta equivocada; selecciona la carpeta donde `manifest.json` se vea directamente. |
| Descarga 502 | Recarga la página, reproduce el reproductor una vez e inténtalo de nuevo. |
| El nombre de archivo sale roto | En Windows están prohibidos `? : * \| " < >`; simplifica la plantilla. |
| "Esta extensión está dañada" (Chrome) | Faltan archivos en la carpeta; vuelve a extraer el ZIP. |
