# Frontend validation

Worker validation completed on 2026-10-08 UTC. **Complete for the stated worker scope**, with the documented path conflict and live-operation limitations below. These are reproducible worker checks and observations, not independent certification or publication results.

## Scope and assumptions

The source is `web/`; the production export is repository-root `dist/`. The approved brief supplies Swarm brain / Brain and swarmbrain.fun. The deployed implementation is an ordinary ERC-20 without agent execution, profit rights, custody, or administrative settings. Accordingly the page presents the idea, live token/pool reads, a Brain/IMD swap flow, and transfer/approve/transferFrom controls. Agent metrics, owner setup, USD prices, and live trading performance are not invented.

The overriding write budget permits `web/**`, `dist/**`, `docs/**`, and specifically `web/.gitignore`. It excludes the requested root `DESIGN.md`, so the design document is delivered as [DESIGN.md](DESIGN.md) here. No root contract/build configuration, implementation source, original ABI, dependency library, or workflow configuration was changed. Temporary browser-tool output was moved into ignored `test/scratch/`; only useful evidence is delivered.

## Commands and results

| Check actually run | Result |
| --- | --- |
| `npm install --prefix web --cache /tmp/swarm-brain-npm-cache --no-audit --no-fund` | Passed; normal dependency installation and committed npm lockfile. No vendored registry or dependency archives. |
| `npm run typecheck --prefix web` | Passed. Also rerun automatically by every production build. |
| `npm run build --prefix web` after the final source correction | Passed: Vite export, pinned ABI copy, deployment manifest generation, and complete asset/configuration verification. |
| `npm test --prefix web` | 16/16 helper-level tests passed with mock RPC and wallet responses. |
| `npm run test:browser --prefix web` against the final export | 17/17 browser scenarios passed. Chromium version and manifest hash are recorded in [browser-results.json](evidence/browser-results.json). |
| `npm run verify --prefix web` / export verifier during build | Passed: exact configuration, ABI provenance, hashes, inventory and limits. |
| Isolated verifier fault-injection checks in scratch | 18 checks passed; details in [INTEGRITY.md](INTEGRITY.md). Scratch fixtures are not submitted. |
| Supplied live public RPC chain/code reads | Both RPCs returned Ethereum chain ID; token and configured protocol addresses returned nonempty code. See [INTEGRITY.md](INTEGRITY.md). |
| Rendered production export via available browser tool | Live public reads loaded supply 1,000,000,000 Brain and initialized pool state, observed at block 26150302. No wallet connected or transaction broadcast. |

Vite emitted one non-fatal advisory that the main JavaScript chunk exceeds 500 kB uncompressed. The complete final export is **568,527 bytes**, including the manifest, across six declared assets plus the manifest. It remains far below both the export response budget and submission limit. The complete candidate Git bundle and scope check are described in `SUBMISSION.md`. Workspace Git metadata is read-only, so the commit was prepared only in a scratch checkout; the original delivery files remain ready for collection.

## Interaction evidence

[Browser test source](../web/tests/browser.mjs) serves the production files at `/preview/`, intercepts **all external requests**, and injects a test-only EIP-1193 wallet. It decodes write data and returns ABI-encoded RPC fixtures and receipts. Synthetic test accounts occur only in tests/evidence, never deployment configuration.

The final 17 browser scenarios cover disconnected/missing wallet, rejected connection, wrong chain and code-4902 add/switch fallback, ABI integrity rejection, absent deployed code, buy with both separate approvals and confirmation, already-approved sell, insufficient balance, router simulation failure, rejected signature, account/network quote invalidation, direct transfer, approval and explicit revocation, delegated transfer, 0.29% slippage, delayed-quote account changes, and responsive/keyboard/accessibility behavior. See the JSON's individual scenario names and outcomes; a scenario may exercise several related steps.

The 16 helper tests validate exact pool-key routing and encoded commands/actions, extended router tuples, native-input approval skipping, minimum-output/slippage bounds, allowance amounts/expiration, unknown-chain handling, nested error translation, simulation→signature→receipt sequencing, wrong-chain/account/no-code guards, and expiry during simulation before a signature. Neither suite proves real liquidity or a successful mainnet swap.

Final tested manifest SHA-256: `dfde5b02af37ad7a4190acf9b14f4d8b7c2b40cbbadc0ce497407df4f905aceb`. The manifest contains every exported asset SHA-256 and its attested contract binding. ABI canonical Keccak verification uses the exact source commit `a5cf6337f3d3aa217dcbaaf4337d03b7a583db46`.

## Better Interface consolidated review

The pinned adapter, workflow, core principles of all six domains, relevant forms/focus guidance, and design-document method were applied during implementation and final review. Attribution/license copies are linked from [THIRD_PARTY.md](THIRD_PARTY.md).

