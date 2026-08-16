# Video Light

Experimental local-only video watermark removal for the GitHub Pages tool.

The browser pipeline uses Mediabunny for MP4 demux/mux and native WebCodecs for H.264 decoding/encoding. The visible Gemini/Veo diamond is detected from multiple sampled frames, then removed frame by frame with reverse alpha blending. A small Canvas cleanup pass can reduce compression residue. Compatible source audio is packet-copied into the output MP4.

Video Light v1 intentionally does not bundle ffmpeg.wasm or a neural denoise model. That keeps the default page lightweight and leaves enhanced WebGPU/WASM cleanup as an optional future mode.
