// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplFactory} from "../TemplFactory.sol";

contract TemplFactoryHarness is TemplFactory {
    constructor(address protocolFeeRecipient, uint256 protocolPercent)
        TemplFactory(protocolFeeRecipient, protocolPercent)
    {}

    function exposeInitPointers() external view returns (address[] memory) {
        return templInitCodePointers;
    }

    function exposeInitCodeLength() external view returns (uint256) {
        return templInitCodeLength;
    }
}
