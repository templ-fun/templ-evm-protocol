// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "../TemplCurve.sol";

/// @title TemplHarness
/// @dev Testing harness that exposes internal helpers for coverage-only assertions
contract TemplHarness is TEMPL {
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps,
        uint256 _protocolBps,
        uint256 _quorumBps,
        uint256 _executionDelay,
        address _burnAddress,
        uint256 _maxMembers,
        string memory _name,
        string memory _description,
        string memory _logoLink,
        uint256 _proposalCreationFeeBps,
        uint256 _referralShareBps,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule,
        address _councilModule
    )
        TEMPL(
            _priest,
            _protocolFeeRecipient,
            _token,
            _entryFee,
            _burnBps,
            _treasuryBps,
            _memberPoolBps,
            _protocolBps,
            _quorumBps,
            _executionDelay,
            _burnAddress,
            _maxMembers,
            _name,
            _description,
            _logoLink,
            _proposalCreationFeeBps,
            _referralShareBps,
            5_100,
            10_000,
            false,
            _membershipModule,
            _treasuryModule,
            _governanceModule,
            _councilModule,
            CurveConfig({
                primary: CurveSegment({style: CurveStyle.Static, rateBps: 0, length: 0}),
                additionalSegments: new CurveSegment[](0)
            })
        )
    {}

    /// @dev Sets member metadata for harness checks.
    function harnessSetMember(
        address member,
        uint256 blockNumber,
        uint256 timestamp,
        bool joined,
        uint256 joinSequenceValue
    ) external {
        Member storage info = members[member];
        info.blockNumber = blockNumber;
        info.timestamp = timestamp;
        info.joined = joined;
        info.joinSequence = joinSequenceValue;
    }

    /// @dev Exposes the internal snapshot helper for coverage assertions.
    function harnessJoinedAfterSnapshot(address member, uint256 snapshotJoinSequence) external view returns (bool) {
        return _joinedAfterSnapshot(members[member], snapshotJoinSequence);
    }

    /// @dev Exposes the active proposal removal helper to hit guard branches in tests.
    function harnessRemoveActiveProposal(uint256 proposalId) external {
        _removeActiveProposal(proposalId);
    }

    /// @dev Clears the member count for zero-member edge tests.
    function harnessClearMembers() external {
        memberCount = 0;
        joinSequence = 0;
    }

    /// @dev Calls the internal disband helper for branch coverage.
    function harnessDisbandTreasury(address token) external {
        _disbandTreasury(token, 0);
    }

    // ---- Internal math helpers exposure for coverage ----
    function harnessScaleInverse(uint256 amount, uint256 divisor) external pure returns (uint256) {
        return _scaleInverse(amount, divisor);
    }

    function harnessScaleForward(uint256 amount, uint256 multiplier) external pure returns (uint256) {
        return _scaleForward(amount, multiplier);
    }

    function harnessMulWouldOverflow(uint256 a, uint256 b) external pure returns (bool) {
        return _mulWouldOverflow(a, b);
    }
}
