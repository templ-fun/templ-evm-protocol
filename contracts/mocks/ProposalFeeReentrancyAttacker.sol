// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITemplMembership {
    function join() external;
}

interface ITemplGovernanceReentrant {
    function createProposalSetJoinPaused(
        bool _paused,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256);
}

interface ITemplGovernanceReentrantExtra {
    function createProposalSetMaxMembers(
        uint256 _newMaxMembers,
        uint256 _votingPeriod,
        string calldata _title,
        string calldata _description
    ) external returns (uint256);
}

interface IProposalFeeReentrancyHook {
    function onProposalFeeCharged() external;
}

/// @dev Helper contract that joins a templ and reenters proposal creation when the proposal fee is collected.
contract ProposalFeeReentrancyAttacker is IProposalFeeReentrancyHook {
    address public immutable templ;
    address public immutable token;
    bool public reentered;

    constructor(address templ_, address token_) {
        templ = templ_;
        token = token_;
        reentered = false;
    }

    function joinTempl(uint256 amount) external {
        IERC20(token).approve(templ, amount);
        ITemplMembership(templ).join();
    }

    function approveFee(uint256 amount) external {
        IERC20(token).approve(templ, amount);
    }

    function attackCreateProposal() external {
        reentered = false;
        ITemplGovernanceReentrant(templ).createProposalSetJoinPaused(
            true,
            0,
            "Pause joins (primary)",
            "Initial proposal"
        );
    }

    function onProposalFeeCharged() external override {
        if (msg.sender != token || reentered) {
            return;
        }
        reentered = true;
        ITemplGovernanceReentrantExtra(templ).createProposalSetMaxMembers(
            0,
            0,
            "Remove cap (reentrant)",
            "Reentrant proposal"
        );
    }
}
