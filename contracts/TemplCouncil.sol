// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title Templ Council Governance Module
/// @notice Hosts council-specific proposal creation flows to keep the primary governance module lean.
/// @author templ.fun
contract TemplCouncilModule is TemplBase {
    /// @notice Sentinel used to detect direct calls to the module implementation.
    address public immutable SELF;

    /// @notice Initializes the module and captures its own address to enforce delegatecalls.
    constructor() {
        SELF = address(this);
    }

    modifier onlyDelegatecall() {
        if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
        _;
    }

    /// @notice Opens a proposal to update the YES vote threshold (bps of votes cast).
    /// @param _newThresholdBps Target YES threshold expressed in basis points.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title Proposal title persisted on-chain.
    /// @param _description Proposal description persisted on-chain.
    /// @return proposalId Newly created proposal id.
    function createProposalSetYesVoteThreshold(
        uint256 _newThresholdBps,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant onlyDelegatecall returns (uint256 proposalId) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_newThresholdBps < MIN_YES_VOTE_THRESHOLD_BPS || _newThresholdBps > BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentage();
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetYesVoteThreshold;
        p.newYesVoteThresholdBps = _newThresholdBps;
        return id;
    }

    /// @notice Opens a proposal to toggle council governance mode.
    /// @param _enable Desired council-mode state.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title Proposal title persisted on-chain.
    /// @param _description Proposal description persisted on-chain.
    /// @return proposalId Newly created proposal id.
    function createProposalSetCouncilMode(
        bool _enable,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant onlyDelegatecall returns (uint256 proposalId) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (_enable && councilMemberCount == 0) revert TemplErrors.NoMembers();
        (uint256 id, Proposal storage p) = _createBaseProposal(_votingPeriod, _title, _description);
        p.action = Action.SetCouncilMode;
        p.setCouncilMode = _enable;
        return id;
    }

    /// @notice Opens a proposal to add a new council member.
    /// @param _newMember Wallet to add to the council.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title Proposal title persisted on-chain.
    /// @param _description Proposal description persisted on-chain.
    /// @return proposalId Newly created proposal id.
    function createProposalAddCouncilMember(
        address _newMember,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant onlyDelegatecall returns (uint256 proposalId) {
        return _createCouncilMemberProposal(_newMember, true, _votingPeriod, _title, _description);
    }

    /// @notice Opens a proposal to remove an existing council member (council-only).
    /// @param _member Wallet slated for removal.
    /// @param _votingPeriod Optional custom voting duration (seconds).
    /// @param _title Proposal title persisted on-chain.
    /// @param _description Proposal description persisted on-chain.
    /// @return proposalId Newly created proposal id.
    function createProposalRemoveCouncilMember(
        address _member,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external nonReentrant onlyDelegatecall returns (uint256 proposalId) {
        if (!councilMembers[msg.sender]) revert TemplErrors.NotCouncil();
        return _createCouncilMemberProposal(_member, false, _votingPeriod, _title, _description);
    }

    /// @notice Internal helper that creates council add/remove proposals and guards invariants.
    /// @param member Wallet to add/remove.
    /// @param add True to add the member, false to remove them.
    /// @param votingPeriod Voting period applied to the proposal.
    /// @param title Title recorded with the proposal.
    /// @param description Description recorded with the proposal.
    /// @return proposalId Newly created proposal id.
    function _createCouncilMemberProposal(
        address member,
        bool add,
        uint256 votingPeriod,
        string calldata title,
        string calldata description
    ) internal returns (uint256 proposalId) {
        if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
        if (member == address(0)) revert TemplErrors.InvalidRecipient();
        if (!members[member].joined) revert TemplErrors.NotMember();
        if (add) {
            if (councilMembers[member]) revert TemplErrors.CouncilMemberExists();
        } else {
            if (!councilMembers[member]) revert TemplErrors.CouncilMemberMissing();
            if (councilMemberCount < 2) revert TemplErrors.CouncilMemberMinimum();
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(votingPeriod, title, description);
        p.action = add ? Action.AddCouncilMember : Action.RemoveCouncilMember;
        p.recipient = member;
        return id;
    }
}
