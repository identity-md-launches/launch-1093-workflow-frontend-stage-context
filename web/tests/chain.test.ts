import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, mock } from 'node:test'
import { decodeAbiParameters, encodeFunctionData, parseAbiParameters, zeroAddress, type EIP1193Provider } from 'viem'
import { approvalRequirements, createEngine, encodeSwap, minimumOutput, readableError, switchNetwork, type SwapQuote } from '../src/chain'
import type { RuntimeConfig } from '../src/config'

const config = {
  manifest: JSON.parse(await readFile(new URL('../deployment-input.json', import.meta.url), 'utf8')),
  abi: JSON.parse(await readFile(new URL('../../docs/abi/LaunchToken.json', import.meta.url), 'utf8')),
} as RuntimeConfig
const key = config.manifest.poolKey
// Test accounts are existing public fixture addresses; no test signer or live RPC is used.
const account = key.currency0
const recipient = key.currency1
const actions = parseAbiParameters('bytes actions,bytes[] params')

test('slippage floors minimum output and rejects invalid or excessive tolerance', () => {
  assert.equal(minimumOutput(1001n, 50), 995n)
  for (const value of [0, -1, 501, 1.5, NaN]) assert.throws(() => minimumOutput(100n, value))
})

test('router encoding preserves handoff pool key, buy direction, and exact settlement currencies', () => {
  const encoded = encodeSwap(key, { zeroForOne: false, amountIn: 100n, minimumOut: 90n })
  assert.equal(encoded.commands, '0x10')
  const [actionBytes, params] = decodeAbiParameters(actions, encoded.inputs[0])
  assert.equal(actionBytes, '0x060c0f')
  const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0])
  assert.equal(swap.poolKey.hooks.toLowerCase(), key.hooks)
  assert.equal(swap.poolKey.fee, 12500)
  assert.equal(swap.poolKey.tickSpacing, key.tickSpacing)
  assert.equal(swap.poolKey.currency0.toLowerCase(), key.currency0)
  assert.equal(swap.poolKey.currency1.toLowerCase(), key.currency1)
  assert.equal(swap.zeroForOne, false)
  assert.equal(swap.amountIn, 100n)
  assert.equal(swap.amountOutMinimum, 90n)
  const settle = decodeAbiParameters(parseAbiParameters('address,uint256'), params[1])
  const take = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2])
  assert.equal(settle[0].toLowerCase(), key.currency1)
  assert.equal(take[0].toLowerCase(), key.currency0)
  assert.equal(settle[1], 100n)
  assert.equal(take[1], 90n)
})

test('extended router uses its six-field tuple with zero intermediate price bound', () => {
  const { inputs } = encodeSwap(key, { zeroForOne: true, amountIn: 42n, minimumOut: 12n }, true)
  const [, params] = decodeAbiParameters(actions, inputs[0])
  const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'), params[0])
  assert.equal(swap.minHopPriceX36, 0n)
  assert.equal(swap.hookData, '0x')
  assert.equal(swap.zeroForOne, true)
  assert.throws(() => encodeSwap(key, { zeroForOne: true, amountIn: 1n << 128n, minimumOut: 12n }))
})

test('approval requirements distinguish token amount, router amount, and expiration', () => {
  assert.deepEqual(approvalRequirements(10n, 9n, 10n, 999, 1), { tokenAllowance: 9n, routerAllowance: 10n, routerExpiration: 999, needsToken: true, needsRouter: false })
  assert.equal(approvalRequirements(10n, 10n, 9n, 999, 1).needsRouter, true)
  assert.equal(approvalRequirements(10n, 10n, 10n, 100, 1).needsRouter, true)
  assert.equal(approvalRequirements(10n, 10n, 10n, 999, 1).needsToken, false)
})

test('unknown chain prompts exact supplied add-chain parameters, then switches again', async () => {
  const requests: unknown[] = []
  let switches = 0
  const provider = { request: async (request: { method: string }) => {
    requests.push(request)
    if (request.method === 'wallet_switchEthereumChain' && switches++ === 0) throw { code: 4902 }
    return null
  } } as unknown as EIP1193Provider
  await switchNetwork(config, provider)
  assert.deepEqual(requests, [
    { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] },
    { method: 'wallet_addEthereumChain', params: [config.manifest.walletAddChain] },
    { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] },
  ])
})

test('wallet rejection never falls through to add-chain', async () => {
  let calls = 0
  const provider = { request: async () => { calls++; throw { code: 4001, message: 'User rejected' } } } as unknown as EIP1193Provider
  await assert.rejects(switchNetwork(config, provider))
  assert.equal(calls, 1)
  assert.match(readableError({ code: 4001 }), /declined/)
})

