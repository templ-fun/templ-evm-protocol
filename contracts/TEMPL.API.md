# TEMPL – Public API

## constructor( address _priest, address _protocolFeeRecipient, address _token, uint256 _entryFee )

All members have 1 vote.

Dev: Constructor sets immutable parameters

Params:
- _priest: Temple creator address
- _protocolFeeRecipient: Receives 10% protocol fee
- _token: ERC20 token for membership payments
- _entryFee: Membership cost (minimum 10 and divisible by 10)

## receive() external payable

Accept ETH donations or direct transfers

## function purchaseAccess() external whenNotPaused notSelf nonReentrant

Purchase membership with automatic fee distribution

Dev: Distributes 30% burn, 30% treasury, 30% member pool, 10% protocol

## function _createBaseProposal( string memory _title, string memory _description, uint256 _votingPeriod ) internal returns (uint256 proposalId, Proposal storage proposal)

     Enforces single active proposal per address and seeds quorum metadata.

Dev: Initialize a new proposal with normalized timing and proposer auto‑YES.

Params:
- _title: Human‑readable proposal title
- _description: Detailed description
- _votingPeriod: Voting period in seconds (0 uses default)

Returns:
- proposalId: Newly assigned proposal ID
- proposal: Storage reference to initialized proposal

## function createProposalSetPaused( string memory _title, string memory _description, bool _paused, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to pause or unpause membership purchases.

Params:
- _title: Human‑readable title
- _description: Detailed description
- _paused: Desired paused state
- _votingPeriod: Voting period in seconds (0 uses default)

Returns:
- id: Newly assigned proposal ID

## function createProposalUpdateConfig( string memory _title, string memory _description, uint256 _newEntryFee, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to update contract configuration.

Dev: Token changes are disabled via governance; `_token` remains unchanged.      `_newEntryFee` must be 0 (no change) or a valid value (≥10 and divisible by 10).

Params:
- _title: Title
- _description: Description
- _newEntryFee: New entry fee (0 to keep current)
- _votingPeriod: Voting period in seconds (0 uses default)

Returns:
- id: Newly assigned proposal ID

## function createProposalWithdrawTreasury( string memory _title, string memory _description, address _token, address _recipient, uint256 _amount, string memory _reason, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to withdraw a specific amount from the treasury/donations.

Params:
- _title: Title
- _description: Description
- _token: Asset to withdraw (`address(0)` for ETH)
- _recipient: Destination address
- _amount: Amount to withdraw
- _reason: Human‑readable reason
- _votingPeriod: Voting period in seconds (0 uses default)

Returns:
- id: Newly assigned proposal ID

## function createProposalWithdrawAllTreasury( string memory _title, string memory _description, address _token, address _recipient, string memory _reason, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to withdraw the entire available balance of an asset.

Params:
- _title: Title
- _description: Description
- _token: Asset to withdraw (`address(0)` for ETH)
- _recipient: Destination address
- _reason: Human‑readable reason
- _votingPeriod: Voting period in seconds (0 uses default)

Returns:
- id: Newly assigned proposal ID

## function createProposalDisbandTreasury( string memory _title, string memory _description, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to disband the treasury into the member pool

Dev: If proposed by the priest, quorum is not required

## function createProposalDisbandTreasury( string memory _title, string memory _description, address _token, uint256 _votingPeriod ) external onlyMember returns (uint256)

Create a proposal to disband the full available balance of a token into the member pool

Dev: Currently only the access token is supported for disbanding into the pool

## function vote(uint256 _proposalId, bool _support) external onlyMember

Cast or change a vote on an active proposal

Dev: One vote per member; vote can be changed until deadline

Params:
- _proposalId: Proposal to vote on
- _support: Vote choice (true = yes, false = no)

## function executeProposal(uint256 _proposalId) external nonReentrant

Execute a passed proposal

Dev: Requires simple majority. If quorum is required, execution is allowed only after the delay from first quorum.

Params:
- _proposalId: Proposal to execute

## function withdrawTreasuryDAO( address token, address recipient, uint256 amount, string memory reason ) external onlyDAO

Withdraw assets held by this contract (proposal required)

Dev: Enables the DAO to move entry-fee treasury or tokens/ETH donated via direct transfer

Params:
- token: Asset to withdraw (address(0) for ETH)
- recipient: Address to receive assets
- amount: Amount to withdraw
- reason: Withdrawal explanation

## function withdrawAllTreasuryDAO( address token, address recipient, string memory reason ) external onlyDAO

Withdraw entire balance of a token or ETH held by the contract (proposal required)

Dev: Covers entry-fee treasury and any donated assets

Params:
- token: Asset to withdraw (address(0) for ETH)
- recipient: Address to receive assets
- reason: Withdrawal explanation

## function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO

Update contract configuration via DAO proposal

Params:
- _token: New ERC20 token address (or address(0) to keep current)
- _entryFee: New entry fee amount (or 0 to keep current)

## function setPausedDAO(bool _paused) external onlyDAO

Pause or unpause new memberships via DAO proposal

Params:
- _paused: true to pause, false to unpause

## function disbandTreasuryDAO() external onlyDAO

Distribute all treasury to the member pool equally

Dev: Increases memberPoolBalance and updates reward snapshots

## function disbandTreasuryDAO(address token) external onlyDAO

Distribute the full available balance of a token to the member pool equally (DAO only)

Dev: Currently only the access token is supported; other tokens cannot be pooled

