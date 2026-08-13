# Gemini Watermark Remover Light

A small, download-focused userscript for removing the visible Gemini sparkle watermark from generated images. It keeps the proven `0.1.13` interception flow without loading the full upstream UI/runtime.

## Why version 0.2.5?

Versions `0.2.0`–`0.2.2` were compatibility bridges that loaded the live upstream userscript through `@require`. That made Light inherit upstream regressions and removed its main advantage.

`0.2.5` restores the Light `0.1.13` runtime, but keeps a version greater than `0.2.2` so userscript managers can update normally. It preserves the original gist `@namespace` for in-place updates while moving `@updateURL` to this repository. It also:

- embeds the calibrated alpha maps instead of fetching a mutable gist;
- supports the current light 48×48 watermark at 96 px right/bottom margins;
- supports half-scale 1K previews with a 24×24 watermark at 48 px margins;
- applies the calibrated `0.55` alpha gain used by current large Gemini downloads;
- retains legacy 96×96 profiles and fallback scanning;
- processes downloads locally in the browser.

## Install

Open the [raw userscript](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js) with Tampermonkey or another compatible userscript manager.

Supported pages:

- `https://gemini.google.com/*`
- `https://business.gemini.google/*`

## Verified regression

The current profile was verified locally against a 2420×1728 Gemini JPG where the old 96×96 profile produced a dark artifact. The selected profile was:

```text
watermark box: x=2276..2323, y=1584..1631
size:          48×48
margins:       right=96, bottom=96
alpha gain:    0.55
```

## Development

No runtime dependencies or build step are required.

```bash
npm run check
npm test
```

## Українською

Це повернення легкого рушія `0.1.13`, а не повного upstream-комбайна. Версія `0.2.5` також обробляє зменшені 1K preview: 24×24 watermark із відступами 48 px. Старий gist `@namespace` навмисно збережений, а `@updateURL` уже веде в репозиторій.

## Credits

Based on the reverse-alpha approach from [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) and the original calibration work credited by that project. Released under the MIT License.
