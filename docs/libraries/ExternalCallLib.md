## `ExternalCallLib`

Helpers to perform low-level external calls while bubbling up revert data.


Using a deployed library helps reduce bytecode size of the calling module.


### `perform(address target, uint256 value, bytes callData) → bytes ret` (public)

Performs a low-level call to `target` forwarding `value` and `callData`.







