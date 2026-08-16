import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../docs/video.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/video.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../docs/video.css', import.meta.url), 'utf8');

test('Video Light puts the upload workbench first like the image tool', () => {
  assert.match(html, /class="workbench video-workbench"/);
  assert.match(html, /id="video-dropzone"/);
  assert.doesNotMatch(html, /class="video-hero"/);
  assert.match(css, /\.video-workbench-head/);
});

test('Video Light explains cleanup and bitrate without implying they affect detection', () => {
  assert.match(html, /Soft cleanup/);
  assert.match(html, /Pure reverse-alpha removal/);
  assert.match(html, /12 Mbps/);
  assert.match(html, /Recommended/);
  assert.match(html, /Bitrate only controls the newly encoded video quality and file size/);
  assert.match(html, /does not move the watermark region or make removal stronger/);
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

test('Video Light keeps a real responsive result workbench', () => {
  assert.match(html, /id="video-process"/);
  assert.match(html, /id="video-progress"/);
  assert.match(html, /id="video-result"/);
  assert.match(html, /id="video-after" controls playsinline preload="metadata"/);
  assert.match(css, /\.video-result-grid/);
  assert.match(css, /@media\(max-width:800px\)/);
});
