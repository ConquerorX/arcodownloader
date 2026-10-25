🇹🇷 [Türkçe](../KURULUM.md) · [English](../en/KURULUM.md) · [Deutsch](../de/KURULUM.md) · [Français](../fr/KURULUM.md) · [Español](../es/KURULUM.md) · **Русский**

# Установка

## Быстрый способ (из папки с исходниками)

1. Скачайте репозиторий: **Code ▸ Download ZIP** или `git clone https://github.com/ConquerorX/arcodownloader.git`
2. Распакуйте ZIP в постоянную папку (не используйте временную папку на рабочем столе: если вы её удалите, расширение пропадёт).
3. Откройте в браузере страницу расширений:

   | Браузер | Адрес |
   |---|---|
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Brave | `brave://extensions` |
   | Opera | `opera://extensions` |
   | Vivaldi | `vivaldi://extensions` |

4. Включите **Режим разработчика**.
5. Нажмите **Загрузить распакованное расширение** ▸ выберите папку, в которой лежит `manifest.json`.

> `manifest.json` должен быть виден прямо внутри папки. Если выбрать родительскую папку, получившуюся при распаковке ZIP, браузер сообщит «манифест не найден».

## Chrome / Edge

Нужен Chrome 111 или новее (для поддержки `content_scripts.world: "MAIN"`). Edge основан на Chromium, поэтому действует то же правило по версии.

После установки:

1. Откройте <https://player.arcod.xyz/>.
2. Нажмите значок ARCOD на панели инструментов. Если он не закреплён, он находится в меню-пазле; щёлкните значок правой кнопкой и выберите **Закрепить**.
3. На странице альбома панель появляется справа вверху.

## Firefox (экспериментально)

Требование: **Firefox 128+**.

```
about:debugging#/runtime/this-firefox  ▸  Загрузить временное дополнение  ▸  manifest.json
```

`Временная` установка удаляется при закрытии браузера. Для постоянной установки нужен подписанный `.xpi`:

```bash
# в корне репозитория
zip -r ../arcodownloader.xpi manifest.json background.js arcod-grab.js media-hook.js relay.js \
          icon16.png icon32.png icon48.png icon128.png
```

Затем `about:config` ▸ `xpinstall.signatures.required` → `false` (только в версии для разработчиков) или подпишите через Firefox Add-ons.

Поскольку в Firefox нет `showSaveFilePicker`, расширение автоматически использует менеджер загрузок браузера.

## Корпоративное / массовое развёртывание

Принудительную установку можно выполнить через `policies.json`. Файл кладётся в каталог установки браузера:

- Windows: `%ProgramFiles%\Google\Chrome\Application\policies.json` (или реестр `HKLM\SOFTWARE\Policies\Google\Chrome`)
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

> `policies.json` в репозитории — это локальный пример, который используется только при разработке; так как он содержит абсолютный путь, он исключён через `.gitignore`.

## Обновление

```bash
git pull
```

Затем на странице расширений нажмите кнопку **↻** на карточке расширения. Если вы устанавливали из ZIP, распакуйте новый ZIP в ту же папку и снова нажмите ↻.

## Удаление

Нажмите **Удалить** на странице расширений. Настройки и очередь хранятся в `localStorage` origin ARCOD, поэтому для полной очистки удалите также данные сайта во вкладке ARCOD.

## Устранение неполадок

| Симптом | Решение |
|---|---|
| Панель не открывается | Обновите страницу, затем нажмите значок. Расширение один раз автоматически перезагружает вкладку. |
| Значок серый / неактивен | Вкладка не на `player.arcod.xyz`. Нажатие на значок открывает ARCOD. |
| «манифест не найден» | Выбрана не та папка; выберите папку, в которой `manifest.json` виден напрямую. |
| Загрузка 502 | Обновите страницу, один раз запустите плеер, повторите попытку. |
| Имя файла испорчено | В Windows запрещены `? : * \| " < >`; упростите шаблон. |
| «Это расширение повреждено» (Chrome) | В папке не хватает файлов; распакуйте ZIP заново. |
