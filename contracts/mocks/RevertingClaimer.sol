// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface ITemplMinimal {
    function purchaseAccess() external;
    function claimExternalToken(address token) external;
}

/// @dev Helper member that reverts on ETH reception to exercise failing claim paths.
contract RevertingClaimer {
    /// @notice Join the provided TEMPL instance by approving and calling purchaseAccess.
    function purchaseMembership(address templ, address token, uint256 amount) external {
        IERC20(token).approve(templ, amount);
        ITemplMinimal(templ).purchaseAccess();
    }

    /// @notice Claim an external reward token from the templ.
    function claimExternal(address templ, address token) external {
        ITemplMinimal(templ).claimExternalToken(token);
    }

    receive() external payable {
        revert("RevertingClaimer: cannot receive");
    }
}
