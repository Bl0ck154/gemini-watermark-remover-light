import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../gemini-watermark-remover-light.user.js', import.meta.url), 'utf8');

function readVersion() {
  return source.match(/^\/\/ @version\s+(.+)$/m)?.[1].trim();
}

function readMap(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const packed = source.match(new RegExp(`(?:"${escaped}"|${escaped})\\s*:\\s*"([A-Za-z0-9+/=]+)"`))?.[1];
  assert.ok(packed, `missing embedded map ${key}`);
  return Uint8Array.from(Buffer.from(packed, 'base64'));
}

function removeWatermark(rgb, width, height, alphaBytes, config) {
  const result = new Uint8ClampedArray(rgb);
  const x = width - config.marginRight - config.size;
  const y = height - config.marginBottom - config.size;
  for (let row = 0; row < config.size; row++) {
    for (let col = 0; col < config.size; col++) {
      const alpha = alphaBytes[row * config.size + col] / 255;
      const signal = Math.max(0, alpha - 3 / 255) * config.alphaGain;
      if (signal < 0.002) continue;
      const effectiveAlpha = Math.min(alpha * config.alphaGain, 0.99);
      const remainder = 1 - effectiveAlpha;
      const offset = ((y + row) * width + x + col) * 3;
      for (let channel = 0; channel < 3; channel++) {
        result[offset + channel] = Math.max(
          0,
          Math.min(255, Math.round((result[offset + channel] - effectiveAlpha * 255) / remainder))
        );
      }
    }
  }
  return result;
}

test('release preserves the legacy identity and updates over the broken 0.2.2 bridge', () => {
  assert.equal(readVersion(), '0.2.5');
  assert.match(source, /^\/\/ @namespace\s+https:\/\/gist\.github\.com\/Bl0ck154$/m);
  assert.match(source, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/Bl0ck154\/gemini-watermark-remover-light\/main\/gemini-watermark-remover-light\.user\.js$/m);
  assert.doesNotMatch(source, /@require|GM_xmlhttpRequest|MAP_SOURCE_URL/);
});

test('all calibrated maps are embedded at the expected dimensions', () => {
  assert.equal(readMap('24-preview').length, 24 * 24);
  assert.equal(readMap('48').length, 48 * 48);
  assert.equal(readMap('96').length, 96 * 96);
  assert.equal(readMap('96-20260520').length, 96 * 96);
});

test('half-scale 1K preview profile reverses a 24px watermark', () => {
  const width = 1210;
  const height = 864;
  const config = { size: 24, marginRight: 48, marginBottom: 48, alphaGain: 0.55 };
  const alpha = readMap('24-preview');
  assert.match(source, /size:\s*24,\s*marginRight:\s*48,\s*marginBottom:\s*48,\s*mapKey:\s*"24-preview"/);

  const original = new Uint8ClampedArray(width * height * 3).fill(86);
  const watermarked = new Uint8ClampedArray(original);
  const originX = width - config.marginRight - config.size;
  const originY = height - config.marginBottom - config.size;
  for (let row = 0; row < config.size; row++) {
    for (let col = 0; col < config.size; col++) {
      const effectiveAlpha = (alpha[row * config.size + col] / 255) * config.alphaGain;
      const offset = ((originY + row) * width + originX + col) * 3;
      for (let channel = 0; channel < 3; channel++) {
        watermarked[offset + channel] = Math.round(
          effectiveAlpha * 255 + (1 - effectiveAlpha) * original[offset + channel]
        );
      }
    }
  }

  const restored = removeWatermark(watermarked, width, height, alpha, config);
  let maxError = 0;
  for (let index = 0; index < restored.length; index++) {
    maxError = Math.max(maxError, Math.abs(restored[index] - original[index]));
  }
  assert.ok(maxError <= 2, `maximum preview round-trip error was ${maxError}`);
});

test('current 48px/96px-margin profile reverses a synthetic light watermark', () => {
  const width = 320;
  const height = 240;
  const config = { size: 48, marginRight: 96, marginBottom: 96, alphaGain: 0.55 };
  const alpha = readMap('48');
  const original = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      original[offset] = 45 + ((x * 7 + y * 3) % 90);
      original[offset + 1] = 55 + ((x * 5 + y * 11) % 80);
      original[offset + 2] = 35 + ((x * 13 + y * 2) % 75);
    }
  }

  const watermarked = new Uint8ClampedArray(original);
  const originX = width - config.marginRight - config.size;
  const originY = height - config.marginBottom - config.size;
  for (let row = 0; row < config.size; row++) {
    for (let col = 0; col < config.size; col++) {
      const effectiveAlpha = (alpha[row * config.size + col] / 255) * config.alphaGain;
      const offset = ((originY + row) * width + originX + col) * 3;
      for (let channel = 0; channel < 3; channel++) {
        watermarked[offset + channel] = Math.round(
          effectiveAlpha * 255 + (1 - effectiveAlpha) * original[offset + channel]
        );
      }
    }
  }

  const restored = removeWatermark(watermarked, width, height, alpha, config);
  let maxError = 0;
  for (let index = 0; index < restored.length; index++) {
    maxError = Math.max(maxError, Math.abs(restored[index] - original[index]));
  }
  assert.ok(maxError <= 2, `maximum round-trip error was ${maxError}`);
});
