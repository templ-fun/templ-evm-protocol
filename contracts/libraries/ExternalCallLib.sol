// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title ExternalCallLib
/// @dev Bubbles up revert data from low-level calls. Using a deployed library helps reduce
///      bytecode size of the calling module.
library ExternalCallLib {
    function perform(address target, uint256 value, bytes memory callData) public returns (bytes memory) {
        (bool success, bytes memory ret) = target.call{ value: value }(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}
