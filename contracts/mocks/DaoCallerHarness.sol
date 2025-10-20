// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "../TemplCurve.sol";

/// @dev Harness that triggers onlyDAO externals via self-calls to cover wrapper paths
contract DaoCallerHarness is TEMPL {
    /// @dev Passthrough constructor to base TEMPL
    constructor(
        address priest,
        address protocolFeeRecipient,
        address token,
        uint256 entryFee
    )
        TEMPL(
            priest,
            protocolFeeRecipient,
            token,
            entryFee,
            30,
            30,
            30,
            10,
            33,
            7 days,
            0x000000000000000000000000000000000000dEaD,
            false,
            0,
            "Test Templ",
            "Harness",
            "https://templ.fun/logo.png",
            500,
            0,
            CurveConfig({
                primary: CurveSegment({style: CurveStyle.Static, rateBps: 0})
            })
        )
    {}
    /// @notice Wrapper to call withdrawTreasuryDAO via contract self-call
    function daoWithdraw(address token, address recipient, uint256 amount, string calldata reason) external {
        this.withdrawTreasuryDAO(token, recipient, amount, reason);
    }
    // withdrawAll wrapper removed
    /// @notice Wrapper to call updateConfigDAO via contract self-call
    function daoUpdate(
        address token,
        uint256 fee,
        bool updateSplit,
        uint256 burnPercent,
        uint256 treasuryPercent,
        uint256 memberPoolPercent
    ) external {
        this.updateConfigDAO(token, fee, updateSplit, burnPercent, treasuryPercent, memberPoolPercent);
    }
    /// @notice Wrapper to call setJoinPausedDAO via contract self-call
    function daoPause(bool p) external {
        this.setJoinPausedDAO(p);
    }
    /// @notice Wrapper to call disbandTreasuryDAO via contract self-call
    function daoDisband(address token) external {
        this.disbandTreasuryDAO(token);
    }
    /// @notice Wrapper to call changePriestDAO via contract self-call
    function daoChangePriest(address newPriest) external {
        this.changePriestDAO(newPriest);
    }
    /// @notice Wrapper to call setDictatorshipDAO via contract self-call
    function daoSetDictatorship(bool enabled) external {
        this.setDictatorshipDAO(enabled);
    }

    /// @notice Wrapper to call setMaxMembersDAO via contract self-call
    function daoSetMaxMembers(uint256 newMax) external {
        this.setMaxMembersDAO(newMax);
    }

    /// @notice Wrapper to call setTemplMetadataDAO via contract self-call
    function daoSetMetadata(string calldata newName, string calldata newDescription, string calldata newLogo) external {
        this.setTemplMetadataDAO(newName, newDescription, newLogo);
    }

    /// @notice Wrapper to call setProposalCreationFeeBpsDAO via contract self-call
    function daoSetProposalFee(uint256 newFeeBps) external {
        this.setProposalCreationFeeBpsDAO(newFeeBps);
    }

    /// @notice Wrapper to call setReferralShareBpsDAO via contract self-call
    function daoSetReferralShare(uint256 newReferralBps) external {
        this.setReferralShareBpsDAO(newReferralBps);
    }

    /// @dev Test helper to set action to an undefined value (testing only)
    function setUndefinedAction(uint256 proposalId) external {
        proposals[proposalId].action = Action.Undefined;
    }
}
