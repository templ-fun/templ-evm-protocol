// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title templ treasury module
/// @notice Adds treasury controls, fee configuration, and external reward management.
contract TemplTreasuryModule is TemplBase {

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

    /// @notice Governance action that toggles whether new members can join.
    /// @param _paused Desired join pause state to apply.
    function setJoinPausedDAO(bool _paused) external onlyDAO {
        _setJoinPaused(_paused);
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

    /// @notice Governance action that updates templ metadata.
    /// @param newName New templ name to persist.
    /// @param newDescription New templ description to persist.
    /// @param newLogoLink New templ logo link to persist.
    function setTemplMetadataDAO(
        string calldata newName,
        string calldata newDescription,
        string calldata newLogoLink
    ) external onlyDAO {
        _setTemplMetadata(newName, newDescription, newLogoLink);
    }

    /// @notice Governance action that updates the proposal creation fee expressed in basis points.
    /// @param newFeeBps New proposal creation fee in basis points.
    function setProposalCreationFeeBpsDAO(uint256 newFeeBps) external onlyDAO {
        _setProposalCreationFee(newFeeBps);
    }

    /// @notice Governance action that updates the referral share basis points.
    /// @param newReferralBps New referral share expressed in basis points.
    function setReferralShareBpsDAO(uint256 newReferralBps) external onlyDAO {
        _setReferralShareBps(newReferralBps);
    }

    /// @notice Governance action that reconfigures the entry fee curve.
    /// @param curve New curve configuration to apply.
    /// @param baseEntryFee Entry fee value referenced by the update (0 keeps the existing base).
    function setEntryFeeCurveDAO(CurveConfig calldata curve, uint256 baseEntryFee) external onlyDAO {
        CurveConfig memory config = curve;
        _applyCurveUpdate(config, baseEntryFee);
    }

    /// @notice Removes an empty external reward token so future disbands can reuse the slot.
    /// @param token Asset to remove from the enumeration set.
    function cleanupExternalRewardToken(address token) external {
        if (token == accessToken) revert TemplErrors.InvalidCallData();
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) revert TemplErrors.InvalidCallData();
        if (rewards.poolBalance != 0 || rewards.rewardRemainder != 0) {
            revert TemplErrors.ExternalRewardsNotSettled();
        }

        rewards.poolBalance = 0;
        rewards.rewardRemainder = 0;
        rewards.cumulativeRewards = 0;
        delete rewards.checkpoints;
        rewards.exists = false;
        externalRewardCleanupNonce[token] += 1;
        _removeExternalToken(token);
    }
}
