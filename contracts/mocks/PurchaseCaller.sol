// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ITempl {
    function purchaseAccess() external;
}

/// @notice Helper contract that attempts to call TEMPL's purchaseAccess
contract PurchaseCaller {
    address public templ;

    /// @dev Store TEMPL address at construction
    constructor(address _templ) {
        templ = _templ;
    }

    /// @notice Call TEMPL.purchaseAccess() from this helper
    function callPurchaseAccess() external {
        ITempl(templ).purchaseAccess();
    }
}
