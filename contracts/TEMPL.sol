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
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP,
        uint256 _protocolBP
    ) TemplGovernance(
        _protocolFeeRecipient,
        _token,
        _burnBP,
        _treasuryBP,
        _memberPoolBP,
        _protocolBP
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
    }

    receive() external payable {}
}
