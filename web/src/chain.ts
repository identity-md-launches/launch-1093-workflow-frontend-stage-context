import {
  createPublicClient, createWalletClient, custom, defineChain,
  encodeAbiParameters, erc20Abi, fallback, getAddress, http, keccak256,
  parseAbi, parseAbiParameters, zeroAddress,
  type Abi, type Address, type EIP1193Provider, type Hash, type Hex, type Transport,
} from 'viem'
import type { PoolKey, RuntimeConfig } from './config'

export type { EIP1193Provider } from 'viem'
export type Direction = 'buy' | 'sell'
export type TokenAction = 'transfer' | 'approve' | 'transferFrom'
export type TransactionStatus = {
  stage: 'simulating' | 'signature' | 'pending' | 'confirmed'
  hash?: Hash
}
export type StatusHandler = (status: TransactionStatus) => void
export type Currency = { address: Address; symbol: string; name: string; decimals: number }
export type SwapQuote = {
  direction: Direction
  amountIn: bigint
  amountOut: bigint
  minimumOut: bigint
  slippageBps: number
  quotedAt: number
  input: Currency
  output: Currency
  zeroForOne: boolean
  account: Address
}
export type ApprovalState = {
  tokenAllowance: bigint
  routerAllowance: bigint
  routerExpiration: number
  needsToken: boolean
  needsRouter: boolean
}
export type Snapshot = {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  tokenBalance?: bigint
  pairBalance?: bigint
  nativeBalance?: bigint
  blockNumber: bigint
  sqrtPriceX96?: bigint
  tick?: number
  liquidity?: bigint
  poolError?: string
}

const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
])
const routerAbi = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'])
const permit2Abi = parseAbi([
  'function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
])
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
])
const poolParameters = parseAbiParameters('(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)')
const ordinarySwapParameters = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)')
const extendedSwapParameters = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)')
const currencyAmountParameters = parseAbiParameters('address currency,uint256 amount')
const actionsParameters = parseAbiParameters('bytes actions,bytes[] params')
const MAX_UINT128 = (1n << 128n) - 1n
const QUOTE_LIFETIME_MS = 60_000

function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase() }

export function minimumOutput(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
    throw new Error('Set slippage between 0.01% and 5%.')
  }
  return amountOut * BigInt(10_000 - slippageBps) / 10_000n
}

export function poolId(key: PoolKey): Hash {
  return keccak256(encodeAbiParameters(poolParameters, [key]))
}

/** Exact-input Universal Router encoding; all currencies and hooks come from the attested pool key. */
export function encodeSwap(key: PoolKey, quote: Pick<SwapQuote, 'amountIn' | 'minimumOut' | 'zeroForOne'>, extended = false): { commands: Hex; inputs: Hex[] } {
  if (quote.amountIn <= 0n || quote.amountIn > MAX_UINT128 || quote.minimumOut < 1n || quote.minimumOut > MAX_UINT128) {
    throw new Error('The input and minimum output must fit the pool’s supported amount range.')
  }
  const base = { poolKey: key, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut, hookData: '0x' as Hex }
  const swap = extended
    ? encodeAbiParameters(extendedSwapParameters, [{ ...base, minHopPriceX36: 0n }])
    : encodeAbiParameters(ordinarySwapParameters, [base])
  const input = quote.zeroForOne ? key.currency0 : key.currency1
  const output = quote.zeroForOne ? key.currency1 : key.currency0
  const settle = encodeAbiParameters(currencyAmountParameters, [input, quote.amountIn])
  const take = encodeAbiParameters(currencyAmountParameters, [output, quote.minimumOut])
  return { commands: '0x10', inputs: [encodeAbiParameters(actionsParameters, ['0x060c0f', [swap, settle, take]])] }
}

