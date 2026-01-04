TEMPL Protocol — Core Contracts Security Audit

Date: 2026-01-03
Audit Type: Manual source review (logic, access-control, economic & governance invariants)
Scope: Core smart contracts in contracts/ (excluding mocks)

⸻

📌 Summary

This codebase implements a modular, delegatecall-based DAO/router (“TEMPL”) with:
	•	Membership (entry-fee join, rewards distribution)
	•	Treasury & Rewards (member pool + external reward token distribution)
	•	Governance (proposal creation, voting, execution; optional “Council Mode”)
	•	Upgradability via routing module selector mapping set by DAO

The system is generally well-structured, uses Solidity ^0.8.x overflow checks, and applies nonReentrant in the most dangerous member-facing flows (joins, proposal execution, rewards claims). However, there are two material logic issues, one of which can weaken governance safety guarantees in a realistic lifecycle transition (member-wide → council governance).

⸻

🔍 Threat Model & Assumptions
	•	Governance is powerful by design: it can upgrade modules and perform arbitrary external calls (CallExternal).
	•	The access token is assumed to be “vanilla ERC20” (no fee-on-transfer, rebasing, hooks). The factory provides “safe deploy” checks, but deployment outside the factory can violate this assumption.
	•	Council Mode is intended to be a stable governance configuration, but the protocol supports transitioning between governance modes.

⸻

⚠️ Findings Overview

ID	Severity	Title
H-01	High	Council mode transition can corrupt post-quorum voter denominator for member-wide proposals, weakening quorum and instant-quorum safety
M-01	Medium	Entry-fee curve base recalibration applies inverse segments in forward order (rounding-dependent), causing miscalibrated future fees for multi-growth curves
L-01	Low	DAO “sweep remainder” functions transfer value without nonReentrant (defense-in-depth)
I-01	Informational	Governance upgrade & CallExternal are total-power actions; security depends on governance parameters and operational discipline
I-02	Informational	External reward token list growth increases join gas cost; keep list pruned


⸻

🧨 Detailed Findings

⸻

H-01 — Council mode transition can corrupt post-quorum voter denominator for member-wide proposals

Severity: High

Impact

If a member-wide proposal (created when Council Mode was disabled) reaches quorum after Council Mode is enabled, the protocol snapshots postQuorumEligibleVoters using _eligibleVoterCount(), which returns councilMemberCount, not memberCount.

This can:
	1.	Lower the effective quorum requirement checked again at execution time.
	2.	Make Instant Quorum trigger far too easily, potentially immediately, which can:
	•	end voting early (endTime = block.timestamp)
	•	allow immediate execution
	•	bypass the intended post-quorum window

This undermines core governance guarantees precisely during the most sensitive lifecycle event: the switch into Council Mode.

Root Cause

For member proposals (where councilSnapshotEpoch == 0), when quorum is reached, governance does:

proposal.postQuorumEligibleVoters = councilSnapshotEpoch == 0
    ? _eligibleVoterCount()
    : proposal.eligibleVoters;

But _eligibleVoterCount() is:

return councilModeEnabled ? councilMemberCount : memberCount;

So after council mode is enabled, _eligibleVoterCount() returns councilMemberCount, even for proposals that remain member-wide by snapshot rules.

Affected Code (reviewed version)
	•	TemplGovernance.sol — quorum reached snapshot (~479–481)
	•	TemplBase.sol — _eligibleVoterCount() (~852–854)
	•	TemplBase.sol — _maybeTriggerInstantQuorum() (~910–913)

Exploitation / Failure Scenario
	•	DAO starts in member mode (100 members).
	•	Proposal A created (member-wide).
	•	Before Proposal A reaches quorum, Proposal B enables council mode (council size = 5).
	•	Proposal A later reaches quorum:
	•	postQuorumEligibleVoters becomes 5 (council members), not ~100.
	•	Instant quorum check uses this reduced basis:
	•	Even a “100% instant quorum” requirement becomes “≥ 5 yes votes”.
	•	Proposal A becomes instantly executable, bypassing the post-quorum window.

