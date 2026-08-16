# Changelog

## Unreleased

- Added experimental **Video Light** as a separate GitHub Pages tool for local MP4 processing.
- Added 12-frame Gemini/Veo diamond detection for common 1080p and 720p layouts, with conservative low-confidence fail/skip behavior.
- Added bottom-right smart search for relocated and smaller diamond variants instead of trusting only a few hard-coded positions.
- Raised the detection gate and added ambiguity rejection so weak matches stop instead of modifying the wrong region.
- Added frame-by-frame reverse-alpha removal, bounded alpha adjustment, and optional soft residual cleanup for compression ringing.
- Replaced the first manual video mux/export path with Mediabunny `Conversion`, so source frame timing is preserved by the media pipeline and the primary audio track is kept when supported.
- Reworked the Video Light page to match the image tool: the upload field is now at the top instead of below a large hero section.
- Replaced terse video settings with explained cleanup and 8/12/18 Mbps bitrate choices; 12 Mbps is the recommended default and bitrate is explicitly documented as output compression only.
- Added Video Light regression coverage, syntax checks, site navigation, and sitemap discovery.
- Video Light intentionally avoids a backend, ffmpeg.wasm, and bundled ML models; enhanced WebGPU/WASM denoise remains a future optional mode.

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
- Replaced the download dropdown with explained JPEG, PNG, and WebP choices.
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
