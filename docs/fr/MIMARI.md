🇹🇷 [Türkçe](../MIMARI.md) · [English](../en/MIMARI.md) · [Deutsch](../de/MIMARI.md) · **Français** · [Español](../es/MIMARI.md) · [Русский](../ru/MIMARI.md)

# Architecture

L'extension se compose volontairement de trois petites couches. Chaque couche ne fait qu'une seule chose et n'étend pas les droits des autres.

```
┌─────────────────────────────────────────────────────────────────────┐
│  player.arcod.xyz                                                   │
│                                                                     │
│  ┌───────────────────────┐        ┌──────────────────────────────┐  │
│  │ arcod-grab.js         │        │ relay.js                     │  │
│  │ MAIN world            │◄──────►│ ISOLATED world               │  │
│  │                       │postMsg │                              │  │
│  │ • panneau + CSS       │        │ • pont bidirectionnel        │  │
│  │ • fetch + lecture FLAC│        │ • accès à chrome.runtime     │  │
│  │ • file + modèle       │        │                              │  │
│  └───────────────────────┘        └───────────────┬──────────────┘  │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ sendMessage
                                    ┌───────────────▼──────────────┐
                                    │ background.js                │
                                    │ MV3 service worker           │
                                    │ • downloads API              │
                                    │ • badge (ON / taille file)   │
                                    │ • cycle de vie des onglets   │
                                    └───────────────┬──────────────┘
                                                    │
                                     gestionnaire de téléchargements
```

## Couches

### 1. `arcod-grab.js` — MAIN world

S'exécute dans le contexte JavaScript propre de la page. Il n'y a qu'une raison à cela : **la requête doit partir de l'origine de la page.** ARCOD rejette les clients hors navigateur (curl, PowerShell, Node) avec un 502 ; l'appel `fetch` doit donc ressembler à une requête normale de la page, et non à une requête forcée via CDP.

Rôles :

- Construire le panneau dans un Shadow DOM (`attachShadow`) — le CSS de la page n'affecte pas le panneau, et celui du panneau n'affecte pas la page.
- Appeler les points d'accès `/api/player/get-album` et `/api/player/stream/{id}`.
- Lire les ~64 premiers Ko du flux et analyser l'en-tête FLAC (`readFlacHead`).
- Conserver la qualité, le modèle de nom de fichier et la file dans le `localStorage` (origine ARCOD).
- Soit écrire le téléchargement en flux directement sur le disque (`showSaveFilePicker`), soit le confier à `background.js`.

### 1b. `media-hook.js` — MAIN world, document_start

Enregistre passivement les éléments audio créés par le site (y compris `new Audio`) et la sortie Web Audio (le `GainNode` principal) ; il n'est exposé à `arcod-grab.js` que par une poignée de main `CustomEvent` étroite, pour lire/régler le volume. Il n'exécute aucune action automatique, même quand le panneau est fermé.

### 2. `relay.js` — ISOLATED world

Le MAIN world n'a pas accès aux API `chrome.*`, et le service worker ne peut pas écrire directement dans la page. `relay.js` est le **canal unique et étroit** entre ces deux côtés :

```js
// page  →  extension
window.postMessage({ __arcodgrab: true, type: 'request', id, req, args })
// extension  →  page
window.postMessage({ __arcodgrab: true, type: 'response', id, ok, res })
```

Seuls les types de messages `arcodgrab:*` de la liste blanche sont transmis ; aucun script de la page ne peut effectuer un appel `chrome.*` arbitraire. Lors d'un clic sur le bouton de la barre d'outils, `arcodgrab:toggle` descend lui aussi par ce canal.

### 3. `background.js` — service worker

- Exécute les appels `chrome.downloads.download` / `open` / `show` / `showDefaultFolder`.
- N'accepte que les adresses `https://player.arcod.xyz/`.
- Gère le badge de l'onglet : **ON** quand le panneau est ouvert, le nombre de tâches s'il y en a dans la file.
- Gomme les différences entre l'API `downloads` de Chrome (callback) et de Firefox (Promise) avec un seul wrapper `callApi`.

## Protocole de messages

| Type | Sens | Rôle |
|---|---|---|
| `arcodgrab:toggle` | background → page | Afficher/masquer le panneau |
| `arcodgrab:panel-ready` | page → background | Passer le badge à `ON` |
| `arcodgrab:queue-count` | page → background | Écrire la taille de la file sur le badge (`ON` si `0`) |
| `arcodgrab:download` | page → background | Confier l'adresse du flux au gestionnaire de téléchargements |
| `arcodgrab:open` | page → background | Ouvrir le fichier téléchargé dans le système d'exploitation |
| `arcodgrab:show` | page → background | Afficher le téléchargement dans la liste |
| `arcodgrab:show-folder` | page → background | Ouvrir le dossier de téléchargements |
| `arcodgrab:commands` | page → background | Liste les touches `commands` attribuées |
| `arcodgrab:open-shortcuts` | page → background | Ouvre l'onglet des raccourcis du navigateur |
| `arcodgrab:command` | background → page | Transmet une commande attribuée à la page (`prev`, `next`, `volUp`, `volDown`) |

## Flux de téléchargement

