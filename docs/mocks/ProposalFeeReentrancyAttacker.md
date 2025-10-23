## `ProposalFeeReentrancyAttacker`



Helper contract that joins a templ and reenters proposal creation when the proposal fee is collected.


### `constructor(address templ_, address token_)` (public)





### `joinTempl(uint256 amount)` (external)





### `approveFee(uint256 amount)` (external)





### `attackCreateProposal()` (external)





### `onProposalFeeCharged()` (external)








