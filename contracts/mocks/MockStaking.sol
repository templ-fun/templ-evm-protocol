// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockStaking
/// @dev Minimal staking contract that pulls tokens from the caller using transferFrom.
contract MockStaking {
    mapping(address => uint256) public staked;

    event Staked(address indexed from, address indexed token, uint256 amount);

    function stake(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        emit Staked(msg.sender, token, amount);
    }
}
