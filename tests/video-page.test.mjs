import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../docs/video.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../docs/video.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../docs/video.css', import.meta.url), 'utf8');

test('Video Light is a local browser tool with explicit supported scope', () => {
  assert.match(html, /Nothing is uploaded/);
  assert.match(html, /WebCodecs/);
  assert.match(html, /No server/);
  assert.match(html, /1080p and 720p/);
  assert.match(js, /mediabunny@1\.46\.0/);
  assert.match(js, /VideoSampleSink/);
  assert.match(js, /Mp4OutputFormat/);
});

test('Video Light keeps video safeguards and audio-copy path', () => {
  assert.match(js, /SAMPLE_COUNT = 12/);
  assert.match(js, /LOW_FRAME_CONFIDENCE/);
  assert.match(js, /MIN_DETECTION_SCORE/);
  assert.match(js, /canEncodeVideo\('avc'/);
  assert.match(js, /EncodedAudioPacketSource/);
  assert.match(js, /audio preserved/);
});

test('Video Light ships a real responsive workbench', () => {
  assert.match(html, /id="video-process"/);
  assert.match(html, /id="video-progress"/);
  assert.match(html, /id="video-result"/);
  assert.match(css, /\.video-result-grid/);
  assert.match(css, /@media\(max-width:800px\)/);
});
