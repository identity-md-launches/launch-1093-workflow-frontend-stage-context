import { getAddress, isAddress, keccak256, toHex, type Abi, type Address } from 'viem';

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type TokenInfo = { address: Address; name: string; symbol: string; decimals: number };
export type DeploymentManifest = {
  version: 1; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address; extendedSwapParams?: boolean };
    pairToken: TokenInfo; otherPairTokens?: (TokenInfo & {id: string})[];
  };
  walletAddChain?: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: {name: string;symbol: string;decimals: number}; blockExplorerUrls: string[] };
  assets: {path: string; sha256: string}[];
};
export type RuntimeConfig = { manifest: DeploymentManifest; abi: Abi };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const localPath = (path: string) => /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
export async function loadConfig(): Promise<RuntimeConfig> {
  const base = new URL('./', window.location.href);
  const response = await fetch(new URL('imd-deployment.json', base), {cache: 'no-cache'});
  if (!response.ok) throw new Error('Deployment configuration could not load. Reload this page.');
  const manifest = await response.json() as DeploymentManifest;
  const allowed = ['version','launchId','chainId','sourceCommit','attestationHash','contracts','poolKey','network','walletAddChain','assets'];
  if (Object.keys(manifest).some(key => !allowed.includes(key)) || manifest.version !== 1 || !manifest.network || manifest.chainId !== manifest.network.chainId || !manifest.poolKey || !Array.isArray(manifest.contracts)) throw new Error('Deployment configuration is invalid. Transactions are unavailable.');
  const token = manifest.contracts.find(item => item.name === 'LaunchToken');
  if (!token || !isAddress(token.address) || !localPath(token.abiPath)) throw new Error('Token configuration is missing or invalid.');
  const abiResponse = await fetch(new URL(token.abiPath, base));
  if (!abiResponse.ok) throw new Error('The deployed token ABI could not load. Reload this page.');
  const abi = await abiResponse.json() as Abi;
  if (!Array.isArray(abi) || keccak256(toHex(canonical(abi))).slice(2) !== token.abiHash) throw new Error('Token ABI integrity check failed. Transactions are unavailable.');
  return {manifest, abi};
}
export const shortAddress = (address: string) => `${getAddress(address).slice(0,6)}…${address.slice(-4)}`;
