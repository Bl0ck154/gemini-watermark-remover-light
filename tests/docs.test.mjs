import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const maps = fs.readFileSync(new URL('../docs/maps.js', import.meta.url), 'utf8');
const userscript = fs.readFileSync(new URL('../gemini-watermark-remover-light.user.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/site.webmanifest', import.meta.url), 'utf8'));
const robots = fs.readFileSync(new URL('../docs/robots.txt', import.meta.url), 'utf8');
const sitemap = fs.readFileSync(new URL('../docs/sitemap.xml', import.meta.url), 'utf8');

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

test('project site leads with the uploader and includes complete discovery metadata', () => {
  assert.match(index, /Gemini Watermark Remover <em>Light<\/em>/);
  assert.doesNotMatch(index, /browser-local image utility|No backend|No upload/i);
  assert.match(index, /name="output-format" value="image\/jpeg" checked/);
  assert.match(index, /type="application\/ld\+json"/);
  assert.match(index, /rel="canonical"/);
  assert.match(index, /rel="icon" href="\.\/favicon\.svg"/);
});

test('download format choices use three distinct encoders', () => {
  assert.match(index, /name="output-format" value="image\/jpeg"/);
  assert.match(index, /name="output-format" value="image\/png"/);
  assert.match(index, /name="output-format" value="image\/webp"/);
  assert.doesNotMatch(index, /name="output-format" value="original"/);
  assert.match(index, /Smaller JPEG/);
  assert.match(index, /Lossless PNG/);
  assert.match(index, /High-quality WebP/);
});

test('every DOM id queried by the web app exists in the page', () => {
  const queriedIds = [...app.matchAll(/querySelector\('#([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(queriedIds.length > 10, 'expected the web app to query its controls');
  for (const id of queriedIds) assert.match(index, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});

test('SEO metadata, manifest, and crawler files use the public Pages URL', () => {
  const structuredData = JSON.parse(index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]);
  assert.equal(structuredData['@type'], 'WebApplication');
  assert.equal(structuredData.name, 'Gemini Watermark Remover Light');
  assert.equal(manifest.name, structuredData.name);
  assert.match(robots, /Sitemap: https:\/\/bl0ck154\.github\.io\/gemini-watermark-remover-light\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/bl0ck154\.github\.io\/gemini-watermark-remover-light\/<\/loc>/);
  assert.ok(fs.existsSync(new URL('../docs/favicon.svg', import.meta.url)));
});