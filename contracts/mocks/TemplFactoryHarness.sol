// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplFactory} from "../TemplFactory.sol";

contract TemplFactoryHarness is TemplFactory {
    constructor(
        address protocolFeeRecipient,
        uint256 protocolPercent,
        address membershipModule,
        address treasuryModule,
        address governanceModule
    )
        TemplFactory(protocolFeeRecipient, protocolPercent, membershipModule, treasuryModule, governanceModule)
    {}

    function exposeInitPointers() external view returns (address[] memory) {
        return templInitCodePointers;
    }

    function exposeInitCodeLength() external view returns (uint256) {
        return templInitCodeLength;
    }
}
