# Video Light engine

The browser engine processes video locally. It does not upload user media and does not require a backend.

Pipeline: MP4 demux -> multi-frame watermark detection -> frame decode -> reverse-alpha removal -> optional soft residual cleanup -> H.264 WebCodecs encode -> MP4 mux with source audio when compatible.

The first release deliberately avoids ffmpeg.wasm and neural-network assets. Enhanced FDnCNN cleanup can be added later as a lazy-loaded WebGPU/WASM mode without changing the local-only architecture.
