import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../docs/video.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/video.js', import.meta.url), 'utf8');
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
  assert.match(css, /\.video-preview-close\{/);
});

test('Processed result is a single large preview with Original and Cleaned switching', () => {
  assert.match(html, /id="video-result-preview" controls playsinline preload="metadata"/);
  assert.match(html, /id="video-show-original"/);
  assert.match(html, /id="video-show-cleaned" class="is-active"/);
  assert.match(js, /function setResultMode\(mode\)/);
  assert.match(css, /\.video-preview-switch\{/);
});

test('Video settings are stacked and explain cleanup and bitrate', () => {
  assert.match(html, /class="format-picker video-choice-group video-cleanup-group"/);
  assert.match(html, /class="format-picker video-choice-group video-bitrate-group"/);
  assert.match(css, /\.video-options\{display:flex;flex-direction:column/);
  assert.match(html, /Enhanced cleanup/);
  assert.match(html, /compression halo/);
  assert.match(html, /12 Mbps/);
  assert.match(html, /Bitrate only controls output quality and file size/);
  assert.match(html, /does not affect watermark detection, position, or removal strength/);
});

test('Video Light adapts detection samples to clip length instead of fixed 12 frames', () => {
  assert.match(js, /DETECTION_SAMPLES_PER_SECOND = 3/);
  assert.match(js, /MIN_DETECTION_SAMPLES = 18/);
  assert.match(js, /MAX_DETECTION_SAMPLES = 60/);
  assert.match(js, /function detectionSampleCount\(duration\)/);
  assert.match(js, /SMART_SEARCH_FRAME_LIMIT = 9/);
  assert.doesNotMatch(js, /SAMPLE_COUNT = 12/);
});

test('Video Light calibrates edge-boosted alpha and performs footprint cleanup', () => {
  assert.match(js, /DEFAULT_ALPHA_EDGE_BOOST = 0\.045/);
  assert.match(js, /function enhanceVideoAlphaEdges/);
  assert.match(js, /function calibrateRemoval/);
  assert.match(js, /function refineFrameGain/);
  assert.match(js, /function buildFootprintPolishWeightMap/);
  assert.match(js, /function applyFootprintPolish/);
  assert.match(js, /cleanup === 'enhanced'/);
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
