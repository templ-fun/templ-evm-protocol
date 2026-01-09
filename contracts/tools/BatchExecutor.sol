// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title BatchExecutor
/// @notice Minimal helper that executes multiple calls in-order and bubbles up reverts atomically.
contract BatchExecutor {
    function execute(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external payable returns (bytes[] memory results) {
        uint256 len = targets.length;
        if (len == 0 || len != values.length || len != calldatas.length) revert();
        uint256 totalValue = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (targets[i] == address(0)) revert();
            totalValue += values[i];
        }
        if (msg.value != totalValue) revert();
        results = new bytes[](len);
        for (uint256 i = 0; i < len; ++i) {
            address target = targets[i];
            (bool success, bytes memory ret) = target.call{value: values[i]}(calldatas[i]);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(ret, 32), mload(ret))
                }
            }
            results[i] = ret;
        }
    }
}
