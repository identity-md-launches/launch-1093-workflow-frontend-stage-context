import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dist, exportedFiles, readBuildInput, sha256, sourceAbi, verifyExport } from './verify.mjs';

// This build-only input becomes the one runtime manifest. The app never imports it.
const input = readBuildInput();
for (const contract of input.contracts) {
  const bytes = sourceAbi(input, contract);
  const target = path.join(dist, contract.abiPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
const assets = exportedFiles()
  .filter(filename => filename !== 'imd-deployment.json')
  .map(filename => ({ path: filename, sha256: sha256(readFileSync(path.join(dist, filename))) }));
writeFileSync(path.join(dist, 'imd-deployment.json'), `${JSON.stringify({ ...input, assets }, null, 2)}\n`);
console.log(JSON.stringify({ result: 'PASS', ...verifyExport() }, null, 2));
