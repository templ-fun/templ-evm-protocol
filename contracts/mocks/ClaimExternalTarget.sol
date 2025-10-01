// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev Minimal mock that satisfies the reentrant token interface and records external claims.
contract ClaimExternalTarget {
    event ExternalClaim(address token, address caller);

    function join() external {}

    function claimMemberRewards() external {}

    function claimExternalReward(address token) external {
        emit ExternalClaim(token, msg.sender);
    }
}
