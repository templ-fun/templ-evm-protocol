OpenAI Codex (v0.63.0)
gpt-5.1-codex-max high

# Codex Audit – Templ (EVM)

## Scope & Approach
- Reviewed: `contracts/TEMPL.sol`, `contracts/TemplBase.sol`, `contracts/TemplMembership.sol`, `contracts/TemplTreasury.sol`, `contracts/TemplGovernance.sol`, `contracts/TemplCouncil.sol`, `contracts/TemplFactory.sol`, `contracts/TemplCurve.sol`, `contracts/TemplDefaults.sol`, `contracts/tools/BatchExecutor.sol`, and reward handling helpers.
- Tooling reviewed: `hardhat.config.cjs`, `slither.config.json`, `echidna.yaml`, test suite structure under `test/`.
- Method: manual line-by-line review, invariant/threat modelling around delegatecall routing, governance execution, fee splits, curve maths, and reward accounting. No automated tests were executed during this pass.

## Findings

### [High] Non-vanilla ERC-20s break join accounting and payouts
- **Issue:** Joins assume the access token (and external reward tokens) transfer the full `entryFee` without balance deltas being checked. Fee-on-transfer/rebasing/hook tokens will report success while delivering fewer tokens. State is updated first (`treasuryBalance`, `memberPoolBalance`, `protocolBps` routing, `entryFee` progression), so a member can join having effectively paid less than the configured fee.
- **Impact:** Pools and treasury become over-accounted relative to actual balances, causing future `claimMemberRewards`, `claimExternalReward`, `disbandTreasury`, or `withdrawTreasury` calls to revert with insufficient balance. Membership can be acquired at a discount, and protocol/treasury expectations are violated. The factory’s `safeDeployFor` probe exists but is optional, so a misconfigured deployment can ship with this footgun.
- **Recommendation:** Enforce vanilla ERC-20 semantics on the access token (make `safeDeployFor` or an equivalent balance-delta check mandatory). Consider measuring balance before/after each transfer and reverting on shortfall, or explicitly rejecting tokens with transfer fees/hooks for both access tokens and external reward tokens.

### [Medium] Same-block join + external reward disband strands a member’s share
- **Issue:** `_externalBaselineForMember` determines a new member’s baseline using only block number and timestamp. If a join and an external reward disband occur in the same block (possible under dictatorship/DAO self-calls), the checkpoint recorded by the disband is treated as if it predated the join. The new member’s baseline equals the post-disband cumulative value, so their share remains reserved in `poolBalance` but becomes unclaimable.
- **Impact:** Part of the disbanded external reward can be permanently locked (cannot be claimed, withdrawn, or cleaned up), shrinking effective member payouts and leaving stuck balances that block `cleanupExternalRewardToken`.
- **Recommendation:** Treat checkpoints in the same block as occurring after the join when computing baselines (e.g., compare with `<=` or incorporate `joinSequence`), or guard disband/cleanup from running in the same block as a join. This ensures new members can claim their share or the pool does not reserve unreachable funds.

## Additional Observations (Info)
- Instant quorum must always be >0; very small DAOs (single eligible voter) can instantly execute proposals even with long pre-quorum periods. Consider allowing `instantQuorumBps` to be set to 0 or gating instant execution until a minimum voter count.
- `activeProposalIds` grows unbounded and is only pruned from the tail; large deployments should call `pruneInactiveProposals` periodically to keep view calls gas-efficient.
- Delegatecall routing is upgradeable via `setRoutingModuleDAO`; misuse or incorrect selector sets can brick the router. Restrict upgrades to well-reviewed governance proposals and consider rehearsing upgrade payloads off-chain.

## Testing & Tooling Notes
- Extensive Hardhat suite present (`npm test`, `npm test:load`), plus Echidna harness (`contracts/echidna/EchidnaTemplHarness.sol`, `echidna.yaml`) and Slither configuration (`slither.config.json`). These were not executed as part of this review; run `npm test` and optionally `npm run test:fuzz` / `npm run test:static` before deployment.
