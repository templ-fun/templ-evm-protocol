// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";

contract ExecuteCallHarness is TEMPL {
    constructor(
        address priest,
        address protocolFeeRecipient,
        address token,
        uint256 entryFee
    ) TEMPL(priest, protocolFeeRecipient, token, entryFee) {}

    function executeCall(bytes memory callData) external returns (bytes memory) {
        return _executeCall(callData);
    }
}
