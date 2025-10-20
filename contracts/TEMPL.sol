// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplMembership} from "./TemplMembership.sol";
import {TemplTreasury} from "./TemplTreasury.sol";
import {TemplGovernance} from "./TemplGovernance.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title templ.fun core templ implementation
/// @notice Wires governance, treasury, and membership modules for a single templ instance.
contract TEMPL is TemplBase, TemplMembership, TemplTreasury, TemplGovernance {
    /// @notice Initializes a new templ with the provided configuration and priest.
    /// @param _priest Wallet that oversees configuration changes until governance replaces it.
    /// @param _protocolFeeRecipient Address that receives the protocol share of every entry fee.
    /// @param _token ERC-20 token used as the access currency for the templ.
    /// @param _entryFee Amount of `_token` required to join the templ.
    /// @param _burnPercent Percent of each entry fee that is burned.
    /// @param _treasuryPercent Percent of each entry fee routed to the templ treasury.
    /// @param _memberPoolPercent Percent of each entry fee streamed to existing members.
    /// @param _protocolPercent Percent of each entry fee forwarded to the protocol.
    /// @param _quorumPercent Percent of members that must vote YES to satisfy quorum.
    /// @param _executionDelay Seconds to wait after quorum before executing a proposal.
    /// @param _burnAddress Address that receives the burn allocation (defaults to the dead address).
    /// @param _priestIsDictator Whether the templ starts in priest-only governance mode.
    /// @param _maxMembers Optional membership cap (0 keeps membership uncapped).
    /// @param _name Human-readable templ name surfaced in frontends.
    /// @param _description Short templ description surfaced in frontends.
    /// @param _logoLink Canonical logo URL for the templ.
    /// @param _proposalCreationFeeBps Proposal creation fee expressed in basis points of the current entry fee.
    /// @param _referralShareBps Referral share expressed in basis points of the member pool allocation.
    /// @param _curve Pricing curve configuration applied to future joins.
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
        string memory _name,
        string memory _description,
        string memory _logoLink,
        uint256 _proposalCreationFeeBps,
        uint256 _referralShareBps,
        CurveConfig memory _curve
    )
        TemplBase(
            _protocolFeeRecipient,
            _token,
            _burnPercent,
            _treasuryPercent,
            _memberPoolPercent,
            _protocolPercent,
            _quorumPercent,
            _executionDelay,
            _burnAddress,
            _priestIsDictator,
            _name,
            _description,
            _logoLink,
            _proposalCreationFeeBps,
            _referralShareBps
        )
    {
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();

        priest = _priest;
        joinPaused = false;
        Member storage priestMember = members[_priest];
        priestMember.joined = true;
        priestMember.timestamp = block.timestamp;
        priestMember.blockNumber = block.number;
        priestMember.rewardSnapshot = cumulativeMemberRewards;
        memberCount = 1;
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }

        _configureEntryFeeCurve(_entryFee, _curve);
    }

    /// @notice Accepts ETH so proposals can later disburse it as external rewards.
    receive() external payable {}

    /// @inheritdoc TemplGovernance
    function _governanceSetJoinPaused(bool _paused) internal override {
        _setJoinPaused(_paused);
    }

    /// @inheritdoc TemplGovernance
    function _governanceUpdateConfig(
        address _token,
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal override {
        _updateConfig(_token, _entryFee, _updateFeeSplit, _burnPercent, _treasuryPercent, _memberPoolPercent);
    }

    /// @inheritdoc TemplGovernance
    function _governanceWithdrawTreasury(
        address token,
        address recipient,
        uint256 amount,
        string memory reason,
        uint256 proposalId
    ) internal override {
        _withdrawTreasury(token, recipient, amount, reason, proposalId);
    }

    /// @inheritdoc TemplGovernance
    function _governanceDisbandTreasury(address token, uint256 proposalId) internal override {
        _disbandTreasury(token, proposalId);
    }

    /// @inheritdoc TemplGovernance
    function _governanceChangePriest(address newPriest) internal override {
        _changePriest(newPriest);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetDictatorship(bool enabled) internal override {
        _updateDictatorship(enabled);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetMaxMembers(uint256 newMaxMembers) internal override {
        _setMaxMembers(newMaxMembers);
    }

    /// @inheritdoc TemplGovernance
    function _governanceUpdateMetadata(
        string memory newName,
        string memory newDescription,
        string memory newLogoLink
    ) internal override {
        _setTemplMetadata(newName, newDescription, newLogoLink);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetProposalCreationFee(uint256 newFeeBps) internal override {
        _setProposalCreationFee(newFeeBps);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetReferralShareBps(uint256 newBps) internal override {
        _setReferralShareBps(newBps);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetEntryFeeCurve(
        CurveConfig memory curve,
        uint256 baseEntryFeeValue
    ) internal override {
        _applyCurveUpdate(curve, baseEntryFeeValue);
    }

}
