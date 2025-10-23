## `ReentrantToken`



ERC20 token that can reenter TEMPL during token transfers


### `constructor(string name_, string symbol_)` (public)



Construct reentrant test token

### `setTempl(address _templ)` (external)

Set the target TEMPL contract address



### `setCallback(enum ReentrantToken.Callback _callback)` (external)

Configure which callback (if any) to trigger



### `setCallbackToken(address tokenAddress)` (external)

Configure which token address to use for claimExternal reentrancy



### `mint(address to, uint256 amount)` (external)

Mint tokens for testing



### `joinTempl(uint256 amount)` (external)

Helper to join TEMPL by minting and approving tokens



### `joinTemplWithAccessToken(address accessToken, uint256 amount)` (external)

Join TEMPL by spending an external access token already held by this contract



### `transferFrom(address from, address to, uint256 value) → bool` (public)



See {IERC20-transferFrom}.
Skips emitting an {Approval} event indicating an allowance update. This is not
required by the ERC. See {xref-ERC20-_approve-address-address-uint256-bool-}[_approve].
NOTE: Does not update the allowance if the current allowance
is the maximum `uint256`.
Requirements:
- `from` and `to` cannot be the zero address.
- `from` must have a balance of at least `value`.
- the caller must have allowance for ``from``'s tokens of at least
`value`.

### `transfer(address to, uint256 value) → bool` (public)



See {IERC20-transfer}.
Requirements:
- `to` cannot be the zero address.
- the caller must have a balance of at least `value`.




### `Callback`














