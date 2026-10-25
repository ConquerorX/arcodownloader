🇹🇷 [Türkçe](../GIZLILIK.md) · [English](../en/GIZLILIK.md) · [Deutsch](../de/GIZLILIK.md) · [Français](../fr/GIZLILIK.md) · **Español** · [Русский](../ru/GIZLILIK.md)

# Privacidad

**Resumen: ARCOD Grab no recopila ningún dato y no envía nada a ningún servidor.**
No existe un backend al que puedan acceder ni el desarrollador ni terceros.

## Datos que no se recopilan

- Información personal, datos de cuenta, correo electrónico, IP
- Historial de descargas, de escucha y de búsquedas
- Estadísticas de uso, informes de fallos, telemetría
- Cookies (la extensión no lee ni escribe ninguna cookie)

## Datos que permanecen en el navegador

Solo en el `localStorage` del origen `player.arcod.xyz`:

| Clave | Contenido |
|---|---|
| `arcodgrab.cfg.v1` | Techo de calidad, plantilla de nombre de archivo, modo de guardado, posición del panel, Modo fácil, preferencia de "en reproducción" |
| `arcodgrab.queue.v1` | Identificadores y nombres de las pistas de la cola de descarga |

Estas dos claves se borran junto con los datos de sitios del navegador. Al quitar la extensión también desaparecen junto con los datos de sitio guardados para ARCOD. Nunca se envían a un servidor.

## Acceso a la red

La extensión solo se comunica con las siguientes direcciones:

| Dirección | Finalidad |
|---|---|
| `https://player.arcod.xyz/api/player/*` | Datos del álbum y ticket de flujo |
| CDN de flujo de ARCOD (la dirección que devuelve el ticket) | Flujo de audio |

La única entrada de `host_permissions` en `manifest.json` es `https://player.arcod.xyz/*`. Ningún otro sitio puede leerse ni modificarse.

## Direcciones de flujo (ticket)

Para cada descarga se obtiene de ARCOD una dirección de flujo de corta duración. Esta dirección:

- se mantiene en memoria solo durante la descarga,
- **no** se escribe en disco, en `localStorage` ni en la consola,
- se libera cuando termina la descarga.

## Permisos

| Permiso | Por qué |
|---|---|
| `downloads` | Entregar el archivo al gestor de descargas del navegador, abrirlo, mostrar la carpeta |
| `host_permissions: player.arcod.xyz` | Colocar el panel en la página y solicitar el flujo desde el origen de la página |

Permisos como `tabs`, `storage`, `webRequest`, `cookies` o `scripting` **no se solicitan**. La URL de la pestaña solo se lee al hacer clic en la barra de herramientas, para verificar la dirección de la pestaña actual.

## Cambios

Si esta política cambia, se actualizan el número de versión y `CHANGELOG.md`. Como todo el código fuente está en este repositorio, cada afirmación se puede auditar:

```bash
grep -rn "fetch(" *.js      # solo /api/player y la dirección del ticket
grep -rn "sendBeacon\|XMLHttpRequest" *.js
```
