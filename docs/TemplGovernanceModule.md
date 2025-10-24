## `TemplGovernanceModule`

Adds proposal creation, voting, and execution flows on top of treasury + membership logic.





### `constructor()` (public)

Initializes the module and captures its own address to enforce delegatecalls.



### `createProposalSetJoinPaused(bool _paused, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to pause or resume new member joins.




### `createProposalUpdateConfig(uint256 _newEntryFee, uint256 _newBurnBps, uint256 _newTreasuryBps, uint256 _newMemberPoolBps, bool _updateFeeSplit, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to update entry fee and/or fee split configuration.




### `createProposalSetMaxMembers(uint256 _newMaxMembers, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to change the membership cap.


Reverts when the requested cap is below the current `memberCount`.


### `createProposalUpdateMetadata(string _newName, string _newDescription, string _newLogoLink, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to update templ metadata.




### `createProposalSetQuorumBps(uint256 _newQuorumBps, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to update the quorum threshold in basis points (0–10_000).


### `createProposalSetPostQuorumVotingPeriod(uint256 _newPeriodSeconds, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to update the post‑quorum voting period in seconds.




### `createProposalSetBurnAddress(address _newBurn, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

/ @notice Opens a proposal to update the burn sink address.


Reverts when `_newBurn` is the zero address.


### `createProposalSetProposalFeeBps(uint256 _newFeeBps, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

/ @notice Opens a proposal to update the proposal creation fee basis points.




### `createProposalSetReferralShareBps(uint256 _newReferralBps, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

/ @notice Opens a proposal to update the referral share basis points.




### `createProposalSetEntryFeeCurve(struct CurveConfig _curve, uint256 _baseEntryFee, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

/ @notice Opens a proposal to update the entry fee curve configuration.




### `createProposalCallExternal(address _target, uint256 _value, bytes4 _selector, bytes _params, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

/ @notice Opens a proposal to perform an arbitrary external call through the templ.


Reverts if `_target` is zero or if no calldata is supplied. Any revert
     produced by the downstream call will be bubbled up during execution.
     This is extremely dangerous—frontends surface prominent warnings clarifying that approving
     these proposals grants arbitrary control and may allow the treasury to be drained.


### `createProposalWithdrawTreasury(address _token, address _recipient, uint256 _amount, string _reason, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to withdraw treasury or external funds to a recipient.




### `createProposalDisbandTreasury(address _token, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

Opens a proposal to disband treasury holdings into member or external reward pools.


If the proposer is the `priest`, the proposal is quorum‑exempt to allow
     an otherwise inactive templ (insufficient turnout) to unwind with a simple majority.
    f

### `createProposalCleanupExternalRewardToken(address _token, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

otice Opens a proposal to cleanup an external reward token once fully settled.




### `createProposalChangePriest(address _newPriest, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

otice Opens a proposal to appoint a new priest.


Reverts when `_newPriest` is the zero address.


### `createProposalSetDictatorship(bool _enable, uint256 _votingPeriod, string _title, string _description) → uint256 proposalId` (external)

otice Opens a proposal to enable or disable dictatorship mode.


Reverts when the requested state equals the current `priestIsDictator` value.


### `vote(uint256 _proposalId, bool _support)` (external)

otice Casts or updates a vote on a proposal.


Prior to quorum, eligibility is locked to the join sequence captured at proposal creation.
     Once quorum is reached, eligibility is re‑snapshotted to prevent later joins from swinging the vote.
    fun

### `executeProposal(uint256 _proposalId)` (external)

ice Executes a passed proposal after quorum (or voting) requirements are satisfied.


For quorum‑gated proposals, the `endTime` captured at quorum anchors the post‑quorum voting window
     to prevent mid‑flight changes from affecting execution timing.
    function

### `_executeActionInternal(uint256 _proposalId) → bytes returnData` (internal)

ecutes the action for `_proposalId` and returns any call return data.




### `_governanceSetJoinPaused(bool _paused)` (internal)

vernance wrapper that sets the join pause flag.




### `_governanceUpdateConfig(uint256 _entryFee, bool _updateFeeSplit, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps)` (internal)

vernance wrapper that updates entry fee and/or fee splits.




### `_governanceWithdrawTreasury(address token, address recipient, uint256 amount, string reason, uint256 proposalId)` (internal)

