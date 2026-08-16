# Changelog

## Unreleased

- Added experimental **Video Light** as a separate GitHub Pages tool for local MP4 processing.
- Replaced the fixed 12-frame detector with adaptive sampling at roughly 3 detection frames per second, bounded to 18–60 samples; export still processes every decoded frame.
- Expanded smart search to score multiple representative frames instead of effectively trusting only three frames during fallback scanning.
- Added bottom-right smart search for relocated and smaller diamond variants instead of trusting only a few hard-coded positions.
- Raised the detection gate and added ambiguity rejection so weak matches stop instead of modifying the wrong region.
- Added upstream-style video alpha edge boosting, automatic edge/gain calibration on sampled frames, and bounded per-frame gain refinement.
- Added an Allenk-inspired refinement layer on top of the stable browser export path: a multi-frame **±4 px** local position snap tightens the detected anchor before final reverse-alpha reconstruction.
- Added per-shot alpha consensus from up to 12 useful frames plus the documented **five-round** local-background feedback estimator; strong-frame gain is capped to **±0.05** around the shot value to reduce flicker and over-removal.
- Replaced the old binary frame gate in the refinement layer with three-tier handling: strong frames get feedback refinement, weak-but-plausible frames use the shot consensus, and only likely watermark-free frames are left untouched. Background-normalized alpha contrast provides extra evidence on difficult bright/busy frames.
- Added conservative alpha-shape selection between the embedded calibrated `48`, `96`, and current `96-20260520` profiles. Alternatives are kept only when their multi-frame restoration residual improves over the baseline by a meaningful margin.
- The public Allenk demo repository does not expose its native implementation or remastered mask assets, so Video Light ports the documented position/gain behavior while continuing to use the calibrated maps available in the browser upstream.
- Replaced the old four-neighbor soft blur with deterministic footprint cleanup: an edge-aware watermark mask, local inpaint/repair, and texture-preserving blend aimed specifically at compression halo around the removed mark.
- Added default **High-quality cleanup** with an on-demand local FDnCNN pass over the watermark region. WebGPU is preferred when available and WASM is used as fallback; if the runtime fails, deterministic cleanup continues automatically.
- Kept the timing-safe Mediabunny `Conversion` export path and wrapped its async frame processor instead of reintroducing the earlier manual mux path.
- Reworked the Video Light page to use the upload field as the complete workspace: selected-video preview, remove/choose-another controls, processing state, and the final large preview all live in the same field.
- Replaced the two small result players with one large preview and an `Original / Cleaned` switch.
- Rebuilt the selected-video close icon from centered CSS strokes so it no longer depends on the off-center font glyph.
- Removed developer-facing metadata from the public video UI: sample counts, audio codec state, frame counters, detection coordinates, edge values, and gain values are no longer shown to end users.
- Simplified cleanup copy to `High-quality cleanup / Basic` and kept 12 Mbps as the recommended bitrate; bitrate is explicitly documented as output compression only.
- Added regression coverage and syntax checking for the Video Light bootstrap/FDnCNN and Allenk-style refinement layers.
- Video Light still avoids a backend and ffmpeg.wasm. User media remains local; the pinned denoise model is downloaded only when the high-quality mode needs it.

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
