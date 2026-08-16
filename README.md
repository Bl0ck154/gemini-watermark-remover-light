# ✦ Gemini Watermark Remover Light

Remove supported **visible Gemini / Nano Banana image watermarks** directly in your browser, with an experimental local **Video Light** tool for Gemini/Veo diamond watermarks.

No media uploads. No processing backend. No account.

[**🌐 Open Image Tool**](https://bl0ck154.github.io/gemini-watermark-remover-light/) · [**🎬 Open Video Light**](https://bl0ck154.github.io/gemini-watermark-remover-light/video.html) · [**🧩 Install Userscript**](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js)

![JavaScript](https://img.shields.io/badge/JavaScript-browser--native-F7DF1E?logo=javascript&logoColor=111)
![Local processing](https://img.shields.io/badge/media%20processing-local-55e99a)
![Backend](https://img.shields.io/badge/backend-none-7aa7ff)
![License](https://img.shields.io/badge/license-MIT-blue)

## Ways to use it

### 🌐 Image web tool

For one-off images:

1. Drop or choose a Gemini image.
2. The visible watermark is processed locally in your browser.
3. Compare the before/after result.
4. Download the cleaned image as PNG, JPG, or WebP.

**Your image never leaves your device.** The site has no image-processing server or upload endpoint.

[**Open the image tool →**](https://bl0ck154.github.io/gemini-watermark-remover-light/#workbench)

### 🎬 Video Light · experimental

Video Light is a separate browser-only MP4 tool for supported visible Gemini/Veo **diamond** watermarks.

Current pipeline:

1. Read the local MP4 with Mediabunny.
2. Sample 12 frames and score known watermark layouts.
3. If the known layouts are weak or ambiguous, search the bottom-right area for relocated and smaller diamond variants.
4. Process frames locally with reverse alpha blending and optional soft residual cleanup.
5. Rebuild the MP4 through Mediabunny's Conversion API and native WebCodecs H.264, preserving source frame timing and keeping the primary audio track when conversion supports it.

Current scope is deliberately conservative: low-confidence or ambiguous clips stop instead of blindly modifying the wrong region.

**The video file is not uploaded.** The page loads the pinned Mediabunny browser module from jsDelivr; video processing itself stays on-device. Current Chrome/Edge are the primary browser target because Video Light needs H.264 WebCodecs support.

Video Light intentionally does **not** bundle ffmpeg.wasm or a neural denoise model. A later optional enhanced mode can add WebGPU/WASM FDnCNN cleanup without changing the local-only architecture.

#### Video bitrate

The default is **12 Mbps**, which is the recommended balance for typical 720p/1080p clips.

- **8 Mbps** — smaller output, more additional compression.
- **12 Mbps** — balanced default.
- **18 Mbps** — larger output with less additional compression.

Bitrate affects only the newly encoded video quality and file size. It does **not** change watermark detection, watermark position, or removal strength.

[**Open Video Light →**](https://bl0ck154.github.io/gemini-watermark-remover-light/video.html)

### 🧩 Userscript

If you download Gemini images regularly, install the userscript once and keep using Gemini normally.

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Open the [raw userscript](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js).
3. Confirm the installation.
4. Download supported Gemini images as usual.

The userscript works on:

- `gemini.google.com`
- `business.gemini.google`

The userscript remains image-focused; Video Light lives on the web tool where full-file decoding and encoding belong.

## Why Light?

- **Private by design** — user media is processed locally.
- **Deterministic core** — supported visible marks use calibrated reverse-alpha removal rather than generative fill.
- **Small default surface** — the image tool and userscript stay compact; Video Light avoids ffmpeg.wasm and bundled ML.
- **Fail-closed behavior** — uncertain image/video detection is preferred over editing the wrong region.
- **Open source** — the project is published under the MIT License.

## What it removes

The image paths target the **visible Gemini sparkle watermark** on supported generated images.

Video Light targets supported visible **Gemini/Veo diamond** video watermarks. It is experimental and does not yet promise the same coverage or cleanup quality as dedicated native video tools on heavily compressed or unusual clips.

This project does **not** claim to remove SynthID or other invisible provenance signals.

## Development

```bash
npm run check
npm test
```

Release notes and technical changes are kept in the [changelog](./CHANGELOG.md).

## Credits

Based on the reverse-alpha approach and calibration work from [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover), with video behavior informed by the public work in [allenk/VeoWatermarkRemover](https://github.com/allenk/VeoWatermarkRemover).

This is an independent open-source project and is not affiliated with Google. Gemini and related names are trademarks of their respective owners.

Released under the [MIT License](./LICENSE).
