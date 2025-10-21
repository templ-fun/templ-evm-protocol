// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CurveConfig} from "../TemplCurve.sol";

/// @notice Shared storage layout and type definitions for templ contracts.
library TemplStorageLib {
    /// @dev Storage slot used by all templ instances to anchor contract state.
    /// @custom:keccak 0xb9c7f1f1a9dee1ec7f4fb855a5551024c6ebe97ed8c5e434f35b43c79cd1c62e
    bytes32 internal constant STORAGE_SLOT = keccak256("templ.storage.v1");

    enum Action {
        SetJoinPaused,
        UpdateConfig,
        WithdrawTreasury,
        DisbandTreasury,
        ChangePriest,
        SetDictatorship,
        SetMaxMembers,
        SetMetadata,
        SetProposalFee,
        SetReferralShare,
        CallExternal,
        SetEntryFeeCurve,
        Undefined
    }

    struct Member {
        bool joined;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 rewardSnapshot;
    }

    struct RewardCheckpoint {
        uint64 blockNumber;
        uint64 timestamp;
        uint256 cumulative;
    }

    struct ExternalRewardState {
        uint256 poolBalance;
        uint256 cumulativeRewards;
        uint256 rewardRemainder;
        bool exists;
        RewardCheckpoint[] checkpoints;
    }

    struct Proposal {
        uint256 id;
        address proposer;
        Action action;
        address token;
        address recipient;
        uint256 amount;
        string title;
        string description;
        string reason;
        bool joinPaused;
        uint256 newEntryFee;
        uint256 newBurnPercent;
        uint256 newTreasuryPercent;
        uint256 newMemberPoolPercent;
        string newTemplName;
        string newTemplDescription;
        string newLogoLink;
        uint256 newProposalCreationFeeBps;
        uint256 newReferralShareBps;
        uint256 newMaxMembers;
        address externalCallTarget;
        uint256 externalCallValue;
        bytes externalCallData;
        CurveConfig curveConfig;
        uint256 curveBaseEntryFee;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 endTime;
        uint256 createdAt;
        bool executed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteChoice;
        uint256 eligibleVoters;
        uint256 postQuorumEligibleVoters;
        uint256 quorumReachedAt;
        uint256 quorumSnapshotBlock;
        bool quorumExempt;
        bool updateFeeSplit;
        uint256 preQuorumSnapshotBlock;
        bool setDictatorship;
    }

    struct Layout {
        uint256 burnPercent;
        uint256 treasuryPercent;
        uint256 memberPoolPercent;
        uint256 protocolPercent;
        address priest;
        address protocolFeeRecipient;
        address accessToken;
        bool priestIsDictator;
        uint256 entryFee;
        uint256 baseEntryFee;
        CurveConfig entryFeeCurve;
        uint256 treasuryBalance;
        uint256 memberPoolBalance;
        bool joinPaused;
        uint256 maxMembers;
        uint256 quorumPercent;
        uint256 executionDelayAfterQuorum;
        address burnAddress;
        string templName;
        string templDescription;
        string templLogoLink;
        uint256 proposalCreationFeeBps;
        uint256 referralShareBps;
        mapping(address => Member) members;
        uint256 memberCount;
        mapping(address => uint256) memberPoolClaims;
        uint256 cumulativeMemberRewards;
        uint256 memberRewardRemainder;
        mapping(address => ExternalRewardState) externalRewards;
        address[] externalRewardTokens;
        mapping(address => uint256) externalRewardTokenIndex;
        mapping(address => mapping(address => uint256)) memberExternalRewardSnapshots;
        uint256 proposalCount;
        mapping(uint256 => Proposal) proposals;
        mapping(address => uint256) activeProposalId;
        mapping(address => bool) hasActiveProposal;
        uint256[] activeProposalIds;
        mapping(uint256 => uint256) activeProposalIndex;
    }

    /// @notice Returns the shared storage layout for the current templ instance.
    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly ("memory-safe") {
            l.slot := slot
        }
    }
}
