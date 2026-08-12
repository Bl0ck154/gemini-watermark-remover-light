# Changelog

## 0.2.4

- Restored the legacy gist `@namespace` so Tampermonkey updates the existing script instead of installing a duplicate.
- Kept `@updateURL` and `@downloadURL` on the new repository raw URL.

## 0.2.3

- Restored the lightweight `0.1.13` download-focused runtime.
- Removed the live upstream `@require` bridge.
- Embedded calibrated alpha maps as compact 8-bit data.
- Added current 48×48, 96 px-margin, 0.55-gain large-image support.
- Preserved legacy 96×96 watermark profiles.
- Fixed multilingual download-action matching.

## 0.2.0–0.2.2

- Compatibility bridge to the live upstream userscript. Reverted because upstream changes could break Light without a Light release.

## 0.1.13

- Last stable standalone Light release before the compatibility bridge.
