// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IProposalFeeReentrancyHook {
    function onProposalFeeCharged() external;
}

/// @dev ERC20 token that can call back into a proposal creator while transferFrom executes.
///      Used to simulate ERC-777 style tokens with hook-based reentrancy during proposal fee collection.
contract ProposalFeeReentrantToken is ERC20 {
    address public templ;
    address public hookTarget;
    bool public hookEnabled;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function setTempl(address templ_) external {
        templ = templ_;
    }

    function setHookTarget(address target) external {
        hookTarget = target;
    }

    function setHookEnabled(bool enabled) external {
        hookEnabled = enabled;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool success = super.transferFrom(from, to, value);
        if (hookEnabled && from == hookTarget && from != address(0)) {
            try IProposalFeeReentrancyHook(from).onProposalFeeCharged() {
                // no-op
            } catch {
                // swallow errors so transfer semantics remain consistent with ERC20 behaviour
            }
        }
        return success;
    }
}
