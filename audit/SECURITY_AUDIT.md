TEMPL Smart Contracts Security Audit

Date: 2025-10-22
Model: gpt5-codex-high
CLI: codex 0.46.0
Commit: fd0322a565ef3c59081514c91c8f68fca4d489a0
Scope: contracts, modules, factory, libraries, config (Hardhat)

1) Executive Summary
- Result: No critical or high-severity issues found. The system enforces DAO-only actions, secures treasury accounting, and includes strong tests for voting snapshots and reentrancy.
- Main advisory: External-call proposals are intentionally powerful and can drain funds if approved. Mitigate through governance process and UI warnings; consider stricter thresholds for these proposals.
**- Change applied after this audit: Hardhat optimizer configured for production-friendly gas (default 500 runs, coverage builds hold at 1). See hardhat.config.cjs.**

2) Methodology
- Manual review of core contracts: router (`contracts/TEMPL.sol`), base/storage/utilities (`contracts/TemplBase.sol`), modules (`contracts/TemplMembership.sol`, `contracts/TemplTreasury.sol`, `contracts/TemplGovernance.sol`), factory (`contracts/TemplFactory.sol`), libraries (`contracts/libraries/**`).
- Automated testing: Ran full Hardhat test suite (284 passing) covering governance, treasury operations, rewards, voting invariants, and curve math.
- Static analysis: Slither on Hardhat artifacts with project config; focused on surfacing correctness/security anomalies while filtering mocks/tests noise.

3) Architecture Overview
- Router: `contracts/TEMPL.sol` delegates to modules by selector via fallback.
- Shared base: `contracts/TemplBase.sol` holds all state and internal helpers used by modules.
- Modules:
  - Membership: joins, member pool accounting, external reward claims.
  - Treasury: config updates, withdrawals, treasury disbanding to member/external pools.
  - Governance: proposals, vote casting, quorum/execution checks, and external calls.
- Factory: `contracts/TemplFactory.sol` deploys TEMPL with protocol config; uses SSTORE2 to store bytecode chunks.

4) Key Strengths
- Access control: DAO-only operations with explicit dictatorship override; member-gated actions; join pause and max-member cap logic.
- Reentrancy mitigations: nonReentrant on sensitive flows (join, claims, proposal execution).
- Treasury safety: Prevents withdrawing assets reserved for member/external reward pools; careful balance accounting.
- Voting integrity: Join-sequence snapshots prevent post-snapshot joins from voting; same-block subtleties addressed using (block, timestamp) checkpoints.
- Curve & math safety: Input validation and overflow/underflow protections on curve computations.

5) Findings & Recommendations
5.1 Design/Info: External Call Proposals Can Drain Funds
- Detail: `_governanceCallExternal` executes arbitrary `target.call{value}` from the templ. This is intentional and warned in comments.
- Risk: Social/governance, not technical. Bad proposals can rug funds if approved.
- Recommendation: Prominent UI warnings; consider stricter quorum or longer execution delays specifically for `CallExternal` actions.

5.2 Low: Gas Optimizer Runs Too Low for Production
- Detail: Optimizer was set to 1 run for all builds. Updated to use `runs = usingCoverage ? 1 : runsDefault`, where `runsDefault` is 500 or `SOLC_RUNS`.
- File: `hardhat.config.cjs`
- Recommendation: Use `SOLC_RUNS` env var to tune; 200–1000 are typical production ranges.

5.3 Info: Slither Config Excludes `arbitrary-send-eth`
- Detail: `slither.config.json` excludes detector; acceptable for DAO patterns but keep periodic runs.
- Recommendation: Re-enable detector occasionally in CI to catch regressions.

5.4 Info: Arbitrary-from Pattern in transferFrom (Benign Here)
- Detail: `_safeTransferFrom(token, from, to, amount)` flagged generally; in context, `from` is the paying user and allowances apply.
- Recommendation: None.

5.5 Info: “Weak PRNG” on Remainders
- Detail: Modulo operations used only for reward remainder distribution; not a randomness source.
- Recommendation: None.

5.6 Info: Active Proposals Index Requires Pruning
- Detail: Manual pruning via `pruneInactiveProposals`. Covered by tests.
- Recommendation: Ensure frontends/ops periodically call prune to keep indexes small.

5.7 Info: ERC-20 Assumptions
- Detail: Fee-on-transfer/rebasing tokens not supported for access token; explicitly noted in code.
- Recommendation: Enforce in UI and deployment docs.

5.8 Info: Dictatorship Mode Centralization Risk
- Detail: In dictatorship, priest can call DAO functions directly.
- Recommendation: Prominent UI state, events, and clear process to disable when appropriate.

6) Static Analysis Summary
- Tool: Slither 0.11.3
- Command: `slither . --hardhat-ignore-compile --hardhat-artifacts-directory artifacts --hardhat-cache-directory cache --config-file slither.config.json --filter-paths '(test/|mocks/)'`
- Results: No critical/high items. Informational/naming/benign patterns as noted above.

7) Tests Summary
- Command: `npm test`
- Result: 284 passing. Coverage includes reentrancy guards, treasury accounting, external rewards (ERC-20/ETH), governance snapshots/quorum/eligibility (incl. same-block edge cases), factory deploy flows, and curve math invariants.

8) Threat Model & Invariants (Selected)
- Treasury protection: Withdrawals/disbands cannot take assets reserved for member/external pools; checked across ERC-20/ETH branches.
- DAO-only execution: `onlyDAO` ensures governance-controlled state changes; dictatorship override is explicit and tested.
- Reentrancy: Critical flows protected by `nonReentrant`.
- Voting integrity: Join-sequence snapshots enforce eligibility boundaries; quorum snapshots lock voter set post-quorum.

9) Repro & Ops Notes
- Tests: `npm test`
- Coverage: `npm run coverage`
- Static analysis: see command in section 6
- Deployment: Provide `SOLC_RUNS` to tune optimizer runs; IR can remain enabled.

10) File Pointers
- Router: contracts/TEMPL.sol
- Base: contracts/TemplBase.sol
- Membership: contracts/TemplMembership.sol
- Treasury: contracts/TemplTreasury.sol
- Governance: contracts/TemplGovernance.sol
- Factory: contracts/TemplFactory.sol
- Config: hardhat.config.cjs
- Slither config: slither.config.json

11) Conclusion
The codebase demonstrates careful handling of DAO mechanics, treasury accounting, and snapshot-based governance with strong test coverage. No critical/high issues were identified. Address the external-call advisory through process/UX controls and keep the optimized build settings for production deployments.

