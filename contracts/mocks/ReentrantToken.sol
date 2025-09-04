// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITempl {
    function purchaseAccess() external;
    function claimMemberPool() external;
}

/// @dev ERC20 token that can reenter TEMPL during token transfers
contract ReentrantToken is ERC20 {
    enum Callback {
        None,
        Purchase,
        Claim
    }

    address public templ;
    Callback public callback;

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {}

    function setTempl(address _templ) external {
        templ = _templ;
    }

    function setCallback(Callback _callback) external {
        callback = _callback;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function joinTempl(uint256 amount) external {
        _mint(address(this), amount);
        _approve(address(this), templ, amount);
        ITempl(templ).purchaseAccess();
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool success = super.transferFrom(from, to, value);
        if (callback == Callback.Purchase) {
            ITempl(templ).purchaseAccess();
        }
        return success;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool success = super.transfer(to, value);
        if (callback == Callback.Claim) {
            ITempl(templ).claimMemberPool();
        }
        return success;
    }
}