export function approvalRequirements(amountIn: bigint, tokenAllowance: bigint, routerAllowance: bigint, routerExpiration: number, now = Math.floor(Date.now() / 1000)): ApprovalState {
  return {
    tokenAllowance, routerAllowance, routerExpiration,
    needsToken: tokenAllowance < amountIn,
    needsRouter: routerAllowance < amountIn || routerExpiration <= now + 120,
  }
}

export function readableError(error: unknown): string {
  const details: Record<string, unknown>[] = []
  const seen = new Set<unknown>()
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const source = value as Record<string, unknown>
    details.push(source)
    visit(source.cause); visit(source.data); visit(source.originalError); visit(source.error)
  }
  visit(error)
  const text = details.flatMap((source) => [source.errorName, source.reason, source.shortMessage, source.message, source.details]).filter((value): value is string => typeof value === 'string').join('\n')
  if (details.some((source) => Number(source.code) === 4001) || /user rejected|user denied/i.test(text)) return 'Request declined in your wallet. Nothing was submitted.'
  const tokenErrors: [string, string][] = [
    ['ERC20InsufficientBalance', 'Not enough tokens in the sending account. Lower the amount or fund that account, then try again.'],
    ['ERC20InsufficientAllowance', 'The token allowance is too low. Approve the required amount, then try again.'],
    ['ERC20InvalidSender', 'The sending address is invalid. Check the source account and try again.'],
    ['ERC20InvalidReceiver', 'The recipient address is invalid. Check the recipient and try again.'],
    ['ERC20InvalidApprover', 'The approval owner is invalid. Reconnect the correct account and try again.'],
    ['ERC20InvalidSpender', 'The approval spender is invalid. Check the spender address and try again.'],
  ]
  for (const [name, message] of tokenErrors) if (text.includes(name)) return message
  if (/insufficient funds|insufficient.*(?:gas|fee)|funds for gas/i.test(text)) return 'Not enough native currency for the transaction and network fees. Add funds to your wallet and try again.'
  if (details.some((source) => Number(source.code) === -32002)) return 'A wallet request is already open. Finish or cancel it in your wallet before trying again.'
  const inner = [...details].reverse()
  const reason = inner.map((source) => source.reason).find((value): value is string => typeof value === 'string' && value.length > 0)
  const customError = inner.map((source) => source.errorName).find((value): value is string => typeof value === 'string' && value !== 'Error')
  const stringError = inner.find((source) => source.errorName === 'Error' && Array.isArray(source.args) && typeof source.args[0] === 'string')?.args as [string] | undefined
  const rpcRevert = inner.flatMap((source) => [source.shortMessage, source.message, source.details])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.match(/(?:execution reverted|reverted with (?:the following )?reason)\s*:\s*([^\n]+)/i)?.[1])
    .find(Boolean)
  const revert = reason ?? stringError?.[0] ?? customError ?? rpcRevert
  if (revert) return `Contract reverted: ${revert.slice(0, 240)}. Refresh state, review the amount and permissions, then try again.`
  const message = details.map((source) => source.shortMessage).find((value): value is string => typeof value === 'string' && value.length > 0)
    ?? inner.map((source) => source.message).find((value): value is string => typeof value === 'string' && value.length > 0)
  if (message) return message.length > 450 ? message.slice(0, 450) + '…' : message
  return 'The request could not be completed. Refresh state and try again.'
}

export async function connectWallet(provider: EIP1193Provider): Promise<{ account: Address; chainId: number }> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts[0]) throw new Error('The wallet did not return an account.')
  const chainId = Number(await provider.request({ method: 'eth_chainId' }))
  return { account: getAddress(accounts[0]), chainId }
}

function unknownChain(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: number; message?: string; cause?: unknown; data?: { originalError?: unknown } }
  return e.code === 4902 || /unknown chain|unrecognized chain|chain.*not.*added|chain.*not.*configured/i.test(e.message ?? '') || unknownChain(e.cause) || unknownChain(e.data?.originalError)
}

