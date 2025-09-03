// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITempl {
    function purchaseAccess() external;
}

/// @dev ERC20 token that attempts to reenter the TEMPL contract during transferFrom
contract ReentrantToken is ERC20 {
    address public templ;
    bool public attack;

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {}

    function setTempl(address _templ) external {
        templ = _templ;
    }

    function setAttack(bool _attack) external {
        attack = _attack;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool success = super.transferFrom(from, to, value);
        if (attack) {
            // attempt reentrancy
            ITempl(templ).purchaseAccess();
        }
        return success;
    }
}
