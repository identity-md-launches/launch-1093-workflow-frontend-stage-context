import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const dist = path.join(root, 'dist');
const hashPattern = /^[a-f0-9]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const baseKeys = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts'];
const optionalKeys = ['poolKey', 'network', 'walletAddChain'];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const abiHash = abi => keccak256(stringToHex(canonical(abi))).slice(2);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = filename => JSON.parse(readFileSync(filename, 'utf8'));

function exactKeys(object, required, optional = []) {
  assert(object && typeof object === 'object' && !Array.isArray(object), 'Expected a JSON object');
  assert(required.every(key => Object.hasOwn(object, key)), `Missing required key in ${required.join(', ')}`);
  assert(Object.keys(object).every(key => [...required, ...optional].includes(key)), `Unexpected key: ${Object.keys(object).filter(key => ![...required, ...optional].includes(key)).join(', ')}`);
}

export function assertRelative(filename) {
  assert(typeof filename === 'string' && filename.length > 0, 'Empty asset path');
  assert(!filename.includes('\\') && !filename.includes(':') && !filename.includes('?') && !filename.includes('#'), `Unsafe path: ${filename}`);
  assert(!filename.startsWith('/') && filename.split('/').every(part => part !== '' && part !== '.' && part !== '..'), `Unsafe path: ${filename}`);
}

export function assertBase(input) {
  exactKeys(input, baseKeys, optionalKeys);
  assert.equal(input.version, 1, 'Unsupported manifest version');
  assert(typeof input.launchId === 'string' && input.launchId.length > 0, 'Missing launchId');
  assert(Number.isSafeInteger(input.chainId) && input.chainId > 0, 'Invalid chainId');
  assert(/^[a-f0-9]{40}$/.test(input.sourceCommit), 'Invalid source commit');
  assert(hashPattern.test(input.attestationHash), 'Invalid attestation hash');
  assert(Array.isArray(input.contracts) && input.contracts.length > 0, 'Missing contracts');
  const names = new Set();
  const paths = new Set();
  for (const contract of input.contracts) {
    exactKeys(contract, ['name', 'address', 'abiHash', 'abiPath']);
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(contract.name), 'Invalid contract name');
    assert(addressPattern.test(contract.address), 'Invalid contract address');
    assert(hashPattern.test(contract.abiHash), 'Invalid ABI hash');
    assertRelative(contract.abiPath);
    assert.equal(contract.abiPath, `abi/${contract.name}.json`, 'ABI path must match implementation name');
    assert(!names.has(contract.name) && !paths.has(contract.abiPath), 'Duplicate contract');
    names.add(contract.name);
    paths.add(contract.abiPath);
  }
  if (input.poolKey) {
    exactKeys(input.poolKey, ['currency0', 'currency1', 'fee', 'tickSpacing', 'hooks']);
    for (const key of ['currency0', 'currency1', 'hooks']) assert(addressPattern.test(input.poolKey[key]), `Invalid pool ${key}`);
    assert(BigInt(input.poolKey.currency0) < BigInt(input.poolKey.currency1), 'Pool currencies must be ordered');
    assert(Number.isInteger(input.poolKey.fee) && input.poolKey.fee >= 0 && input.poolKey.fee < 2 ** 24, 'Invalid pool fee');
    assert(Number.isInteger(input.poolKey.tickSpacing) && input.poolKey.tickSpacing > 0 && input.poolKey.tickSpacing < 2 ** 23, 'Invalid tick spacing');
  }
  if (input.network) {
    assert.equal(input.network.chainId, input.chainId, 'Network chain differs from handoff');
    assert(Array.isArray(input.network.rpcUrls) && input.network.rpcUrls.length > 0, 'Missing public RPC URLs');
    for (const rpc of input.network.rpcUrls) {
      const url = new URL(rpc);
      assert.equal(url.protocol, 'https:', 'RPC must use HTTPS');
      assert(!url.username && !url.password, 'RPC must not contain credentials');
    }
  }
  if (input.walletAddChain) {
    assert(input.network, 'walletAddChain requires network');
    assert.equal(BigInt(input.walletAddChain.chainId), BigInt(input.chainId), 'Wallet chain differs from handoff');
  }
}

