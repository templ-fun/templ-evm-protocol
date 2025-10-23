## `TemplHarness`



Testing harness that exposes internal helpers for coverage-only assertions


### `constructor(address _priest, address _protocolFeeRecipient, address _token, uint256 _entryFee, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps, uint256 _protocolBps, uint256 _quorumBps, uint256 _executionDelay, address _burnAddress, bool _priestIsDictator, uint256 _maxMembers, string _name, string _description, string _logoLink, uint256 _proposalCreationFeeBps, uint256 _referralShareBps, address _membershipModule, address _treasuryModule, address _governanceModule)` (public)





### `harnessSetMember(address member, uint256 blockNumber, uint256 timestamp, bool joined, uint256 joinSequenceValue)` (external)



Sets member metadata for harness checks.

### `harnessJoinedAfterSnapshot(address member, uint256 snapshotJoinSequence) → bool` (external)



Exposes the internal snapshot helper for coverage assertions.

### `harnessResetExternalRewards(address token, uint256 cumulative)` (external)



Clears checkpoints while keeping rewards active for baseline checks.

### `harnessPushCheckpoint(address token, uint64 blockNumber, uint64 timestamp, uint256 cumulative)` (external)



Pushes a checkpoint to drive binary-search branches in tests.

### `harnessExternalBaseline(address token, address member) → uint256` (external)



Returns the external baseline for a member using the current reward state.

### `harnessUpdateCheckpointSameBlock(address token, uint256 newCumulative)` (external)



Updates the latest checkpoint within the same block to cover mutation branches.

### `harnessGetLatestCheckpoint(address token) → uint64 blockNumber, uint64 timestamp, uint256 cumulative` (external)



Returns the latest checkpoint metadata for assertions.

### `harnessRemoveActiveProposal(uint256 proposalId)` (external)



Exposes the active proposal removal helper to hit guard branches in tests.

### `harnessSeedExternalRemainder(address token, uint256 remainder, uint256 cumulative)` (external)



Seeds an external remainder so flush logic can be exercised under controlled scenarios.

### `harnessFlushExternalRemainders()` (external)



Flushes external remainders for coverage purposes.

### `harnessClearMembers()` (external)



Clears the member count for zero-member edge tests.

### `harnessDisbandTreasury(address token)` (external)



Calls the internal disband helper for branch coverage.

### `harnessRegisterExternalToken(address token)` (external)



Exposes token registration to exercise external reward limits in tests.

### `harnessRemoveExternalToken(address token)` (external)



Invokes the base removal helper for coverage scenarios.




