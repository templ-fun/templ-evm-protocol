// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "../TemplCurve.sol";
import {TemplTreasuryModule} from "../TemplTreasury.sol";

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
        address governanceModule,
        address councilModule
    )
        TEMPL(
            priest,
            protocolFeeRecipient,
            token,
            entryFee,
            3000,
            3000,
            3000,
            1000,
            3300,
            7 days,
            0x000000000000000000000000000000000000dEaD,
            0,
            "Test Templ",
            "Harness",
            "https://templ.fun/logo.png",
            500,
            0,
            5_100,
            10_000,
            false,
            membershipModule,
            treasuryModule,
            governanceModule,
            councilModule,
            CurveConfig({
                primary: CurveSegment({style: CurveStyle.Static, rateBps: 0, length: 0}),
                additionalSegments: new CurveSegment[](0)
            })
        )
    {}
    /// @notice Wrapper to call withdrawTreasuryDAO via contract self-call
    function daoWithdraw(address token, address recipient, uint256 amount) external {
        TemplTreasuryModule(address(this)).withdrawTreasuryDAO(token, recipient, amount);
    }

    /// @notice Wrapper to call updateConfigDAO via contract self-call
    function daoUpdate(
        uint256 fee,
        bool updateSplit,
        uint256 burnBps,
        uint256 treasuryBps,
        uint256 memberPoolBps
    ) external {
        TemplTreasuryModule(address(this)).updateConfigDAO(fee, updateSplit, burnBps, treasuryBps, memberPoolBps);
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

    /// @notice Wrapper to call setEntryFeeCurveDAO via contract self-call
    function daoSetEntryFeeCurve(CurveConfig calldata curve, uint256 baseEntryFee) external {
        CurveConfig memory config = curve;
        TemplTreasuryModule(address(this)).setEntryFeeCurveDAO(config, baseEntryFee);
    }

    /// @notice Wrapper to call setQuorumBpsDAO via contract self-call
    function daoSetQuorum(uint256 newQuorumBps) external {
        TemplTreasuryModule(address(this)).setQuorumBpsDAO(newQuorumBps);
    }

    /// @notice Wrapper to call setPostQuorumVotingPeriodDAO via contract self-call
    function daoSetPostQuorumVotingPeriod(uint256 newPeriod) external {
        TemplTreasuryModule(address(this)).setPostQuorumVotingPeriodDAO(newPeriod);
    }

    /// @notice Wrapper to call setBurnAddressDAO via contract self-call
    function daoSetBurnAddress(address newBurn) external {
        TemplTreasuryModule(address(this)).setBurnAddressDAO(newBurn);
    }

    /// @notice Wrapper to call setPreQuorumVotingPeriodDAO via contract self-call
    function daoSetPreQuorumVotingPeriod(uint256 newPeriod) external {
        TemplTreasuryModule(address(this)).setPreQuorumVotingPeriodDAO(newPeriod);
    }

    /// @notice Wrapper to call setYesVoteThresholdBpsDAO via contract self-call
    function daoSetYesVoteThreshold(uint256 newThresholdBps) external {
        TemplTreasuryModule(address(this)).setYesVoteThresholdBpsDAO(newThresholdBps);
    }

    /// @notice Wrapper to call setInstantQuorumBpsDAO via contract self-call
    function daoSetInstantQuorum(uint256 newThresholdBps) external {
        TemplTreasuryModule(address(this)).setInstantQuorumBpsDAO(newThresholdBps);
    }

    /// @notice Wrapper to call setCouncilModeDAO via contract self-call
    function daoSetCouncilMode(bool enabled) external {
        TemplTreasuryModule(address(this)).setCouncilModeDAO(enabled);
    }

    /// @notice Wrapper to call addCouncilMemberDAO via contract self-call
    function daoAddCouncilMember(address member) external {
        TemplTreasuryModule(address(this)).addCouncilMemberDAO(member);
    }

    /// @notice Wrapper to call removeCouncilMemberDAO via contract self-call
    function daoRemoveCouncilMember(address member) external {
        TemplTreasuryModule(address(this)).removeCouncilMemberDAO(member);
    }

    /// @notice Wrapper to call sweepMemberPoolRemainderDAO via contract self-call
    function daoSweepMemberPoolRemainder(address recipient) external {
        TemplTreasuryModule(address(this)).sweepMemberPoolRemainderDAO(recipient);
    }

    /// @notice Wrapper to call batchDAO via contract self-call
    function daoBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external returns (bytes[] memory results) {
        return TemplTreasuryModule(address(this)).batchDAO(targets, values, calldatas);
    }

    /// @dev Test helper to set action to an undefined value (testing only)
    function setUndefinedAction(uint256 proposalId) external {
        proposals[proposalId].action = Action.Undefined;
    }
}
