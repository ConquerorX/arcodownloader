🇹🇷 [Türkçe](../MIMARI.md) · [English](../en/MIMARI.md) · [Deutsch](../de/MIMARI.md) · [Français](../fr/MIMARI.md) · **Español** · [Русский](../ru/MIMARI.md)

# Arquitectura

La extensión consta deliberadamente de tres capas pequeñas. Cada capa hace una sola cosa y no amplía los permisos de las demás.

```
┌─────────────────────────────────────────────────────────────────────┐
│  player.arcod.xyz                                                   │
│                                                                     │
│  ┌───────────────────────┐        ┌──────────────────────────────┐  │
│  │ arcod-grab.js         │        │ relay.js                     │  │
│  │ MAIN world            │◄──────►│ ISOLATED world               │  │
│  │                       │postMsg │                              │  │
│  │ • panel + CSS         │        │ • puente bidireccional       │  │
│  │ • fetch + lectura FLAC│        │ • acceso a chrome.runtime    │  │
│  │ • cola + plantilla    │        │                              │  │
│  └───────────────────────┘        └───────────────┬──────────────┘  │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ sendMessage
                                    ┌───────────────▼──────────────┐
                                    │ background.js                │
                                    │ MV3 service worker           │
                                    │ • downloads API              │
                                    │ • insignia (ON / n.º de cola)│
                                    │ • ciclo de vida de pestañas  │
                                    └───────────────┬──────────────┘
                                                    │
                                          gestor de descargas del navegador
```

## Capas

### 1. `arcod-grab.js` — MAIN world

Se ejecuta en el propio contexto JavaScript de la página. Hay un único motivo: **la petición debe salir del origen de la página.** ARCOD rechaza con un 502 a los clientes que no son navegadores (curl, PowerShell, Node); por eso la llamada `fetch` debe parecer una petición normal de la página y no una forzada mediante CDP.

Tareas:

- Montar el panel dentro de un Shadow DOM (`attachShadow`): el CSS de la página no afecta al panel, y el CSS del panel no afecta a la página.
- Llamar a los endpoints `/api/player/get-album` y `/api/player/stream/{id}`.
- Leer los primeros ~64 KB del flujo y analizar la cabecera FLAC (`readFlacHead`).
- Guardar la calidad, la plantilla de nombre de archivo y la cola en `localStorage` (origen de ARCOD).
- Volcar la descarga en flujo directamente al disco (`showSaveFilePicker`) o delegarla en `background.js`.

### 2. `relay.js` — ISOLATED world

El MAIN world no puede acceder a las API `chrome.*`, y el service worker no puede escribir directamente en la página. `relay.js` es el **único y estrecho canal** entre ambos lados:

```js
// página  →  extensión
window.postMessage({ __arcodgrab: true, type: 'request', id, req, args })
// extensión  →  página
window.postMessage({ __arcodgrab: true, type: 'response', id, ok, res })
```

Solo se reenvían los tipos de mensaje `arcodgrab:*` de la lista blanca; ningún script de la página puede hacer una llamada `chrome.*` arbitraria. Al pulsar el botón de la barra de herramientas, `arcodgrab:toggle` también baja por este mismo canal.

### 3. `background.js` — service worker

- Ejecuta las llamadas `chrome.downloads.download` / `open` / `show` / `showDefaultFolder`.
- Solo acepta direcciones `https://player.arcod.xyz/`.
- Gestiona la insignia de la pestaña: **ON** mientras el panel está abierto y, si hay trabajos en la cola, su número.
- Cubre las diferencias entre la API `downloads` de Chrome (callback) y la de Firefox (Promise) con un único envoltorio `callApi`.

## Protocolo de mensajes

| Tipo | Dirección | Función |
|---|---|---|
| `arcodgrab:toggle` | background → página | Mostrar/ocultar el panel |
| `arcodgrab:panel-ready` | página → background | Poner la insignia en `ON` |
| `arcodgrab:queue-count` | página → background | Escribir en la insignia el número de la cola (`ON` si es `0`) |
| `arcodgrab:download` | página → background | Entregar la dirección del flujo al gestor de descargas |
| `arcodgrab:open` | página → background | Abrir lo descargado en el sistema operativo |
| `arcodgrab:show` | página → background | Mostrar la descarga en la lista |
| `arcodgrab:show-folder` | página → background | Abrir la carpeta de descargas |
| `arcodgrab:commands` | página → background | Lista las teclas `commands` asignadas |
| `arcodgrab:open-shortcuts` | página → background | Abre la pestaña de atajos del navegador |
| `arcodgrab:command` | background → página | Reenvía a la página un comando asignado (`prev`, `next`, `volUp`, `volDown`) |

## Flujo de descarga

