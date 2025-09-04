// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITempl {
    function claimMemberPool() external;
    function purchaseAccess() external;
}

/// @dev ERC20 token that attempts to reenter TEMPL.claimMemberPool during transfer
contract ReentrantClaimToken is ERC20 {
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

    function joinTempl(uint256 amount) external {
        _mint(address(this), amount);
        _approve(address(this), templ, amount);
        ITempl(templ).purchaseAccess();
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool success = super.transfer(to, value);
        if (attack) {
            ITempl(templ).claimMemberPool();
        }
        return success;
    }
}
