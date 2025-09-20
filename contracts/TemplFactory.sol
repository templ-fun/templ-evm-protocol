// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {TemplErrors} from "./TemplErrors.sol";

contract TemplFactory {
    uint256 internal constant TOTAL_BPS = 100;

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolBP;

    event TemplCreated(
        address indexed templ,
        address indexed creator,
        address indexed priest,
        address token,
        uint256 entryFee,
        uint256 burnBP,
        uint256 treasuryBP,
        uint256 memberPoolBP
    );

    constructor(address _protocolFeeRecipient, uint256 _protocolBP) {
        if (_protocolFeeRecipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolBP > TOTAL_BPS) revert TemplErrors.InvalidFeeSplit();
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolBP = _protocolBP;
    }

    function createTempl(
        address _priest,
        address _token,
        uint256 _entryFee,
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP
    ) external returns (address templAddress) {
        _validateFeeSplit(_burnBP, _treasuryBP, _memberPoolBP);
        TEMPL templ = new TEMPL(
            _priest,
            protocolFeeRecipient,
            _token,
            _entryFee,
            _burnBP,
            _treasuryBP,
            _memberPoolBP,
            protocolBP
        );
        templAddress = address(templ);
        emit TemplCreated(
            templAddress,
            msg.sender,
            _priest,
            _token,
            _entryFee,
            _burnBP,
            _treasuryBP,
            _memberPoolBP
        );
    }

    function _validateFeeSplit(
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP
    ) internal view {
        if (
            _burnBP > TOTAL_BPS ||
            _treasuryBP > TOTAL_BPS ||
            _memberPoolBP > TOTAL_BPS ||
            protocolBP > TOTAL_BPS
        ) revert TemplErrors.InvalidFeeSplit();
        if (_burnBP + _treasuryBP + _memberPoolBP + protocolBP != TOTAL_BPS) {
            revert TemplErrors.InvalidFeeSplit();
        }
    }
}
