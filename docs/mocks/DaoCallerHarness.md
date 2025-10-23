## `DaoCallerHarness`



Harness that triggers onlyDAO externals via self-calls to cover wrapper paths


### `constructor(address priest, address protocolFeeRecipient, address token, uint256 entryFee, address membershipModule, address treasuryModule, address governanceModule)` (public)



Passthrough constructor to base TEMPL

### `daoWithdraw(address token, address recipient, uint256 amount, string reason)` (external)

Wrapper to call withdrawTreasuryDAO via contract self-call



### `daoUpdate(uint256 fee, bool updateSplit, uint256 burnBps, uint256 treasuryBps, uint256 memberPoolBps)` (external)

Wrapper to call updateConfigDAO via contract self-call



### `daoPause(bool p)` (external)

Wrapper to call setJoinPausedDAO via contract self-call



### `daoDisband(address token)` (external)

Wrapper to call disbandTreasuryDAO via contract self-call



### `daoChangePriest(address newPriest)` (external)

Wrapper to call changePriestDAO via contract self-call



### `daoSetDictatorship(bool enabled)` (external)

Wrapper to call setDictatorshipDAO via contract self-call



### `daoSetMaxMembers(uint256 newMax)` (external)

Wrapper to call setMaxMembersDAO via contract self-call



### `daoSetMetadata(string newName, string newDescription, string newLogo)` (external)

Wrapper to call setTemplMetadataDAO via contract self-call



### `daoSetProposalFee(uint256 newFeeBps)` (external)

Wrapper to call setProposalCreationFeeBpsDAO via contract self-call



### `daoSetReferralShare(uint256 newReferralBps)` (external)

Wrapper to call setReferralShareBpsDAO via contract self-call



### `setUndefinedAction(uint256 proposalId)` (external)



Test helper to set action to an undefined value (testing only)




