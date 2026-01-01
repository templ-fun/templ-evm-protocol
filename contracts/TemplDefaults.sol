// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title TemplDefaults
/// @notice Shared default configuration constants to avoid drift across contracts
/// @author templ.fun
library TemplDefaults {
    uint256 internal constant DEFAULT_QUORUM_BPS = 3_300;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 36 hours;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant DEFAULT_YES_VOTE_THRESHOLD_BPS = 5_100;
    uint256 internal constant DEFAULT_INSTANT_QUORUM_BPS = 10_000;
}
