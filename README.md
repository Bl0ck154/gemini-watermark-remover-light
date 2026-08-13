# ✦ Gemini Watermark Remover Light

Remove the **visible Gemini / Nano Banana watermark** directly in your browser.

No uploads. No backend. No account. Just open an image, remove the visible mark, and download the result.

[**🌐 Open Web Tool**](https://bl0ck154.github.io/gemini-watermark-remover-light/) · [**🧩 Install Userscript**](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js)

![JavaScript](https://img.shields.io/badge/JavaScript-browser--native-F7DF1E?logo=javascript&logoColor=111)
![Local processing](https://img.shields.io/badge/processing-100%25%20local-55e99a)
![Backend](https://img.shields.io/badge/backend-none-7aa7ff)
![License](https://img.shields.io/badge/license-MIT-blue)

## Two ways to use it

### 🌐 Web tool

For one-off images, use the browser tool:

1. Drop or choose a Gemini image.
2. The visible watermark is processed locally in your browser.
3. Compare the before/after result.
4. Download the cleaned image as PNG, JPG, or WebP.

**Your image never leaves your device.** The site has no image-processing server or upload endpoint.

[**Open the web tool →**](https://bl0ck154.github.io/gemini-watermark-remover-light/#workbench)

### 🧩 Userscript

If you download Gemini images regularly, install the userscript once and keep using Gemini normally.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Open the [raw userscript](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js).
3. Confirm the installation.
4. Download supported Gemini images as usual.

The userscript works on:

- `gemini.google.com`
- `business.gemini.google`

## Why Light?

- **Private by design** — image processing happens locally.
- **No AI guessing** — it uses a deterministic removal method for supported visible Gemini marks.
- **Lightweight** — no external runtime or processing backend.
- **Web + userscript** — use the quick browser tool or automate downloads.
- **Open source** — the project is published under the MIT License.

## What it removes

This project targets the **visible Gemini sparkle watermark** found on supported generated images.

It does **not** claim to remove SynthID or other invisible provenance signals.

## Development

```bash
npm run check
npm test
```

Release notes and technical changes are kept in the [changelog](./CHANGELOG.md).

## Credits

Based on the reverse-alpha approach from [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) and the calibration work credited by that project.

This is an independent open-source project and is not affiliated with Google. Gemini and related names are trademarks of their respective owners.

Released under the [MIT License](./LICENSE).
