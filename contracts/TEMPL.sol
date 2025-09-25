// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplGovernance} from "./TemplGovernance.sol";
import {TemplErrors} from "./TemplErrors.sol";

contract TEMPL is TemplGovernance {
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
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }
    }

    receive() external payable {}
}
