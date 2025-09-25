// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplTreasury} from "./TemplTreasury.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplGovernance is TemplTreasury {
    constructor(
        address _protocolFeeRecipient,
        address _accessToken,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent,
        uint256 _quorumPercent,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator
    ) TemplTreasury(
        _protocolFeeRecipient,
        _accessToken,
        _burnPercent,
        _treasuryPercent,
        _memberPoolPercent,
        _protocolPercent,
        _quorumPercent,
        _executionDelay,
        _burnAddress,
        _priestIsDictator
    ) {}

    function createProposalSetPaused(
        bool _paused,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetPaused;
        p.paused = _paused;
        return id;
    }

    function createProposalUpdateConfig(
        uint256 _newEntryFee,
        uint256 _newBurnPercent,
        uint256 _newTreasuryPercent,
        uint256 _newMemberPoolPercent,
        bool _updateFeeSplit,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newEntryFee > 0) {
            if (_newEntryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_newEntryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        }
        if (_updateFeeSplit) {
            _validatePercentSplit(_newBurnPercent, _newTreasuryPercent, _newMemberPoolPercent, protocolPercent);
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.UpdateConfig;
        p.newEntryFee = _newEntryFee;
        p.newBurnPercent = _newBurnPercent;
        p.newTreasuryPercent = _newTreasuryPercent;
        p.newMemberPoolPercent = _newMemberPoolPercent;
        p.updateFeeSplit = _updateFeeSplit;
        return id;
    }

    function createProposalSetMaxMembers(
        uint256 _newMaxMembers,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newMaxMembers > 0 && _newMaxMembers < memberList.length) {
            revert TemplErrors.MemberLimitTooLow();
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetMaxMembers;
        p.newMaxMembers = _newMaxMembers;
        return id;
    }

    function createProposalWithdrawTreasury(
        address _token,
        address _recipient,
        uint256 _amount,
        string memory _reason,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.WithdrawTreasury;
        p.token = _token;
        p.recipient = _recipient;
        p.amount = _amount;
        p.reason = _reason;
        return id;
    }

    function createProposalDisbandTreasury(
        address _token,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.DisbandTreasury;
        p.token = _token;
        if (msg.sender == priest) {
            p.quorumExempt = true;
        }
        return id;
    }

    function createProposalChangePriest(
        address _newPriest,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (_newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.ChangePriest;
        p.recipient = _newPriest;
        return id;
    }

    function createProposalSetDictatorship(
        bool _enable,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator == _enable) revert TemplErrors.DictatorshipUnchanged();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetDictatorship;
        p.setDictatorship = _enable;
        return id;
    }

    function vote(uint256 _proposalId, bool _support) external onlyMember {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (priestIsDictator && proposal.action != Action.SetDictatorship) {
            revert TemplErrors.DictatorshipEnabled();
        }

        if (block.timestamp >= proposal.endTime) revert TemplErrors.VotingEnded();

        Member storage memberInfo = members[msg.sender];

        if (proposal.quorumReachedAt == 0) {
            if (_joinedAfterSnapshot(memberInfo, proposal.preQuorumSnapshotBlock, proposal.createdAt)) {
                revert TemplErrors.JoinedAfterProposal();
            }
        } else {
            if (_joinedAfterSnapshot(memberInfo, proposal.quorumSnapshotBlock, proposal.quorumReachedAt)) {
                revert TemplErrors.JoinedAfterProposal();
            }
        }

        bool hadVoted = proposal.hasVoted[msg.sender];
        bool previous = proposal.voteChoice[msg.sender];

        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = _support;

        if (!hadVoted) {
            if (_support) {
                proposal.yesVotes += 1;
            } else {
                proposal.noVotes += 1;
            }
        } else if (previous != _support) {
            if (previous) {
                proposal.yesVotes -= 1;
                proposal.noVotes += 1;
            } else {
                proposal.noVotes -= 1;
                proposal.yesVotes += 1;
            }
        }

        if (!proposal.quorumExempt && proposal.quorumReachedAt == 0) {
            if (
                proposal.eligibleVoters != 0 &&
                proposal.yesVotes * 100 >= quorumPercent * proposal.eligibleVoters
            ) {
                proposal.quorumReachedAt = block.timestamp;
                proposal.quorumSnapshotBlock = block.number;
                proposal.postQuorumEligibleVoters = memberList.length;
                proposal.endTime = block.timestamp + executionDelayAfterQuorum;
            }
        }

        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }

    function executeProposal(uint256 _proposalId) external nonReentrant {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (priestIsDictator && proposal.action != Action.SetDictatorship) {
            revert TemplErrors.DictatorshipEnabled();
        }

        if (!proposal.quorumExempt) {
            if (proposal.quorumReachedAt == 0) {
                revert TemplErrors.QuorumNotReached();
            }
            if (block.timestamp < proposal.quorumReachedAt + executionDelayAfterQuorum) {
                revert TemplErrors.ExecutionDelayActive();
            }
        } else {
            if (block.timestamp < proposal.endTime) revert TemplErrors.VotingNotEnded();
        }
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();

        if (proposal.yesVotes <= proposal.noVotes) revert TemplErrors.ProposalNotPassed();

        proposal.executed = true;

        address proposerAddr = proposal.proposer;
        if (hasActiveProposal[proposerAddr] && activeProposalId[proposerAddr] == _proposalId) {
            hasActiveProposal[proposerAddr] = false;
            activeProposalId[proposerAddr] = 0;
        }

        if (proposal.action == Action.SetPaused) {
            _setPaused(proposal.paused);
        } else if (proposal.action == Action.UpdateConfig) {
            _updateConfig(
                proposal.token,
                proposal.newEntryFee,
                proposal.updateFeeSplit,
                proposal.newBurnPercent,
                proposal.newTreasuryPercent,
                proposal.newMemberPoolPercent
            );
        } else if (proposal.action == Action.WithdrawTreasury) {
            _withdrawTreasury(proposal.token, proposal.recipient, proposal.amount, proposal.reason, _proposalId);
        } else if (proposal.action == Action.DisbandTreasury) {
            _disbandTreasury(proposal.token, _proposalId);
        } else if (proposal.action == Action.ChangePriest) {
            _changePriest(proposal.recipient);
        } else if (proposal.action == Action.SetDictatorship) {
            _updateDictatorship(proposal.setDictatorship);
        } else if (proposal.action == Action.SetMaxMembers) {
            _setMaxMembers(proposal.newMaxMembers);
        } else {
            revert TemplErrors.InvalidCallData();
        }

        emit ProposalExecuted(_proposalId, true, hex"");
    }

    function getProposal(uint256 _proposalId) external view returns (
        address proposer,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 endTime,
        bool executed,
        bool passed,
        string memory title,
        string memory description
    ) {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.quorumExempt) {
            passed = block.timestamp >= proposal.endTime && proposal.yesVotes > proposal.noVotes;
        } else if (proposal.quorumReachedAt != 0) {
            passed = (block.timestamp >= (proposal.quorumReachedAt + executionDelayAfterQuorum)) &&
                (proposal.yesVotes > proposal.noVotes);
        } else {
            passed = false;
        }

        return (
            proposal.proposer,
            proposal.yesVotes,
            proposal.noVotes,
            proposal.endTime,
            proposal.executed,
            passed,
            proposal.title,
            proposal.description
        );
    }

    function getProposalSnapshots(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 eligibleVotersPreQuorum,
            uint256 eligibleVotersPostQuorum,
            uint256 preQuorumSnapshotBlock,
            uint256 quorumSnapshotBlock,
            uint256 createdAt,
            uint256 quorumReachedAt
        )
    {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        return (
            proposal.eligibleVoters,
            proposal.postQuorumEligibleVoters,
            proposal.preQuorumSnapshotBlock,
            proposal.quorumSnapshotBlock,
            proposal.createdAt,
            proposal.quorumReachedAt
        );
    }

    function hasVoted(
        uint256 _proposalId,
        address _voter
    ) external view returns (bool voted, bool support) {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        return (proposal.hasVoted[_voter], proposal.voteChoice[_voter]);
    }

    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 pc = proposalCount;
        uint256 currentTime = block.timestamp;
        uint256 activeCount = 0;

        for (uint256 i = 0; i < pc; i++) {
            if (_isActiveProposal(proposals[i], currentTime)) {
                activeCount++;
            }
        }

        uint256[] memory activeIds = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < pc; i++) {
            if (_isActiveProposal(proposals[i], currentTime)) {
                activeIds[index++] = i;
            }
        }

        return activeIds;
    }

    function getActiveProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory proposalIds,
        bool hasMore
    ) {
        if (limit == 0 || limit > 100) revert TemplErrors.LimitOutOfRange();
        if (offset >= proposalCount) {
            return (new uint256[](0), false);
        }

        uint256 currentTime = block.timestamp;
        uint256[] memory tempIds = new uint256[](limit);
        uint256 count = 0;
        uint256 scanned = offset;

        for (uint256 i = offset; i < proposalCount && count < limit; i++) {
            if (_isActiveProposal(proposals[i], currentTime)) {
                tempIds[count++] = i;
            }
            scanned = i + 1;
        }

        if (count == limit && scanned < proposalCount) {
            for (uint256 i = scanned; i < proposalCount; i++) {
                if (_isActiveProposal(proposals[i], currentTime)) {
                    hasMore = true;
                    break;
                }
            }
        }

        proposalIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            proposalIds[i] = tempIds[i];
        }

        return (proposalIds, hasMore);
    }

    function _createBaseProposal(
        uint256 _votingPeriod,
        string memory _title,
        string memory _description
    ) internal returns (uint256 proposalId, Proposal storage proposal) {
        if (!members[msg.sender].purchased) revert TemplErrors.NotMember();
        if (hasActiveProposal[msg.sender]) {
            uint256 existingId = activeProposalId[msg.sender];
            Proposal storage existingProposal = proposals[existingId];
            if (!existingProposal.executed && block.timestamp < existingProposal.endTime) {
                revert TemplErrors.ActiveProposalExists();
            } else {
                hasActiveProposal[msg.sender] = false;
                activeProposalId[msg.sender] = 0;
            }
        }
        uint256 period = _votingPeriod == 0 ? DEFAULT_VOTING_PERIOD : _votingPeriod;
        if (period < MIN_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooShort();
        if (period > MAX_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooLong();
        proposalId = proposalCount++;
        proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.title = _title;
        proposal.description = _description;
        proposal.preQuorumSnapshotBlock = block.number;
        proposal.executed = false;
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = true;
        proposal.yesVotes = 1;
        proposal.noVotes = 0;
        proposal.eligibleVoters = memberList.length;
        proposal.quorumReachedAt = 0;
        proposal.quorumExempt = false;
        if (
            proposal.eligibleVoters != 0 &&
            proposal.yesVotes * 100 >= quorumPercent * proposal.eligibleVoters
        ) {
            proposal.quorumReachedAt = block.timestamp;
            proposal.quorumSnapshotBlock = block.number;
            proposal.postQuorumEligibleVoters = proposal.eligibleVoters;
            proposal.endTime = block.timestamp + executionDelayAfterQuorum;
        }
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        emit ProposalCreated(proposalId, msg.sender, proposal.endTime, _title, _description);
    }

    function _joinedAfterSnapshot(
        Member storage memberInfo,
        uint256 snapshotBlock,
        uint256 snapshotTimestamp
    ) internal view returns (bool) {
        if (snapshotBlock == 0) {
            return false;
        }
        if (memberInfo.block > snapshotBlock) {
            return true;
        }
        if (memberInfo.block == snapshotBlock && memberInfo.timestamp > snapshotTimestamp) {
            return true;
        }
        return false;
    }

    function _isActiveProposal(Proposal storage proposal, uint256 currentTime) internal view returns (bool) {
        return currentTime < proposal.endTime && !proposal.executed;
    }
}
