## `TemplBase`

Hosts shared state, events, and internal helpers used by membership, treasury, and governance modules.




### `onlyMember()`

function so only wallets that successfully joined may call it.
    modifier onlyMe



### `onlyDAO()`

ls from the contract (governance) or the priest when dictatorship mode is enabled.
    modifier onlyDA



### `notSelf()`

ct calls from the contract to avoid double-entry during join flows.
    modifier notSel



### `whenNotPaused()`

ns and other gated actions only execute when the templ is unpaused.
    modifier whenNo




### `_recordExternalCheckpoint(struct TemplBase.ExternalRewardState rewards)` (internal)

a new external reward checkpoint so future joins can baseline correctly.




### `_externalBaselineForMember(struct TemplBase.ExternalRewardState rewards, struct TemplBase.Member memberInfo) → uint256 baseline` (internal)

es the cumulative rewards baseline for a member using join-time snapshots.




### `_cleanupExternalRewardToken(address token)` (internal)

n external reward token from enumeration once fully settled.




### `_flushExternalRemainders()` (internal)

tes any outstanding external reward remainders to existing members before new joins.
    function _flush



### `_initializeTempl(address _protocolFeeRecipient, address _accessToken, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps, uint256 _protocolBps, uint256 _quorumBps, uint256 _executionDelay, address _burnAddress, bool _priestIsDictator, string _name, string _description, string _logoLink, uint256 _proposalCreationFeeBps, uint256 _referralShareBps)` (internal)

utable configuration and initial governance parameters shared across modules.


Also initializes the default `preQuorumVotingPeriod` to `MIN_PRE_QUORUM_VOTING_PERIOD`.
    function _initi

### `_setPercentSplit(uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps)` (internal)

the split between burn, treasury, and member pool slices.




### `_validatePercentSplit(uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps, uint256 _protocolBps)` (internal)

s that the provided split plus the protocol fee equals 100%.




### `_configureEntryFeeCurve(uint256 newBaseEntryFee, struct CurveConfig newCurve)` (internal)

es the entry fee curve anchor and growth profile.




### `_updateEntryFeeCurve(struct CurveConfig newCurve)` (internal)

the entry fee curve without altering the base anchor.




### `_setCurrentEntryFee(uint256 targetEntryFee)` (internal)

current entry fee target while preserving the existing curve shape.




### `_applyCurveUpdate(struct CurveConfig newCurve, uint256 baseEntryFeeValue)` (internal)

a curve update driven by governance or DAO actions.




### `_copyCurveConfig(struct CurveConfig stored) → struct CurveConfig cfg` (internal)

a memory copy of a curve stored on-chain.




### `_advanceEntryFeeAfterJoin()` (internal)

es the entry fee for the next join in response to membership changes.
    function _advan



### `_refreshEntryFeeFromState()` (internal)

es the entry fee based on the current membership count and stored curve.
    function _refre



### `_currentPaidJoins() → uint256 count` (internal)

the number of paid joins that have occurred (excludes the auto-enrolled priest).




### `_curveHasGrowth(struct CurveConfig curve) → bool hasGrowth` (internal)

whether any curve segment introduces dynamic pricing.




### `_priceForPaidJoins(uint256 baseFee, struct CurveConfig curve, uint256 paidJoins) → uint256 price` (internal)

the entry fee for a given number of completed paid joins (memory curve).




### `_priceForPaidJoinsFromStorage(uint256 baseFee, struct CurveConfig curve, uint256 paidJoins) → uint256 price` (internal)

the entry fee for a given number of completed paid joins (storage curve).




### `_solveBaseEntryFee(uint256 targetPrice, struct CurveConfig curve, uint256 paidJoins) → uint256 baseFee` (internal)

the base entry fee that produces a target price after `paidJoins` joins.




### `_consumeSegment(uint256 amount, struct CurveSegment segment, uint256 remaining, bool forward) → uint256 newAmount, uint256 newRemaining` (internal)

a curve segment for up to `remaining` steps and returns the updated amount and remaining steps.




### `_applySegment(uint256 amount, struct CurveSegment segment, uint256 steps, bool forward) → uint256 updated` (internal)

a curve segment forward or inverse for the specified number of steps.




### `_powBps(uint256 factorBps, uint256 exponent) → uint256 result, bool overflow` (internal)

