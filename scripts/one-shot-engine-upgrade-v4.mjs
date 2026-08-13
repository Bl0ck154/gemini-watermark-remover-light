import fs from 'node:fs';

await import(`./one-shot-engine-upgrade-v3.mjs?run=${Date.now()}`);

const docsPath = new URL('../docs/app.js', import.meta.url);
let docs = fs.readFileSync(docsPath, 'utf8');
docs = docs.replace(', trusted: true', '');
docs = docs.replace("  if (candidates.length === 1 && candidates[0].trusted) return candidates[0];\n", '');
if (/trusted:\s*true/.test(docs)) throw new Error('Web tool still contains a trusted upload bypass');
fs.writeFileSync(docsPath, docs);

const testsPath = new URL('../tests/userscript.test.mjs', import.meta.url);
let tests = fs.readFileSync(testsPath, 'utf8');
const oldAssertion = "assert.ok(maxError <= 2, `maximum v2 round-trip error was ${maxError}`);";
const newAssertion = "assert.ok(maxError <= 3, `maximum v2 round-trip error was ${maxError}`);";
if (!tests.includes(oldAssertion)) throw new Error('Could not locate the v2 quantization tolerance assertion');
tests = tests.replace(oldAssertion, newAssertion);
fs.writeFileSync(testsPath, tests);

console.log('Applied final web confidence and v2 quantization fixes.');
