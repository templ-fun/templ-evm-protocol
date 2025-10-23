// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestToken
/// @dev Simple ERC20 token with mint and burn capabilities for testing
contract TestToken is ERC20 {
    uint8 private immutable _decimals;

    /// @dev Construct a test ERC20 with custom decimals
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /// @notice Mint tokens to an address (testing only)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
