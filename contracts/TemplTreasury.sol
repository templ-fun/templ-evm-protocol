// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplMembership} from "./TemplMembership.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title templ treasury module
/// @notice Adds treasury controls, fee configuration, and external reward management.
abstract contract TemplTreasury is TemplMembership {
    using SafeERC20 for IERC20;

    /// @notice Pass-through constructor wiring the treasury layer into the membership module.
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
        bool _priestIsDictator,
        string memory _homeLink
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
        _priestIsDictator,
        _homeLink
    ) {}

    /// @notice Governance action that transfers available treasury or external funds to a recipient.
    /// @param token Token to withdraw (`address(0)` for ETH, access token, or arbitrary ERC-20).
    /// @param recipient Destination wallet for the withdrawal.
    /// @param amount Amount to transfer.
    /// @param reason Human-readable justification emitted for off-chain consumers.
    function withdrawTreasuryDAO(
        address token,
        address recipient,
        uint256 amount,
        string memory reason
    ) external onlyDAO {
        _withdrawTreasury(token, recipient, amount, reason, 0);
    }

    /// @notice Governance action that updates the entry fee and/or fee split configuration.
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

    /// @notice Governance action that toggles the paused state.
    function setPausedDAO(bool _paused) external onlyDAO {
        _setPaused(_paused);
    }

    /// @notice Governance action that adjusts the membership cap.
    function setMaxMembersDAO(uint256 _maxMembers) external onlyDAO {
        _setMaxMembers(_maxMembers);
    }

    /// @notice Governance action that moves treasury balances into the member or external reward pools.
    function disbandTreasuryDAO(address token) external onlyDAO {
        _disbandTreasury(token, 0);
    }

    /// @notice Governance action that appoints a new priest.
    function changePriestDAO(address newPriest) external onlyDAO {
        _changePriest(newPriest);
    }

    /// @notice Governance action that enables or disables dictatorship mode.
    function setDictatorshipDAO(bool enabled) external onlyDAO {
        _updateDictatorship(enabled);
    }

    /// @notice Governance action that updates the templ home link shared across surfaces.
    function setTemplHomeLinkDAO(string calldata newLink) external onlyDAO {
        _setTemplHomeLink(newLink);
    }

    /// @dev Internal helper that executes a treasury withdrawal and emits the corresponding event.
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

    /// @dev Backend listeners consume PriestChanged to persist the new priest and notify off-chain services.
    function _changePriest(address newPriest) internal {
        if (newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        address old = priest;
        if (newPriest == old) revert TemplErrors.InvalidCallData();
        priest = newPriest;
        emit PriestChanged(old, newPriest);
    }

    /// @dev Applies updates to the entry fee and fee split configuration.
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

    /// @dev Sets the paused flag without mutating membership limits during manual resumes.
    function _setPaused(bool _paused) internal {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    /// @dev Routes treasury balances into member or external pools so members can claim them evenly.
    function _disbandTreasury(address token, uint256 proposalId) internal {
        uint256 n = memberList.length;
        if (n == 0) revert TemplErrors.NoMembers();

        if (token == accessToken) {
            uint256 current = IERC20(accessToken).balanceOf(address(this));
            if (current <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
            uint256 accessTokenAmount = current - memberPoolBalance;

            uint256 fromFees = accessTokenAmount <= treasuryBalance ? accessTokenAmount : treasuryBalance;
            treasuryBalance -= fromFees;

            memberPoolBalance += accessTokenAmount;

            uint256 poolTotalRewards = accessTokenAmount + memberRewardRemainder;
            uint256 poolPerMember = poolTotalRewards / n;
            uint256 poolRemainder = poolTotalRewards % n;
            cumulativeMemberRewards += poolPerMember;
            memberRewardRemainder = poolRemainder;

            emit TreasuryDisbanded(proposalId, token, accessTokenAmount, poolPerMember, poolRemainder);
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

    /// @dev Registers a token so external rewards can be enumerated by frontends.
    function _registerExternalToken(address token) internal {
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            rewards.exists = true;
            externalRewardTokens.push(token);
        }
    }
}
