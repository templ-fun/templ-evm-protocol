// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplMembership} from "./TemplMembership.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplTreasury is TemplMembership {
    using SafeERC20 for IERC20;

    constructor(
        address _protocolFeeRecipient,
        address _accessToken,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent,
        uint256 _quorumPercent,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator
    ) TemplMembership(
        _protocolFeeRecipient,
        _accessToken,
        _burnPercent,
        _treasuryPercent,
        _memberPoolPercent,
        _protocolPercent,
        _quorumPercent,
        _executionDelay,
        _burnAddress,
        _priestIsDictator
    ) {}

    function withdrawTreasuryDAO(
        address token,
        address recipient,
        uint256 amount,
        string memory reason
    ) external onlyDAO {
        _withdrawTreasury(token, recipient, amount, reason, 0);
    }

    function updateConfigDAO(
        address _token,
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) external onlyDAO {
        _updateConfig(_token, _entryFee, _updateFeeSplit, _burnPercent, _treasuryPercent, _memberPoolPercent);
    }

    function setPausedDAO(bool _paused) external onlyDAO {
        _setPaused(_paused);
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
            ExternalRewardState storage rewards = externalRewards[address(0)];
            uint256 current = address(this).balance;
            uint256 reserved = rewards.poolBalance;
            uint256 available = current > reserved ? current - reserved : 0;
            if (amount > available) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            ExternalRewardState storage rewards = externalRewards[token];
            uint256 current = IERC20(token).balanceOf(address(this));
            uint256 reserved = rewards.poolBalance;
            uint256 available = current > reserved ? current - reserved : 0;
            if (amount > available) revert TemplErrors.InsufficientTreasuryBalance();
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount, reason);
    }

    /// @dev Backend listeners consume PriestChanged to clear delegate/mute state for the new priest.
    function _changePriest(address newPriest) internal {
        if (newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        address old = priest;
        if (newPriest == old) revert TemplErrors.InvalidCallData();
        priest = newPriest;
        emit PriestChanged(old, newPriest);
    }

    function _updateConfig(
        address _token,
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal {
        if (_token != address(0) && _token != accessToken) revert TemplErrors.TokenChangeDisabled();
        if (_entryFee > 0) {
            if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
            entryFee = _entryFee;
        }
        if (_updateFeeSplit) {
            _setPercentSplit(_burnPercent, _treasuryPercent, _memberPoolPercent);
        }
        emit ConfigUpdated(accessToken, entryFee, burnPercent, treasuryPercent, memberPoolPercent, protocolPercent);
    }

    function _setPaused(bool _paused) internal {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    function _disbandTreasury(address token, uint256 proposalId) internal {
        uint256 n = memberList.length;
        if (n == 0) revert TemplErrors.NoMembers();

        if (token == accessToken) {
            uint256 current = IERC20(accessToken).balanceOf(address(this));
            if (current <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
            uint256 amount = current - memberPoolBalance;

            uint256 fromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= fromFees;

            memberPoolBalance += amount;

            uint256 totalRewards = amount + memberRewardRemainder;
            uint256 perMember = totalRewards / n;
            uint256 remainder = totalRewards % n;
            cumulativeMemberRewards += perMember;
            memberRewardRemainder = remainder;

            emit TreasuryDisbanded(proposalId, token, amount, perMember, remainder);
            return;
        }

        uint256 currentBalance;
        if (token == address(0)) {
            currentBalance = address(this).balance;
        } else {
            currentBalance = IERC20(token).balanceOf(address(this));
        }

        ExternalRewardState storage rewards = externalRewards[token];
        uint256 reserved = rewards.poolBalance;
        if (currentBalance <= reserved) revert TemplErrors.NoTreasuryFunds();

        uint256 amount = currentBalance - reserved;
        if (amount == 0) revert TemplErrors.NoTreasuryFunds();

        _registerExternalToken(token);

        rewards.poolBalance += amount;

        uint256 totalRewards = amount + rewards.rewardRemainder;
        uint256 perMember = totalRewards / n;
        uint256 remainder = totalRewards % n;
        rewards.cumulativeRewards += perMember;
        rewards.rewardRemainder = remainder;

        _recordExternalCheckpoint(rewards);

        emit TreasuryDisbanded(proposalId, token, amount, perMember, remainder);
    }

    function _registerExternalToken(address token) internal {
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            rewards.exists = true;
            externalRewardTokens.push(token);
        }
    }
}
