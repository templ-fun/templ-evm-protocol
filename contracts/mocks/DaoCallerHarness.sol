// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";

/// @dev Harness that triggers onlyDAO externals via self-calls to cover wrapper paths
contract DaoCallerHarness is TEMPL {
    /// @dev Passthrough constructor to base TEMPL
    constructor(address priest, address protocolFeeRecipient, address token, uint256 entryFee)
        TEMPL(priest, protocolFeeRecipient, token, entryFee)
    {}
    /// @notice Wrapper to call withdrawTreasuryDAO via contract self-call
    function daoWithdraw(address token, address recipient, uint256 amount, string calldata reason) external {
        this.withdrawTreasuryDAO(token, recipient, amount, reason);
    }
    /// @notice Wrapper to call withdrawAllTreasuryDAO via contract self-call
    function daoWithdrawAll(address token, address recipient, string calldata reason) external {
        this.withdrawAllTreasuryDAO(token, recipient, reason);
    }
    /// @notice Wrapper to call updateConfigDAO via contract self-call
    function daoUpdate(address token, uint256 fee) external {
        this.updateConfigDAO(token, fee);
    }
    /// @notice Wrapper to call setPausedDAO via contract self-call
    function daoPause(bool p) external {
        this.setPausedDAO(p);
    }
    /// @notice Wrapper to call disbandTreasuryDAO via contract self-call
    function daoDisband() external {
        this.disbandTreasuryDAO();
    }
    /// @dev Test helper to force invalid action path (testing only)
    function corruptAction(uint256 proposalId, uint8 val) external {
        proposals[proposalId].action = Action(val);
    }
}
