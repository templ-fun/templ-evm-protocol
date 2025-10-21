// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev Simple target contract used for governance call-through tests.
contract ExternalCallTarget {
    uint256 public storedValue;

    event ValueSet(address indexed caller, uint256 newValue, uint256 ethReceived);

    error ExternalCallFailure(uint256 code);

    function setNumber(uint256 newValue) external returns (uint256) {
        storedValue = newValue;
        emit ValueSet(msg.sender, newValue, 0);
        return newValue + 1;
    }

    function setNumberPayable(uint256 newValue) external payable returns (uint256) {
        storedValue = newValue;
        emit ValueSet(msg.sender, newValue, msg.value);
        return storedValue;
    }

    function willRevert() external pure {
        revert ExternalCallFailure(42);
    }

    receive() external payable {}
}
