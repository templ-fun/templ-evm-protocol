// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CreateConfig} from "../TemplFactoryTypes.sol";
import {ITemplDeployer} from "../TemplDeployer.sol";

/// @dev Test-only deployer that returns the zero address to exercise factory guards.
contract NullDeployer is ITemplDeployer {
    function deployTempl(
        CreateConfig calldata,
        address,
        uint256,
        address,
        address,
        address,
        address
    ) external pure returns (address templAddress) {
        return address(0);
    }
}
