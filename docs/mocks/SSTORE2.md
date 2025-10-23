## `SSTORE2`

Read and write persistent bytecode blobs at a fraction of the storage cost.


Adapted from https://github.com/0xsequence/sstore2 (MIT licensed).


### `write(bytes _data) → address pointer` (internal)

Stores `_data` and returns the pointer contract address for later retrieval.




### `read(address _pointer) → bytes` (internal)

Reads the entire contents stored at `_pointer`.




### `read(address _pointer, uint256 _start) → bytes` (internal)

Reads `_pointer` starting at `_start` (bytes offset from the original data).




### `read(address _pointer, uint256 _start, uint256 _end) → bytes` (internal)

Reads `_pointer` inclusive of `_start` and exclusive of `_end`.







