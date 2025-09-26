// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";

/// @title TemplHarness
/// @dev Testing harness that exposes internal helpers for coverage-only assertions
contract TemplHarness is TEMPL {
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent,
        uint256 _quorumPercent,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator,
        uint256 _maxMembers,
        string memory _homeLink
    )
        TEMPL(
            _priest,
            _protocolFeeRecipient,
            _token,
            _entryFee,
            _burnPercent,
            _treasuryPercent,
            _memberPoolPercent,
            _protocolPercent,
            _quorumPercent,
            _executionDelay,
            _burnAddress,
            _priestIsDictator,
            _maxMembers,
            _homeLink
        )
    {}

    /// @dev Clears the member list for zero-member coverage scenarios.
    function harnessClearMemberList() external {
        delete memberList;
    }

    /// @dev Sets member metadata for harness checks.
    function harnessSetMember(
        address member,
        uint256 blockNumber,
        uint256 timestamp,
        bool purchased
    ) external {
        Member storage info = members[member];
        info.block = blockNumber;
        info.timestamp = timestamp;
        info.purchased = purchased;
    }

    /// @dev Exposes the internal snapshot helper for coverage assertions.
    function harnessJoinedAfterSnapshot(
        address member,
        uint256 snapshotBlock,
        uint256 snapshotTimestamp
    ) external view returns (bool) {
        return _joinedAfterSnapshot(members[member], snapshotBlock, snapshotTimestamp);
    }

    /// @dev Clears checkpoints while keeping rewards active for baseline checks.
    function harnessResetExternalRewards(address token, uint256 cumulative) external {
        ExternalRewardState storage rewards = externalRewards[token];
        rewards.exists = true;
        rewards.cumulativeRewards = cumulative;
        delete rewards.checkpoints;
    }

    /// @dev Pushes a checkpoint to drive binary-search branches in tests.
    function harnessPushCheckpoint(
        address token,
        uint64 blockNumber,
        uint64 timestamp,
        uint256 cumulative
    ) external {
        ExternalRewardState storage rewards = externalRewards[token];
        rewards.exists = true;
        rewards.checkpoints.push(
            RewardCheckpoint({blockNumber: blockNumber, timestamp: timestamp, cumulative: cumulative})
        );
    }

    /// @dev Returns the external baseline for a member using the current reward state.
    function harnessExternalBaseline(address token, address member) external view returns (uint256) {
        return _externalBaselineForMember(externalRewards[token], members[member]);
    }

    /// @dev Updates the latest checkpoint within the same block to cover mutation branches.
    function harnessUpdateCheckpointSameBlock(address token, uint256 newCumulative) external {
        ExternalRewardState storage rewards = externalRewards[token];
        rewards.exists = true;
        rewards.checkpoints.push(
            RewardCheckpoint({
                blockNumber: uint64(block.number),
                timestamp: uint64(block.timestamp),
                cumulative: rewards.cumulativeRewards
            })
        );
        rewards.cumulativeRewards = newCumulative;
        _recordExternalCheckpoint(rewards);
    }

    /// @dev Returns the latest checkpoint metadata for assertions.
    function harnessGetLatestCheckpoint(address token)
        external
        view
        returns (uint64 blockNumber, uint64 timestamp, uint256 cumulative)
    {
        ExternalRewardState storage rewards = externalRewards[token];
        uint256 len = rewards.checkpoints.length;
        if (len == 0) {
            return (0, 0, 0);
        }
        RewardCheckpoint storage cp = rewards.checkpoints[len - 1];
        return (cp.blockNumber, cp.timestamp, cp.cumulative);
    }
}
