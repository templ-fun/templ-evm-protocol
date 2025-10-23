// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Bytecode } from "./utils/Bytecode.sol";

/// @title SSTORE2
/// @notice Read and write persistent bytecode blobs at a fraction of the storage cost.
/// @dev Adapted from https://github.com/0xsequence/sstore2 (MIT licensed).
library SSTORE2 {
    error WriteError();

    /// @notice Stores `_data` and returns the pointer contract address for later retrieval.
    /// @param _data Bytes to persist inside a minimal proxy contract's bytecode.
    /// @return pointer Address of the deployed pointer contract.
    function write(bytes memory _data) internal returns (address pointer) {
        if (_data.length == 0) revert WriteError();
        bytes memory code = Bytecode.creationCodeFor(abi.encodePacked(hex"00", _data));
        assembly ("memory-safe") {
            pointer := create(0, add(code, 0x20), mload(code))
        }
        if (pointer == address(0)) revert WriteError();
    }

    /// @notice Reads the entire contents stored at `_pointer`.
    /// @param _pointer Address of the pointer contract returned by `write`.
    /// @return Bytes payload that was previously written.
    function read(address _pointer) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, 1, type(uint256).max);
    }

    /// @notice Reads `_pointer` starting at `_start` (bytes offset from the original data).
    /// @param _pointer Address of the pointer contract returned by `write`.
    /// @param _start Offset within the original bytes to start reading (0-based).
    /// @return Slice of bytes from `_start` to the end.
    function read(address _pointer, uint256 _start) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, _start + 1, type(uint256).max);
    }

    /// @notice Reads `_pointer` inclusive of `_start` and exclusive of `_end`.
    /// @param _pointer Address of the pointer contract returned by `write`.
    /// @param _start Start offset within the original bytes (inclusive, 0-based).
    /// @param _end End offset within the original bytes (exclusive).
    /// @return Slice of bytes within the requested range.
    function read(address _pointer, uint256 _start, uint256 _end) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, _start + 1, _end + 1);
    }
}
