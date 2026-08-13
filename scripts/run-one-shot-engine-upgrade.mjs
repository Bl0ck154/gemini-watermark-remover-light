import fs from 'node:fs';

const target = new URL('./one-shot-engine-upgrade.mjs', import.meta.url);
let source = fs.readFileSync(target, 'utf8');
const start = source.indexOf('function patchSelectConfig(');
const end = source.indexOf('\n\nconst upstreamMaps', start);
if (start < 0 || end < 0) throw new Error('Could not locate patchSelectConfig helper');

const fixed = String.raw`function patchSelectConfig(source, indent = '  ') {
  const startToken = ${'`'}${'${indent}'}async function selectConfig(imageData) {${'`'};
  const endToken = ${'`'}\n\n${'${indent}'}async function scanBottomRightConfig${'`'};
  const startIndex = source.indexOf(startToken);
  const endIndex = source.indexOf(endToken, startIndex);
  assert(startIndex >= 0 && endIndex > startIndex, 'Could not find selectConfig');
  const replacement = ${'`'}${'${indent}'}async function selectConfig(imageData) {\n${'${indent}'}  const candidates = getCandidateConfigs(imageData.width, imageData.height);\n${'${indent}'}  if (candidates.length === 1 && candidates[0].trusted) return candidates[0];\n${'${indent}'}  let best = candidates[0];\n${'${indent}'}  let bestScore = Number.NEGATIVE_INFINITY;\n${'${indent}'}  let secondBestScore = Number.NEGATIVE_INFINITY;\n${'${indent}'}  for (const candidate of candidates) {\n${'${indent}'}    const alphaMap = await getAlphaMap(candidate.mapKey);\n${'${indent}'}    const score = scoreConfig(imageData, alphaMap, candidate) + (candidate.prior || 0);\n${'${indent}'}    if (score > bestScore) {\n${'${indent}'}      secondBestScore = bestScore;\n${'${indent}'}      best = candidate;\n${'${indent}'}      bestScore = score;\n${'${indent}'}    } else if (score > secondBestScore) {\n${'${indent}'}      secondBestScore = score;\n${'${indent}'}    }\n${'${indent}'}  }\n${'${indent}'}  if (bestScore < MIN_MULTI_CANDIDATE_SCORE) return scanBottomRightConfig(imageData);\n${'${indent}'}  if (Number.isFinite(secondBestScore) && bestScore - secondBestScore < MIN_MULTI_SCORE_GAP) {\n${'${indent}'}    return scanBottomRightConfig(imageData);\n${'${indent}'}  }\n${'${indent}'}  return best;\n${'${indent}'}}${'`'};
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}`.replaceAll('\u001b', '');

source = source.slice(0, start) + fixed + source.slice(end);
source = source.replace("userscript = patchSelectConfig(userscript, '  ', '\"');", "userscript = patchSelectConfig(userscript, '  ');");
source = source.replace("docsApp = patchSelectConfig(docsApp, '', \"'\");", "docsApp = patchSelectConfig(docsApp, '');");
fs.writeFileSync(target, source);
await import(target.href + `?fixed=${Date.now()}`);
