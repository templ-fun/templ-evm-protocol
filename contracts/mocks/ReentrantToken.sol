// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITempl {
    function join() external;
    function joinFor(address recipient) external;
    function claimMemberRewards() external;
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

    /// @dev Construct reentrant test token
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    /// @notice Set the target TEMPL contract address
    function setTempl(address _templ) external {
        templ = _templ;
    }
    /// @notice Configure which callback (if any) to trigger
    function setCallback(Callback _callback) external {
        callback = _callback;
    }
    /// @notice Mint tokens for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    /// @notice Helper to join TEMPL by minting and approving tokens
    function joinTempl(uint256 amount) external {
        _mint(address(this), amount);
        _approve(address(this), templ, amount);
        ITempl(templ).join();
    }
    /// @notice Join TEMPL by spending an external access token already held by this contract
    function joinTemplWithAccessToken(address accessToken, uint256 amount) external {
        IERC20(accessToken).approve(templ, amount);
        ITempl(templ).join();
    }
    /// @inheritdoc ERC20
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool success = super.transferFrom(from, to, value);
        if (callback == Callback.Purchase) {
            ITempl(templ).join();
        }
        return success;
    }
    /// @inheritdoc ERC20
    function transfer(address to, uint256 value) public override returns (bool) {
        bool success = super.transfer(to, value);
        if (callback == Callback.Claim) {
            ITempl(templ).claimMemberRewards();
        }
        return success;
    }
}