a basis-point scaled exponent using exponentiation by squaring.




### `_min(uint256 a, uint256 b) → uint256 minValue` (internal)

the smaller of two values.




### `_validateCurveConfig(struct CurveConfig curve)` (internal)

s curve configuration input.




### `_validateCurveSegment(struct CurveSegment segment)` (internal)

s a single curve segment.




### `_validateEntryFeeAmount(uint256 amount)` (internal)

entry fee amounts satisfy templ invariants.




### `_emitEntryFeeCurveUpdated()` (internal)

e standardized curve update event with the current configuration.
    function _emitE



### `_updateDictatorship(bool _enabled)` (internal)

dictatorship governance mode, emitting an event when the state changes.




### `_setMaxMembers(uint256 newMaxMembers)` (internal)

clears the membership cap and auto-pauses if the new cap is already met.




### `_setTemplMetadata(string newName, string newDescription, string newLogoLink)` (internal)

ew templ metadata and emits an event when it changes.




### `_setProposalCreationFee(uint256 newFeeBps)` (internal)

the proposal creation fee (bps of current entry fee).




### `_setReferralShareBps(uint256 newBps)` (internal)

the referral share basis points (slice of member pool).




### `_setQuorumBps(uint256 newQuorumBps)` (internal)

the quorum threshold (bps).


Accepts either 0-100 (interpreted as %) or 0-10_000 (basis points) values.


### `_setPostQuorumVotingPeriod(uint256 newPeriod)` (internal)

the post‑quorum voting period in seconds.




### `_setBurnAddress(address newBurn)` (internal)

e burn sink address.




### `_setPreQuorumVotingPeriod(uint256 newPeriod)` (internal)

e default pre‑quorum voting period used when proposals do not supply one.




### `_withdrawTreasury(address token, address recipient, uint256 amount, string reason, uint256 proposalId)` (internal)

asury withdrawal and emits the corresponding event.




### `_updateConfig(uint256 _entryFee, bool _updateFeeSplit, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps)` (internal)

s to the entry fee and/or fee split configuration.


The access token, protocol recipient, and protocol basis points are immutable
     post-deploy and cannot be changed via this update.


### `_setJoinPaused(bool _paused)` (internal)

pause flag without mutating membership limits during manual resumes.




### `_changePriest(address newPriest)` (internal)

iest address and emits an event.




### `_disbandTreasury(address token, uint256 proposalId)` (internal)

y balances into member or external pools so members can claim them evenly.




### `_addActiveProposal(uint256 proposalId)` (internal)

active `proposalId` for enumeration by views.




### `_removeActiveProposal(uint256 proposalId)` (internal)

ctive `proposalId` from the active index.




### `_joinedAfterSnapshot(struct TemplBase.Member memberInfo, uint256 snapshotJoinSequence) → bool joinedAfter` (internal)

a member joined after a particular snapshot point using join sequences.




### `_isActiveProposal(struct TemplBase.Proposal proposal, uint256 currentTime) → bool active` (internal)

r `proposal` is currently active at `currentTime`.




### `_autoPauseIfLimitReached()` (internal)

w joins when a non-zero membership cap has been reached.
    function _autoPauseIf



### `_safeTransfer(address token, address to, uint256 amount)` (internal)

unt` of `token` from this contract to `to`.




### `_safeTransferFrom(address token, address from, address to, uint256 amount)` (internal)

unt` of `token` from `from` to `to` using allowance.




### `_registerExternalToken(address token)` (internal)

en` so external rewards can be enumerated in views.




### `_removeExternalToken(address token)` (internal)

` from the external rewards enumeration set.




### `_scaleForward(uint256 amount, uint256 multiplier) → uint256 result` (internal)

