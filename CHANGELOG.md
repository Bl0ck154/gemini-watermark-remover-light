# Changelog

## Unreleased

- Replaced the redundant `Original format` web option with an explicit WebP output, so JPEG, PNG, and WebP are now three distinct download choices.
- Added regression coverage preventing the duplicate output option from returning.
- Updated the web profile badge to v0.3.0.

- Added the compact current `36-v2` watermark profile, quantized from the upstream calibrated alpha map.
- Added projected v2 margin candidates and included the 36 px profile in bottom-right fallback scanning.
- Added official 1K-size priors and an ambiguity gate between the two best candidates to reduce wrong-region edits.
- Added regression coverage for the new 36 px profile and CI checks for userscript/web map synchronization.

- Turned the GitHub Pages project site into a functional local drag-and-drop image tool.
- Added confidence-gated profile matching, before/after comparison, and PNG, JPG, or WebP downloads.
- Added upload size and decoded-pixel limits, stale-job protection, and accessible processing states.
- Added generated calibration-map synchronization between the userscript and web tool.
- Moved the image drop field to the first screen and made the full field clickable.
- Replaced the download dropdown with explained JPEG, PNG, and original-format choices.
- Added complete product naming, structured SEO metadata, a sitemap, and a site icon.

## 0.2.5

- Added half-scale 1K preview support with a calibrated 24×24 alpha map, 48 px margins, and 0.55 gain.
- Added current 1K 48×48 / 32 px-margin detection alongside legacy profiles.
- Removed the blanket preview-size skip that left small watermarks untouched.

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
