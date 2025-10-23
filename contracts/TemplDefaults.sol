// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title TemplDefaults
/// @notice Shared default configuration constants to avoid drift across contracts
library TemplDefaults {
    uint256 internal constant DEFAULT_QUORUM_BPS = 3_300;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
}
