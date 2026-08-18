import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../docs/video.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/video.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../docs/video-bootstrap.js', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../docs/video-allenk-refinement.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../docs/video.css', import.meta.url), 'utf8');

test('Video Light mirrors the image tool upload layout', () => {
  assert.match(html, /class="workbench video-workbench"/);
  assert.match(html, /class="drop-zone video-dropzone"/);
  assert.match(html, /class="drop-idle"/);
  assert.match(html, /Drop a video here/);
  assert.match(html, /class="file-types">MP4/);
  assert.doesNotMatch(html, /Remove a video watermark/);
  assert.doesNotMatch(css, /\.video-main\s*\{/);
});

test('Selected video uses the drop field as a real preview workspace', () => {
  assert.match(html, /id="video-selected-state"/);
  assert.match(html, /id="video-selected-preview" controls playsinline preload="metadata"/);
  assert.match(html, /id="video-remove"/);
  assert.match(html, /id="video-replace"[^>]*>Choose another/);
  assert.match(css, /\.video-stage\{/);
  assert.match(css, /\.video-preview-close::before/);
  assert.match(css, /translate\(-50%,-50%\) rotate\(45deg\)/);
});

test('Processed result is a single large preview with Original and Cleaned switching', () => {
  assert.match(html, /id="video-result-preview" controls playsinline preload="metadata"/);
  assert.match(html, /id="video-show-original"/);
  assert.match(html, /id="video-show-cleaned" class="is-active"/);
  assert.match(js, /function setResultMode\(mode\)/);
  assert.match(css, /\.video-preview-switch\{/);
});

test('Video settings keep cleanup simple and match output bitrate to the source automatically', () => {
  assert.match(html, /class="format-picker video-choice-group video-cleanup-group"/);
  assert.doesNotMatch(html, /class="format-picker video-choice-group video-bitrate-group"/);
  assert.match(css, /\.video-options\{display:flex;flex-direction:column/);
  assert.match(html, /High-quality cleanup/);
  assert.match(html, /remaining halo locally/);
  assert.doesNotMatch(html, />12 Mbps</);
  assert.match(refinement, /async function sourceVideoBitrate/);
  assert.match(refinement, /getAverageBitrate/);
  assert.match(refinement, /computePacketStats/);
  assert.match(refinement, /Source-matched video bitrate/);
});

test('Video Light adapts detection samples to clip length instead of fixed 12 frames', () => {
  assert.match(js, /DETECTION_SAMPLES_PER_SECOND = 3/);
  assert.match(js, /MIN_DETECTION_SAMPLES = 18/);
  assert.match(js, /MAX_DETECTION_SAMPLES = 60/);
  assert.match(js, /function detectionSampleCount\(duration\)/);
  assert.match(js, /SMART_SEARCH_FRAME_LIMIT = 9/);
  assert.doesNotMatch(js, /SAMPLE_COUNT = 12/);
});

test('Video Light calibrates edge-boosted alpha and performs deterministic footprint cleanup', () => {
  assert.match(js, /DEFAULT_ALPHA_EDGE_BOOST = 0\.045/);
  assert.match(js, /function enhanceVideoAlphaEdges/);
  assert.match(js, /function calibrateRemoval/);
  assert.match(js, /function refineFrameGain/);
  assert.match(js, /function buildFootprintPolishWeightMap/);
  assert.match(js, /function applyFootprintPolish/);
  assert.match(js, /cleanup === 'enhanced'/);
});

test('Video refinement shim avoids the removed double reverse-alpha pass', () => {
  assert.match(html, /video-allenk-refinement\.js/);
  assert.match(refinement, /await import\('\.\/video-bootstrap\.js'\)/);
  assert.match(refinement, /sourceMatchedBitrateConversionInit/);
  assert.match(refinement, /Do not overwrite the cleaned/);
  assert.doesNotMatch(refinement, /POSITION_REFINE_RADIUS/);
  assert.doesNotMatch(refinement, /restoreRawPatch/);
  assert.doesNotMatch(refinement, /applyReverseAlpha/);
});

test('Calibrated current and legacy alpha profiles stay in the single main removal pipeline', () => {
  assert.match(js, /96-20260520/);
  assert.match(js, /SMALL_VIDEO_ALPHA_PROFILE = '48'/);
  assert.match(js, /LARGE_VIDEO_ALPHA_PROFILE = '96-20260520'/);
  assert.match(js, /function calibrateRemoval/);
  assert.match(js, /function refineFrameGain/);
  assert.match(js, /removeFrameWatermark/);
  assert.doesNotMatch(refinement, /applyReverseAlpha/);
});

test('High-quality cleanup adds local FDnCNN with WebGPU and WASM fallback', () => {
  assert.match(refinement, /await import\('\.\/video-bootstrap\.js'\)/);
  assert.match(bootstrap, /onnxruntime-web@\$\{ORT_VERSION\}/);
  assert.match(bootstrap, /model_core_fp32_104\.onnx/);
  assert.match(bootstrap, /model_core_fp32_200\.onnx/);
  assert.match(bootstrap, /executionProviders: \['webgpu'\]/);
  assert.match(bootstrap, /executionProviders: \['wasm'\]/);
  assert.match(bootstrap, /FDNCNN_SIGMA = 75/);
  assert.match(bootstrap, /async function enhanceCanvas/);
  assert.match(bootstrap, /process: async \(sample\)/);
  assert.match(bootstrap, /continuing with deterministic cleanup/);
});

test('Public video metadata is simplified for end users', () => {
  assert.match(bootstrap, /friendlySelectedMeta/);
  assert.match(bootstrap, /friendlyResultMeta/);
  assert.match(bootstrap, /Analyzing the watermark/);
  assert.match(bootstrap, /Cleaning the video locally/);
  assert.doesNotMatch(html, /detection samples/i);
  assert.doesNotMatch(html, /alpha gain/i);
});

test('Video Light uses local Mediabunny Conversion for timing-safe MP4 rebuilds', () => {
  assert.match(js, /mediabunny@1\.46\.0/);
  assert.match(js, /CanvasSink/);
  assert.match(js, /Conversion\.init/);
  assert.match(js, /tracks: 'primary'/);
  assert.match(js, /forceTranscode: true/);
  assert.match(js, /process: \(sample\)/);
  assert.doesNotMatch(js, /EncodedAudioPacketSource/);
  assert.doesNotMatch(js, /CanvasSource/);
});

test('Video Light keeps conservative smart-search safeguards', () => {
  assert.match(js, /smartSearchCandidates/);
  assert.match(js, /22, 24, 35, 36, 44, 48, 72/);
  assert.match(js, /720p-vertical-inset/);
  assert.match(js, /MIN_DETECTION_SCORE = 0\.12/);
  assert.match(js, /Nothing was changed/);
  assert.match(js, /watermark position is ambiguous/);
  assert.match(css, /@media\(max-width:800px\)/);
});