```text
ticket()            →  /api/player/stream/{id}?quality={q}
                       ↓  { url, quality }
fetch(ticket.url)   →  flujo (ReadableStream)
                       ↓
  saveMode = 'fsa'  →  showSaveFilePicker → writable.write(chunk) …
  saveMode = 'dl'   →  chrome.downloads.download({ url, filename })
```

En modo `dl` el flujo nunca se almacena en memoria: la dirección va directamente al gestor de descargas del navegador y es el navegador quien escribe el archivo. En modo `fsa` los fragmentos se escriben en disco en flujo; como la ruta completa del archivo no está expuesta a JS, la función "mostrar en carpeta" abre la carpeta de descargas del navegador.

## Modelo de calidad

La tabla de calidad de ARCOD define un **techo**:

| Canal | Bit | kHz |
|---|---|---|
| `5` | 16 | 44.1 |
| `6` | 16 | 48 |
| `7` | 24 | 96 |
| `27` | 24 | 192 |

El servidor cruza el techo solicitado con la resolución propia de la grabación. Por eso pedir 24/192 no es una mejora, sino "lo mejor posible". El panel hace visible esta diferencia mostrando, antes de descargar, los valores **reales** leídos del flujo.

## Verificación

`readFlacHead(u8)` busca en los primeros bytes:

1. la firma mágica `fLaC`,
2. la cadena de bloques de metadatos (`STREAMINFO`, `PADDING`, `SEEKTABLE`, `VORBIS_COMMENT`, `PICTURE`…),
3. del cuerpo de STREAMINFO: frecuencia de muestreo, canales, profundidad de bits, número total de muestras y MD5.

El resultado se informa como uno de tres estados: **original**, **reempaquetado** (MD5 a cero), **etiquetas eliminadas** (sin VORBIS_COMMENT).

## Diseño

El panel sigue el lenguaje Apple HIG: tokens de color semánticos (claro/oscuro automático), superficies de material con `backdrop-filter`, separadores de 0,5 px, cuadrícula de 8 pt. El Modo fácil se activa por sí solo en el primer arranque con `prefers-contrast: more`.

## Atajos y entrada

- **Flujo de atajos:** los `commands` del manifiesto (`arcod-prev`, `arcod-next`, `arcod-vol-up`, `arcod-vol-down`) no traen tecla por defecto; se asignan en `chrome://extensions/shortcuts`. `background.js` recibe `onCommand` y elige la pestaña de destino en este orden: con audio en reproducción, activa, usada más recientemente. Si no hay pestaña de ARCOD, permanece en silencio. El comando viaja por `relay.js` como `arcodgrab:command` (lista blanca: `prev`, `next`, `volUp`, `volDown`) y llega al MAIN world como mensaje `type: 'command'`, que procesa `scCommand`. No hace falta ningún permiso nuevo.
- **Ámbito:** `cfg.scScope` es `'page'` (por defecto) o `'global'`. En el ámbito global solo funcionan las teclas `commands`; las teclas personalizadas asignadas en el panel solo valen en la página.
- **Aislamiento del teclado:** al escribir en el panel, las teclas (incluido Espacio) no se filtran a la página; los atajos de la página no se activan mientras se escribe en el panel.
- **El menú contextual** también funciona con el panel cerrado; no actúa por sí solo, no construye el panel y muestra el estado con un toast. Añadir a la cola pasa por la única ruta `queueAdd()`.
- **La plantilla de nombre de archivo** se edita con un editor de bloques (chips) con arrastrar y soltar; `cfg.template` sigue siendo una cadena, convertida por `tplParse`/`tplBuild`. El método de guardado es `cfg.saveMode`: `'dl'` | `'fsa'` | `'auto'`; la cola siempre descarga mediante el navegador.
- **Volumen:** primero se prueba el control de volumen del sitio y después `audio.volume`.

## Idiomas

Todos los textos visibles para el usuario están en un único diccionario `I18N` dentro de `arcod-grab.js` (`tr`, `en`, `de`, `fr`, `es`, `ru`). `t('clave', { n })` lo lee; una clave que falte recurre primero al turco y, si tampoco está allí, a la propia clave. Los nodos estáticos se marcan con atributos `data-i18n*`; al cambiar de idioma, `applyI18n()` los reescribe todos sin recargar la página. `background.js` devuelve un `code` estable en lugar de un texto de error; la traducción se hace en el panel. `T()` pone la primera letra en mayúscula según el idioma. Pasos para añadir un idioma: [README → Idiomas](../../README.es.md#-idiomas).

## ¿Por qué un solo archivo?

`arcod-grab.js` mantiene el panel, el CSS y el motor de descarga en una única IIFE. Los scripts inyectados en el MAIN world no tienen carga de módulos, y cada archivo adicional sería una petición extra por página. Por eso es una elección deliberada: **un script, cero dependencias, cero compilación.**
