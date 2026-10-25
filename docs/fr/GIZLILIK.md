🇹🇷 [Türkçe](../GIZLILIK.md) · [English](../en/GIZLILIK.md) · [Deutsch](../de/GIZLILIK.md) · **Français** · [Español](../es/GIZLILIK.md) · [Русский](../ru/GIZLILIK.md)

# Confidentialité

**Résumé : ARCOD Grab ne collecte aucune donnée et n'envoie rien à aucun serveur.**
Il n'existe aucun backend auquel le développeur ou des tiers pourraient accéder.

## Données non collectées

- Informations personnelles, informations de compte, e-mail, IP
- Historique de téléchargements, d'écoute et de recherche
- Statistiques d'utilisation, rapports de plantage, télémétrie
- Cookies (l'extension ne lit ni n'écrit aucun cookie)

## Données qui restent dans le navigateur

Uniquement dans le `localStorage` de l'origine `player.arcod.xyz` :

| Clé | Contenu |
|---|---|
| `arcodgrab.cfg.v1` | Plafond de qualité, modèle de nom de fichier, mode d'enregistrement, position du panneau, Mode facile, préférence « en cours de lecture » |
| `arcodgrab.queue.v1` | Identifiants et noms des pistes de la file de téléchargement |

Ces deux clés sont supprimées avec les données de site du navigateur. Quand tu désinstalles l'extension, elles disparaissent aussi avec les données de site conservées pour ARCOD. Elles ne sont jamais envoyées à un serveur.

## Accès réseau

L'extension ne communique qu'avec les adresses suivantes :

| Adresse | Objet |
|---|---|
| `https://player.arcod.xyz/api/player/*` | Données d'album et ticket de flux |
| CDN de flux d'ARCOD (l'adresse renvoyée par le ticket) | Flux audio |

La seule entrée `host_permissions` de `manifest.json` est `https://player.arcod.xyz/*`. Aucun autre site ne peut être lu ni modifié.

## Adresses de flux (ticket)

Pour chaque téléchargement, une adresse de flux de courte durée est obtenue auprès d'ARCOD. Cette adresse :

- n'est conservée en mémoire que pendant le téléchargement,
- n'est **pas** écrite sur le disque, dans le `localStorage` ou dans la console,
- est libérée à la fin du téléchargement.

## Autorisations

| Autorisation | Pourquoi |
|---|---|
| `downloads` | Confier le fichier au gestionnaire de téléchargements du navigateur, l'ouvrir, afficher le dossier |
| `host_permissions: player.arcod.xyz` | Placer le panneau dans la page et demander le flux depuis l'origine de la page |

Des autorisations comme `tabs`, `storage`, `webRequest`, `cookies` ou `scripting` ne sont **pas demandées**. L'URL de l'onglet n'est lue que lors d'un clic sur la barre d'outils, pour vérifier l'adresse de l'onglet courant.

## Modifications

Si cette politique change, le numéro de version et `CHANGELOG.md` sont mis à jour. Tout le code source étant dans ce dépôt, chaque affirmation est vérifiable :

```bash
grep -rn "fetch(" *.js      # uniquement /api/player et l'adresse du ticket
grep -rn "sendBeacon\|XMLHttpRequest" *.js
```
