// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title Templ Governance Module
/// @notice Adds proposal creation, voting, and execution flows on top of treasury + membership logic.
/// @author templ.fun
contract TemplGovernanceModule is TemplBase {
    /// @notice Sentinel used to detect direct calls to the module implementation.
    address public immutable SELF;
    /// @notice Bound on how many inactive proposals to prune from the tail after each execution.
    /// @dev Keeps the active proposals index tidy without risking excessive gas on heavy executions.
    uint256 internal constant EXECUTION_TAIL_PRUNE = 5;

    /// @notice Initializes the module and captures its own address to enforce delegatecalls.
    constructor() {
        SELF = address(this);
    }

    /// @notice Opens a proposal to pause or resume new member joins.
    /// @param _paused Desired join pause state.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Proposal id for tracking and voting.
    function createProposalSetJoinPaused(
        bool _paused,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetJoinPaused;
        p.joinPaused = _paused;
        return id;
    }

    /// @notice Opens a proposal to update entry fee and/or fee split configuration.
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
        uint256 _newEntryFee,
        uint256 _newBurnBps,
        uint256 _newTreasuryBps,
        uint256 _newMemberPoolBps,
        bool _updateFeeSplit,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_newEntryFee > 0) {
            if (_newEntryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_newEntryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        }
        if (_updateFeeSplit) {
            _validatePercentSplit(_newBurnBps, _newTreasuryBps, _newMemberPoolBps, protocolBps);
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.UpdateConfig;
        p.newEntryFee = _newEntryFee;
        p.newBurnBps = _newBurnBps;
        p.newTreasuryBps = _newTreasuryBps;
        p.newMemberPoolBps = _newMemberPoolBps;
        p.updateFeeSplit = _updateFeeSplit;
        return id;
    }

    /// @notice Opens a proposal to change the membership cap.
    /// @dev Reverts when the requested cap is below the current `memberCount`.
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetMetadata;
        p.newTemplName = _newName;
        p.newTemplDescription = _newDescription;
        p.newLogoLink = _newLogoLink;
        return id;
    }

    /// @notice Opens a proposal to update the quorum threshold in basis points.
    /// @param _newQuorumBps New quorum threshold (0-10_000 bps).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetQuorumBps(
        uint256 _newQuorumBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_newQuorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetQuorumBps;
        p.newQuorumBps = _newQuorumBps;
        return id;
    }

    /// @notice Opens a proposal to update the instant quorum threshold in basis points.
    /// @param _newInstantQuorumBps New instant quorum threshold (1-10_000 bps).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetInstantQuorumBps(
        uint256 _newInstantQuorumBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_newInstantQuorumBps == 0 || _newInstantQuorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetInstantQuorumBps;
        p.newInstantQuorumBps = _newInstantQuorumBps;
        return id;
    }

    /// @notice Opens a proposal to update the post-quorum voting period in seconds.
    /// @param _newPeriodSeconds New period (seconds) applied after quorum before execution.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetPostQuorumVotingPeriod(
        uint256 _newPeriodSeconds,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetPostQuorumVotingPeriod;
        p.newPostQuorumVotingPeriod = _newPeriodSeconds;
        return id;
    }

    /// @notice Opens a proposal to update the burn sink address.
    /// @dev Reverts when `_newBurn` is the zero address.
    /// @param _newBurn Address that will receive burn allocations.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetBurnAddress(
        address _newBurn,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_newBurn == address(0)) revert TemplErrors.InvalidRecipient();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetBurnAddress;
        p.newBurnAddress = _newBurn;
        return id;
    }

    /// @notice Opens a proposal to update the proposal creation fee basis points.
    /// @param _newFeeBps New proposal creation fee (bps of current entry fee).
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalSetProposalFeeBps(
        uint256 _newFeeBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        CurveConfig memory curve = _curve;
        _validateCurveConfig(curve);
        if (_baseEntryFee != 0) {
            _validateBaseEntryFeeAmount(_baseEntryFee);
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetEntryFeeCurve;
        p.curveConfig = curve;
        p.curveBaseEntryFee = _baseEntryFee;
        return id;
    }

    /// @notice Opens a proposal to perform an arbitrary external call through the templ.
    /// @dev Reverts if `_target` is zero or if calldata exceeds the max size. Any revert
    ///      produced by the downstream call will be bubbled up during execution.
    ///      This is extremely dangerous; frontends surface prominent warnings clarifying that approving
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_target == address(0)) revert TemplErrors.InvalidRecipient();
        if (_params.length > MAX_EXTERNAL_CALLDATA_BYTES - 4) revert TemplErrors.InvalidCallData();
        bytes memory callData = abi.encodePacked(_selector, _params);
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
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    function createProposalWithdrawTreasury(
        address _token,
        address _recipient,
        uint256 _amount,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.WithdrawTreasury;
        p.token = _token;
        p.recipient = _recipient;
        p.amount = _amount;
        return id;
    }

    /// @notice Opens a proposal to disband treasury holdings into the member pool or protocol sweep.
    /// @param _token Token whose treasury allocation should be disbanded.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal identifier.
    /// @dev If the proposer is the `priest`, or a council member while council mode is enabled, the
    ///      proposal is quorum-exempt to allow an otherwise inactive templ (insufficient turnout)
    ///      to unwind with a simple majority.
    function createProposalDisbandTreasury(
        address _token,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.DisbandTreasury;
        p.token = _token;
        if (msg.sender == priest || (councilModeEnabled && councilMembers[msg.sender])) {
            p.quorumExempt = true;
        }
        return id;
    }

    /// @notice Opens a proposal to appoint a new priest.
    /// @dev Reverts when `_newPriest` is the zero address.
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
    ) external nonReentrant returns (uint256 proposalId) {
        _requireDelegatecall();
        if (_newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.ChangePriest;
        p.recipient = _newPriest;
        return id;
    }

    /// @notice Casts or updates a vote on a proposal.
    /// @param _proposalId Proposal id to vote on.
    /// @param _support True for YES, false for NO.
    /// @dev Prior to quorum, eligibility is locked to the join sequence captured at proposal creation.
    ///      Once quorum is reached, eligibility is re-snapshotted to prevent later joins from swinging the vote.
    function vote(uint256 _proposalId, bool _support) external nonReentrant onlyMember {
        _requireDelegatecall();
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (!(block.timestamp < proposal.endTime)) revert TemplErrors.VotingEnded();

        Member storage memberInfo = members[msg.sender];

        uint256 councilSnapshotEpoch = proposal.councilSnapshotEpoch;
        if (councilSnapshotEpoch != 0 && !_isCouncilMemberAtEpoch(msg.sender, councilSnapshotEpoch)) {
            revert TemplErrors.NotCouncil();
        }

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

        unchecked {
            if (!hadVoted) {
                if (_support) {
                    ++proposal.yesVotes;
                } else {
                    ++proposal.noVotes;
                }
            } else if (previous != _support) {
                if (previous) {
                    --proposal.yesVotes;
                    ++proposal.noVotes;
                } else {
                    --proposal.noVotes;
                    ++proposal.yesVotes;
                }
            }
        }

        if (!proposal.quorumExempt && proposal.quorumReachedAt == 0) {
            if (proposal.eligibleVoters != 0) {
                unchecked {
                    if (!(proposal.yesVotes * BPS_DENOMINATOR < proposal.quorumBpsSnapshot * proposal.eligibleVoters)) {
                        proposal.quorumReachedAt = block.timestamp;
                        proposal.quorumSnapshotBlock = block.number;
                        proposal.postQuorumEligibleVoters = councilSnapshotEpoch == 0
                            ? memberCount
                            : proposal.eligibleVoters;
                        proposal.quorumJoinSequence = joinSequence;
                        proposal.endTime = block.timestamp + proposal.postQuorumVotingPeriodSnapshot;
                    }
                }
            }
        }

        _maybeTriggerInstantQuorum(proposal);

        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }

    /// @notice Executes a passed proposal after quorum (or voting) requirements are satisfied.
    /// @param _proposalId Proposal id to execute.
    /// @dev For quorum-gated proposals, the `endTime` captured at quorum anchors the post-quorum voting window
    ///      to prevent mid-flight changes from affecting execution timing. After execution, the
    ///      active proposals index opportunistically prunes up to `EXECUTION_TAIL_PRUNE` inactive
    ///      entries from its tail to keep the set compact.
    function executeProposal(uint256 _proposalId) external nonReentrant {
        _requireDelegatecall();
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        bool instant = proposal.instantQuorumMet;
        if (proposal.quorumExempt && block.timestamp < proposal.endTime) {
            revert TemplErrors.VotingNotEnded();
        }
        if (!proposal.quorumExempt) {
            if (proposal.quorumReachedAt == 0 && !instant) {
                revert TemplErrors.QuorumNotReached();
            }
            if (!instant && block.timestamp < proposal.endTime) {
                revert TemplErrors.ExecutionDelayActive();
            }
            uint256 denom = proposal.postQuorumEligibleVoters;
            if (denom != 0 && !instant && proposal.yesVotes * BPS_DENOMINATOR < proposal.quorumBpsSnapshot * denom) {
                revert TemplErrors.QuorumNotReached();
            }
        }
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();

        if (!_meetsYesVoteThreshold(proposal.yesVotes, proposal.noVotes, proposal.yesVoteThresholdBpsSnapshot)) {
            revert TemplErrors.ProposalNotPassed();
        }

        proposal.executed = true;

        address proposerAddr = proposal.proposer;
        if (hasActiveProposal[proposerAddr] && activeProposalId[proposerAddr] == _proposalId) {
            hasActiveProposal[proposerAddr] = false;
            activeProposalId[proposerAddr] = 0;
        }

        bytes memory returnData = _executeActionInternal(_proposalId);

        emit ProposalExecuted(_proposalId, true, keccak256(returnData));
        _removeActiveProposal(_proposalId);
        _pruneInactiveTail(EXECUTION_TAIL_PRUNE);
    }

    /// @notice Cancels an active proposal before any other members vote.
    /// @param _proposalId Proposal id to cancel.
    function cancelProposal(uint256 _proposalId) external nonReentrant {
        _requireDelegatecall();
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();
        if (proposal.proposer != msg.sender) revert TemplErrors.InvalidCallData();
        if (!(block.timestamp < proposal.endTime)) revert TemplErrors.VotingEnded();

        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;
        uint256 allowedVotes = proposal.hasVoted[msg.sender] ? 1 : 0;
        if (totalVotes > allowedVotes) revert TemplErrors.InvalidCallData();

        proposal.executed = true;
        proposal.endTime = block.timestamp;

        address proposerAddr = proposal.proposer;
        if (hasActiveProposal[proposerAddr] && activeProposalId[proposerAddr] == _proposalId) {
            hasActiveProposal[proposerAddr] = false;
            activeProposalId[proposerAddr] = 0;
        }

        emit ProposalCancelled(_proposalId, msg.sender);
        _removeActiveProposal(_proposalId);
        _pruneInactiveTail(EXECUTION_TAIL_PRUNE);
    }

    /// @notice Executes the action for `_proposalId` and returns any call return data.
    /// @param _proposalId Proposal id whose action should be executed.
    /// @return returnData ABI-encoded return data for CallExternal actions, empty otherwise.
    function _executeActionInternal(uint256 _proposalId) internal returns (bytes memory returnData) {
        Proposal storage proposal = proposals[_proposalId];
        returnData = hex"";
        if (proposal.action == Action.CallExternal) {
            returnData = _governanceCallExternal(proposal);
        } else if (proposal.action == Action.UpdateConfig) {
            _governanceUpdateConfig(
                proposal.newEntryFee,
                proposal.updateFeeSplit,
                proposal.newBurnBps,
                proposal.newTreasuryBps,
                proposal.newMemberPoolBps
            );
        } else if (proposal.action == Action.WithdrawTreasury) {
            _governanceWithdrawTreasury(proposal.token, proposal.recipient, proposal.amount, _proposalId);
        } else if (proposal.action == Action.DisbandTreasury) {
            _governanceDisbandTreasury(proposal.token, _proposalId);
        } else if (proposal.action == Action.ChangePriest) {
            _governanceChangePriest(proposal.recipient);
        } else if (proposal.action == Action.SetJoinPaused) {
            _governanceSetJoinPaused(proposal.joinPaused);
        } else if (proposal.action == Action.SetMaxMembers) {
            _governanceSetMaxMembers(proposal.newMaxMembers);
        } else if (proposal.action == Action.SetMetadata) {
            _governanceUpdateMetadata(proposal.newTemplName, proposal.newTemplDescription, proposal.newLogoLink);
        } else if (proposal.action == Action.SetProposalFee) {
            _governanceSetProposalCreationFee(proposal.newProposalCreationFeeBps);
        } else if (proposal.action == Action.SetReferralShare) {
            _governanceSetReferralShareBps(proposal.newReferralShareBps);
        } else if (proposal.action == Action.SetEntryFeeCurve) {
            CurveConfig memory curve2 = proposal.curveConfig;
            _governanceSetEntryFeeCurve(curve2, proposal.curveBaseEntryFee);
        } else if (proposal.action == Action.SetQuorumBps) {
            _governanceSetQuorumBps(proposal.newQuorumBps);
        } else if (proposal.action == Action.SetPostQuorumVotingPeriod) {
            _governanceSetPostQuorumVotingPeriod(proposal.newPostQuorumVotingPeriod);
        } else if (proposal.action == Action.SetBurnAddress) {
            _governanceSetBurnAddress(proposal.newBurnAddress);
        } else if (proposal.action == Action.SetYesVoteThreshold) {
            _governanceSetYesVoteThreshold(proposal.newYesVoteThresholdBps);
        } else if (proposal.action == Action.SetInstantQuorumBps) {
            _governanceSetInstantQuorumBps(proposal.newInstantQuorumBps);
        } else if (proposal.action == Action.SetCouncilMode) {
            _governanceSetCouncilMode(proposal.setCouncilMode);
        } else if (proposal.action == Action.AddCouncilMember) {
            _governanceAddCouncilMember(proposal.recipient);
        } else if (proposal.action == Action.RemoveCouncilMember) {
            _governanceRemoveCouncilMember(proposal.recipient);
        } else {
            revert TemplErrors.InvalidCallData();
        }
        return returnData;
    }

    /// @notice Governance wrapper that sets the join pause flag.
    /// @param _paused Desired pause state.
    function _governanceSetJoinPaused(bool _paused) internal {
        _setJoinPaused(_paused);
    }

    /// @notice Governance wrapper that updates entry fee and/or fee splits.
    /// @param _entryFee Optional new entry fee.
    /// @param _updateFeeSplit Whether to apply the provided split values.
    /// @param _burnBps New burn share (bps) when applying split updates.
    /// @param _treasuryBps New treasury share (bps) when applying split updates.
    /// @param _memberPoolBps New member pool share (bps) when applying split updates.
    function _governanceUpdateConfig(
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps
    ) internal {
        _updateConfig(_entryFee, _updateFeeSplit, _burnBps, _treasuryBps, _memberPoolBps);
    }

    /// @notice Governance wrapper that withdraws available treasury funds.
    /// @param token Token to withdraw (`address(0)` for ETH).
    /// @param recipient Destination wallet.
    /// @param amount Amount to transfer.
    /// @param proposalId Authorizing proposal id.
    function _governanceWithdrawTreasury(
        address token,
        address recipient,
        uint256 amount,
        uint256 proposalId
    ) internal {
        _withdrawTreasury(token, recipient, amount, proposalId);
    }

    /// @notice Governance wrapper that disbands treasury into a reward pool for `token`.
    /// @param token Token to disband (`address(0)` for ETH).
    /// @param proposalId Authorizing proposal id.
    function _governanceDisbandTreasury(address token, uint256 proposalId) internal {
        _disbandTreasury(token, proposalId);
    }

    /// @notice Governance wrapper that updates the priest address.
    /// @param newPriest New priest wallet.
    function _governanceChangePriest(address newPriest) internal {
        _changePriest(newPriest);
    }

    /// @notice Governance wrapper that updates the membership cap.
    /// @param newMaxMembers New membership cap (0 removes the cap).
    function _governanceSetMaxMembers(uint256 newMaxMembers) internal {
        _setMaxMembers(newMaxMembers);
    }

    /// @notice Governance wrapper that updates on-chain templ metadata.
    /// @param newName New templ name.
    /// @param newDescription New templ description.
    /// @param newLogoLink New templ logo link.
    function _governanceUpdateMetadata(
        string memory newName,
        string memory newDescription,
        string memory newLogoLink
    ) internal {
        _setTemplMetadata(newName, newDescription, newLogoLink);
    }

    /// @notice Governance wrapper that updates proposal creation fee (bps of entry fee).
    /// @param newFeeBps New fee in basis points.
    function _governanceSetProposalCreationFee(uint256 newFeeBps) internal {
        _setProposalCreationFee(newFeeBps);
    }

    /// @notice Governance wrapper that updates referral share basis points.
    /// @param newBps New referral share bps.
    function _governanceSetReferralShareBps(uint256 newBps) internal {
        _setReferralShareBps(newBps);
    }

    /// @notice Governance wrapper that updates the entry fee curve.
    /// @param curve New curve configuration.
    /// @param baseEntryFee Optional base entry fee anchor (0 keeps current base).
    function _governanceSetEntryFeeCurve(CurveConfig memory curve, uint256 baseEntryFee) internal {
        _applyCurveUpdate(curve, baseEntryFee);
    }

    /// @notice Governance wrapper that updates quorum threshold (bps).
    /// @param newQuorumBps New quorum threshold value.
    function _governanceSetQuorumBps(uint256 newQuorumBps) internal {
        _setQuorumBps(newQuorumBps);
    }

    /// @notice Governance wrapper that updates the post-quorum voting period.
    /// @param newPeriod New period in seconds.
    function _governanceSetPostQuorumVotingPeriod(uint256 newPeriod) internal {
        _setPostQuorumVotingPeriod(newPeriod);
    }

    /// @notice Governance wrapper that updates the burn sink address.
    /// @param newBurn New burn address.
    function _governanceSetBurnAddress(address newBurn) internal {
        _setBurnAddress(newBurn);
    }

    /// @notice Governance wrapper that updates the YES vote threshold.
    /// @param newThresholdBps New threshold (bps).
    function _governanceSetYesVoteThreshold(uint256 newThresholdBps) internal {
        _setYesVoteThreshold(newThresholdBps);
    }

    /// @notice Governance wrapper that updates the instant quorum threshold.
    /// @param newThresholdBps New instant quorum threshold (bps).
    function _governanceSetInstantQuorumBps(uint256 newThresholdBps) internal {
        _setInstantQuorumBps(newThresholdBps);
    }

    /// @notice Governance wrapper that toggles council mode.
    /// @param enabled True to enable council mode.
    function _governanceSetCouncilMode(bool enabled) internal {
        _setCouncilMode(enabled);
    }

    /// @notice Governance wrapper that adds a council member.
    /// @param account Wallet to add.
    function _governanceAddCouncilMember(address account) internal {
        _addCouncilMember(account, address(this));
    }

    /// @notice Governance wrapper that removes a council member.
    /// @param account Wallet to remove.
    function _governanceRemoveCouncilMember(address account) internal {
        _removeCouncilMember(account, address(this));
    }

    /// @notice Executes the arbitrary call attached to `proposal` and bubbles up revert data.
    /// @param proposal Proposal storage reference containing the external call payload.
    /// @return returndata Raw return data from the external call.
    function _governanceCallExternal(Proposal storage proposal) internal returns (bytes memory returndata) {
        address target = proposal.externalCallTarget;
        if (target == address(0)) revert TemplErrors.InvalidRecipient();
        bytes memory callData = proposal.externalCallData;
        if (callData.length == 0) revert TemplErrors.InvalidCallData();
        uint256 callValue = proposal.externalCallValue;
        (bool success, bytes memory _returndata) = target.call{value: callValue}(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(_returndata, 32), mload(_returndata))
            }
        }
        delete proposal.externalCallData;
        return _returndata;
    }

    /// @notice Removes up to `maxRemovals` inactive proposals from the active set.
    /// @param maxRemovals Maximum number of entries to remove.
    function _pruneInactiveTail(uint256 maxRemovals) internal {
        _pruneInactive(maxRemovals);
    }

    /// @notice Removes proposals that are no longer active from the tracked set.
    /// @param maxRemovals Maximum number of entries to prune in this call.
    /// @return removed Number of proposals removed from the active index.
    function pruneInactiveProposals(uint256 maxRemovals) external returns (uint256 removed) {
        _requireDelegatecall();
        removed = _pruneInactive(maxRemovals);
    }

    /// @notice Removes inactive proposals anywhere in the tracked set, scanning from newest to oldest.
    /// @param maxRemovals Maximum number of entries to prune in this call.
    /// @return removed Number of proposals removed from the active index.
    function _pruneInactive(uint256 maxRemovals) internal returns (uint256 removed) {
        if (maxRemovals == 0) return 0;
        uint256 len = activeProposalIds.length;
        if (len == 0) return 0;
        uint256 currentTime = block.timestamp;
        uint256 i = len;
        while (i > 0 && removed < maxRemovals) {
            uint256 proposalId = activeProposalIds[i - 1];
            if (_isActiveProposal(proposals[proposalId], currentTime)) {
                unchecked {
                    --i;
                }
                continue;
            }
            _removeActiveProposal(proposalId);
            unchecked {
                ++removed;
            }
            uint256 newLen = activeProposalIds.length;
            if (i > newLen) {
                i = newLen;
            }
        }
    }

    /// @notice Reverts unless called via delegatecall from the TEMPL router.
    /// @dev Prevents direct calls to the module implementation.
    function _requireDelegatecall() internal view {
        if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
    }
}
