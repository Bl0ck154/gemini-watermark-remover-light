import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userscriptPath = path.join(root, 'gemini-watermark-remover-light.user.js');
const docsAppPath = path.join(root, 'docs', 'app.js');
const testsPath = path.join(root, 'tests', 'userscript.test.mjs');
const changelogPath = path.join(root, 'CHANGELOG.md');
const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
const upstreamCommit = 'a771bc28df7e6af97dd862d5f293157207ba6d58';
const upstreamMapsUrl = `https://raw.githubusercontent.com/GargantuaX/gemini-watermark-remover/${upstreamCommit}/src/core/embeddedAlphaMaps.js`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function replaceOnce(source, search, replacement, label) {
  if (typeof search === 'string') {
    assert(source.includes(search), `Could not find ${label}`);
    return source.replace(search, replacement);
  }
  assert(search.test(source), `Could not find ${label}`);
  return source.replace(search, replacement);
}

function replaceBetween(source, startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert(start >= 0 && end > start, `Could not find ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function quantize36(source) {
  const match = source.match(/'36-v2'\s*:\s*'([A-Za-z0-9+/=]+)'/);
  assert(match, 'Could not extract upstream 36-v2 map');
  const raw = Buffer.from(match[1], 'base64');
  assert(raw.length === 36 * 36 * 4, `Unexpected upstream 36-v2 byte length: ${raw.length}`);
  const out = Buffer.alloc(36 * 36);
  for (let i = 0; i < out.length; i += 1) {
    const value = raw.readFloatLE(i * 4);
    assert(Number.isFinite(value), `Non-finite upstream alpha at ${i}`);
    out[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
  }
  return out.toString('base64');
}

const helperUserscript = `  function getV2SmallConfig(width, height) {\n    const longSide = Math.max(width, height);\n    const shortSide = Math.min(width, height);\n    if (longSide > 2048 || shortSide <= 0) return null;\n    const sourceLongDim = shortSide >= 566 ? 2752 : (shortSide >= 550 ? 2816 : 2848);\n    const margin = Math.round(192 * (longSide / sourceLongDim));\n    const config = { size: 36, marginRight: margin, marginBottom: margin, mapKey: "36-v2" };\n    return width - margin - config.size >= 0 && height - margin - config.size >= 0 ? config : null;\n  }\n\n  function appendUniqueCandidate(candidates, candidate) {\n    if (!candidate) return candidates;\n    const duplicate = candidates.some((item) => item.size === candidate.size && item.marginRight === candidate.marginRight && item.marginBottom === candidate.marginBottom && item.mapKey === candidate.mapKey);\n    if (!duplicate) candidates.push(candidate);\n    return candidates;\n  }\n\n`;

const getCandidatesUserscript = `${helperUserscript}  function getCandidateConfigs(width, height) {\n    const key = \`${'${width}'}x${'${height}'}\`;\n    const v2Small = getV2SmallConfig(width, height);\n\n    if (HALF_K_SIZE_KEYS.has(key)) {\n      return appendUniqueCandidate([{ size: 48, marginRight: 32, marginBottom: 32, mapKey: "48", prior: 0.00025 }], v2Small);\n    }\n\n    if (ONE_K_SIZE_KEYS.has(key)) {\n      return appendUniqueCandidate([\n        { size: 48, marginRight: 32, marginBottom: 32, mapKey: "48", prior: 0.00035 },\n        { size: 48, marginRight: 96, marginBottom: 96, mapKey: "48", alphaGain: 0.55, prior: 0.00015 },\n        { size: 96, marginRight: 64, marginBottom: 64, mapKey: "96" },\n        { size: 24, marginRight: 48, marginBottom: 48, mapKey: "24-preview", alphaGain: 0.55 }\n      ], v2Small);\n    }\n\n    if (Math.max(width, height) >= 1024) {\n      const oldMargin = { size: 96, marginRight: 64, marginBottom: 64, mapKey: "96" };\n      const newMargin = { size: 96, marginRight: 192, marginBottom: 192, mapKey: "96-20260520" };\n      const currentLight = { size: 48, marginRight: 96, marginBottom: 96, mapKey: "48", alphaGain: 0.55 };\n      const candidates = [oldMargin, currentLight];\n      if (Math.max(width, height) <= 1800) {\n        candidates.push(\n          { size: 48, marginRight: 32, marginBottom: 32, mapKey: "48" },\n          { size: 24, marginRight: 48, marginBottom: 48, mapKey: "24-preview", alphaGain: 0.55 }\n        );\n      }\n      if (width - newMargin.marginRight - newMargin.size >= 0 && height - newMargin.marginBottom - newMargin.size >= 0) candidates.push(newMargin);\n      return appendUniqueCandidate(candidates, v2Small);\n    }\n\n    return appendUniqueCandidate([{ size: 48, marginRight: 32, marginBottom: 32, mapKey: "48", trusted: true }], v2Small);\n  }\n\n  function scoreConfig`;

const selectUserscript = `  async function selectConfig(imageData) {\n    const candidates = getCandidateConfigs(imageData.width, imageData.height);\n    if (candidates.length === 1 && candidates[0].trusted) return candidates[0];\n    let best = candidates[0];\n    let bestScore = Number.NEGATIVE_INFINITY;\n    let secondBestScore = Number.NEGATIVE_INFINITY;\n    for (const candidate of candidates) {\n      const alphaMap = await getAlphaMap(candidate.mapKey);\n      const score = scoreConfig(imageData, alphaMap, candidate) + (candidate.prior || 0);\n      if (score > bestScore) {\n        secondBestScore = bestScore;\n        best = candidate;\n        bestScore = score;\n      } else if (score > secondBestScore) {\n        secondBestScore = score;\n      }\n    }\n    if (bestScore < MIN_MULTI_CANDIDATE_SCORE) return scanBottomRightConfig(imageData);\n    if (Number.isFinite(secondBestScore) && bestScore - secondBestScore < MIN_MULTI_SCORE_GAP) return scanBottomRightConfig(imageData);\n    return best;\n  }`;

const helperDocs = `function getV2SmallConfig(width, height) {\n  const longSide = Math.max(width, height);\n  const shortSide = Math.min(width, height);\n  if (longSide > 2048 || shortSide <= 0) return null;\n  const sourceLongDim = shortSide >= 566 ? 2752 : (shortSide >= 550 ? 2816 : 2848);\n  const margin = Math.round(192 * (longSide / sourceLongDim));\n  const config = { size: 36, marginRight: margin, marginBottom: margin, mapKey: '36-v2' };\n  return width - margin - config.size >= 0 && height - margin - config.size >= 0 ? config : null;\n}\n\nfunction appendUniqueCandidate(candidates, candidate) {\n  if (!candidate) return candidates;\n  const duplicate = candidates.some((item) => item.size === candidate.size && item.marginRight === candidate.marginRight && item.marginBottom === candidate.marginBottom && item.mapKey === candidate.mapKey);\n  if (!duplicate) candidates.push(candidate);\n  return candidates;\n}\n\n`;

const getCandidatesDocs = `${helperDocs}function getCandidateConfigs(width, height) {\n  const key = \`${'${width}'}x${'${height}'}\`;\n  const v2Small = getV2SmallConfig(width, height);\n  if (HALF_K_SIZE_KEYS.has(key)) return appendUniqueCandidate([{ size: 48, marginRight: 32, marginBottom: 32, mapKey: '48', prior: 0.00025 }], v2Small);\n  if (ONE_K_SIZE_KEYS.has(key)) {\n    return appendUniqueCandidate([\n      { size: 48, marginRight: 32, marginBottom: 32, mapKey: '48', prior: 0.00035 },\n      { size: 48, marginRight: 96, marginBottom: 96, mapKey: '48', alphaGain: 0.55, prior: 0.00015 },\n      { size: 96, marginRight: 64, marginBottom: 64, mapKey: '96' },\n      { size: 24, marginRight: 48, marginBottom: 48, mapKey: '24-preview', alphaGain: 0.55 }\n    ], v2Small);\n  }\n  if (Math.max(width, height) >= 1024) {\n    const candidates = [\n      { size: 96, marginRight: 64, marginBottom: 64, mapKey: '96' },\n      { size: 48, marginRight: 96, marginBottom: 96, mapKey: '48', alphaGain: 0.55 }\n    ];\n    if (Math.max(width, height) <= 1800) candidates.push(\n      { size: 48, marginRight: 32, marginBottom: 32, mapKey: '48' },\n      { size: 24, marginRight: 48, marginBottom: 48, mapKey: '24-preview', alphaGain: 0.55 }\n    );\n    if (width >= 288 && height >= 288) candidates.push({ size: 96, marginRight: 192, marginBottom: 192, mapKey: '96-20260520' });\n    return appendUniqueCandidate(candidates, v2Small);\n  }\n  return appendUniqueCandidate([{ size: 48, marginRight: 32, marginBottom: 32, mapKey: '48', trusted: true }], v2Small);\n}\n\nfunction scoreConfig`;

const selectDocs = `async function selectConfig(imageData) {\n  const candidates = getCandidateConfigs(imageData.width, imageData.height);\n  if (candidates.length === 1 && candidates[0].trusted) return candidates[0];\n  let best = candidates[0];\n  let bestScore = Number.NEGATIVE_INFINITY;\n  let secondBestScore = Number.NEGATIVE_INFINITY;\n  for (const candidate of candidates) {\n    const score = scoreConfig(imageData, await getAlphaMap(candidate.mapKey), candidate) + (candidate.prior || 0);\n    if (score > bestScore) {\n      secondBestScore = bestScore;\n      best = candidate;\n      bestScore = score;\n    } else if (score > secondBestScore) {\n      secondBestScore = score;\n    }\n  }\n  if (bestScore < MIN_MULTI_CANDIDATE_SCORE) return scanBottomRightConfig(imageData);\n  if (Number.isFinite(secondBestScore) && bestScore - secondBestScore < MIN_MULTI_SCORE_GAP) return scanBottomRightConfig(imageData);\n  return best;\n}`;

const upstreamSource = await fetch(upstreamMapsUrl).then((response) => {
  assert(response.ok, `Failed to fetch upstream map source: ${response.status}`);
  return response.text();
});
const map36 = quantize36(upstreamSource);

let userscript = fs.readFileSync(userscriptPath, 'utf8');
userscript = replaceOnce(userscript, '// @version      0.2.5', '// @version      0.3.0', 'userscript version');
userscript = replaceOnce(userscript, '// @description  Lightweight download-focused remover: restored 0.1.13 runtime with standalone maps and current 2K watermark support', '// @description  Lightweight download-focused Gemini remover with standalone maps, v2 profile support and confidence-gated matching', 'userscript description');
if (!userscript.includes('"36-v2":')) userscript = replaceOnce(userscript, '  const EMBEDDED_ALPHA_MAPS_U8 = Object.freeze({\n    "24-preview":', `  const EMBEDDED_ALPHA_MAPS_U8 = Object.freeze({\n    "36-v2": "${map36}",\n    "24-preview":`, '36-v2 map');
if (!userscript.includes('MIN_MULTI_SCORE_GAP')) userscript = replaceOnce(userscript, '  const MIN_MULTI_CANDIDATE_SCORE = 0.002;\n', '  const MIN_MULTI_CANDIDATE_SCORE = 0.002;\n  const MIN_MULTI_SCORE_GAP = 0.0005;\n', 'userscript ambiguity constant');
userscript = replaceOnce(userscript, /  function getCandidateConfigs\(width, height\) \{[\s\S]*?\n  \}\n\n  function scoreConfig/, getCandidatesUserscript, 'userscript candidate block');
userscript = replaceBetween(userscript, '  async function selectConfig(imageData) {', '\n\n  async function scanBottomRightConfig', selectUserscript, 'userscript selectConfig');
userscript = replaceOnce(userscript, '      { mapKey: "24-preview", size: 24, alphaGain: 0.55 },\n      { mapKey: "48", size: 48, alphaGain: 0.55 },', '      { mapKey: "24-preview", size: 24, alphaGain: 0.55 },\n      { mapKey: "36-v2", size: 36 },\n      { mapKey: "48", size: 48, alphaGain: 0.55 },', 'userscript scan v2 profile');
fs.writeFileSync(userscriptPath, userscript);

let docsApp = fs.readFileSync(docsAppPath, 'utf8');
if (!docsApp.includes('MIN_MULTI_SCORE_GAP')) docsApp = replaceOnce(docsApp, 'const MIN_MULTI_CANDIDATE_SCORE = 0.002;\n', 'const MIN_MULTI_CANDIDATE_SCORE = 0.002;\nconst MIN_MULTI_SCORE_GAP = 0.0005;\n', 'docs ambiguity constant');
if (!docsApp.includes('const ONE_K_SIZE_KEYS')) docsApp = replaceOnce(docsApp, "const HALF_K_SIZE_KEYS = new Set(['512x512', '768x512', '512x768']);\n", "const HALF_K_SIZE_KEYS = new Set(['512x512', '768x512', '512x768']);\nconst ONE_K_SIZE_KEYS = new Set([\n  '1024x1024', '512x2048', '384x3072', '848x1264', '1264x848', '896x1200', '2048x512',\n  '1200x896', '928x1152', '1152x928', '3072x384', '768x1376', '1376x768', '1408x768',\n  '1584x672', '832x1248', '1248x832', '864x1184', '1184x864', '768x1344', '1344x768', '1536x672'\n]);\n", 'docs 1K catalog');
docsApp = replaceOnce(docsApp, /function getCandidateConfigs\(width, height\) \{[\s\S]*?\n\}\n\nfunction scoreConfig/, getCandidatesDocs, 'docs candidate block');
docsApp = replaceBetween(docsApp, 'async function selectConfig(imageData) {', '\n\nfunction removeWatermark', selectDocs, 'docs selectConfig');
docsApp = replaceOnce(docsApp, "    { mapKey: '24-preview', size: 24, alphaGain: 0.55 },\n    { mapKey: '48', size: 48, alphaGain: 0.55 },", "    { mapKey: '24-preview', size: 24, alphaGain: 0.55 },\n    { mapKey: '36-v2', size: 36 },\n    { mapKey: '48', size: 48, alphaGain: 0.55 },", 'docs scan v2 profile');
fs.writeFileSync(docsAppPath, docsApp);

let tests = fs.readFileSync(testsPath, 'utf8');
tests = replaceOnce(tests, "assert.equal(readVersion(), '0.2.5');", "assert.equal(readVersion(), '0.3.0');", 'test version');
if (!tests.includes("readMap('36-v2').length")) tests = replaceOnce(tests, "test('all calibrated maps are embedded at the expected dimensions', () => {\n  assert.equal(readMap('24-preview').length, 24 * 24);", "test('all calibrated maps are embedded at the expected dimensions', () => {\n  assert.equal(readMap('36-v2').length, 36 * 36);\n  assert.equal(readMap('24-preview').length, 24 * 24);", '36 map test');
if (!tests.includes("v2 36px profile reverses")) tests += `\n\ntest('v2 36px profile reverses a synthetic watermark', () => {\n  const width = 1408;\n  const height = 768;\n  const config = { size: 36, marginRight: 95, marginBottom: 95, alphaGain: 1 };\n  const alpha = readMap('36-v2');\n  const original = new Uint8ClampedArray(width * height * 3);\n  for (let i = 0; i < original.length; i += 1) original[i] = 40 + (i % 140);\n  const watermarked = new Uint8ClampedArray(original);\n  const originX = width - config.marginRight - config.size;\n  const originY = height - config.marginBottom - config.size;\n  for (let row = 0; row < config.size; row += 1) {\n    for (let col = 0; col < config.size; col += 1) {\n      const effectiveAlpha = alpha[row * config.size + col] / 255;\n      const offset = ((originY + row) * width + originX + col) * 3;\n      for (let channel = 0; channel < 3; channel += 1) watermarked[offset + channel] = Math.round(effectiveAlpha * 255 + (1 - effectiveAlpha) * original[offset + channel]);\n    }\n  }\n  const restored = removeWatermark(watermarked, width, height, alpha, config);\n  let maxError = 0;\n  for (let i = 0; i < restored.length; i += 1) maxError = Math.max(maxError, Math.abs(restored[i] - original[i]));\n  assert.ok(maxError <= 2, \`maximum v2 round-trip error was ${'${maxError}'}\`);\n  assert.match(source, /mapKey:\\s*[\"']36-v2[\"']/);\n  assert.match(source, /MIN_MULTI_SCORE_GAP/);\n});\n`;
fs.writeFileSync(testsPath, tests);

let changelog = fs.readFileSync(changelogPath, 'utf8');
if (!changelog.includes('compact current `36-v2`')) changelog = replaceOnce(changelog, '# Changelog\n\n## Unreleased\n', '# Changelog\n\n## Unreleased\n\n- Added the compact current `36-v2` watermark profile, quantized from the upstream calibrated alpha map.\n- Added projected v2 margin candidates and included the 36 px profile in bottom-right fallback scanning.\n- Added official 1K-size priors and an ambiguity gate between the two best candidates to reduce wrong-region edits.\n- Added regression coverage for the new 36 px profile and CI checks for userscript/web map synchronization.\n', 'changelog');
fs.writeFileSync(changelogPath, changelog);

fs.mkdirSync(path.dirname(ciPath), { recursive: true });
fs.writeFileSync(ciPath, `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm test\n      - run: npm run check\n`);

console.log('Applied v3 Light engine migration.');