export function handoffBase(handoff, networkInput) {
  const output = Object.fromEntries(baseKeys.filter(key => key !== 'contracts').map(key => [key, handoff[key]]));
  output.contracts = handoff.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash, abiPath: `abi/${name}.json` }));
  if (Object.hasOwn(handoff, 'poolKey')) output.poolKey = handoff.poolKey;
  if (networkInput) {
    output.network = networkInput.network;
    if (Object.hasOwn(networkInput, 'walletAddChain')) output.walletAddChain = networkInput.walletAddChain;
  }
  return output;
}

export function readBuildInput() {
  const input = readJson(path.join(root, 'web/deployment-input.json'));
  assertBase(input);
  const handoffPath = path.join(root, '.imd/reads/deployment.json');
  const networkPath = path.join(root, '.imd/reads/network.json');
  if (existsSync(handoffPath)) {
    const expected = handoffBase(readJson(handoffPath), existsSync(networkPath) ? readJson(networkPath) : undefined);
    assert.equal(canonical(input), canonical(expected), 'Build input differs from supplied attested deployment/network handoff');
  }
  return input;
}

export function sourceAbi(input, contract) {
  const bytes = execFileSync('git', ['show', `${input.sourceCommit}:docs/abi/${contract.name}.json`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const abi = JSON.parse(bytes.toString('utf8'));
  assert(Array.isArray(abi), `ABI must be a raw JSON array: ${contract.name}`);
  assert.equal(abiHash(abi), contract.abiHash, `Pinned implementation ABI hash mismatch: ${contract.name}`);
  return bytes;
}

export function exportedFiles(directory = dist, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory).sort()) {
    const filename = path.join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const stat = lstatSync(filename);
    assert(!stat.isSymbolicLink(), `Static export cannot contain a symlink: ${relative}`);
    if (stat.isDirectory()) files.push(...exportedFiles(filename, relative));
    else {
      assert(stat.isFile(), `Static export cannot contain a special file: ${relative}`);
      assertRelative(relative);
      files.push(relative);
    }
  }
  return files.sort();
}

export function verifyExport() {
  const input = readBuildInput();
  const manifest = readJson(path.join(dist, 'imd-deployment.json'));
  exactKeys(manifest, [...baseKeys, 'assets'], optionalKeys);
  const { assets, ...base } = manifest;
  assert.equal(canonical(base), canonical(input), 'Export configuration differs from build input');
  assert(Array.isArray(assets) && assets.length > 0 && assets.length <= 128, 'Export needs 1–128 declared assets');
  const files = exportedFiles().filter(filename => filename !== 'imd-deployment.json');
  assert(files.includes('index.html'), 'Missing static entrypoint');
  assert.equal(new Set(assets.map(asset => asset.path)).size, assets.length, 'Duplicate assets');
  assert.deepEqual([...assets.map(asset => asset.path)].sort(), files, 'Every exported file must be declared exactly once, excluding the manifest');
  let total = lstatSync(path.join(dist, 'imd-deployment.json')).size;
  for (const asset of assets) {
    exactKeys(asset, ['path', 'sha256']);
    assertRelative(asset.path);
    assert(hashPattern.test(asset.sha256), `Invalid SHA-256: ${asset.path}`);
    const bytes = readFileSync(path.join(dist, asset.path));
    assert(bytes.length <= 8 * 1024 * 1024, `Asset exceeds 8 MiB: ${asset.path}`);
    assert.equal(sha256(bytes), asset.sha256, `Asset integrity mismatch: ${asset.path}`);
    total += bytes.length;
  }
  assert(total < 24 * 1024 * 1024, 'Export exceeds conservative HTTP response budget');
  for (const contract of input.contracts) {
    const expectedBytes = sourceAbi(input, contract);
    const actualBytes = readFileSync(path.join(dist, contract.abiPath));
    const abi = JSON.parse(actualBytes.toString('utf8'));
    assert(Array.isArray(abi), `Exported ABI must be a raw array: ${contract.name}`);
    assert.equal(abiHash(abi), contract.abiHash, `Exported ABI hash mismatch: ${contract.name}`);
    assert(expectedBytes.equals(actualBytes), `Exported ABI bytes differ from pinned implementation: ${contract.name}`);
  }
  return { assets: assets.length, bytes: total, sourceCommit: input.sourceCommit, abiHashes: input.contracts.map(({ name, abiHash }) => ({ name, abiHash })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ result: 'PASS', ...verifyExport() }, null, 2));
  } catch (error) {
    console.error(`Export verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
