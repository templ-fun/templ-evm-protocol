// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Reverter {
    function alwaysRevert() external pure {
        revert("always revert");
    }
}
