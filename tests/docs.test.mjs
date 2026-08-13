import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const maps = fs.readFileSync(new URL('../docs/maps.js', import.meta.url), 'utf8');
const userscript = fs.readFileSync(new URL('../gemini-watermark-remover-light.user.js', import.meta.url), 'utf8');

function mapObject(source) {
  const block = source.match(/EMBEDDED_ALPHA_MAPS_U8 = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
  assert.ok(block, 'missing embedded map block');
  return JSON.parse(block.replace(/(^|\n)\s*(48|96):/g, '$1"$2":'));
}

test('project site ships the same calibration data as the userscript', () => {
  assert.deepEqual(mapObject(maps), mapObject(userscript));
});

test('public image tool requires confidence instead of trusting arbitrary uploads', () => {
  assert.doesNotMatch(app, /trusted:\s*true/);
  assert.match(app, /bestScore < MIN_MULTI_CANDIDATE_SCORE/);
  assert.match(app, /No supported Gemini mark was found with enough confidence/);
});

test('upload UI protects format switching, stale work, and decoded image memory', () => {
  assert.match(app, /currentInputFile = file/);
  assert.match(app, /generation !== processingGeneration/);
  assert.match(app, /width \* height > MAX_PIXELS/);
  assert.match(app, /type === 'image\/webp' \? 'webp'/);
  assert.match(index, /aria-live="polite"/);
});