Recommendation

When quorum is reached for member-wide proposals, snapshot memberCount, not _eligibleVoterCount():

if (councilSnapshotEpoch == 0) {
    proposal.postQuorumEligibleVoters = memberCount;
} else {
    proposal.postQuorumEligibleVoters = proposal.eligibleVoters;
}

Similarly, in _maybeTriggerInstantQuorum(), snapshot the voter denominator based on proposal type, not current governance mode.

⸻

M-01 — Entry-fee curve base recalibration applies inverse segments in forward order

Severity: Medium

Impact

When _setCurrentEntryFee() retargets entryFee while a curve has growth and paidJoins > 0, the contract recomputes baseEntryFee using _solveBaseEntryFee().

However, _solveBaseEntryFee() applies inverse segment transforms in the same order as forward application, while inverse transforms use ceiling rounding per segment. Because rounding is applied per segment, the order of inverses is not mathematically equivalent under integer arithmetic.

This can cause:
	•	Slightly miscalibrated baseEntryFee
	•	Future entry fees drifting from the intended curve
	•	Discontinuous fee jumps after governance retargets

Root Cause
	•	Forward pricing applies segments sequentially: f_n(...f_2(f_1(base)))
	•	Inverse pricing must apply inverse transforms in reverse order
	•	Current implementation applies inverses forward, compounding rounding error

Affected Code
	•	TemplBase.sol:
	•	_setCurrentEntryFee() (~789–813)
	•	_solveBaseEntryFee() (~1120–1152)
	•	_scaleInverse() rounding (~1193–1194)

Recommendation

Apply inverse segment transforms in reverse order, after computing how many steps each segment consumes. Segment count is small, so this is safe and cheap.

⸻

L-01 — Sweep remainder DAO functions lack nonReentrant

Severity: Low
	•	sweepExternalRewardRemainderDAO
	•	sweepMemberPoolRemainderDAO

These functions transfer ETH/ERC20 value. They are onlyDAO, limiting exploitability, but adding nonReentrant would improve defense-in-depth consistency.

Recommendation: Add nonReentrant.

⸻

I-01 — Governance upgrade & CallExternal are total-power actions
	•	setRoutingModuleDAO can remap selectors to arbitrary modules.
	•	CallExternal can invoke arbitrary targets with calldata/value.

This is an intentional design choice, but it means governance correctness is security-critical.

Recommendation: Treat governance parameter changes as security events; audit new modules before routing updates.

⸻

I-02 — External reward token list growth increases join gas cost

Joins flush remainders across all externalRewardTokens. Although capped, unnecessary token registrations increase gas cost.

Recommendation: Prune inactive reward tokens via governance.

⸻

✅ Additional Recommendations
	1.	Add regression tests for member proposals that reach quorum after council mode is enabled.
	2.	Explicitly document governance-mode transition risks.
	3.	Consider emitting initialization events for initial members for indexers/UI completeness.

⸻

📄 Contracts Reviewed (Core)
	•	contracts/TEMPL.sol
	•	contracts/TemplBase.sol
	•	contracts/TemplMembership.sol
	•	contracts/TemplGovernance.sol
	•	contracts/TemplCouncil.sol
	•	contracts/TemplTreasury.sol
	•	contracts/TemplFactory.sol
	•	contracts/TemplDeployer.sol
	•	contracts/TemplCurve.sol
	•	contracts/TemplDefaults.sol
	•	contracts/TemplErrors.sol
	•	contracts/tools/BatchExecutor.sol

⸻

Final Notes

The H-01 issue is the most critical and should be fixed before mainnet deployment or before enabling council mode in production. The rest of the findings primarily affect economic precision, operational safety, and long-term maintainability.