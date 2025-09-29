// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplGovernance} from "./TemplGovernance.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title templ.fun core templ implementation
/// @notice Wires governance, treasury, and membership modules for a single templ instance.
contract TEMPL is TemplGovernance {
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
    ) TemplGovernance(
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
    ) {
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();

        priest = _priest;
        entryFee = _entryFee;
        paused = false;
        Member storage priestMember = members[_priest];
        priestMember.purchased = true;
        priestMember.timestamp = block.timestamp;
        priestMember.block = block.number;
        priestMember.rewardSnapshot = cumulativeMemberRewards;
        memberCount = 1;
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }
    }

    /// @notice Accepts ETH so proposals can later disburse it as external rewards.
    receive() external payable {}
}
