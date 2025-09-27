// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplFactory} from "../TemplFactory.sol";

contract TemplFactoryHarness is TemplFactory {
    constructor(address protocolFeeRecipient, uint256 protocolPercent)
        TemplFactory(protocolFeeRecipient, protocolPercent)
    {}

    function exposeInitPointer() external view returns (address) {
        return templInitCodePointer;
    }
}