` by `multiplier` (bps), saturating at `MAX_ENTRY_FEE`.




### `_scaleInverse(uint256 amount, uint256 divisor) → uint256 result` (internal)

g by dividing `amount` by `divisor` (bps) rounding up.




### `_mulWouldOverflow(uint256 a, uint256 b) → bool overflow` (internal)

hen multiplying `a` and `b` would overflow uint256.





### `MemberJoined(address payer, address member, uint256 totalAmount, uint256 burnedAmount, uint256 treasuryAmount, uint256 memberPoolAmount, uint256 protocolAmount, uint256 timestamp, uint256 blockNumber, uint256 joinId)`

ice Emitted after a successful join.




### `MemberRewardsClaimed(address member, uint256 amount, uint256 timestamp)`

Emitted when a member claims rewards from the member pool.




### `ProposalCreated(uint256 proposalId, address proposer, uint256 endTime, string title, string description)`

Emitted when a proposal is created.




### `VoteCast(uint256 proposalId, address voter, bool support, uint256 timestamp)`

Emitted when a member casts a vote on a proposal.




### `ProposalExecuted(uint256 proposalId, bool success, bytes32 returnDataHash)`

Emitted after a proposal execution attempt.




### `TreasuryAction(uint256 proposalId, address token, address recipient, uint256 amount, string reason)`

Emitted when a treasury withdrawal is executed.




### `ConfigUpdated(address token, uint256 entryFee, uint256 burnBps, uint256 treasuryBps, uint256 memberPoolBps, uint256 protocolBps)`

Emitted when templ configuration is updated.




### `JoinPauseUpdated(bool joinPaused)`

Emitted when joins are paused or resumed.




### `MaxMembersUpdated(uint256 maxMembers)`

Emitted when the membership cap is updated.




### `EntryFeeCurveUpdated(uint8[] styles, uint32[] rateBps, uint32[] lengths)`

Emitted whenever the entry fee curve configuration changes.




### `PriestChanged(address oldPriest, address newPriest)`

Emitted when the priest address is changed.




### `TreasuryDisbanded(uint256 proposalId, address token, uint256 amount, uint256 perMember, uint256 remainder)`

Emitted when treasury balances are disbanded into a reward pool.




### `ExternalRewardClaimed(address token, address member, uint256 amount)`

Emitted when a member claims external rewards.




### `TemplMetadataUpdated(string name, string description, string logoLink)`

Emitted when templ metadata is updated.




### `ProposalCreationFeeUpdated(uint256 previousFeeBps, uint256 newFeeBps)`

Emitted when the proposal creation fee is updated.




### `ReferralShareBpsUpdated(uint256 previousBps, uint256 newBps)`

Emitted when referral share bps is updated.




### `QuorumBpsUpdated(uint256 previousBps, uint256 newBps)`

Emitted when the quorum threshold is updated via governance.




### `PostQuorumVotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod)`

Emitted when the post‑quorum voting period is updated via governance.




### `BurnAddressUpdated(address previousBurn, address newBurn)`

itted when the burn address is updated via governance.




### `PreQuorumVotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod)`

itted when the default pre‑quorum voting period is updated.




### `DictatorshipModeChanged(bool enabled)`

when dictatorship mode is toggled.





### `Member`


bool joined


uint256 timestamp


uint256 blockNumber


uint256 rewardSnapshot


uint256 joinSequence


### `RewardCheckpoint`


uint64 blockNumber


uint64 timestamp


uint256 cumulative


### `Proposal`


uint256 id


address proposer


enum TemplBase.Action action


address token


address recipient


uint256 amount


string title


string description


string reason


bool joinPaused


uint256 newEntryFee


uint256 newBurnBps


uint256 newTreasuryBps


uint256 newMemberPoolBps


string newTemplName


string newTemplDescription


string newLogoLink


uint256 newProposalCreationFeeBps


uint256 newReferralShareBps


uint256 newMaxMembers


uint256 newQuorumBps


uint256 newPostQuorumVotingPeriod


address newBurnAddress


address externalCallTarget


uint256 externalCallValue


bytes externalCallData


struct CurveConfig curveConfig


uint256 curveBaseEntryFee


uint256 yesVotes


uint256 noVotes


uint256 endTime


uint256 createdAt


bool executed


mapping(address => bool) hasVoted


mapping(address => bool) voteChoice


uint256 eligibleVoters


uint256 postQuorumEligibleVoters


uint256 quorumReachedAt


uint256 quorumSnapshotBlock


bool quorumExempt


bool updateFeeSplit


uint256 preQuorumSnapshotBlock


uint256 preQuorumJoinSequence


uint256 quorumJoinSequence


bool setDictatorship


### `ExternalRewardState`


uint256 poolBalance


uint256 cumulativeRewards


uint256 rewardRemainder


bool exists


struct TemplBase.RewardCheckpoint[] checkpoints



### `Action`





















