export async function switchNetwork(config: RuntimeConfig, provider: EIP1193Provider): Promise<void> {
  const chainId = `0x${config.manifest.chainId.toString(16)}` as Hex
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (error) {
    if (!unknownChain(error) || !config.manifest.walletAddChain) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [config.manifest.walletAddChain] })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  }
}

export function createEngine(config: RuntimeConfig, provider?: EIP1193Provider) {
  const { manifest, abi } = config
  const network = manifest.network
  const tokenContract = manifest.contracts.find((contract) => contract.name === 'LaunchToken')
  if (!tokenContract) throw new Error('The verified manifest does not contain LaunchToken.')
  const tokenAddress = getAddress(tokenContract.address)
  const key = manifest.poolKey
  if (!key || !network?.uniswapV4) throw new Error('Trading is unavailable because this deployment has no verified pool or network configuration.')
  if (!sameAddress(key.currency0, tokenAddress) && !sameAddress(key.currency1, tokenAddress)) throw new Error('The pool does not contain the deployed token.')
  const pairAddress = sameAddress(key.currency0, tokenAddress) ? key.currency1 : key.currency0
  const pairConfig = [network.pairToken, ...(network.otherPairTokens ?? [])].find((currency) => currency && sameAddress(currency.address, pairAddress))
  const pair: Currency = sameAddress(pairAddress, zeroAddress)
    ? { address: zeroAddress, ...network.nativeCurrency }
    : pairConfig ? { ...pairConfig, address: getAddress(pairConfig.address) } : (() => { throw new Error('The paired token is not in the verified network configuration.') })()
  const token: Currency = { address: tokenAddress, name: 'Swarm brain', symbol: 'Brain', decimals: 18 }
  const chain = defineChain({
    id: manifest.chainId, name: network.name, nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: `${network.name} explorer`, url: network.explorer } },
  })
  const transports: Transport[] = network.rpcUrls.map((url) => http(url, { timeout: 12_000, retryCount: 1, batch: false }))
  if (provider) {
    // A wallet on another chain must never become a read fallback for this deployment.
    const guardedProvider = {
      request: async (args: Parameters<EIP1193Provider['request']>[0]) => {
        if (Number(await provider.request({ method: 'eth_chainId' })) !== manifest.chainId) throw new Error(`Switch your wallet to ${network.name}.`)
        return provider.request(args)
      },
    } as EIP1193Provider
    transports.push(custom(guardedProvider, { retryCount: 0 }))
  }
  const client = createPublicClient({ chain, transport: fallback(transports, { rank: false, retryCount: 0 }) })
  const id = poolId(key)
  const protocols = network.uniswapV4
  const currencies = (direction: Direction) => direction === 'buy' ? { input: pair, output: token } : { input: token, output: pair }

  async function verify(): Promise<void> {
    const rpcChain = await client.getChainId()
    if (rpcChain !== manifest.chainId) throw new Error(`The RPC returned chain ${rpcChain}; expected ${manifest.chainId}. Transactions are disabled.`)
    for (const contract of manifest.contracts) {
      const code = await client.getCode({ address: contract.address })
      if (!code || code === '0x') throw new Error(`No deployed code was found for ${contract.name}. Transactions are disabled.`)
    }
  }

  async function checkWallet(account: Address) {
    if (!provider) throw new Error('Connect a browser wallet to continue.')
    const [walletChain, accounts] = await Promise.all([
      provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
    ])
    if (Number(walletChain) !== manifest.chainId) throw new Error(`Switch your wallet to ${network.name} before continuing.`)
    if (!accounts[0] || !sameAddress(accounts[0], account)) throw new Error('Your wallet account changed. Reconnect and try again.')
  }

  async function ensureWallet(account: Address) {
    await checkWallet(account)
    await verify()
    return createWalletClient({ account, chain, transport: custom(provider!) })
  }

  async function verifyTrading(): Promise<void> {
    for (const [name, address] of Object.entries(protocols)) {
      if (typeof address !== 'string' || !address.startsWith('0x')) continue
      const code = await client.getCode({ address: address as Address })
      if (!code || code === '0x') throw new Error(`No deployed code was found for ${name}. Trading is disabled.`)
    }
    if (!sameAddress(key.hooks, zeroAddress)) {
      const code = await client.getCode({ address: key.hooks })
      if (!code || code === '0x') throw new Error('The pool hook is unavailable. Trading is disabled.')
    }
  }

  async function transact(account: Address, request: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; value?: bigint }, onStatus: StatusHandler = () => {}, beforeSignature?: () => void) {
    onStatus({ stage: 'simulating' })
    const wallet = await ensureWallet(account)
    const simulated = await client.simulateContract({ ...request, account })
    await checkWallet(account)
    beforeSignature?.()
    onStatus({ stage: 'signature' })
    const hash = await wallet.writeContract(simulated.request)
    onStatus({ stage: 'pending', hash })
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
    if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted. Check the explorer for details.`)
    onStatus({ stage: 'confirmed', hash })
    return hash
  }

  async function snapshot(account?: Address): Promise<Snapshot> {
    await verify()
    const [name, symbol, decimals, totalSupply, blockNumber] = await Promise.all([
      client.readContract({ address: tokenAddress, abi, functionName: 'name' }) as Promise<string>,
      client.readContract({ address: tokenAddress, abi, functionName: 'symbol' }) as Promise<string>,
      client.readContract({ address: tokenAddress, abi, functionName: 'decimals' }) as Promise<number>,
      client.readContract({ address: tokenAddress, abi, functionName: 'totalSupply' }) as Promise<bigint>,
      client.getBlockNumber(),
    ])
    token.name = name; token.symbol = symbol; token.decimals = decimals
    const state: Snapshot = { name, symbol, decimals, totalSupply, blockNumber }
    if (account) {
      const [tokenBalance, pairBalance, nativeBalance] = await Promise.all([
        client.readContract({ address: tokenAddress, abi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
        sameAddress(pair.address, zeroAddress) ? client.getBalance({ address: account }) : client.readContract({ address: pair.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
        client.getBalance({ address: account }),
      ])
      Object.assign(state, { tokenBalance, pairBalance, nativeBalance })
    }
    try {
      const [slot, liquidity] = await Promise.all([
        client.readContract({ address: protocols.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [id] }),
        client.readContract({ address: protocols.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [id] }),
      ])
      Object.assign(state, { sqrtPriceX96: slot[0], tick: slot[1], liquidity })
      if (slot[0] === 0n || liquidity === 0n) state.poolError = 'This pool has no active liquidity. Quotes and swaps may be unavailable.'
    } catch (error) { state.poolError = readableError(error) }
    return state
  }

  async function quote(direction: Direction, amountIn: bigint, slippageBps: number, account: Address): Promise<SwapQuote> {
    if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error('Enter a positive amount within the supported range.')
    minimumOutput(1n, slippageBps)
    await verify()
    await verifyTrading()
    const { input, output } = currencies(direction)
    const zeroForOne = sameAddress(input.address, key.currency0)
    const { result } = await client.simulateContract({
      address: protocols.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle',
      args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }], account,
    })
    if (result[0] <= 0n) throw new Error('The pool returned no output. Try another amount or wait for liquidity.')
    const minimumOut = minimumOutput(result[0], slippageBps)
    if (minimumOut < 1n) throw new Error('This amount is too small to swap safely.')
    return { direction, amountIn, amountOut: result[0], minimumOut, slippageBps, quotedAt: Date.now(), input: { ...input }, output: { ...output }, zeroForOne, account }
  }

  async function approvals(account: Address, direction: Direction, amountIn: bigint): Promise<ApprovalState> {
    const { input } = currencies(direction)
    if (sameAddress(input.address, zeroAddress)) return { tokenAllowance: 0n, routerAllowance: 0n, routerExpiration: 0, needsToken: false, needsRouter: false }
    const inputAbi = sameAddress(input.address, tokenAddress) ? abi : erc20Abi
    const [tokenAllowance, routerAllowance] = await Promise.all([
      client.readContract({ address: input.address, abi: inputAbi, functionName: 'allowance', args: [account, protocols.permit2] }) as Promise<bigint>,
      client.readContract({ address: protocols.permit2, abi: permit2Abi, functionName: 'allowance', args: [account, input.address, protocols.universalRouter] }),
    ])
    return approvalRequirements(amountIn, tokenAllowance, routerAllowance[0], routerAllowance[1])
  }

  async function approveToken(account: Address, direction: Direction, amountIn: bigint, onStatus?: StatusHandler): Promise<Hash | undefined> {
    const { input } = currencies(direction)
    const current = await approvals(account, direction, amountIn)
    if (!current.needsToken) return
    await verifyTrading()
    return transact(account, { address: input.address, abi: sameAddress(input.address, tokenAddress) ? abi : erc20Abi, functionName: 'approve', args: [protocols.permit2, amountIn] }, onStatus)
  }

  async function approveRouter(account: Address, direction: Direction, amountIn: bigint, onStatus?: StatusHandler): Promise<Hash | undefined> {
    const { input } = currencies(direction)
    const current = await approvals(account, direction, amountIn)
    if (!current.needsRouter) return
    if (current.needsToken) throw new Error(`Approve ${input.symbol} for Permit2 first.`)
    await verifyTrading()
    const expiration = Math.floor(Date.now() / 1000) + 1800
    return transact(account, { address: protocols.permit2, abi: permit2Abi, functionName: 'approve', args: [input.address, protocols.universalRouter, amountIn, expiration] }, onStatus)
  }

  async function swap(account: Address, quoted: SwapQuote, onStatus?: StatusHandler): Promise<Hash> {
    if (!sameAddress(account, quoted.account)) throw new Error('Your account changed. Request a fresh quote.')
    const requireFreshQuote = () => {
      if (Date.now() - quoted.quotedAt > QUOTE_LIFETIME_MS) throw new Error('This quote has expired. Request a fresh quote before swapping.')
    }
    requireFreshQuote()
    const { input, output } = currencies(quoted.direction)
    if (!sameAddress(quoted.input.address, input.address) || !sameAddress(quoted.output.address, output.address) || quoted.zeroForOne !== sameAddress(input.address, key.currency0)) throw new Error('The quote does not match this pool. Request a fresh quote.')
    const current = await approvals(account, quoted.direction, quoted.amountIn)
    if (current.needsToken || current.needsRouter) throw new Error('Complete the required token approvals first.')
    await verifyTrading()
    const encoded = encodeSwap(key, quoted, protocols.extendedSwapParams === true)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)
    return transact(account, {
      address: protocols.universalRouter, abi: routerAbi, functionName: 'execute', args: [encoded.commands, encoded.inputs, deadline],
      value: sameAddress(input.address, zeroAddress) ? quoted.amountIn : 0n,
    }, onStatus, requireFreshQuote)
  }

  async function writeToken(account: Address, action: TokenAction, args: readonly unknown[], onStatus?: StatusHandler): Promise<Hash> {
    return transact(account, { address: tokenAddress, abi, functionName: action, args }, onStatus)
  }

  async function allowance(owner: Address, spender: Address): Promise<bigint> {
    return client.readContract({ address: tokenAddress, abi, functionName: 'allowance', args: [owner, spender] }) as Promise<bigint>
  }

  return { client, token, pair, poolId: id, verify, snapshot, quote, approvals, approveToken, approveRouter, swap, writeToken, allowance }
}

export type ChainEngine = ReturnType<typeof createEngine>
