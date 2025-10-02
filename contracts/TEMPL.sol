// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplMembership} from "./TemplMembership.sol";
import {TemplTreasury} from "./TemplTreasury.sol";
import {TemplGovernance} from "./TemplGovernance.sol";
import {TemplErrors} from "./TemplErrors.sol";

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
    /// @param _homeLink Canonical URL for the templ surfaced in frontends and notifications.
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
            _homeLink
        )
    {
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();

        priest = _priest;
        entryFee = _entryFee;
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
    function _governanceSetHomeLink(string memory newLink) internal override {
        _setTemplHomeLink(newLink);
    }

    /// @inheritdoc TemplGovernance
    function _governanceSetFeeCurve(
        FeeCurveFormula formula,
        uint256 slope,
        uint256 scale
    ) internal override {
        _setFeeCurve(formula, slope, scale);
    }

}
