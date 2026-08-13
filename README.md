# ✦ Gemini Watermark Remover Light

A **small, local-first userscript** for supported Gemini image downloads. Light keeps the proven standalone runtime, ships its calibrated image data inside the script, and avoids loading a mutable upstream runtime through `@require`.

[**Install userscript**](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js) · [Changelog](./CHANGELOG.md) · [MIT License](./LICENSE)

![JavaScript](https://img.shields.io/badge/JavaScript-browser--native-F7DF1E?logo=javascript&logoColor=111)
![Runtime](https://img.shields.io/badge/runtime-standalone-55e99a)
![Backend](https://img.shields.io/badge/backend-none-7aa7ff)
![License](https://img.shields.io/badge/license-MIT-blue)

## Why Light?

Versions `0.2.0`–`0.2.2` temporarily acted as compatibility bridges and loaded the live upstream userscript through `@require`. That made Light inherit upstream regressions and removed the main reason for keeping a lightweight fork.

`0.2.5` returns to the proven standalone Light runtime while keeping normal userscript updates working. It:

- embeds calibrated alpha maps instead of fetching mutable runtime data;
- supports current light profiles and half-scale previews;
- retains legacy 96×96 profiles and bounded fallback scanning;
- keeps the legacy gist `@namespace` so existing installs update in place;
- points `@updateURL` and `@downloadURL` at this repository;
- processes supported image downloads locally in the browser;
- has no runtime dependencies or build step.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Open the [raw userscript](https://raw.githubusercontent.com/Bl0ck154/gemini-watermark-remover-light/main/gemini-watermark-remover-light.user.js).
3. Confirm installation.
4. Use Gemini normally; supported image download flows are handled by the script.

Supported pages:

- `https://gemini.google.com/*`
- `https://business.gemini.google/*`

## Current profile coverage

| Profile | Placement | Notes |
|---|---:|---|
| 24×24 preview | 48 px right / bottom | half-scale preview, gain `0.55` |
| 48×48 light | 96 px right / bottom | current large-download profile, gain `0.55` |
| 48×48 light | 32 px right / bottom | smaller/current layout |
| 96×96 legacy | 64 px right / bottom | legacy profile |
| 96×96 2026 | 192 px right / bottom | later legacy-size placement |
| fallback scan | bounded bottom-right area | requires a confidence threshold and score gap |

## Verified regression

The current profile was verified locally against a `2420×1728` Gemini JPG where the old 96×96 profile produced a dark artifact:

```text
watermark box: x=2276..2323, y=1584..1631
size:          48×48
margins:       right=96, bottom=96
alpha gain:    0.55
```

## Design goals

**Small surface area.** The project stays download-focused instead of pulling in a larger UI/runtime.

**Local processing.** There is no project backend for image processing.

**Predictable updates.** Light changes only when this repository publishes a new version; it no longer inherits a live upstream script automatically.

**Fail-safe fallback.** When fixed candidates are insufficient, the fallback scan uses explicit confidence requirements instead of accepting any best-looking location.

## Development

No runtime dependencies or build step are required.

```bash
npm run check
npm test
```

The regression suite verifies the userscript identity/update path, embedded calibration dimensions, and synthetic round-trip behavior for current profiles.

## Project layout

```text
gemini-watermark-remover-light.user.js  # standalone userscript
README.md                                # project documentation
CHANGELOG.md                             # release history
tests/userscript.test.mjs               # regression tests
docs/                                    # static GitHub Pages project site
```

The polished static project page is kept in [`docs/`](./docs/) so it can be published directly with GitHub Pages from the `main` branch.

## Scope

This project is focused on the **visible Gemini image mark** documented by the upstream reverse-alpha approach. It does not claim to handle SynthID or other invisible provenance mechanisms.

## Credits

Based on the reverse-alpha approach from [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) and the original calibration work credited by that project.

This is an independent open-source project and is not affiliated with Google. Gemini and related names are trademarks of their respective owners.

Released under the [MIT License](./LICENSE).
