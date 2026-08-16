# Video Light v1 notes

Video Light is an experimental, browser-only MP4 pipeline. It intentionally keeps the first release small: Mediabunny + WebCodecs + the repository's existing calibrated alpha maps, with a light Canvas residual cleanup instead of shipping an ML model.

Current scope:
- MP4 input.
- Common Gemini/Veo diamond layouts at 1080p and 720p, with a conservative scaled fallback.
- Multi-frame sampling before export.
- Stable per-clip geometry and per-frame confidence gates.
- Reverse alpha removal with bounded frame-to-frame alpha changes.
- Optional soft residual cleanup for compression ringing.
- H.264/AVC output through native WebCodecs.
- Original audio packet copy when the source codec can be muxed into MP4.

Known limits:
- Experimental support outside calibrated 1080p/720p layouts.
- Heavy recompression or unusual watermark variants can leave a faint residual.
- Browser support depends on H.264 WebCodecs support; current Chrome/Edge are the primary target.
- Enhanced FDnCNN/WebGPU/WASM cleanup is deliberately deferred to a later optional mode so the default tool stays light.
