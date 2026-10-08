# Deployment and export integrity

Checked on 2026-10-08 UTC. These are worker observations, not publication attestation or proof of successful trading.

## Runtime and build inputs

The app loads `dist/imd-deployment.json` and the ABI JSON referenced by that manifest. `web/deployment-input.json` is the preserved **build-only** subset of the supplied deployment and network handoffs; it is not imported by browser source. This allows rebuilding after the temporary `.imd/reads/` inputs are removed. When those inputs exist, the exporter and verifier require an exact structural match to them.

The deployed source commit is `a5cf6337f3d3aa217dcbaaf4337d03b7a583db46`. The build reads `docs/abi/LaunchToken.json` from that commit using `git show`, validates that it is a raw JSON ABI array, recursively sorts object keys while preserving array order, and computes Keccak-256 of the resulting compact UTF-8 JSON. The result matches the handoff:

```
LaunchToken: 38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee
```

The ABI is exported with exactly the pinned source bytes. A repository checkout containing the pinned Git commit is required to rebuild or run the provenance check. A downloaded source archive without Git history must first obtain that commit; the build deliberately does not fall back to a guessed ABI.

The exact handoff `poolKey` is retained, including fee `12500`, tick spacing `60`, and its nonzero hook. The nested deployment manifest's older fee `3000` is not the pool configuration. The supplied `network` and `walletAddChain` objects are copied unchanged.

## Repeatable checks

From `web/`, run `npm ci`, `npm run build`, and `npm run verify`. The build exports the production application before writing its deployment manifest. Every exported file except the manifest receives a lowercase SHA-256 entry, including `index.html` and all ABIs. Any export change requires rerunning the build or `node scripts/export.mjs` followed by verification.

`web/scripts/verify.mjs` verifies:

- The exact permitted manifest keys, required fields, address/hash formats, and equality to the preserved handoff; the temporary original handoff is also compared when present.
- Pool key preservation, chain consistency, relative ABI/asset paths, and exact implementation ABI bytes and canonical Keccak hashes.
- Every asset's SHA-256, a complete inventory without duplicates or unlisted files, the static entrypoint, and rejection of symlinks and special files.
- At most 128 assets, at most 8 MiB per asset, and an export below 24 MiB to leave room within the publication response budget. The separate complete submission limit remains 8 MiB.

Eighteen isolated integrity checks passed in `test/scratch/`: recursive canonical ordering; invalid path rejection; successful pinned ABI export; rejection of an extra manifest key, changed pool fee, changed RPC, changed contract address, duplicate inventory entry, missing entry, wrong SHA-256, traversal path, unlisted file, changed asset bytes, symlink asset, and build-input divergence from the original handoff; and a clean pass after restoring the fixture. Two further checks rejected a semantically changed ABI even with a correct asset SHA-256, and changed ABI formatting even with an unchanged canonical ABI hash. These checks used a scratch export, not the production files.

## Read-only live RPC observations

Both supplied public endpoints returned chain ID `0x1`. `https://ethereum-rpc.publicnode.com` returned the following nonempty deployed code. Requests used `eth_chainId` and `eth_getCode` at `latest`; no transaction was signed or broadcast.

| Manifest role | Address | Runtime code bytes |
| --- | --- | ---: |
| LaunchToken | `0xc244d8e912c095aa2bb56e911a30c44e38369e78` | 1784 |
| Pool hook | `0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000` | 488 |
| IMD paired currency | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` | 22990 |
| PoolManager | `0x000000000004444c5dc75cb358380d2e3de08a90` | 24009 |
| Universal Router | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | 19499 |
| Quoter | `0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203` | 5820 |
| StateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | 3531 |
| PositionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | 23877 |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` | 9152 |

`https://eth.drpc.org` rejected an eleven-request JSON-RPC batch with HTTP 500 / error code 31 because its free endpoint limits batches to three calls. Retrying individually succeeded: chain ID `0x1`, LaunchToken code length 1784 bytes, and block number `0x18f0566` (26150246). Runtime fallback must use individual requests or respect that batch limit.

These observations establish endpoint reachability and nonempty code at check time. They do not establish runtime-code equivalence, liquidity, future endpoint availability, successful swaps, publication, fixed-CID asset delivery, or named-site resolution. Browser interaction and accessibility evidence are recorded separately in the frontend validation documentation.
