// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title Templ Module Base
/// @notice Shared delegatecall guard for templ modules.
/// @author templ.fun
abstract contract TemplModuleBase is TemplBase {
    /// @notice Sentinel used to detect direct calls to the module implementation.
    address internal immutable SELF;

    /// @notice Initializes the module and captures its own address to enforce delegatecalls.
    constructor() {
        SELF = address(this);
    }

    modifier onlyDelegatecall() {
        if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
        _;
    }

    /// @notice Reverts unless called via delegatecall from the TEMPL router.
    /// @dev Prevents direct calls to the module implementation.
    function _requireDelegatecall() internal view {
        if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
    }
}
