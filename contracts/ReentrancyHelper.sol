// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITEMPL {
    function purchaseAccess() external;
    function executeProposal(uint256 proposalId) external;
    function claimMemberPool() external;
}

/// @dev Helper contract that attempts to reenter TEMPL during callbacks
contract ReentrancyHelper {
    address public immutable templ;
    address public immutable token;

    constructor(address _templ, address _token) {
        templ = _templ;
        token = _token;
    }

    function buyAccess(uint256 amount) external {
        IERC20(token).approve(templ, amount);
        ITEMPL(templ).purchaseAccess();
    }

    function attackExecute(uint256 proposalId) external {
        ITEMPL(templ).executeProposal(proposalId);
    }

    function attackClaim() external {
        ITEMPL(templ).claimMemberPool();
    }
}

