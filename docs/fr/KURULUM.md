🇹🇷 [Türkçe](../KURULUM.md) · [English](../en/KURULUM.md) · [Deutsch](../de/KURULUM.md) · **Français** · [Español](../es/KURULUM.md) · [Русский](../ru/KURULUM.md)

# Installation

## Méthode rapide (depuis le dossier source)

1. Télécharge le dépôt : **Code ▸ Download ZIP** ou `git clone https://github.com/ConquerorX/arcodownloader.git`
2. Extrais le ZIP dans un dossier permanent (n'utilise pas un dossier temporaire sur le bureau : si tu le supprimes, l'extension disparaît).
3. Ouvre la page des extensions dans le navigateur :

   | Navigateur | Adresse |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Active le **Mode développeur**.
5. Clique sur **Charger l'extension non empaquetée** ▸ sélectionne le dossier qui contient `manifest.json`.

> `manifest.json` doit apparaître directement dans le dossier. Si tu sélectionnes un dossier parent créé par l'extraction du ZIP, le navigateur affichera « manifeste introuvable ».

## Chrome / Edge

Chrome 111 ou supérieur est requis (pour la prise en charge de `content_scripts.world: "MAIN"`). Edge étant basé sur Chromium, la même règle de version s'applique.

Après l'installation :

1. Ouvre <https://player.arcod.xyz/>.
2. Clique sur l'icône ARCOD de la barre d'outils. Si elle n'est pas épinglée, elle se trouve dans le menu en forme de puzzle ; fais un clic droit sur l'icône et choisis **Épingler**.
3. Sur une page d'album, le panneau apparaît en haut à droite.

## Firefox (expérimental)

Prérequis : **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Charger un module complémentaire temporaire  ▸  manifest.json
```

Une installation `temporaire` est supprimée à la fermeture du navigateur. Une installation permanente nécessite un `.xpi` signé :

```bash
# à la racine du dépôt
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Ensuite, `about:config` ▸ `xpinstall.signatures.required` → `false` (uniquement dans l'édition développeur) ou fais-le signer via Firefox Add-ons.

Comme `showSaveFilePicker` n'existe pas dans Firefox, l'extension utilise automatiquement le gestionnaire de téléchargements du navigateur.

## Déploiement en entreprise / en masse

Une installation forcée est possible avec `policies.json`. Le fichier se place dans le répertoire d'installation du navigateur :

- Windows : `%ProgramFiles%\Google\Chrome\Application\policies.json` (ou la base de registre `HKLM\SOFTWARE\Policies\Google\Chrome`)
- macOS : `/Library/Application Support/Google/Chrome/policies/managed/`
- Linux : `/etc/opt/chrome/policies/managed/`

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

> Le `policies.json` du dépôt est un exemple local utilisé uniquement pendant le développement ; comme il contient un chemin absolu, il est exclu par `.gitignore`.

## Mise à jour

```bash
git pull
```

Ensuite, sur la page des extensions, clique sur le bouton **↻** de la carte de l'extension. Si tu as installé via un ZIP, extrais le nouveau ZIP dans le même dossier, puis clique de nouveau sur ↻.

## Désinstallation

Clique sur **Supprimer** dans la page des extensions. Les réglages et la file d'attente sont conservés dans le `localStorage` de l'origine ARCOD ; pour un nettoyage complet, supprime aussi les données du site dans l'onglet ARCOD.

## Dépannage

| Symptôme | Solution |
|---|---|
| Le panneau ne s'ouvre pas | Recharge la page, puis clique sur l'icône. L'extension recharge l'onglet une fois automatiquement. |
| L'icône est grise / inactive | L'onglet n'est pas sur `player.arcod.xyz`. Cliquer sur l'icône ouvre ARCOD. |
| « manifeste introuvable » | Mauvais dossier sélectionné ; choisis le dossier où `manifest.json` apparaît directement. |
| Téléchargement 502 | Recharge la page, lance une fois le lecteur, réessaie. |
| Nom de fichier corrompu | `? : * \| " < >` sont interdits sous Windows ; simplifie le modèle. |
| « Cette extension est corrompue » (Chrome) | Des fichiers du dossier manquent ; extrais de nouveau le ZIP. |
