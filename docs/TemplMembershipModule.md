## `TemplMembershipModule`

Handles joins, reward accounting, and member-facing views.




### `onlyDelegatecall()`






### `constructor()` (public)

Initializes the module and captures its own address to enforce delegatecalls.



### `join()` (external)

Join the templ by paying the configured entry fee on behalf of the caller.



### `joinWithReferral(address referral)` (external)

Join the templ by paying the entry fee on behalf of the caller with a referral.




### `joinFor(address recipient)` (external)

Join the templ on behalf of another wallet by covering their entry fee.




### `joinForWithReferral(address recipient, address referral)` (external)

Join the templ for another wallet while crediting a referral.




### `_join(address payer, address recipient, address referral)` (internal)

Shared join workflow that handles accounting updates for new members.




### `getClaimableMemberRewards(address member) → uint256 amount` (public)

Returns the member pool allocation pending for a given wallet.




### `getExternalRewardTokens() → address[] tokens` (external)

Lists ERC-20 (or ETH) reward tokens with active external pools.




### `getExternalRewardState(address token) → uint256 poolBalance, uint256 cumulativeRewards, uint256 remainder` (external)

Returns the global accounting for an external reward token.




### `getClaimableExternalReward(address member, address token) → uint256 amount` (public)

Computes how much of an external reward token a member can claim.




### `claimMemberRewards()` (external)

Claims the caller's accrued share of the member rewards pool.



### `claimExternalReward(address token)` (external)

Claims the caller's accrued share of an external reward token or ETH.




### `isMember(address user) → bool joined` (external)

Reports whether a wallet currently counts as a member.




### `getJoinDetails(address user) → bool joined, uint256 timestamp, uint256 blockNumber` (external)

Returns metadata about when a wallet joined.




### `getTreasuryInfo() → uint256 treasury, uint256 memberPool, address protocolAddress, uint256 burned` (external)

Exposes treasury balances, member pool totals, and protocol receipts.




### `getConfig() → address token, uint256 fee, bool joinPaused, uint256 joins, uint256 treasury, uint256 pool, uint256 burnBpsOut, uint256 treasuryBpsOut, uint256 memberPoolBpsOut, uint256 protocolBpsOut` (external)

Returns high level configuration and aggregate balances for the templ.




### `getMemberCount() → uint256 count` (external)

Returns the number of active members.




### `totalJoins() → uint256 joins` (public)

Historical counter for total successful joins (mirrors member count without storing extra state).




### `getVoteWeight(address voter) → uint256 weight` (external)

Exposes a voter's current vote weight (1 per active member).




### `getExternalRewardTokensPaginated(uint256 offset, uint256 limit) → address[] tokens, bool hasMore` (external)

Returns external reward tokens with pagination to avoid large arrays.





### `ReferralRewardPaid(address referral, address newMember, uint256 amount)`

Emitted when a valid referral is credited during a join.






