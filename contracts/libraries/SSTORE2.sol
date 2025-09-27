// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Bytecode} from "./utils/Bytecode.sol";

/// @title SSTORE2
/// @notice Read and write persistent bytecode blobs at a fraction of the storage cost.
/// @dev Adapted from https://github.com/0xsequence/sstore2 (MIT licensed).
library SSTORE2 {
    error WriteError();

    /// @notice Stores `_data` and returns the pointer contract address for later retrieval.
    function write(bytes memory _data) internal returns (address pointer) {
        bytes memory code = Bytecode.creationCodeFor(abi.encodePacked(hex"00", _data));
        assembly {
            pointer := create(0, add(code, 0x20), mload(code))
        }
        if (pointer == address(0)) revert WriteError();
    }

    /// @notice Reads the entire contents stored at `_pointer`.
    function read(address _pointer) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, 1, type(uint256).max);
    }

    /// @notice Reads `_pointer` starting at `_start` (bytes offset from the original data).
    function read(address _pointer, uint256 _start) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, _start + 1, type(uint256).max);
    }

    /// @notice Reads `_pointer` inclusive of `_start` and exclusive of `_end`.
    function read(address _pointer, uint256 _start, uint256 _end) internal view returns (bytes memory) {
        return Bytecode.codeAt(_pointer, _start + 1, _end + 1);
    }
}