test('nested wallet and ERC-20 errors explain a concrete recovery action', () => {
  assert.match(readableError({ shortMessage: 'RPC request failed', cause: { data: { originalError: { code: 4001 } } } }), /declined in your wallet/)
  const mappings = [
    ['ERC20InsufficientBalance', /Lower the amount or fund/],
    ['ERC20InsufficientAllowance', /Approve the required amount/],
    ['ERC20InvalidReceiver', /Check the recipient/],
    ['ERC20InvalidSender', /Check the source account/],
    ['ERC20InvalidSpender', /Check the spender address/],
    ['ERC20InvalidApprover', /Reconnect the correct account/],
  ] as const
  for (const [errorName, expected] of mappings) {
    assert.match(readableError({ shortMessage: 'Contract failed', cause: { data: { errorName } } }), expected)
  }
  assert.match(readableError({ cause: { message: 'insufficient funds for gas * price + value' } }), /Add funds to your wallet/)
  assert.match(readableError({ data: { originalError: { code: -32002 } } }), /Finish or cancel/)
})

test('specific revert reasons survive generic RPC wrappers', () => {
  assert.match(readableError({ shortMessage: 'An unknown RPC error occurred', cause: { reason: 'Pool is paused' } }), /Contract reverted: Pool is paused.*Refresh state/)
  assert.match(readableError({ shortMessage: 'RPC request failed', cause: { message: 'execution reverted: Pool is paused' } }), /Contract reverted: Pool is paused/)
  assert.match(readableError({ cause: { data: { errorName: 'HookNotInitialized' } } }), /HookNotInitialized/)
  assert.match(readableError({ cause: { data: { errorName: 'Error', args: ['Pool is paused'] } } }), /Pool is paused/)
})

function stubEngine(options: { chain?: number; accountChanges?: boolean; simulationFails?: boolean } = {}) {
  const sent: unknown[] = []
  let accountChecks = 0
  const provider = { request: async ({ method, params }: { method: string; params: unknown }) => {
    if (method === 'eth_chainId') return `0x${(options.chain ?? 1).toString(16)}`
    if (method === 'eth_accounts') return [options.accountChanges && accountChecks++ > 0 ? recipient : account]
    if (method === 'eth_sendTransaction') { sent.push(params); return `0x${'a'.repeat(64)}` }
    throw new Error(`Unexpected wallet request: ${method}`)
  } } as unknown as EIP1193Provider
  const engine = createEngine(config, provider)
  mock.method(engine.client, 'getChainId', async () => 1)
  mock.method(engine.client, 'getCode', async () => '0x6000')
  mock.method(engine.client, 'simulateContract', async (request: Record<string, unknown>) => {
    if (options.simulationFails) throw new Error('ERC20InsufficientBalance')
    return { request, result: true }
  })
  mock.method(engine.client, 'waitForTransactionReceipt', async () => ({ status: 'success' }))
  return { engine, sent }
}

test('token transfer simulates the loaded ABI, signs, and waits for confirmation', async () => {
  const { engine, sent } = stubEngine()
  const stages: string[] = []
  await engine.writeToken(account, 'transfer', [recipient, 17n], (status) => stages.push(status.stage))
  assert.deepEqual(stages, ['simulating', 'signature', 'pending', 'confirmed'])
  assert.equal(sent.length, 1)
  const tx = (sent[0] as [{ data: string; to: string }])[0]
  assert.equal(tx.to.toLowerCase(), account)
  assert.equal(tx.data, encodeFunctionData({ abi: config.abi, functionName: 'transfer', args: [recipient, 17n] }))
})

test('wrong chain, simulation revert, and account change all block signing', async () => {
  for (const options of [{ chain: 2 }, { simulationFails: true }, { accountChanges: true }]) {
    const { engine, sent } = stubEngine(options)
    await assert.rejects(engine.writeToken(account, 'transfer', [recipient, 17n]))
    assert.equal(sent.length, 0)
  }
})

test('missing deployed code blocks signing', async () => {
  const { engine, sent } = stubEngine()
  mock.method(engine.client, 'getCode', async () => undefined)
  await assert.rejects(engine.writeToken(account, 'approve', [recipient, 0n]), /No deployed code/)
  assert.equal(sent.length, 0)
})

test('native input skips both token approval reads', async () => {
  const nativeConfig = structuredClone(config)
  nativeConfig.manifest.poolKey = { ...key, currency0: zeroAddress, currency1: account }
  const engine = createEngine(nativeConfig)
  mock.method(engine.client, 'readContract', () => { throw new Error('Native currency must not request an allowance') })
  const state = await engine.approvals(account, 'buy', 1n)
  assert.equal(state.needsToken, false)
  assert.equal(state.needsRouter, false)
})

