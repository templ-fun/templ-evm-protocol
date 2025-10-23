// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { TEMPL } from "../TEMPL.sol";
import { CurveConfig, CurveSegment, CurveStyle } from "../TemplCurve.sol";
import { TemplTreasuryModule } from "../TemplTreasury.sol";

/// @dev Harness that triggers onlyDAO externals via self-calls to cover wrapper paths
contract DaoCallerHarness is TEMPL {
    /// @dev Passthrough constructor to base TEMPL
    constructor(
        address priest,
        address protocolFeeRecipient,
        address token,
        uint256 entryFee,
        address membershipModule,
        address treasuryModule,
        address governanceModule
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
            membershipModule,
            treasuryModule,
            governanceModule,
            CurveConfig({
                primary: CurveSegment({ style: CurveStyle.Static, rateBps: 0, length: 0 }),
                additionalSegments: new CurveSegment[](0)
            })
        )
    {}
    /// @notice Wrapper to call withdrawTreasuryDAO via contract self-call
    function daoWithdraw(address token, address recipient, uint256 amount, string calldata reason) external {
        TemplTreasuryModule(address(this)).withdrawTreasuryDAO(token, recipient, amount, reason);
    }

    /// @notice Wrapper to call updateConfigDAO via contract self-call
    function daoUpdate(
        uint256 fee,
        bool updateSplit,
        uint256 burnBps,
        uint256 treasuryBps,
        uint256 memberPoolBps
    ) external {
        TemplTreasuryModule(address(this)).updateConfigDAO(
            fee,
            updateSplit,
            burnBps,
            treasuryBps,
            memberPoolBps
        );
    }
    /// @notice Wrapper to call setJoinPausedDAO via contract self-call
    function daoPause(bool p) external {
        TemplTreasuryModule(address(this)).setJoinPausedDAO(p);
    }
    /// @notice Wrapper to call disbandTreasuryDAO via contract self-call
    function daoDisband(address token) external {
        TemplTreasuryModule(address(this)).disbandTreasuryDAO(token);
    }
    /// @notice Wrapper to call changePriestDAO via contract self-call
    function daoChangePriest(address newPriest) external {
        TemplTreasuryModule(address(this)).changePriestDAO(newPriest);
    }
    /// @notice Wrapper to call setDictatorshipDAO via contract self-call
    function daoSetDictatorship(bool enabled) external {
        TemplTreasuryModule(address(this)).setDictatorshipDAO(enabled);
    }

    /// @notice Wrapper to call setMaxMembersDAO via contract self-call
    function daoSetMaxMembers(uint256 newMax) external {
        TemplTreasuryModule(address(this)).setMaxMembersDAO(newMax);
    }

    /// @notice Wrapper to call setTemplMetadataDAO via contract self-call
    function daoSetMetadata(string calldata newName, string calldata newDescription, string calldata newLogo) external {
        TemplTreasuryModule(address(this)).setTemplMetadataDAO(newName, newDescription, newLogo);
    }

    /// @notice Wrapper to call setProposalCreationFeeBpsDAO via contract self-call
    function daoSetProposalFee(uint256 newFeeBps) external {
        TemplTreasuryModule(address(this)).setProposalCreationFeeBpsDAO(newFeeBps);
    }

    /// @notice Wrapper to call setReferralShareBpsDAO via contract self-call
    function daoSetReferralShare(uint256 newReferralBps) external {
        TemplTreasuryModule(address(this)).setReferralShareBpsDAO(newReferralBps);
    }

    /// @dev Test helper to set action to an undefined value (testing only)
    function setUndefinedAction(uint256 proposalId) external {
        proposals[proposalId].action = Action.Undefined;
    }
}
