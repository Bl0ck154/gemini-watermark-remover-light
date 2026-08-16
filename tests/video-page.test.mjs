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
  assert.doesNotMatch(html, /video-workbench-head/);
  assert.doesNotMatch(css, /\.video-main\s*\{/);
});

test('Selected video and result actions reuse the image result toolbar pattern', () => {
  assert.match(html, /class="result-toolbar video-file-card"/);
  assert.match(html, /class="result-toolbar video-result-toolbar"/);
  assert.match(html, /id="video-replace"[^>]*>Choose another/);
  assert.match(html, /id="video-new"[^>]*>Choose another/);
});

test('Video settings are stacked and use the image option-card pattern', () => {
  assert.match(html, /class="format-picker video-choice-group video-cleanup-group"/);
  assert.match(html, /class="format-picker video-choice-group video-bitrate-group"/);
  assert.match(css, /\.video-options\{display:flex;flex-direction:column/);
  assert.match(html, /Soft cleanup/);
  assert.match(html, /Pure reverse-alpha removal/);
  assert.match(html, /12 Mbps/);
  assert.match(html, /Recommended/);
  assert.match(html, /Bitrate only controls output quality and file size/);
  assert.match(html, /does not affect watermark detection, position, or removal strength/);
});

test('Video Light uses local Mediabunny Conversion for timing-safe MP4 rebuilds', () => {
  assert.match(js, /mediabunny@1\.46\.0/);
  assert.match(js, /CanvasSink/);
  assert.match(js, /Conversion/);
  assert.match(js, /Conversion\.init/);
  assert.match(js, /tracks: 'primary'/);
  assert.match(js, /forceTranscode: true/);
  assert.match(js, /process: \(sample\)/);
  assert.doesNotMatch(js, /EncodedAudioPacketSource/);
  assert.doesNotMatch(js, /CanvasSource/);
});

test('Video Light searches beyond a few hard-coded watermark positions', () => {
  assert.match(js, /SAMPLE_COUNT = 12/);
  assert.match(js, /smartSearchCandidates/);
  assert.match(js, /searchSizes/);
  assert.match(js, /22, 24, 35, 36, 44, 48, 72/);
  assert.match(js, /720p-vertical-inset/);
  assert.match(js, /MIN_DETECTION_SCORE = 0\.12/);
  assert.match(js, /Nothing was changed/);
  assert.match(js, /watermark position is ambiguous/);
});

test('Video Light keeps a responsive result workbench', () => {
  assert.match(html, /id="video-process"/);
  assert.match(html, /id="video-progress"/);
  assert.match(html, /id="video-result"/);
  assert.match(html, /id="video-after" controls playsinline preload="metadata"/);
  assert.match(css, /\.video-result-grid/);
  assert.match(css, /@media\(max-width:800px\)/);
});
