## `Bytecode`

Helpers for constructing creation code and reading deployed bytecode ranges.





### `creationCodeFor(bytes _code) → bytes` (internal)

Generate creation code that results in a contract with `_code` as bytecode.




### `codeSize(address _addr) → uint256 size` (internal)

Returns the size of the code stored at `_addr`.




### `codeAt(address _addr, uint256 _start, uint256 _end) → bytes code` (internal)

Returns the code stored at `_addr` within the specified window.