test('expired quotes and changed accounts block swaps before any RPC or signature', async () => {
  const { engine, sent } = stubEngine()
  const quote = { account, quotedAt: Date.now() - 61_000 } as SwapQuote
  await assert.rejects(engine.swap(account, quote), /expired/)
  await assert.rejects(engine.swap(recipient, { ...quote, quotedAt: Date.now() }), /account changed/)
  assert.equal(sent.length, 0)
})

test('quote is an eth_call simulation with the exact pool, and ERC-20 swap sends no native value', async () => {
  const { engine, sent } = stubEngine()
  const simulations: Record<string, any>[] = []
  mock.method(engine.client, 'simulateContract', async (request: Record<string, any>) => {
    simulations.push(request)
    return { request, result: request.functionName === 'quoteExactInputSingle' ? [100n, 42n] : true }
  })
  mock.method(engine.client, 'readContract', async (request: Record<string, any>) =>
    request.address.toLowerCase() === config.manifest.network.uniswapV4.permit2.toLowerCase()
      ? [200n, Math.floor(Date.now() / 1000) + 3600, 0] : 200n,
  )
  const quote = await engine.quote('buy', 50n, 50, account)
  assert.equal(sent.length, 0)
  assert.equal(quote.minimumOut, 99n)
  assert.deepEqual(simulations[0].args[0].poolKey, key)
  assert.equal(simulations[0].args[0].zeroForOne, false)
  assert.equal(simulations[0].address, config.manifest.network.uniswapV4.quoter)
  await engine.swap(account, quote)
  const execute = simulations.at(-1)!
  assert.equal(execute.functionName, 'execute')
  assert.equal(execute.address, config.manifest.network.uniswapV4.universalRouter)
  assert.equal(execute.value, 0n)
  assert.equal(execute.args[0], '0x10')
  assert.equal(sent.length, 1)
})

test('each ERC-20 approval uses configured recipients and skips itself once sufficient', async () => {
  const { engine, sent } = stubEngine()
  let tokenAllowance = 0n
  let routerAllowance = 0n
  const simulations: Record<string, any>[] = []
  mock.method(engine.client, 'readContract', async (request: Record<string, any>) =>
    request.address.toLowerCase() === config.manifest.network.uniswapV4.permit2.toLowerCase()
      ? [routerAllowance, Math.floor(Date.now() / 1000) + 3600, 0] : tokenAllowance,
  )
  mock.method(engine.client, 'simulateContract', async (request: Record<string, any>) => {
    simulations.push(request)
    return { request, result: true }
  })
  await assert.rejects(engine.approveRouter(account, 'buy', 20n), /Permit2 first/)
  await engine.approveToken(account, 'buy', 20n)
  assert.equal(simulations[0].address.toLowerCase(), recipient)
  assert.deepEqual(simulations[0].args, [config.manifest.network.uniswapV4.permit2, 20n])
  tokenAllowance = 20n
  await engine.approveToken(account, 'buy', 20n)
  assert.equal(sent.length, 1)
  const beforeRouterApproval = Math.floor(Date.now() / 1000)
  await engine.approveRouter(account, 'buy', 20n)
  assert.equal(simulations[1].address, config.manifest.network.uniswapV4.permit2)
  assert.equal(simulations[1].args[0].toLowerCase(), recipient)
  assert.equal(simulations[1].args[1], config.manifest.network.uniswapV4.universalRouter)
  assert.equal(simulations[1].args[2], 20n)
  assert.ok(simulations[1].args[3] >= beforeRouterApproval + 1800)
  assert.ok(simulations[1].args[3] <= Math.floor(Date.now() / 1000) + 1800)
  routerAllowance = 20n
  await engine.approveRouter(account, 'buy', 20n)
  assert.equal(sent.length, 2)
})

test('quote expiration during simulation blocks the wallet signature', async (context) => {
  let time = Date.now()
  context.mock.method(Date, 'now', () => time)
  const { engine, sent } = stubEngine()
  mock.method(engine.client, 'readContract', async (request: Record<string, any>) =>
    request.address.toLowerCase() === config.manifest.network.uniswapV4.permit2.toLowerCase()
      ? [200n, Math.floor(time / 1000) + 3600, 0] : 200n,
  )
  mock.method(engine.client, 'simulateContract', async (request: Record<string, unknown>) => {
    time += 61_000
    return { request, result: true }
  })
  const quote: SwapQuote = {
    direction: 'buy', account, quotedAt: time, amountIn: 50n, amountOut: 100n,
    minimumOut: 99n, slippageBps: 50, input: engine.pair, output: engine.token, zeroForOne: false,
  }
  const stages: string[] = []
  await assert.rejects(engine.swap(account, quote, (status) => stages.push(status.stage)), /quote has expired/)
  assert.deepEqual(stages, ['simulating'])
  assert.equal(sent.length, 0)
})