## function _withdrawTreasury( address token, address recipient, uint256 amount, string memory reason, uint256 proposalId ) internal

     Preserves member pool for the access token by limiting to available = balance - pool.

Dev: Internal handler to withdraw a specific amount of an asset.      Emits {TreasuryAction}.      Reverts with InvalidRecipient, AmountZero, InsufficientTreasuryBalance, or ProposalExecutionFailed (for ETH send).

Params:
- token: Asset to withdraw (address(0) for ETH)
- recipient: Recipient address
- amount: Amount to withdraw
- reason: Free‑form description for event logging
- proposalId: Associated proposal ID (0 for direct DAO calls in harness)

## function _withdrawAllTreasury( address token, address recipient, string memory reason, uint256 proposalId ) internal

     For access token, preserves member pool and reduces tracked treasuryBalance up to fee‑sourced portion.

Dev: Internal handler to withdraw the entire available balance of an asset.      Emits {TreasuryAction}.      Reverts with InvalidRecipient or NoTreasuryFunds.

Params:
- token: Asset to withdraw (address(0) for ETH)
- recipient: Recipient address
- reason: Free‑form description for event logging
- proposalId: Associated proposal ID (0 for direct DAO calls in harness)

## function _updateConfig(address _token, uint256 _entryFee) internal

     Emits {ConfigUpdated}.

Dev: Internal config updater. Token changes are disabled; entry fee updates must remain ≥10 and divisible by 10.

Params:
- _token: Must be address(0) or the current access token
- _entryFee: New entry fee or 0 to keep current

## function _setPaused(bool _paused) internal

Dev: Internal pause setter. Emits {ContractPaused}.

Params:
- _paused: True to pause, false to unpause

## function _disbandTreasury(address token, uint256 proposalId) internal

     Updates cumulative rewards and remainder; emits {TreasuryDisbanded}.

Dev: Internal disband: moves all available access token to the member pool equally across all members.      Reverts if token is not the access token, if no funds are available, or if there are no members.

Params:
- token: Must equal the access token
- proposalId: Associated proposal ID (0 for direct DAO calls in harness)

## function getClaimablePoolAmount(address member) public view returns (uint256)

Get unclaimed rewards for a member

Params:
- member: Address to check rewards for

Returns:
- Claimable: token amount from member pool

## function claimMemberPool() external onlyMember nonReentrant

Claim accumulated rewards from the member pool

## function getProposal(uint256 _proposalId) external view returns ( address proposer, string memory title, string memory description, uint256 yesVotes, uint256 noVotes, uint256 endTime, bool executed, bool passed )

Get comprehensive proposal information

Params:
- _proposalId: Proposal ID to query

Returns:
- proposer: Address that created the proposal
- title: Proposal title
- description: Detailed description
- yesVotes: Total weighted yes votes
- noVotes: Total weighted no votes
- endTime: Current deadline/earliest execution time
- executed: Whether proposal has been executed
- passed: Whether proposal is eligible to pass based on timing and votes

## function hasVoted(uint256 _proposalId, address _voter) external view returns (bool voted, bool support)

Check member's vote on a specific proposal

Params:
- _proposalId: Proposal to check
- _voter: Address to check vote for

Returns:
- voted: Whether the address has voted
- support: Vote choice (true = yes, false = no)

## function getActiveProposals() external view returns (uint256[] memory)

Get list of currently active proposals

Dev: Gas usage grows with proposal count; use paginated for large sets

Returns:
- Array: of active proposal IDs

## function getActiveProposalsPaginated( uint256 offset, uint256 limit ) external view returns ( uint256[] memory proposalIds, bool hasMore )

Get paginated list of active proposals

Params:
- offset: Starting position in proposal list
- limit: Maximum proposals to return

Returns:
- proposalIds: Array of active proposal IDs
- hasMore: True if more active proposals exist

## function hasAccess(address user) external view returns (bool)

Check if an address has purchased membership

Params:
- user: Address to check

Returns:
- True: if user has purchased access

## function getPurchaseDetails(address user) external view returns ( bool purchased, uint256 timestamp, uint256 blockNum )

Get membership purchase details for an address

Params:
- user: Address to query

Returns:
- purchased: Whether user has membership
- timestamp: When membership was purchased
- blockNum: Block number of purchase

## function getTreasuryInfo() external view returns ( uint256 treasury, uint256 memberPool, uint256 totalReceived, uint256 totalBurnedAmount, uint256 totalProtocolFees, address protocolAddress )

Get treasury and fee distribution info

Returns:
- treasury: Current DAO treasury balance (available)
- memberPool: Current member pool balance
- totalReceived: Total amount sent to treasury
- totalBurnedAmount: Total tokens burned
- totalProtocolFees: Total protocol fees collected
- protocolAddress: Protocol fee recipient address

## function getConfig() external view returns ( address token, uint256 fee, bool isPaused, uint256 purchases, uint256 treasury, uint256 pool )

Get current contract configuration

Returns:
- token: ERC20 token address for payments
- fee: Membership entry fee amount
- isPaused: Whether purchases are paused
- purchases: Total number of members
- treasury: Current treasury balance (available)
- pool: Current member pool balance

## function getMemberCount() external view returns (uint256)

Get total number of members

Returns:
- Current: member count

## function getVoteWeight(address voter) external view returns (uint256)

Get voting power for a specific address

Params:
- voter: Address to check voting weight for

Returns:
- Current: voting power (0 for non-members, 1 for members)
