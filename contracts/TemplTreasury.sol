// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title templ treasury module
/// @notice Adds treasury controls, fee configuration, and external reward management.
abstract contract TemplTreasury is TemplBase {
    using SafeERC20 for IERC20;

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
    /// @param _token Optional replacement access token (must equal the existing token or zero to leave unchanged).
    /// @param _entryFee Optional new entry fee (0 keeps the current value).
    /// @param _updateFeeSplit Whether to apply the provided percentage overrides.
    /// @param _burnPercent New burn allocation in basis points when `_updateFeeSplit` is true.
    /// @param _treasuryPercent New treasury allocation in basis points when `_updateFeeSplit` is true.
    /// @param _memberPoolPercent New member pool allocation in basis points when `_updateFeeSplit` is true.
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
    /// @param _paused Desired paused state to apply.
    function setPausedDAO(bool _paused) external onlyDAO {
        _setPaused(_paused);
    }

    /// @notice Governance action that adjusts the membership cap.
    /// @param _maxMembers New membership cap (0 removes the cap).
    function setMaxMembersDAO(uint256 _maxMembers) external onlyDAO {
        _setMaxMembers(_maxMembers);
    }

    /// @notice Governance action that moves treasury balances into the member or external reward pools.
    /// @param token Asset to disband (`address(0)` for ETH).
    function disbandTreasuryDAO(address token) external onlyDAO {
        _disbandTreasury(token, 0);
    }

    /// @notice Governance action that appoints a new priest.
    /// @param newPriest Address of the incoming priest.
    function changePriestDAO(address newPriest) external onlyDAO {
        _changePriest(newPriest);
    }

    /// @notice Governance action that enables or disables dictatorship mode.
    /// @param enabled Target dictatorship state.
    function setDictatorshipDAO(bool enabled) external onlyDAO {
        _updateDictatorship(enabled);
    }

    /// @notice Governance action that updates the templ home link shared across surfaces.
    /// @param newLink Canonical URL to persist.
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
            uint256 currentBalance = IERC20(accessToken).balanceOf(address(this));
            if (currentBalance <= memberPoolBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 availableBalance = currentBalance - memberPoolBalance;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 debitedFromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= debitedFromFees;

            IERC20(accessToken).safeTransfer(recipient, amount);
        } else if (token == address(0)) {
            ExternalRewardState storage rewards = externalRewards[address(0)];
            uint256 currentBalance = address(this).balance;
            uint256 reservedForMembers = rewards.poolBalance;
            uint256 availableBalance = currentBalance > reservedForMembers ? currentBalance - reservedForMembers : 0;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            ExternalRewardState storage rewards = externalRewards[token];
            uint256 currentBalance = IERC20(token).balanceOf(address(this));
            uint256 reservedForMembers = rewards.poolBalance;
            uint256 availableBalance = currentBalance > reservedForMembers
                ? currentBalance - reservedForMembers
                : 0;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
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
        uint256 activeMembers = memberCount;
        if (activeMembers == 0) revert TemplErrors.NoMembers();

        if (token == accessToken) {
            uint256 accessTokenBalance = IERC20(accessToken).balanceOf(address(this));
            if (accessTokenBalance <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
            uint256 accessTokenAmount = accessTokenBalance - memberPoolBalance;

            uint256 debitedFromFees = accessTokenAmount <= treasuryBalance ? accessTokenAmount : treasuryBalance;
            treasuryBalance -= debitedFromFees;

            memberPoolBalance += accessTokenAmount;

            uint256 poolTotalRewards = accessTokenAmount + memberRewardRemainder;
            uint256 poolPerMember = poolTotalRewards / activeMembers;
            uint256 poolRemainder = poolTotalRewards % activeMembers;
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
        uint256 perMember = totalRewards / activeMembers;
        uint256 remainder = totalRewards % activeMembers;
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
