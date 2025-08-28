// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ReturnEth {
    // Allow contract to receive ETH
    receive() external payable {}

    // Sends specified amount of ETH back to the caller
    function returnToCaller(uint256 amount) external {
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Send failed");
    }
}

