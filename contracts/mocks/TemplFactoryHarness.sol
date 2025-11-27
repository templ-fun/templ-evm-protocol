// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {TemplFactory} from "../TemplFactory.sol";

contract TemplFactoryHarness is TemplFactory {
    constructor(
        address factoryDeployer,
        address protocolFeeRecipient,
        uint256 protocolBps,
        address membershipModule,
        address treasuryModule,
        address governanceModule,
        address councilModule,
        address templDeployer
    )
        TemplFactory(
            factoryDeployer,
            protocolFeeRecipient,
            protocolBps,
            membershipModule,
            treasuryModule,
            governanceModule,
            councilModule,
            templDeployer
        )
    {}
}
