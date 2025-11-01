// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev Simple module stub that overrides getMemberCount() with a constant.
///      Used to verify selector re-routing via setRoutingModuleDAO.
contract MockMembershipOverride {
    function getMemberCount() external pure returns (uint256) {
        return 424242;
    }
}

