## `TemplTreasuryModule`

Adds treasury controls, fee configuration, and external reward management.




### `onlyDelegatecall()`






### `constructor()` (public)

Initializes the module and captures its own address to enforce delegatecalls.



### `withdrawTreasuryDAO(address token, address recipient, uint256 amount, string reason)` (external)

Governance action that transfers available treasury or external funds to a recipient.




### `updateConfigDAO(uint256 _entryFee, bool _updateFeeSplit, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps)` (external)

Governance action that updates the entry fee and/or fee split configuration.




### `setJoinPausedDAO(bool _paused)` (external)

Governance action that toggles whether new members can join.




### `setMaxMembersDAO(uint256 _maxMembers)` (external)

Governance action that adjusts the membership cap.




### `disbandTreasuryDAO(address token)` (external)

Governance action that moves treasury balances into the member or external reward pools.




### `changePriestDAO(address newPriest)` (external)

Governance action that appoints a new priest.




### `setDictatorshipDAO(bool enabled)` (external)

Governance action that enables or disables dictatorship mode.


Reverts when the requested state equals the current `priestIsDictator` value.


### `setTemplMetadataDAO(string newName, string newDescription, string newLogoLink)` (external)

Governance action that updates templ metadata.




### `setProposalCreationFeeBpsDAO(uint256 newFeeBps)` (external)

Governance action that updates the proposal creation fee expressed in basis points.




### `setReferralShareBpsDAO(uint256 newReferralBps)` (external)

Governance action that updates the referral share basis points.




### `setEntryFeeCurveDAO(struct CurveConfig curve, uint256 baseEntryFee)` (external)

Governance action that reconfigures the entry fee curve.




### `cleanupExternalRewardToken(address token)` (external)

Removes an empty external reward token so future disbands can reuse the slot.




### `setQuorumBpsDAO(uint256 newQuorumBps)` (external)

Governance action that updates the quorum threshold (bps).


Accepts either 0-100 (interpreted as %) or 0-10_000 (basis points).


### `setPostQuorumVotingPeriodDAO(uint256 newPeriod)` (external)

Governance action that updates the post‑quorum voting period in seconds.




### `setBurnAddressDAO(address newBurn)` (external)

/ @notice Governance action that updates the burn sink address.


Reverts when `newBurn` is the zero address.


### `setPreQuorumVotingPeriodDAO(uint256 newPeriod)` (external)

/ @notice Governance action that updates the default pre‑quorum voting period (seconds).


Governance can reach this setter by proposing a `CallExternal` targeting the TEMPL
     router with the `setPreQuorumVotingPeriodDAO` selector and encoded params.
     The allowed range is [36 hours, 30 days].


### `batchDAO(address[] targets, uint256[] values, bytes[] calldatas) → bytes[] results` (external)

otice Governance action that performs multiple external calls atomically from the templ.


Executes each call in-order. If any call reverts, bubbles up revert data and reverts the whole batch.