| Domain | Coverage and evidence | Limitations / not applicable |
| --- | --- | --- |
| Accessibility — Checked | Semantic buttons/links, labels, skip link, native disclosures, explicit direction group, status/alert regions, visible keyboard focus, quote flow by keyboard, reduced motion; automated axe at 1440/768/390/320. Invalid token fields are marked and focused. | No screen-reader session, native wallet extension, physical touch device, or comprehensive forced-colors examination. No modals or composite custom widgets to trap focus. |
| Layout — Checked | Production screenshots and measured scroll width at 1440/768/390/320; long addresses and opened token/contract disclosures; separate 200% text enlargement without horizontal overflow. | Text enlargement is not native browser zoom. RTL/localization not supported or tested. |
| Writing — Checked | Verb-first actions, explicit approval recipient and allowance duration, exact spend/minimum output review, error recovery text, unavailable USD context, conceptual-art label, clear release limitations. | ENS labels are not implemented; checksummed addresses are used. |
| Typography — Checked | Heading hierarchy, source type roles, system-font stack, wrapping/measure, readable form sizes, tabular numbers, full address access; final screenshots inspected. | Platform font fallback differs between devices. No claim that every requested weight is supplied on every system. |
| Colors — Checked | Semantic token review, computed rendered color/background measurements, automated contrast checks. Text carries status meaning alongside color. | Light-only by design; no unimplemented dark theme claimed. Axe cannot classify the decorative arrow's non-text character; it is aria-hidden and not a control. |
| UI — Checked | Hover/focus/pressed, disconnected, loading, approval, submitted/confirmed/rejected, allowance and read-error states; 120ms opt-in button transitions, .96 press scale, layered card surfaces and native disclosure affordances. | No automatic entrance motion or modal state. Animations-panel playback at 10% speed was not performed. |

### Findings, fixes and rechecks

| Severity / domain | Source location | Finding, correction and evidence |
| --- | --- | --- |
| High / interaction | `web/src/App.tsx:80` and `:129` | A delayed quote or allowance read could restore results after an account/chain change. Added context guards and invalidation of reviews. Browser regression changes account during a delayed quote and confirms no stale action is restored. |
| High / transaction state | `web/src/chain.ts:245`, `:336` | An initial quote-age check could pass before slow RPC verification/simulation. A final guard now rejects expiry immediately before signing. Unit regression passes with no wallet write. |
| Medium / form behavior | `web/src/App.tsx:132` | Floating multiplication rejected valid slippage values such as 0.29%. Parse decimal text to integer basis points. Browser regression quotes at 0.29% successfully. |
| Medium / writing | `web/src/chain.ts:332`, `web/src/App.tsx:186` | Approval duration copy said 30 minutes while helper initially used one hour. Aligned router approval to 1800 seconds; approval tests and final browser flow pass. |
| Medium / accessibility | `web/src/App.tsx:180` | Axe incomplete evidence identified `aria-label` on an untyped direction div. Added `role="group"`; final axe report no longer contains the finding. |
| Medium / forms | `web/src/App.tsx:166`, `:195` | Token validation needed field-specific invalid markup and correct focus for invalid source/zero addresses. Added `aria-invalid`, error descriptions, and the target-field focus choice. Final typecheck/browser suite passes. |
| Low / writing | `web/src/App.tsx:177` | Initial brand treatment contained an unsupported registration mark. Removed it. Final live and mocked screenshots reflect the corrected identity. |

### Browser, contrast and resource evidence

The production export was inspected directly using the available browser tool at `/dist/` with real public reads, and separately by Playwright at `/preview/` with controlled mocks. This tests relative asset/configuration paths rather than relying on a root-only development server. All final static requests succeeded. The live console had zero errors or warnings; mocked sessions recorded no page/console/static resource errors or unexpected external requests.

- [Desktop expanded tools and quote](evidence/desktop.png), [mobile](evidence/mobile.png), [320px](evidence/viewport-320.png), [768px](evidence/viewport-768.png).
- [Keyboard focus](evidence/desktop-keyboard.png), [quote-action focus](evidence/quote-keyboard.png), [200% text enlargement](evidence/text-200-percent.png).
- [Live desktop](evidence/live-desktop.png), [live mobile](evidence/live-mobile.png), [live read observation](evidence/live-read-state.json), [console](evidence/live-console.txt), [resource responses](evidence/live-network.txt).
- [Automated accessibility results](evidence/accessibility.json): zero violations at all four widths. The decorative downward arrow remains an explicitly recorded incomplete contrast item, not a claimed pass.
- [Measured rendered contrasts](evidence/contrast.json): main text on page 12.96:1, muted page text 5.65:1, main text on card 13.88:1, muted card text 6.05:1, and primary button text 8.96:1. The direct browser inspection additionally measured the hovered primary button at 7.83:1 and error text/surface at 7.11:1. These measurements exceed the 4.5:1 normal-text threshold for the identified pairs; they do not certify every transient/composited state.

## Remaining limitations

No mainnet wallet signature, approval, transfer, or swap was broadcast. There was no real wallet installation test, funded-wallet validation, live quote execution test, screen-reader audit, physical device test, native 200% browser zoom, or cross-browser Safari/Firefox run. No runtime-bytecode equivalence check or independent security audit is claimed. Public RPCs and pool liquidity may change after observation.

The source and static export are the worker deliverables. No GitHub publication, IPFS pin, CID check, domain update, named-site resolution, or control-plane post-publication verification was performed. The supplied domain remains product identity; absolute social image/canonical hosting metadata await verified publication.
