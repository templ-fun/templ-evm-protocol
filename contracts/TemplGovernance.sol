// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title templ governance module
/// @notice Adds proposal creation, voting, and execution flows on top of treasury + membership logic.
contract TemplGovernanceModule is TemplBase {

    /// @notice Opens a proposal to pause or resume new member joins.
    /// @param _paused Desired join pause state.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return Proposal id for tracking and voting.
    function createProposalSetJoinPaused(
        bool _paused,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetJoinPaused;
        p.joinPaused = _paused;
        return id;
    }

    /// @notice Opens a proposal to update entry fee and/or fee split configuration.
    /// @param _token Optional replacement access token (must match current token or zero address).
    /// @param _newEntryFee Optional new entry fee (0 to keep current).
    /// @param _newBurnBps New burn share (bps) when `_updateFeeSplit` is true.
    /// @param _newTreasuryBps New treasury share (bps) when `_updateFeeSplit` is true.
    /// @param _newMemberPoolBps New member pool share (bps) when `_updateFeeSplit` is true.
    /// @param _updateFeeSplit Whether to apply the new split values.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalUpdateConfig(
        address _token,
        uint256 _newEntryFee,
        uint256 _newBurnBps,
        uint256 _newTreasuryBps,
        uint256 _newMemberPoolBps,
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
            _validatePercentSplit(_newBurnBps, _newTreasuryBps, _newMemberPoolBps, protocolBps);
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.UpdateConfig;
        p.token = _token;
        p.newEntryFee = _newEntryFee;
        p.newBurnBps = _newBurnBps;
        p.newTreasuryBps = _newTreasuryBps;
        p.newMemberPoolBps = _newMemberPoolBps;
        p.updateFeeSplit = _updateFeeSplit;
        return id;
    }

    /// @notice Opens a proposal to change the membership cap.
    /// @param _newMaxMembers New membership limit (0 to remove the cap).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetMaxMembers(
        uint256 _newMaxMembers,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newMaxMembers > 0 && _newMaxMembers < memberCount) {
            revert TemplErrors.MemberLimitTooLow();
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetMaxMembers;
        p.newMaxMembers = _newMaxMembers;
        return id;
    }

    /// @notice Opens a proposal to update templ metadata.
    /// @param _newName New templ name.
    /// @param _newDescription New templ description.
    /// @param _newLogoLink New templ logo link.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalUpdateMetadata(
        string calldata _newName,
        string calldata _newDescription,
        string calldata _newLogoLink,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetMetadata;
        p.newTemplName = _newName;
        p.newTemplDescription = _newDescription;
        p.newLogoLink = _newLogoLink;
        return id;
    }

    /// @notice Opens a proposal to update the proposal creation fee basis points.
    function createProposalSetProposalFeeBps(
        uint256 _newFeeBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newFeeBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetProposalFee;
        p.newProposalCreationFeeBps = _newFeeBps;
        return id;
    }

    /// @notice Opens a proposal to update the referral share basis points.
    /// @param _newReferralBps New referral share (bps of member pool allocation).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetReferralShareBps(
        uint256 _newReferralBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newReferralBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetReferralShare;
        p.newReferralShareBps = _newReferralBps;
        return id;
    }

    /// @notice Opens a proposal to update the entry fee curve configuration.
    /// @param _curve New curve configuration to apply.
    /// @param _baseEntryFee Optional replacement base entry fee anchor (0 keeps the current base).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetEntryFeeCurve(
        CurveConfig calldata _curve,
        uint256 _baseEntryFee,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        CurveConfig memory curve = _curve;
        _validateCurveConfig(curve);
        if (_baseEntryFee != 0) {
            _validateEntryFeeAmount(_baseEntryFee);
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetEntryFeeCurve;
        p.curveConfig = curve;
        p.curveBaseEntryFee = _baseEntryFee;
        return id;
    }

    /// @notice Opens a proposal to perform an arbitrary external call through the templ.
    /// @dev Reverts if `_target` is zero or if no calldata is supplied. Any revert
    ///      produced by the downstream call will be bubbled up during execution.
    ///      This is extremely dangerous—frontends surface prominent warnings clarifying that approving
    ///      these proposals grants arbitrary control and may allow the treasury to be drained.
    /// @param _target Destination contract for the call.
    /// @param _value ETH value to forward along with the call.
    /// @param _selector Function selector to invoke on the target.
    /// @param _params ABI-encoded arguments appended to the selector.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalCallExternal(
        address _target,
        uint256 _value,
        bytes4 _selector,
        bytes calldata _params,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_target == address(0)) revert TemplErrors.InvalidRecipient();
        bytes memory callData = abi.encodePacked(_selector, _params);
        // NOTE: External call proposals can execute arbitrary logic; frontends surface explicit warnings so
        //       voters understand these actions may drain treasury funds or otherwise rug the templ.
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.CallExternal;
        p.externalCallTarget = _target;
        p.externalCallValue = _value;
        p.externalCallData = callData;
        return id;
    }

    /// @notice Opens a proposal to withdraw treasury or external funds to a recipient.
    /// @param _token Token to withdraw (`address(0)` for ETH).
    /// @param _recipient Destination wallet for the funds.
    /// @param _amount Amount to withdraw.
    /// @param _reason Free-form text explaining the withdrawal.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
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

    /// @notice Opens a proposal to disband treasury holdings into member or external reward pools.
    /// @param _token Token whose treasury allocation should be disbanded.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
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
        // NOTE: Priest-initiated disband proposals intentionally bypass quorum to allow an inactive templ
        //       (where turnout falls short of quorum) to unwind safely so long as a simple majority still votes yes.
        if (msg.sender == priest) {
            p.quorumExempt = true;
        }
        return id;
    }

    /// @notice Opens a proposal to cleanup an external reward token once fully settled.
    /// @param _token External reward token to cleanup (cannot be the access token).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalCleanupExternalRewardToken(
        address _token,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.CleanupExternalRewardToken;
        p.token = _token;
        return id;
    }

    /// @notice Opens a proposal to appoint a new priest.
    /// @param _newPriest Address proposed as the new priest.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
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

    /// @notice Opens a proposal to enable or disable dictatorship mode.
    /// @param _enable Target dictatorship state.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
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

    /// @notice Casts or updates a vote on a proposal.
    /// @param _proposalId Proposal id to vote on.
    /// @param _support True for YES, false for NO.
    function vote(uint256 _proposalId, bool _support) external onlyMember {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (priestIsDictator && proposal.action != Action.SetDictatorship) {
            revert TemplErrors.DictatorshipEnabled();
        }

        if (block.timestamp >= proposal.endTime) revert TemplErrors.VotingEnded();

        Member storage memberInfo = members[msg.sender];

        if (proposal.quorumReachedAt == 0) {
            if (_joinedAfterSnapshot(memberInfo, proposal.preQuorumJoinSequence)) {
                revert TemplErrors.JoinedAfterProposal();
            }
        } else {
            if (_joinedAfterSnapshot(memberInfo, proposal.quorumJoinSequence)) {
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
                proposal.yesVotes * BPS_DENOMINATOR >= quorumBps * proposal.eligibleVoters
            ) {
                proposal.quorumReachedAt = block.timestamp;
                proposal.quorumSnapshotBlock = block.number;
                proposal.postQuorumEligibleVoters = memberCount;
                // Lock the join sequence to the current value so later joins cannot swing the vote.
                proposal.quorumJoinSequence = joinSequence;
                proposal.endTime = block.timestamp + executionDelayAfterQuorum;
            }
        }

        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }

    /// @notice Executes a passed proposal after quorum (or voting) requirements are satisfied.
    /// @param _proposalId Proposal id to execute.
    function executeProposal(uint256 _proposalId) external nonReentrant {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (priestIsDictator && proposal.action != Action.SetDictatorship) {
            revert TemplErrors.DictatorshipEnabled();
        }

        if (proposal.quorumExempt && block.timestamp < proposal.endTime) {
            revert TemplErrors.VotingNotEnded();
        }
        if (!proposal.quorumExempt) {
            if (proposal.quorumReachedAt == 0) {
                revert TemplErrors.QuorumNotReached();
            }
            if (block.timestamp < proposal.quorumReachedAt + executionDelayAfterQuorum) {
                revert TemplErrors.ExecutionDelayActive();
            }
            if (
                proposal.eligibleVoters != 0 &&
                proposal.yesVotes * BPS_DENOMINATOR < quorumBps * proposal.eligibleVoters
            ) {
                revert TemplErrors.QuorumNotReached();
            }
        }
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();

        if (proposal.yesVotes <= proposal.noVotes) revert TemplErrors.ProposalNotPassed();

        proposal.executed = true;

        address proposerAddr = proposal.proposer;
        if (hasActiveProposal[proposerAddr] && activeProposalId[proposerAddr] == _proposalId) {
            hasActiveProposal[proposerAddr] = false;
            activeProposalId[proposerAddr] = 0;
        }

        bytes memory returnData = hex"";

        if (proposal.action == Action.SetJoinPaused) {
            _governanceSetJoinPaused(proposal.joinPaused);
        } else if (proposal.action == Action.UpdateConfig) {
            _governanceUpdateConfig(
                proposal.token,
                proposal.newEntryFee,
                proposal.updateFeeSplit,
                proposal.newBurnBps,
                proposal.newTreasuryBps,
                proposal.newMemberPoolBps
            );
        } else if (proposal.action == Action.WithdrawTreasury) {
            _governanceWithdrawTreasury(
                proposal.token,
                proposal.recipient,
                proposal.amount,
                proposal.reason,
                _proposalId
            );
        } else if (proposal.action == Action.DisbandTreasury) {
            _governanceDisbandTreasury(proposal.token, _proposalId);
        } else if (proposal.action == Action.ChangePriest) {
            _governanceChangePriest(proposal.recipient);
        } else if (proposal.action == Action.SetDictatorship) {
            _governanceSetDictatorship(proposal.setDictatorship);
        } else if (proposal.action == Action.SetMaxMembers) {
            _governanceSetMaxMembers(proposal.newMaxMembers);
        } else if (proposal.action == Action.SetMetadata) {
            _governanceUpdateMetadata(proposal.newTemplName, proposal.newTemplDescription, proposal.newLogoLink);
        } else if (proposal.action == Action.SetProposalFee) {
            _governanceSetProposalCreationFee(proposal.newProposalCreationFeeBps);
        } else if (proposal.action == Action.SetReferralShare) {
            _governanceSetReferralShareBps(proposal.newReferralShareBps);
        } else if (proposal.action == Action.SetEntryFeeCurve) {
            CurveConfig memory curve = proposal.curveConfig;
            _governanceSetEntryFeeCurve(curve, proposal.curveBaseEntryFee);
        } else if (proposal.action == Action.CallExternal) {
            returnData = _governanceCallExternal(proposal);
        } else if (proposal.action == Action.CleanupExternalRewardToken) {
            _governanceCleanupExternalRewardToken(proposal.token);
        } else {
            revert TemplErrors.InvalidCallData();
        }

        emit ProposalExecuted(_proposalId, true, returnData);
        _removeActiveProposal(_proposalId);
    }

    function _governanceSetJoinPaused(bool _paused) internal {
        _setJoinPaused(_paused);
    }

    function _governanceUpdateConfig(
        address _token,
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps
    ) internal {
        _updateConfig(_token, _entryFee, _updateFeeSplit, _burnBps, _treasuryBps, _memberPoolBps);
    }

    function _governanceWithdrawTreasury(
        address token,
        address recipient,
        uint256 amount,
        string memory reason,
        uint256 proposalId
    ) internal {
        _withdrawTreasury(token, recipient, amount, reason, proposalId);
    }

    function _governanceDisbandTreasury(address token, uint256 proposalId) internal {
        _disbandTreasury(token, proposalId);
    }

    function _governanceChangePriest(address newPriest) internal {
        _changePriest(newPriest);
    }

    function _governanceSetDictatorship(bool enabled) internal {
        _updateDictatorship(enabled);
    }

    function _governanceSetMaxMembers(uint256 newMaxMembers) internal {
        _setMaxMembers(newMaxMembers);
    }

    function _governanceUpdateMetadata(
        string memory newName,
        string memory newDescription,
        string memory newLogoLink
    ) internal {
        _setTemplMetadata(newName, newDescription, newLogoLink);
    }

    function _governanceSetProposalCreationFee(uint256 newFeeBps) internal {
        _setProposalCreationFee(newFeeBps);
    }

    function _governanceSetReferralShareBps(uint256 newBps) internal {
        _setReferralShareBps(newBps);
    }

    function _governanceSetEntryFeeCurve(CurveConfig memory curve, uint256 baseEntryFee) internal {
        _applyCurveUpdate(curve, baseEntryFee);
    }

    function _governanceCleanupExternalRewardToken(address token) internal {
        _cleanupExternalRewardToken(token);
    }

    /// @dev Executes the arbitrary call attached to `proposal` and bubbles up revert data.
    function _governanceCallExternal(Proposal storage proposal) internal returns (bytes memory) {
        address target = proposal.externalCallTarget;
        if (target == address(0)) revert TemplErrors.InvalidRecipient();
        bytes memory callData = proposal.externalCallData;
        if (callData.length == 0) revert TemplErrors.InvalidCallData();
        uint256 callValue = proposal.externalCallValue;
        (bool success, bytes memory returndata) = target.call{value: callValue}(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returndata, 32), mload(returndata))
            }
        }
        delete proposal.externalCallData;
        return returndata;
    }

    /// @notice Returns core metadata for a proposal including vote totals and status.
    /// @param _proposalId Proposal id to inspect.
    /// @return proposer Address that created the proposal.
    /// @return yesVotes Number of YES votes.
    /// @return noVotes Number of NO votes.
    /// @return endTime Timestamp when voting/execution window closes.
    /// @return executed Whether the proposal has been executed.
    /// @return passed Whether the proposal can be executed based on vote outcomes.
    /// @return title On-chain title string.
    /// @return description On-chain description string.
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
            bool quorumMaintained = proposal.eligibleVoters == 0 ||
                proposal.yesVotes * BPS_DENOMINATOR >= quorumBps * proposal.eligibleVoters;
            passed = (block.timestamp >= (proposal.quorumReachedAt + executionDelayAfterQuorum)) &&
                quorumMaintained &&
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

    /// @notice Returns quorum-related snapshot data for a proposal.
    /// @param _proposalId Proposal id to inspect.
    /// @return eligibleVotersPreQuorum Members eligible before quorum was reached.
    /// @return eligibleVotersPostQuorum Members eligible after quorum was reached.
    /// @return preQuorumSnapshotBlock Block recorded when the proposal opened.
    /// @return quorumSnapshotBlock Block recorded when quorum was reached (if any).
    /// @return createdAt Timestamp when the proposal was created.
    /// @return quorumReachedAt Timestamp when quorum was reached (0 when never reached).
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

    /// @notice Returns the join sequence snapshots captured for proposal eligibility.
    /// @param _proposalId Proposal id to inspect.
    /// @return preQuorumJoinSequence Join sequence recorded when the proposal was created.
    /// @return quorumJoinSequence Join sequence recorded when quorum was reached (0 if never reached).
    function getProposalJoinSequences(uint256 _proposalId)
        external
        view
        returns (uint256 preQuorumJoinSequence, uint256 quorumJoinSequence)
    {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        return (proposal.preQuorumJoinSequence, proposal.quorumJoinSequence);
    }

    /// @notice Returns whether a voter participated in a proposal and their recorded choice.
    /// @param _proposalId Proposal id to inspect.
    /// @param _voter Wallet to query.
    /// @return voted True if the voter has cast a ballot.
    /// @return support Recorded support value (false when `voted` is false).
    function hasVoted(
        uint256 _proposalId,
        address _voter
    ) external view returns (bool voted, bool support) {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        return (proposal.hasVoted[_voter], proposal.voteChoice[_voter]);
    }

    /// @notice Lists proposal ids that are still within their active voting/execution window.
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 len = activeProposalIds.length;
        uint256 currentTime = block.timestamp;
        uint256[] memory temp = new uint256[](len);
        uint256 count = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = activeProposalIds[i];
            if (_isActiveProposal(proposals[id], currentTime)) {
                temp[count++] = id;
            }
        }
        uint256[] memory activeIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            activeIds[i] = temp[i];
        }
        return activeIds;
    }

    /// @notice Returns active proposal ids using offset + limit pagination.
    /// @param offset Starting index within the proposal array.
    /// @param limit Maximum number of active proposals to return (capped at 100).
    /// @return proposalIds Active proposal ids discovered in the window.
    /// @return hasMore True when additional active proposals exist beyond the window.
    function getActiveProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory proposalIds,
        bool hasMore
    ) {
        if (limit == 0 || limit > 100) revert TemplErrors.LimitOutOfRange();
        uint256 currentTime = block.timestamp;
        uint256 len = activeProposalIds.length;
        uint256 totalActive = 0;
        for (uint256 i = 0; i < len; i++) {
            if (_isActiveProposal(proposals[activeProposalIds[i]], currentTime)) {
                totalActive++;
            }
        }
        if (offset >= totalActive) {
            return (new uint256[](0), false);
        }

        uint256[] memory tempIds = new uint256[](limit);
        uint256 count = 0;
        uint256 activeSeen = 0;
        for (uint256 i = 0; i < len && count < limit; i++) {
            uint256 id = activeProposalIds[i];
            if (!_isActiveProposal(proposals[id], currentTime)) {
                continue;
            }
            if (activeSeen++ < offset) {
                continue;
            }
            tempIds[count++] = id;
        }

        hasMore = (offset + count) < totalActive;

        proposalIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            proposalIds[i] = tempIds[i];
        }

        return (proposalIds, hasMore);
    }

    /// @dev Creates the base proposal structure, including quorum pre-checks and proposer tracking.
    function _createBaseProposal(
        uint256 _votingPeriod,
        string memory _title,
        string memory _description
    ) internal returns (uint256 proposalId, Proposal storage proposal) {
        if (!members[msg.sender].joined) revert TemplErrors.NotMember();
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
        if (proposalCreationLock[msg.sender]) {
            revert TemplErrors.ActiveProposalExists();
        }
        proposalCreationLock[msg.sender] = true;
        uint256 period = _votingPeriod == 0 ? DEFAULT_VOTING_PERIOD : _votingPeriod;
        if (period < MIN_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooShort();
        if (period > MAX_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooLong();
        uint256 feeBps = proposalCreationFeeBps;
        if (feeBps > 0) {
            uint256 proposalFee = (entryFee * feeBps) / BPS_DENOMINATOR;
            if (proposalFee > 0) {
                _safeTransferFrom(accessToken, msg.sender, address(this), proposalFee);
                treasuryBalance += proposalFee;
            }
        }
        proposalId = proposalCount++;
        proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.title = _title;
        proposal.description = _description;
        proposal.preQuorumSnapshotBlock = block.number;
        // Capture the join sequence so only existing members can vote prior to quorum.
        proposal.preQuorumJoinSequence = joinSequence;
        proposal.executed = false;
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = true;
        proposal.yesVotes = 1;
        proposal.noVotes = 0;
        proposal.eligibleVoters = memberCount;
        proposal.quorumReachedAt = 0;
        proposal.quorumExempt = false;
        if (
            proposal.eligibleVoters != 0 &&
            proposal.yesVotes * BPS_DENOMINATOR >= quorumBps * proposal.eligibleVoters
        ) {
            proposal.quorumReachedAt = block.timestamp;
            proposal.quorumSnapshotBlock = block.number;
            proposal.postQuorumEligibleVoters = proposal.eligibleVoters;
            proposal.quorumJoinSequence = proposal.preQuorumJoinSequence;
            proposal.endTime = block.timestamp + executionDelayAfterQuorum;
        }
        _addActiveProposal(proposalId);
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        emit ProposalCreated(proposalId, msg.sender, proposal.endTime, _title, _description);
        proposalCreationLock[msg.sender] = false;
    }

    /// @notice Removes proposals that are no longer active from the tracked set.
    /// @param maxRemovals Maximum number of entries to prune in this call.
    /// @return removed Number of proposals removed from the active index.
    function pruneInactiveProposals(uint256 maxRemovals) external returns (uint256 removed) {
        if (maxRemovals == 0) {
            return 0;
        }
        uint256 len = activeProposalIds.length;
        if (len == 0) {
            return 0;
        }
        uint256 currentTime = block.timestamp;
        while (len > 0 && removed < maxRemovals) {
            uint256 proposalId = activeProposalIds[len - 1];
            Proposal storage proposal = proposals[proposalId];
            if (_isActiveProposal(proposal, currentTime)) {
                break;
            }
            _removeActiveProposal(proposalId);
            removed++;
            len = activeProposalIds.length;
        }
    }

}
