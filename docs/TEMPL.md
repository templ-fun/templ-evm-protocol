## `TEMPL`

Wires governance, treasury, and membership modules for a single Templ instance.





### `constructor(address _priest, address _protocolFeeRecipient, address _token, uint256 _entryFee, uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps, uint256 _protocolBps, uint256 _quorumBps, uint256 _executionDelay, address _burnAddress, bool _priestIsDictator, uint256 _maxMembers, string _name, string _description, string _logoLink, uint256 _proposalCreationFeeBps, uint256 _referralShareBps, address _membershipModule, address _treasuryModule, address _governanceModule, struct CurveConfig _curve)` (public)

Initializes a new templ with the provided configuration and priest.




### `receive()` (external)

Accepts ETH so proposals can later disburse it as external rewards.



### `getModuleForSelector(bytes4 selector) → address module` (external)

Exposes the module registered for a given function selector.




### `getRegisteredSelectors() → bytes4[] membership, bytes4[] treasury, bytes4[] governance` (external)

Returns the static selector sets handled by each module.


Helpful for tooling and off-chain introspection. These mirror the
     registrations performed in the constructor and do not change at runtime.


### `fallback()` (external)

Fallback routes calls to the registered module for the function selector.



### `getProposalActionData(uint256 _proposalId) → enum TemplBase.Action action, bytes payload` (external)

Returns the action and ABI-encoded payload for a proposal.


See README Proposal Views for payload types per action.


### `_delegateTo(address module)` (internal)

Delegatecalls the registered `module` forwarding calldata and bubbling return/revert data.




### `_registerMembershipSelectors(address module)` (internal)

Registers membership function selectors to dispatch to `module`.




### `_registerTreasurySelectors(address module)` (internal)

Registers treasury function selectors to dispatch to `module`.




### `_registerGovernanceSelectors(address module)` (internal)

Registers governance function selectors to dispatch to `module`.




### `_registerModule(address module, bytes4[] selectors)` (internal)

Assigns each `selectors[i]` to `module` so delegatecalls are routed correctly.







