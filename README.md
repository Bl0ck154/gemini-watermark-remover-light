# ✦ Gemini Watermark Remover Light

**Remove the visible Gemini / Nano Banana sparkle locally in your browser.** No image uploads, no account, no AI inpainting.

[**Try the online remover**](https://bl0ck154.github.io/gemini-watermark-remover-light/) · [**Install the userscript**](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js) · [Changelog](./CHANGELOG.md)

![JavaScript](https://img.shields.io/badge/JavaScript-browser--native-F7DF1E?logo=javascript&logoColor=111)
![Local processing](https://img.shields.io/badge/processing-100%25_local-55e99a)
![No backend](https://img.shields.io/badge/backend-none-7aa7ff)
![License](https://img.shields.io/badge/license-MIT-blue)

Gemini Watermark Remover Light is a small, download-focused userscript **and** a standalone web tool for removing the visible Gemini sparkle watermark from generated images. It keeps the proven Light interception flow without loading the full upstream UI/runtime.

## Why Light?

The goal is intentionally narrow: do one thing reliably, locally and with as little runtime baggage as possible.

- **Deterministic reverse-alpha removal** — no generative fill or AI guessing.
- **100% local image processing** — the image is decoded, modified and re-encoded in your browser.
- **Fail-safe detection** — uncertain fallback matches are rejected instead of blindly modifying pixels.
- **Current + legacy profiles** — supports current light watermarks, half-scale previews and older 96×96 layouts.
- **Two ways to use it** — automatic cleanup inside Gemini via userscript, or drag-and-drop cleanup on the web page.
- **No runtime dependencies or build step** for the userscript itself.

## Online tool

Open **https://bl0ck154.github.io/gemini-watermark-remover-light/** and drop, browse or paste an image.

The page provides:

- drag & drop, file picker and clipboard paste;
- automatic local watermark detection and removal;
- before/after comparison slider;
- detected profile + margin details;
- JPEG or lossless PNG output;
- direct download from a local `Blob` URL.

The website has **no image upload endpoint**. The only project data it loads is the same calibrated alpha-map data shipped with this repository's userscript.

> **Scope:** this project targets the **visible** Gemini sparkle watermark. It does not claim to remove SynthID, invisible watermarking or other provenance systems.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Open the [raw userscript](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js).
3. Confirm installation.
4. Download supported generated images normally from Gemini.

Supported pages:

- `https://gemini.google.com/*`
- `https://business.gemini.google/*`

## Supported visible-watermark profiles

| Profile | Typical placement | Notes |
|---|---:|---|
| 24×24 preview | 48 px right / 48 px bottom | Half-scale preview, calibrated gain `0.55` |
| 48×48 light | 96 px right / 96 px bottom | Current large Gemini downloads, gain `0.55` |
| 48×48 legacy/light | 32 px right / 32 px bottom | Smaller/older layouts |
| 96×96 legacy | 64 px right / 64 px bottom | Legacy profile |
| 96×96 2026 profile | 192 px right / 192 px bottom | Later 96×96 placement |
| fallback scan | bottom-right candidate area | Runs only when fixed candidates are insufficient and requires a confidence gap |

### Verified regression case

The current light profile was verified locally against a `2420×1728` Gemini JPG where the old 96×96 profile produced a dark artifact:

```text
watermark box: x=2276..2323, y=1584..1631
size:          48×48
margins:       right=96, bottom=96
alpha gain:    0.55
```

## How it works

Gemini's visible sparkle is blended over the source pixels with a known alpha pattern. For each affected RGB channel, the remover reverses that blend approximately as:

```text
original = (watermarked - alpha × 255) / (1 - alpha)
```

The project stores calibrated alpha maps as compact 8-bit base64 data. Detection scores known profile/margin candidates against the image; larger uncertain cases can use a bounded bottom-right scan. If the scan does not have enough confidence, processing stops without changing the image.

## Userscript vs web tool

| | Userscript | Web tool |
|---|---|---|
| Best for | Everyday Gemini downloads | One-off/manual files |
| Input | Gemini download response | Drop / browse / paste |
| Processing | Browser-local | Browser-local |
| Server upload | No | No |
| Install required | Yes | No |
| Before/after UI | No | Yes |

## Output modes

The userscript keeps its lightweight download-oriented output modes, including compact JPEG-based output and true PNG. The web tool offers a simpler choice: preserve JPEG when appropriate, force JPEG 92%, or save as lossless PNG.

## Development

Requirements: a recent Node.js version for validation/tests. The runtime itself remains browser-native JavaScript.

```bash
npm run check
npm test
```

The GitHub Pages workflow also runs these checks before publishing the static website.

Repository layout:

```text
gemini-watermark-remover-light.user.js  # standalone userscript + calibrated maps
web/                                     # static no-backend web tool
tests/                                   # userscript + website regression checks
.github/workflows/pages.yml              # validation + GitHub Pages deployment
```

## Privacy

- No image upload API.
- No account or authentication.
- No analytics or third-party JavaScript in the web tool.
- Processing uses browser `Canvas` / `ImageData` and local `Blob` URLs.
- Object URLs are revoked when the image is replaced or the page is left.

## Credits

Based on the reverse-alpha approach from [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) and the original calibration work credited by that project.

This project is independent and is not affiliated with Google. Gemini and related names are trademarks of their respective owners.

Released under the [MIT License](./LICENSE).
