# Swarm brain frontend

Vite, React and TypeScript frontend for the deployed Brain ERC-20 and its Uniswap v4 Brain/IMD pool. The committed `../dist/` directory is the complete static site. It can be hosted under a gateway subpath without server rewrites. No backend, private key, WalletConnect project ID or private RPC service is required.

## Install, build and preview

Use Node.js 22.12+ (worker used 24.21.0), npm, and a Git checkout containing deployed commit `a5cf6337f3d3aa217dcbaaf4337d03b7a583db46`.

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --port 4173
```

Open the preview URL printed by Vite. For source development, run `npm run build` once, then `npm run dev`. Development middleware serves the generated manifest and ABIs from `../dist/`; browser code always loads the same runtime deployment configuration. Rebuild to refresh the committed production export.

The build checks TypeScript, exports with relative base `./`, copies the exact implementation-derived ABI from the pinned Git commit, generates `dist/imd-deployment.json`, and verifies its configuration and complete asset inventory. Never modify exported assets without regenerating the manifest. `npm run verify` repeats the independent file/configuration checks. A source archive without the pinned Git history cannot perform ABI provenance verification.

## Configuration

`dist/imd-deployment.json` is the **only runtime deployment configuration**. `src/config.ts` loads it relative to the current page, loads its ABI path, and verifies canonical Keccak ABI integrity. `src/chain.ts` obtains every deployment address, network ID, protocol address, public RPC and pool parameter from that loaded manifest.

`deployment-input.json` preserves the handoff for builds after temporary `.imd/reads/` files are removed. It is not imported by browser code. The exporter compares it to the original handoff when available. It preserves the effective pool fee `12500` (1.25%), sorted currencies, tick spacing `60`, and exact nonzero hook; the nested handoff's older pool fee is not used.

RPC reads use the supplied public endpoints, with a connected wallet as a guarded fallback only on the correct chain. HTTP batching is disabled because one supplied endpoint limits batches. Visible reads poll every 5 seconds while connected and 15 seconds otherwise, with no overlapping polls and no background-tab polling. The UI marks failed reads and disables writes until verification recovers. Verification checks RPC chain ID and nonempty deployed code; it does not prove bytecode identity or independently audit contracts.

## Wallet and actions

Supported browser wallets expose the EIP-1193 `window.ethereum` provider. Mobile users can open the site in a compatible wallet browser. There is no external connection service. WalletConnect and ENS resolution are not implemented; addresses are checksummed, fully visible in details, copyable, and linked to the supplied explorer. No project ID was supplied, so no invented ID appears in the build.

- The main panel supports buy and sell, exact token amounts, slippage 0.01–5%, simulated quotes, minimum received, quoted exchange rate, and explicit pending/confirmed/rejected status.
- For ERC-20 input, approve only the requested token amount to Permit2, then separately approve the router through Permit2 for 30 minutes. Sufficient current allowances skip their respective step. Native input requires neither approval.
- Swaps use the exact handoff pool key and the network's Universal Router. Quotes use `eth_call`, every write is simulated before a wallet prompt, and the wallet account/chain is checked again before signing. Quotes expire after 60 seconds and the router deadline is five minutes.
- Wrong-network visitors receive one switch action; unknown-chain errors trigger the exact supplied `wallet_addEthereumChain` parameters, followed by another switch.
- “Token tools” exposes transfer, approve/revoke, and transferFrom. It reads relevant allowances, displays a transaction review, requires revocation before replacing a nonzero direct allowance, and waits for a confirmed receipt before unlocking.
- There are no token owner settings. Agent activity, strategies, profits and custody are not implemented by the deployed token and are not fabricated on the site. No approved USD price source was provided; units and quote exchange rates are shown instead.

## Validate the export

```sh
npm run build
npm test
# Install Chromium if the worker does not already provide it:
PLAYWRIGHT_BROWSERS_PATH=/tmp/swarm-brain-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/swarm-brain-browsers npm run test:browser
```

`tests/browser.mjs` also detects the worker-provided Chromium and accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for another installed executable. It starts and closes its own local static server at `/preview/`, intercepts all external requests, injects a mock wallet, and never broadcasts real transactions. Evidence is written to `../docs/evidence/`; rerunning replaces it. See `../docs/VALIDATION.md` for the final results and limitations, `../docs/INTEGRITY.md` for ABI/RPC observations, and `../docs/DESIGN.md` for implemented design tokens and components.

## Delivery scope

Source, package manifest, lockfile, and necessary frontend configuration live under `web/`; the full static export lives under `dist/`. `web/.gitignore` is the explicitly allowed ignore-file path and excludes generated dependencies/caches at every nesting level. Do not commit dependency archives or `node_modules`. Root contract/build files are unchanged.

The task's requested root `DESIGN.md` conflicts with its overriding allowed paths. The document is therefore delivered at `docs/DESIGN.md`. Publishing to GitHub/IPFS, fixed-CID and named-site checks, and real wallet transactions belong to later services or operators and were not performed here. Social title/description and local favicon are included; a public social preview image and absolute canonical URL await verified hosting. `swarmbrain.fun` is the supplied product identity, not a claim that this worker published that domain.