vernance wrapper that withdraws available treasury funds.




### `_governanceDisbandTreasury(address token, uint256 proposalId)` (internal)

vernance wrapper that disbands treasury into a reward pool for `token`.




### `_governanceChangePriest(address newPriest)` (internal)

vernance wrapper that updates the priest address.




### `_governanceSetDictatorship(bool enabled)` (internal)

vernance wrapper that toggles dictatorship mode.




### `_governanceSetMaxMembers(uint256 newMaxMembers)` (internal)

vernance wrapper that updates the membership cap.




### `_governanceUpdateMetadata(string newName, string newDescription, string newLogoLink)` (internal)

vernance wrapper that updates on-chain templ metadata.




### `_governanceSetProposalCreationFee(uint256 newFeeBps)` (internal)

vernance wrapper that updates proposal creation fee (bps of entry fee).




### `_governanceSetReferralShareBps(uint256 newBps)` (internal)

vernance wrapper that updates referral share basis points.




### `_governanceSetEntryFeeCurve(struct CurveConfig curve, uint256 baseEntryFee)` (internal)

vernance wrapper that updates the entry fee curve.




### `_governanceCleanupExternalRewardToken(address token)` (internal)

vernance wrapper that removes a settled external reward token from enumeration.




### `_governanceSetQuorumBps(uint256 newQuorumBps)` (internal)

vernance wrapper that updates quorum threshold (bps).




### `_governanceSetPostQuorumVotingPeriod(uint256 newPeriod)` (internal)

vernance wrapper that updates the post‑quorum voting period.




### `_governanceSetBurnAddress(address newBurn)` (internal)

rnance wrapper that updates the burn sink address.




### `_governanceCallExternal(struct TemplBase.Proposal proposal) → bytes returndata` (internal)

utes the arbitrary call attached to `proposal` and bubbles up revert data.




### `getProposal(uint256 _proposalId) → address proposer, uint256 yesVotes, uint256 noVotes, uint256 endTime, bool executed, bool passed, string title, string description` (external)

rns core metadata for a proposal including vote totals and status.




### `_proposalPassed(struct TemplBase.Proposal proposal) → bool passed` (internal)

rns whether `proposal` has satisfied quorum, delay, and majority conditions.




### `getProposalSnapshots(uint256 _proposalId) → uint256 eligibleVotersPreQuorum, uint256 eligibleVotersPostQuorum, uint256 preQuorumSnapshotBlock, uint256 quorumSnapshotBlock, uint256 createdAt, uint256 quorumReachedAt` (external)

rns quorum-related snapshot data for a proposal.




### `getProposalJoinSequences(uint256 _proposalId) → uint256 preQuorumJoinSequence, uint256 quorumJoinSequence` (external)

rns the join sequence snapshots captured for proposal eligibility.




### `hasVoted(uint256 _proposalId, address _voter) → bool voted, bool support` (external)

rns whether a voter participated in a proposal and their recorded choice.




### `getActiveProposals() → uint256[] proposalIds` (external)

s proposal ids that are still within their active voting/execution window.




### `getActiveProposalsPaginated(uint256 offset, uint256 limit) → uint256[] proposalIds, bool hasMore` (external)

rns active proposal ids using offset + limit pagination.




### `_createBaseProposal(uint256 _votingPeriod, string _title, string _description) → uint256 proposalId, struct TemplBase.Proposal proposal` (internal)

tes the base proposal structure, applies fee, and tracks proposer state.


Captures a pre‑quorum snapshot (block, join sequence, eligible voters), applies a proposal fee
     when configured, and auto‑votes YES for the proposer. The voting period is clamped to
     `[MIN_PRE_QUORUM_VOTING_PERIOD, MAX_PRE_QUORUM_VOTING_PERIOD]` with `preQuorumVotingPeriod`
     applied when callers pass zero.
    function _creat

### `_pruneInactiveTail(uint256 maxRemovals)` (internal)

up to `maxRemovals` inactive proposals from the tail of the active set.




### `pruneInactiveProposals(uint256 maxRemovals) → uint256 removed` (external)

proposals that are no longer active from the tracked set.




### `_requireDelegatecall()` (internal)

unless called via delegatecall from the TEMPL router.


Prevents direct calls to the module implementation.
    function _requi



