// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ITempl {
    function join() external;
}

/// @notice Helper contract that attempts to call TEMPL's join entry point.
contract JoinCaller {
    address public templ;

    /// @dev Store TEMPL address at construction
    constructor(address _templ) {
        templ = _templ;
    }

    /// @notice Call TEMPL.join() from this helper.
    function callJoin() external {
        ITempl(templ).join();
    }
}
