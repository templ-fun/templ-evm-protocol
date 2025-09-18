// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplMembership} from "./TemplMembership.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplTreasury is TemplMembership {
    using SafeERC20 for IERC20;

    constructor(address _protocolFeeRecipient, address _accessToken)
        TemplMembership(_protocolFeeRecipient, _accessToken)
    {}

    function withdrawTreasuryDAO(
        address token,
        address recipient,
        uint256 amount,
        string memory reason
    ) external onlyDAO {
        _withdrawTreasury(token, recipient, amount, reason, 0);
    }

    function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO {
        _updateConfig(_token, _entryFee);
    }

    function setPausedDAO(bool _paused) external onlyDAO {
        _setPaused(_paused);
    }

    function disbandTreasuryDAO() external onlyDAO {
        _disbandTreasury(accessToken, 0);
    }

    function disbandTreasuryDAO(address token) external onlyDAO {
        _disbandTreasury(token, 0);
    }

    function changePriestDAO(address newPriest) external onlyDAO {
        _changePriest(newPriest);
    }

    function _withdrawTreasury(
        address token,
        address recipient,
        uint256 amount,
        string memory reason,
        uint256 proposalId
    ) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (amount == 0) revert TemplErrors.AmountZero();

        if (token == accessToken) {
            uint256 current = IERC20(accessToken).balanceOf(address(this));
            if (current <= memberPoolBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 available = current - memberPoolBalance;
            if (amount > available) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 fromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= fromFees;

            IERC20(accessToken).safeTransfer(recipient, amount);
        } else if (token == address(0)) {
            if (amount > address(this).balance) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            if (amount > IERC20(token).balanceOf(address(this))) revert TemplErrors.InsufficientTreasuryBalance();
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount, reason);
    }

    function _changePriest(address newPriest) internal {
        if (newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        address old = priest;
        if (newPriest == old) revert TemplErrors.InvalidCallData();
        priest = newPriest;
        emit PriestChanged(old, newPriest);
    }

    function _updateConfig(address _token, uint256 _entryFee) internal {
        if (_token != address(0) && _token != accessToken) revert TemplErrors.TokenChangeDisabled();
        if (_entryFee > 0) {
            if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
            entryFee = _entryFee;
        }
        emit ConfigUpdated(accessToken, entryFee);
    }

    function _setPaused(bool _paused) internal {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    function _disbandTreasury(address token, uint256 proposalId) internal {
        if (token != accessToken) revert TemplErrors.InvalidCallData();
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        if (current <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
        uint256 amount = current - memberPoolBalance;

        uint256 n = memberList.length;
        if (n == 0) revert TemplErrors.NoMembers();
        uint256 fromFees = amount <= treasuryBalance ? amount : treasuryBalance;
        treasuryBalance -= fromFees;

        memberPoolBalance += amount;

        uint256 perMember = amount / n;
        uint256 remainder = amount % n;
        cumulativeMemberRewards += perMember;
        memberRewardRemainder += remainder;

        emit TreasuryDisbanded(proposalId, amount, perMember, remainder);
    }
}
