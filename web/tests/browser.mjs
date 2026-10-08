/** Production-export integration checks. All external requests and wallet writes are mocked. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exportDir = path.join(root, 'dist');
const evidenceDir = path.join(root, 'docs/evidence');
const manifest = JSON.parse(await readFile(path.join(exportDir, 'imd-deployment.json'), 'utf8'));
const token = manifest.contracts.find(contract => contract.name === 'LaunchToken').address.toLowerCase();
const pair = manifest.network.pairToken.address.toLowerCase();
const { permit2, universalRouter, quoter, stateView } = manifest.network.uniswapV4;
// Synthetic accounts belong only to this isolated browser fixture, never deployment configuration.
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const UNIT = 10n ** 18n;
const BLOCK_HASH = `0x${'a'.repeat(64)}`;
const ABIS = {
  token: parseAbi([
    'function name() view returns (string)', 'function symbol() view returns (string)',
    'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)',
    'function transferFrom(address,address,uint256) returns (bool)',
  ]),
  permit: parseAbi([
    'function allowance(address,address,address) view returns (uint160,uint48,uint48)',
    'function approve(address,address,uint160,uint48)',
  ]),
  state: parseAbi([
    'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)',
    'function getLiquidity(bytes32) view returns (uint128)',
  ]),
  quote: parseAbi([
    'struct PoolKey {address currency0;address currency1;uint24 fee;int24 tickSpacing;address hooks;}',
    'struct QuoteExactSingleParams {PoolKey poolKey;bool zeroForOne;uint128 exactAmount;bytes hookData;}',
    'function quoteExactInputSingle(QuoteExactSingleParams) returns (uint256 amountOut,uint256 gasEstimate)',
  ]),
  router: parseAbi(['function execute(bytes,bytes[],uint256) payable']),
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/preview/')) { response.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html';
    const file = path.resolve(exportDir, relative);
    if (!file.startsWith(`${exportDir}/`) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/preview/`;
const fallbackChrome = '/home/imd/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chromium.executablePath()) ? undefined : existsSync(fallbackChrome) ? fallbackChrome : undefined);
let browser;
let browserVersion;
const results = [];
const errors = [];
const seenExternal = new Set();

function fixture(options = {}) {
  return { options, writes: [], calls: [], tokenAllowances: new Map(), permitAllowances: new Map(), simulationFails: false, quoteFails: false, rpcFails: false, receipts: new Map() };
}
function encode(abi, functionName, result) { return encodeFunctionResult({ abi, functionName, result }); }
function rpcCall(mock, call) {
  const { method, params = [] } = call;
  mock.calls.push({ method, params });
  if (mock.rpcFails) throw { code: -32000, message: 'Fixture RPC temporarily unavailable' };
  if (method === 'eth_chainId') return '0x1';
  if (method === 'eth_getCode') return mock.options.missingCode ? '0x' : '0x60006000';
  if (method === 'eth_blockNumber') return '0x1900000';
  if (method === 'eth_getBalance') return `0x${(10n * UNIT).toString(16)}`;
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
  if (method === 'eth_estimateGas') return '0x30d40';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_getTransactionReceipt') return mock.receipts.get(params[0]) || null;
  if (method === 'eth_getBlockByNumber') return {
    number: '0x1900000', hash: BLOCK_HASH, parentHash: BLOCK_HASH, nonce: '0x0000000000000000',
    sha3Uncles: BLOCK_HASH, logsBloom: `0x${'0'.repeat(512)}`, transactionsRoot: BLOCK_HASH,
    stateRoot: BLOCK_HASH, receiptsRoot: BLOCK_HASH, miner: ACCOUNT, difficulty: '0x0', totalDifficulty: '0x0',
    extraData: '0x', size: '0x100', gasLimit: '0x1c9c380', gasUsed: '0x5208', timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}`,
    transactions: [], uncles: [], baseFeePerGas: '0x3b9aca00', mixHash: BLOCK_HASH,
  };
  if (method !== 'eth_call') throw { code: -32601, message: `Unhandled fixture RPC method ${method}` };
  const target = params[0].to.toLowerCase();
  const data = params[0].data;
  if ([token, pair].includes(target)) {
    const decoded = decodeFunctionData({ abi: ABIS.token, data });
    const name = decoded.functionName;
    const values = {
      name: target === token ? 'Swarm brain' : 'Identity.md', symbol: target === token ? 'Brain' : 'IMD',
      decimals: 18, totalSupply: 1_000_000_000n * UNIT,
      balanceOf: mock.options.lowBalance ? UNIT / 10n : 1_000n * UNIT,
      allowance: mock.tokenAllowances.get(target) || (mock.options.approved ? 1_000n * UNIT : 0n),
      approve: true, transfer: true, transferFrom: true,
    };
    return encode(ABIS.token, name, values[name]);
  }
  if (target === permit2.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: ABIS.permit, data });
    if (decoded.functionName === 'allowance') return encode(ABIS.permit, 'allowance', [mock.permitAllowances.get(decoded.args[1].toLowerCase()) || (mock.options.approved ? 1_000n * UNIT : 0n), Math.floor(Date.now()/1000) + 86_400, 0]);
    return '0x';
  }
  if (target === stateView.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: ABIS.state, data });
    return encode(ABIS.state, decoded.functionName, decoded.functionName === 'getSlot0' ? [2n ** 96n, 0, 0, manifest.poolKey.fee] : 1_000_000n * UNIT);
  }
  if (target === quoter.toLowerCase()) {
    if (mock.quoteFails) throw { code: 3, message: 'execution reverted: Quote unavailable in fixture' };
    const decoded = decodeFunctionData({ abi: ABIS.quote, data });
    return encode(ABIS.quote, 'quoteExactInputSingle', [decoded.args[0].exactAmount * 2n, 150_000n]);
  }
  if (target === universalRouter.toLowerCase()) {
    if (mock.simulationFails) throw { code: 3, message: 'execution reverted: Slippage exceeded in fixture' };
    return '0x';
  }
  throw { code: -32602, message: `Unhandled fixture contract ${target}` };
}
async function pageFor(options = {}) {
  const mock = fixture(options);
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const localErrors = [];
  page.on('pageerror', error => localErrors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) localErrors.push(`Static resource ${response.status()}: ${response.url()}`); });
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('net::ERR')) localErrors.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.url().startsWith(origin)) {
      if (options.corruptAbi && request.url().endsWith('/abi/LaunchToken.json')) { await route.fulfill({ contentType: 'application/json', body: '[]' }); return; }
      await route.continue(); return;
    }
    seenExternal.add(request.url());
    if (!manifest.network.rpcUrls.some(endpoint => request.url().startsWith(endpoint))) { localErrors.push(`Unexpected external request blocked: ${request.url()}`); await route.abort(); return; }
    try {
      const data = request.postDataJSON();
      const calls = Array.isArray(data) ? data : [data];
      if (options.quoteDelayMs && calls.some(call => call.method === 'eth_call' && call.params?.[0]?.to?.toLowerCase() === quoter.toLowerCase())) await new Promise(resolve => setTimeout(resolve, options.quoteDelayMs));
      const respond = call => { try { return { jsonrpc: '2.0', id: call.id, result: rpcCall(mock, call) }; } catch (error) { return { jsonrpc: '2.0', id: call.id, error }; } };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(data) ? data.map(respond) : respond(data)) });
    } catch (error) { localErrors.push(`RPC fixture: ${error.message}`); await route.abort(); }
  });
  if (options.wallet !== false) {
    await page.exposeFunction('__fixtureSend', transaction => {
      mock.writes.push(transaction);
      const destination = transaction.to.toLowerCase();
      if ([token, pair].includes(destination)) {
        const decoded = decodeFunctionData({ abi: ABIS.token, data: transaction.data });
        if (decoded.functionName === 'approve') mock.tokenAllowances.set(destination, decoded.args[1]);
      }
      if (destination === permit2.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ABIS.permit, data: transaction.data });
        mock.permitAllowances.set(decoded.args[0].toLowerCase(), decoded.args[2]);
      }
      const hash = `0x${mock.writes.length.toString(16).padStart(64, '0')}`;
      mock.receipts.set(hash, {
        transactionHash: hash, transactionIndex: '0x0', blockHash: BLOCK_HASH, blockNumber: '0x1900000',
        from: ACCOUNT, to: transaction.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null,
        logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2',
      });
      return hash;
    });
    await page.addInitScript(({ account, options }) => {
      const listeners = {};
      const wallet = {
        chainId: options.wrongChain ? '0xaa36a7' : '0x1', requests: [], connected: false, unknownChain: Boolean(options.unknownChain), rejectSend: false,
        on(name, callback) { (listeners[name] ||= []).push(callback); },
        removeListener(name, callback) { listeners[name] = (listeners[name] || []).filter(listener => listener !== callback); },
        emit(name, value) { (listeners[name] || []).forEach(listener => listener(value)); },
        async request({ method, params }) {
          this.requests.push({ method, params });
          if (method === 'eth_requestAccounts') { if (options.rejectConnect) throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); this.connected = true; return [account]; }
          if (method === 'eth_accounts') return this.connected ? [account] : [];
          if (method === 'eth_chainId') return this.chainId;
          if (method === 'wallet_switchEthereumChain') {
            if (this.unknownChain) throw Object.assign(new Error('Unrecognized chain.'), { code: 4902 });
            this.chainId = params[0].chainId; this.emit('chainChanged', this.chainId); return null;
          }
          if (method === 'wallet_addEthereumChain') { this.unknownChain = false; return null; }
          if (method === 'eth_sendTransaction') { if (this.rejectSend) throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); return window.__fixtureSend(params[0]); }
          if (method === 'eth_estimateGas') return '0x30d40';
          if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
          throw new Error(`Unhandled fixture wallet method ${method}`);
        },
      };
      window.ethereum = wallet; window.__fixtureWallet = wallet;
    }, { account: ACCOUNT, options });
  }
  await page.goto(url);
  if (!options.corruptAbi) await page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
  return { page, mock, context, localErrors };
}
async function check(name, body) {
  const started = Date.now();
  try { await body(); results.push({ name, status: 'passed', durationMs: Date.now()-started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', durationMs: Date.now()-started, error: error.message }); errors.push(error); console.error(`FAIL ${name}: ${error.message}`); }
}
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: /Disconnect/i }).waitFor();
}
async function quote(page, amount = '1') {
  await page.locator('#swap-amount').fill(amount);
  await page.getByRole('button', { name: /^Get quote$|^Quote$/ }).click();
}
async function clean(f) { assert.deepEqual(f.localErrors, [], 'No browser script or console errors'); await f.context.close(); }

try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  browserVersion = await browser.version();
  await mkdir(evidenceDir, { recursive: true });
  // Scenarios are below, kept deliberately against visible production controls.
  await check('Disconnected visitor and missing-wallet recovery', async () => {
    const f = await pageFor({ wallet: false });
    await f.page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Get quote$|^Quote$/ }).count(), 0);
    await f.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await f.page.getByText(/install.*wallet|wallet.*install|no.*wallet|browser wallet/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Rejected wallet connection leaves trading disabled', async () => {
    const f = await pageFor({ rejectConnect: true });
    await f.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await f.page.getByText(/declined|rejected/i).first().waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Get quote$|^Quote$/ }).count(), 0);
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Wrong chain blocks actions; 4902 adds exact configured network then switches', async () => {
    const f = await pageFor({ wrongChain: true, unknownChain: true });
    await connect(f.page);
    await f.page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Get quote$|^Quote$/ }).count(), 0);
    await f.page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).click();
    await f.page.waitForFunction(() => window.__fixtureWallet.requests.filter(request => request.method === 'wallet_switchEthereumChain').length === 2);
    const requests = await f.page.evaluate(() => window.__fixtureWallet.requests);
    assert.deepEqual(requests.find(request => request.method === 'wallet_addEthereumChain').params, [manifest.walletAddChain]);
    assert.deepEqual(requests.filter(request => request.method === 'wallet_switchEthereumChain').map(request => request.params), [[{ chainId: '0x1' }], [{ chainId: '0x1' }]]);
    await quote(f.page);
    await f.page.getByRole('button', { name: /Approve IMD/ }).waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Attested ABI corruption fails closed', async () => {
    const f = await pageFor({ corruptAbi: true });
    await f.page.getByText(/ABI integrity check failed/i).waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Get quote$|^Quote$/ }).count(), 0);
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Missing deployed bytecode blocks trading', async () => {
    const f = await pageFor({ missingCode: true });
    await connect(f.page);
    await f.page.getByText(/No deployed code/i).first().waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Get quote$|^Quote$/ }).count(), 0);
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('ERC20 buy quote, two explicit approvals, simulated swap and receipt', async () => {
    const f = await pageFor();
    await connect(f.page);
    await quote(f.page);
    await f.page.getByRole('button', { name: /Approve IMD/ }).click();
    await f.page.getByRole('button', { name: /Approve IMD for router/i }).click();
    await f.page.getByRole('button', { name: /^Swap/ }).click();
    await f.page.getByText(/Transaction confirmed|Swap confirmed|Confirmed on Ethereum/i).first().waitFor();
    assert.equal(f.mock.writes.length, 3);
    assert.deepEqual(f.mock.writes.map(transaction => transaction.to.toLowerCase()), [pair, permit2.toLowerCase(), universalRouter.toLowerCase()]);
    const tokenApproval = decodeFunctionData({ abi: ABIS.token, data: f.mock.writes[0].data });
    assert.equal(tokenApproval.functionName, 'approve');
    assert.equal(tokenApproval.args[0].toLowerCase(), permit2.toLowerCase());
    assert.equal(tokenApproval.args[1], UNIT);
    const routerApproval = decodeFunctionData({ abi: ABIS.permit, data: f.mock.writes[1].data });
    assert.equal(routerApproval.args[0].toLowerCase(), pair);
    assert.equal(routerApproval.args[1].toLowerCase(), universalRouter.toLowerCase());
    assert.equal(routerApproval.args[2], UNIT);
    const swap = decodeFunctionData({ abi: ABIS.router, data: f.mock.writes[2].data });
    assert.equal(swap.args[0], '0x10');
    assert.ok(!f.mock.writes[2].value || BigInt(f.mock.writes[2].value) === 0n, 'ERC20 purchases must send no ETH');
    const simulations = f.mock.calls.filter(call => call.method === 'eth_call' && call.params[0].to.toLowerCase() === universalRouter.toLowerCase());
    assert.equal(simulations.length, 1, 'Router was simulated before submitting');
    await clean(f);
  });
  await check('Insufficient balance prevents quote or submission', async () => {
    const f = await pageFor({ lowBalance: true });
    await connect(f.page);
    await f.page.locator('#swap-amount').fill('100');
    const button = f.page.getByRole('button', { name: /^Get quote$|^Quote$/ });
    if (!await button.isDisabled()) await button.click();
    await f.page.getByText(/insufficient|exceeds.*balance|not enough/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Sell direction, quote invalidation and slippage validation', async () => {
    const f = await pageFor({ approved: true });
    await connect(f.page);
    await f.page.getByRole('button', { name: 'Sell Brain', exact: true }).click();
    await f.page.locator('#slippage').fill('0.29');
    await quote(f.page, '2');
    await f.page.getByRole('button', { name: /^Swap/ }).waitFor();
    const quoteCall = f.mock.calls.find(call => call.method === 'eth_call' && call.params[0].to.toLowerCase() === quoter.toLowerCase());
    const decoded = decodeFunctionData({ abi: ABIS.quote, data: quoteCall.params[0].data });
    assert.equal(decoded.args[0].zeroForOne, true, 'Brain is currency0 in the attested pool');
    assert.equal(decoded.args[0].exactAmount, 2n * UNIT);
    await f.page.getByText('3.9884 IMD', { exact: true }).waitFor();
    await f.page.locator('#slippage').fill('6');
    assert.equal(await f.page.getByRole('button', { name: /^Swap/ }).count(), 0, 'Changing slippage clears the previous quote');
    const quoteButton = f.page.getByRole('button', { name: /^Get quote$|^Quote$/ });
    if (!await quoteButton.isDisabled()) await quoteButton.click();
    await f.page.getByText(/0.01%.*5%|between.*5/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Failed quote shows the revert and supports a successful retry', async () => {
    const f = await pageFor();
    await connect(f.page);
    f.mock.quoteFails = true;
    await quote(f.page);
    await f.page.getByText(/Quote unavailable in fixture|reverted/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    f.mock.quoteFails = false;
    await f.page.getByRole('button', { name: 'Get quote', exact: true }).click();
    await f.page.getByRole('button', { name: /Approve IMD for Permit2/ }).waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Router simulation failure is visible and never requests a signature', async () => {
    const f = await pageFor({ approved: true });
    await connect(f.page);
    await quote(f.page);
    f.mock.simulationFails = true;
    await f.page.getByRole('button', { name: /^Swap/ }).click();
    await f.page.getByText(/Slippage exceeded|reverted/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    const requests = await f.page.evaluate(() => window.__fixtureWallet.requests);
    assert.equal(requests.filter(request => request.method === 'eth_sendTransaction').length, 0);
    await clean(f);
  });
  await check('Rejected transaction displays recovery without submitting', async () => {
    const f = await pageFor({ approved: true });
    await connect(f.page);
    await quote(f.page);
    await f.page.evaluate(() => { window.__fixtureWallet.rejectSend = true; });
    await f.page.getByRole('button', { name: /^Swap/ }).click();
    await f.page.getByText(/declined|rejected/i).first().waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Account and chain changes invalidate active quotes', async () => {
    const f = await pageFor({ approved: true });
    await connect(f.page);
    await quote(f.page);
    await f.page.getByRole('button', { name: /^Swap/ }).waitFor();
    await f.page.evaluate(() => { window.__fixtureWallet.chainId = '0xaa36a7'; window.__fixtureWallet.emit('chainChanged', '0xaa36a7'); });
    await f.page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Swap/ }).count(), 0);
    await f.page.evaluate(() => { window.__fixtureWallet.connected = false; window.__fixtureWallet.emit('accountsChanged', []); });
    await f.page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Account change during a delayed quote cannot restore stale trading controls', async () => {
    const f = await pageFor({ approved: true, quoteDelayMs: 500 });
    await connect(f.page);
    const pendingQuoteResponse = f.page.waitForResponse(response => {
      try {
        const request = response.request().postDataJSON();
        return request?.method === 'eth_call' && request.params?.[0]?.to?.toLowerCase() === quoter.toLowerCase();
      } catch { return false; }
    });
    await quote(f.page);
    await f.page.getByRole('button', { name: 'Getting quote…', exact: true }).waitFor();
    await f.page.evaluate(account => window.__fixtureWallet.emit('accountsChanged', [account]), RECIPIENT);
    await pendingQuoteResponse;
    await f.page.getByRole('button', { name: 'Get quote', exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: /^Swap/ }).count(), 0);
    assert.equal(await f.page.getByRole('button', { name: /Approve IMD/ }).count(), 0);
    assert.equal(await f.page.getByLabel('Estimated output', { exact: true }).textContent(), '—');
    assert.equal(f.mock.writes.length, 0);
    await clean(f);
  });
  await check('Token transfer validates address and requires explicit review', async () => {
    const f = await pageFor();
    await connect(f.page);
    await f.page.locator('#tools summary').click();
    await f.page.locator('#tool-to').fill('not-an-address');
    await f.page.locator('#tool-amount').fill('1');
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByText(/valid, nonzero Ethereum address/i).waitFor();
    assert.equal(f.mock.writes.length, 0);
    await f.page.locator('#tool-to').fill(RECIPIENT);
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByRole('button', { name: 'Confirm transfer', exact: true }).waitFor();
    assert.equal(f.mock.writes.length, 0, 'Review does not request a signature');
    await f.page.getByRole('button', { name: 'Confirm transfer', exact: true }).click();
    await f.page.locator('#tools').getByText('Transaction confirmed.', { exact: false }).waitFor();
    const call = decodeFunctionData({ abi: ABIS.token, data: f.mock.writes[0].data });
    assert.equal(call.functionName, 'transfer'); assert.deepEqual(call.args, [RECIPIENT, UNIT]);
    await clean(f);
  });
  await check('Token approval and revoke controls submit the reviewed allowance', async () => {
    const f = await pageFor();
    await connect(f.page);
    await f.page.locator('#tools summary').click();
    await f.page.locator('#tool-action').selectOption('approve');
    await f.page.locator('#tool-to').fill(RECIPIENT);
    await f.page.locator('#tool-amount').fill('2');
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByRole('button', { name: 'Confirm approval', exact: true }).click();
    await f.page.locator('#tools').getByText('Transaction confirmed.', { exact: false }).waitFor();
    await f.page.locator('#tool-amount').fill('3');
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByText(/Revoke the existing allowance with amount 0 first/i).waitFor();
    assert.equal(f.mock.writes.length, 1);
    await f.page.locator('#tool-amount').fill('0');
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByRole('button', { name: 'Confirm approval', exact: true }).click();
    await f.page.locator('#tools').getByText('Transaction confirmed.', { exact: false }).waitFor();
    assert.equal(f.mock.writes.length, 2);
    const calls = f.mock.writes.map(transaction => decodeFunctionData({ abi: ABIS.token, data: transaction.data }));
    assert.deepEqual(calls.map(call => call.functionName), ['approve', 'approve']);
    assert.deepEqual(calls.map(call => call.args[1]), [2n * UNIT, 0n]);
    await clean(f);
  });
  await check('Delegated transfer checks allowance then confirms transferFrom', async () => {
    const f = await pageFor({ approved: true });
    await connect(f.page);
    await f.page.locator('#tools summary').click();
    await f.page.locator('#tool-action').selectOption('transferFrom');
    await f.page.locator('#tool-from').fill(ACCOUNT);
    await f.page.locator('#tool-to').fill(RECIPIENT);
    await f.page.locator('#tool-amount').fill('1');
    await f.page.getByRole('button', { name: 'Review transaction', exact: true }).click();
    await f.page.getByRole('button', { name: 'Confirm delegated transfer', exact: true }).click();
    await f.page.locator('#tools').getByText('Transaction confirmed.', { exact: false }).waitFor();
    const call = decodeFunctionData({ abi: ABIS.token, data: f.mock.writes[0].data });
    assert.equal(call.functionName, 'transferFrom'); assert.deepEqual(call.args, [ACCOUNT, RECIPIENT, UNIT]);
    await clean(f);
  });
  await check('Responsive reflow, keyboard operation, reduced motion and automated accessibility', async () => {
    const f = await pageFor();
    await f.page.keyboard.press('Tab');
    assert.equal(await f.page.evaluate(() => document.activeElement.textContent), 'Skip to content');
    await f.page.keyboard.press('Enter');
    await f.page.keyboard.press('Tab');
    const focus = await f.page.evaluate(() => ({ name: document.activeElement.textContent, outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth }));
    assert.notEqual(focus.outline, 'none'); assert.notEqual(focus.width, '0px');
    await f.page.screenshot({ path: path.join(evidenceDir, 'desktop-keyboard.png'), fullPage: true });
    await connect(f.page);
    await f.page.getByRole('button', { name: 'Get quote', exact: true }).waitFor();
    await f.page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Get quote' && !button.disabled));
    await f.page.locator('#swap-amount').focus();
    const inputOutline = await f.page.locator('#swap-amount').evaluate(input => getComputedStyle(input).outlineStyle);
    assert.notEqual(inputOutline, 'none');
    await f.page.keyboard.type('1');
    await f.page.keyboard.press('Tab');
    assert.equal(await f.page.evaluate(() => document.activeElement.id), 'slippage');
    assert.notEqual(await f.page.locator('#slippage').evaluate(input => getComputedStyle(input).outlineStyle), 'none');
    await f.page.keyboard.press('Tab');
    assert.equal(await f.page.evaluate(() => document.activeElement.textContent), 'Get quote');
    assert.notEqual(await f.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
    await f.page.screenshot({ path: path.join(evidenceDir, 'quote-keyboard.png'), fullPage: true });
    await f.page.keyboard.press('Enter');
    await f.page.getByRole('button', { name: /Approve IMD for Permit2/ }).waitFor();
    await f.page.locator('#tools summary').click();
    await f.page.locator('#contracts summary').click();
    const contrast = await f.page.evaluate(() => {
      const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
      const luminance = color => color.slice(0, 3).map(channel => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return ['h1', '.lede', '.note', '.stat-label', '.primary', '.eyebrow', '.footer', '.tool-aside', '.coin.brain'].map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element);
        let current = element, background, unverified;
        while (current) {
          const parentStyle = getComputedStyle(current), channels = rgb(parentStyle.backgroundColor);
          if (parentStyle.backgroundImage !== 'none' || parentStyle.opacity !== '1') unverified = 'Non-solid background or opacity';
          if (channels.length === 3 || channels[3] === 1) { background = parentStyle.backgroundColor; break; }
          if (channels[3] > 0) unverified = 'Translucent background';
          current = current.parentElement;
        }
        const fore = luminance(rgb(style.color)), back = luminance(rgb(background || 'rgb(255,255,255)'));
        return { selector, foreground: style.color, background, ratio: (Math.max(fore, back) + .05) / (Math.min(fore, back) + .05), unverified };
      });
    });
    await writeFile(path.join(evidenceDir, 'contrast.json'), `${JSON.stringify(contrast, null, 2)}\n`);
    for (const pair of contrast) { assert.equal(pair.unverified, undefined); assert.ok(pair.ratio >= 4.5, `${pair.selector} text contrast ${pair.ratio}`); }
    const audit = [];
    for (const width of [1440, 768, 390, 320]) {
      await f.page.setViewportSize({ width, height: 1000 });
      const dimensions = await f.page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.client + 1, `No horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
      const axe = await new AxeBuilder({ page: f.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      audit.push({ width, violations: axe.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })) })), incompleteRules: axe.incomplete.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })) })) });
      await f.page.screenshot({ path: path.join(evidenceDir, width === 1440 ? 'desktop.png' : width === 390 ? 'mobile.png' : `viewport-${width}.png`), fullPage: true });
    }
    await writeFile(path.join(evidenceDir, 'accessibility.json'), `${JSON.stringify(audit, null, 2)}\n`);
    assert.deepEqual(audit.flatMap(item => item.violations), [], 'No automated WCAG A/AA violations at inspected widths');
    const motion = await f.page.getByRole('button', { name: /Approve IMD for Permit2/ }).evaluate(button => getComputedStyle(button).transitionDuration);
    assert.equal(motion, '0s', 'Reduced-motion preference removes button transitions');
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    await f.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const resized = await f.page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(resized.scroll <= resized.client + 1, '200% text enlargement does not overflow');
    await f.page.screenshot({ path: path.join(evidenceDir, 'text-200-percent.png'), fullPage: true });
    await clean(f);
  });
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await mkdir(evidenceDir, { recursive: true });
  const manifestBytes = await readFile(path.join(exportDir, 'imd-deployment.json'));
  await writeFile(path.join(evidenceDir, 'browser-results.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), servedFrom: '/preview/', browser: `Chromium ${browserVersion} (Playwright)`,
    deploymentManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    total: results.length, passed: results.filter(item => item.status === 'passed').length,
    failed: results.filter(item => item.status === 'failed').length,
    externalEndpointsIntercepted: [...seenExternal], allExternalRequestsIntercepted: true,
    noLiveTransactions: true, fixtures: 'Injected EIP-1193 browser wallet, ABI-encoded public RPC responses, mocked receipts',
    limitations: ['Mocked chain state does not prove a live quote or swap succeeds.', 'No real funds, signatures, or broadcasts were used.', 'Automated axe checks do not replace a screen-reader audit.', '200% text enlargement is not browser-native zoom.', 'No physical mobile device or native-wallet extension tested.'],
    results,
  }, null, 2)}\n`);
}
if (errors.length) process.exitCode = 1;
