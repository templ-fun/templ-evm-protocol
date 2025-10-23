## `ProposalFeeReentrantToken`



ERC20 token that can call back into a proposal creator while transferFrom executes.
     Used to simulate ERC-777 style tokens with hook-based reentrancy during proposal fee collection.


### `constructor(string name_, string symbol_)` (public)





### `setTempl(address templ_)` (external)





### `setHookTarget(address target)` (external)





### `setHookEnabled(bool enabled)` (external)





### `mint(address to, uint256 amount)` (external)





### `transferFrom(address from, address to, uint256 value) → bool` (public)








