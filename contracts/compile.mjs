import { runTolkCompiler } from '@ton/tolk-js';
import fs from 'node:fs';
import path from 'node:path';

const entry = process.argv[2] ?? 'points_claim.tolk';
const result = await runTolkCompiler({
  entrypointFileName: entry,
  fsReadCallback: (p) => fs.readFileSync(path.join('src', p.replace(/^\.\//, '')), 'utf8'),
});

if (result.status !== 'ok') {
  console.error(result.message);
  process.exit(1);
}

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/points_claim.compiled.json', JSON.stringify({ hex: result.codeHashHex, boc: result.codeBoc64 }, null, 2));
console.log('compiled ok; code hash', result.codeHashHex);
