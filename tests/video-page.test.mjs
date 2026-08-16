import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../docs/video.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/video.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../docs/video.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const sitemap = fs.readFileSync(new URL('../docs/sitemap.xml', import.meta.url), 'utf8');

test('Video Light is a local browser tool with explicit supported scope', () => {
  assert.match(html, /Nothing is uploaded/);
  assert.match(html, /WebCodecs/);
  assert.match(html, /No server/);
  assert.match(html, /1080p and 720p/);
  assert.match(js, /mediabunny@1\.46\.0/);
  assert.match(js, /VideoSampleSink/);
  assert.match(js, /Mp4OutputFormat/);
  assert.doesNotMatch(js, /ffmpeg\.wasm/i);
});

test('Video Light uses current Mediabunny metadata APIs and multi-frame safeguards', () => {
  assert.match(js, /SAMPLE_COUNT = 12/);
  assert.match(js, /LOW_FRAME_CONFIDENCE/);
  assert.match(js, /MIN_DETECTION_SCORE/);
  assert.match(js, /getDisplayWidth\(\)/);
  assert.match(js, /getDisplayHeight\(\)/);
  assert.match(js, /getFirstTimestamp\(\)/);
  assert.match(js, /computePacketStats\(90/);
  assert.match(js, /ambiguous in this clip/);
});

test('Video Light configures audio before starting the MP4 output', () => {
  assert.match(js, /EncodedAudioPacketSource/);
  assert.match(js, /EncodedPacketSink/);
  assert.match(js, /canEncodeVideo\('avc'/);
  const prepareIndex = js.indexOf('const audioCopy = await prepareAudioCopy');
  const startIndex = js.indexOf('await output.start()', prepareIndex);
  assert.ok(prepareIndex > 0, 'audio preparation must exist');
  assert.ok(startIndex > prepareIndex, 'audio track must be registered before output.start()');
});

test('Video Light ships a real responsive workbench and public navigation', () => {
  assert.match(html, /id="video-process"/);
  assert.match(html, /id="video-progress"/);
  assert.match(html, /id="video-result"/);
  assert.match(css, /\.video-result-grid/);
  assert.match(css, /@media\(max-width:800px\)/);
  assert.match(index, /href="\.\/video\.html">Video<\/a>/);
  assert.match(sitemap, /video\.html/);
});