```text
ticket()            →  /api/player/stream/{id}?quality={q}
                       ↓  { url, quality }
fetch(ticket.url)   →  flux (ReadableStream)
                       ↓
  saveMode = 'fsa'  →  showSaveFilePicker → writable.write(chunk) …
  saveMode = 'dl'   →  chrome.downloads.download({ url, filename })
```

En mode `dl`, le flux n'est jamais mis en mémoire : l'adresse va directement au gestionnaire de téléchargements du navigateur, qui écrit le fichier. En mode `fsa`, les blocs sont écrits sur le disque au fil du flux ; comme le chemin complet du fichier n'est pas exposé à JS, la fonction « afficher dans le dossier » ouvre le dossier de téléchargements du navigateur.

## Modèle de qualité

La table de qualité d'ARCOD définit un **plafond** :

| Canal | Bit | kHz |
|---|---|---|
| `5` | 16 | 44.1 |
| `6` | 16 | 48 |
| `7` | 24 | 96 |
| `27` | 24 | 192 |

Le serveur croise le plafond demandé avec la résolution propre de l'enregistrement. Demander du 24/192 n'est donc pas une amélioration, cela signifie « le meilleur possible ». Le panneau rend cette différence visible en affichant, avant le téléchargement, les valeurs **réelles** lues dans le flux.

## Vérification

`readFlacHead(u8)` recherche dans les premiers octets :

1. la signature magique `fLaC`,
2. la chaîne de blocs de métadonnées (`STREAMINFO`, `PADDING`, `SEEKTABLE`, `VORBIS_COMMENT`, `PICTURE`…),
3. dans le corps de STREAMINFO : fréquence d'échantillonnage, canaux, profondeur de bits, nombre total d'échantillons et MD5.

Le résultat est rapporté sous l'un de trois états : **original**, **reconditionné** (MD5 nul), **tags supprimés** (pas de VORBIS_COMMENT).

## Design

Le panneau suit le langage Apple HIG : jetons de couleur sémantiques (clair/sombre automatique), surfaces matérielles `backdrop-filter`, séparateurs de 0,5 px, grille de 8 pt. Le Mode facile s'active de lui-même au premier lancement avec `prefers-contrast: more`.

## Raccourcis et saisie

- **Flux des raccourcis :** les `commands` du manifeste (`arcod-prev`, `arcod-next`, `arcod-vol-up`, `arcod-vol-down`) n'ont aucune touche par défaut ; on les attribue sur `chrome://extensions/shortcuts`. `background.js` reçoit `onCommand` et choisit l'onglet cible dans cet ordre : audio en cours, actif, le plus récemment utilisé. S'il n'y a pas d'onglet ARCOD, il reste silencieux. La commande passe par `relay.js` sous la forme `arcodgrab:command` (liste blanche : `prev`, `next`, `volUp`, `volDown`) et arrive dans le MAIN world comme message `type: 'command'` traité par `scCommand`. Aucune nouvelle autorisation n'est nécessaire.
- **Portée :** `cfg.scScope` vaut `'page'` (par défaut) ou `'global'`. En portée globale, seules les touches `commands` fonctionnent ; les touches personnalisées attribuées dans le panneau ne valent que sur la page.
- **Isolation du clavier :** quand on tape dans le panneau, les touches (Espace compris) ne fuient pas vers la page ; les raccourcis de la page ne se déclenchent pas pendant la saisie dans le panneau.
- **Le menu contextuel** fonctionne aussi panneau fermé ; il n'agit pas de lui-même, ne construit pas le panneau et affiche l'état dans un toast. L'ajout à la file passe par l'unique chemin `queueAdd()`.
- **Le modèle de nom de fichier** s'édite avec un éditeur de blocs (chips) par glisser-déposer ; `cfg.template` reste une chaîne, convertie par `tplParse`/`tplBuild`. Le mode d'enregistrement est `cfg.saveMode` : `'dl'` | `'fsa'` | `'auto'` ; la file télécharge toujours via le navigateur.
- **Volume :** on essaie d'abord le curseur de volume du site, puis `audio.volume`.

## Langues

Tous les textes visibles par l'utilisateur se trouvent dans un unique dictionnaire `I18N` de `arcod-grab.js` (`tr`, `en`, `de`, `fr`, `es`, `ru`). `t('clé', { n })` le lit ; une clé manquante retombe d'abord sur le turc, puis, à défaut, sur la clé elle-même. Les nœuds statiques sont marqués par des attributs `data-i18n*` ; au changement de langue, `applyI18n()` les réécrit tous sans recharger la page. `background.js` renvoie un `code` stable au lieu d'un texte d'erreur ; la traduction se fait dans le panneau. `T()` met la première lettre en majuscule selon la langue. Étapes pour ajouter une langue : [README → Langues](../../README.fr.md#-langues).

## Pourquoi un seul fichier ?

`arcod-grab.js` regroupe le panneau, le CSS et le moteur de téléchargement dans une seule IIFE. Les scripts injectés dans le MAIN world n'ont pas de chargement de modules, et chaque fichier supplémentaire serait une requête de plus par page. C'est donc un choix délibéré : **un script, zéro dépendance, zéro build.** `arcod-grab.js` reste l'unique script principal ; `media-hook.js` est séparé uniquement parce qu'il doit se charger avant les scripts de la page.
