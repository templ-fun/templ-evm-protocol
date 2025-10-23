// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { TemplBase } from "./TemplBase.sol";
import { TemplErrors } from "./TemplErrors.sol";
import { CurveConfig } from "./TemplCurve.sol";

/// @title Templ Treasury Module
/// @notice Adds treasury controls, fee configuration, and external reward management.
/// @author templ.fun
contract TemplTreasuryModule is TemplBase {
    /// @notice Sentinel used to detect direct calls to the module implementation.
    address public immutable SELF;

    /// @notice Initializes the module and captures its own address to enforce delegatecalls.
    constructor() {
        SELF = address(this);
    }

    modifier onlyDelegatecall() {
        if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
        _;
    }

    /// @notice Governance action that transfers available treasury or external funds to a recipient.
    /// @param token Token to withdraw (`address(0)` for ETH, access token, or arbitrary ERC-20).
    /// @param recipient Destination wallet for the withdrawal.
    /// @param amount Amount to transfer.
    /// @param reason Human-readable justification emitted for off-chain consumers.
    function withdrawTreasuryDAO(
        address token,
        address recipient,
        uint256 amount,
        string calldata reason
    ) external onlyDAO nonReentrant onlyDelegatecall {
        _withdrawTreasury(token, recipient, amount, reason, 0);
    }

    /// @notice Governance action that updates the entry fee and/or fee split configuration.
    /// @param _entryFee Optional new entry fee (0 keeps the current value).
    /// @param _updateFeeSplit Whether to apply the provided fee-split overrides (bps).
    /// @param _burnBps New burn allocation in basis points when `_updateFeeSplit` is true.
    /// @param _treasuryBps New treasury allocation in basis points when `_updateFeeSplit` is true.
    /// @param _memberPoolBps New member pool allocation in basis points when `_updateFeeSplit` is true.
    function updateConfigDAO(
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps
    ) external onlyDAO onlyDelegatecall {
        _updateConfig(_entryFee, _updateFeeSplit, _burnBps, _treasuryBps, _memberPoolBps);
    }

    /// @notice Governance action that toggles whether new members can join.
    /// @param _paused Desired join pause state to apply.
    function setJoinPausedDAO(bool _paused) external onlyDAO onlyDelegatecall {
        _setJoinPaused(_paused);
    }

    /// @notice Governance action that adjusts the membership cap.
    /// @param _maxMembers New membership cap (0 removes the cap).
    function setMaxMembersDAO(uint256 _maxMembers) external onlyDAO onlyDelegatecall {
        _setMaxMembers(_maxMembers);
    }

    /// @notice Governance action that moves treasury balances into the member or external reward pools.
    /// @param token Asset to disband (`address(0)` for ETH).
    function disbandTreasuryDAO(address token) external onlyDAO nonReentrant onlyDelegatecall {
        _disbandTreasury(token, 0);
    }

    /// @notice Governance action that appoints a new priest.
    /// @param newPriest Address of the incoming priest.
    function changePriestDAO(address newPriest) external onlyDAO onlyDelegatecall {
        _changePriest(newPriest);
    }

    /// @notice Governance action that enables or disables dictatorship mode.
    /// @param enabled Target dictatorship state.
    function setDictatorshipDAO(bool enabled) external onlyDAO onlyDelegatecall {
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
    ) external onlyDAO onlyDelegatecall {
        _setTemplMetadata(newName, newDescription, newLogoLink);
    }

    /// @notice Governance action that updates the proposal creation fee expressed in basis points.
    /// @param newFeeBps New proposal creation fee in basis points.
    function setProposalCreationFeeBpsDAO(uint256 newFeeBps) external onlyDAO onlyDelegatecall {
        _setProposalCreationFee(newFeeBps);
    }

    /// @notice Governance action that updates the referral share basis points.
    /// @param newReferralBps New referral share expressed in basis points.
    function setReferralShareBpsDAO(uint256 newReferralBps) external onlyDAO onlyDelegatecall {
        _setReferralShareBps(newReferralBps);
    }

    /// @notice Governance action that reconfigures the entry fee curve.
    /// @param curve New curve configuration to apply.
    /// @param baseEntryFee Entry fee value referenced by the update (0 keeps the existing base).
    function setEntryFeeCurveDAO(CurveConfig calldata curve, uint256 baseEntryFee) external onlyDAO onlyDelegatecall {
        CurveConfig memory config = curve;
        _applyCurveUpdate(config, baseEntryFee);
    }

    /// @notice Removes an empty external reward token so future disbands can reuse the slot.
    /// @param token Asset to remove from the enumeration set.
    function cleanupExternalRewardToken(address token) external onlyDAO onlyDelegatecall {
        _cleanupExternalRewardToken(token);
    }

    /// @notice Governance action that updates the quorum threshold (bps).
    /// @param newQuorumBps New quorum threshold (accepts 0-100 or 0-10_000 bps values).
    function setQuorumBpsDAO(uint256 newQuorumBps) external onlyDAO onlyDelegatecall {
        _setQuorumBps(newQuorumBps);
    }

    /// @notice Governance action that updates the post‑quorum voting period in seconds.
    /// @param newPeriod Seconds to wait after quorum before execution.
    function setPostQuorumVotingPeriodDAO(uint256 newPeriod) external onlyDAO onlyDelegatecall {
        _setPostQuorumVotingPeriod(newPeriod);
    }

    /// @notice Governance action that updates the burn sink address.
    /// @param newBurn Address to receive burn allocations.
    function setBurnAddressDAO(address newBurn) external onlyDAO onlyDelegatecall {
        _setBurnAddress(newBurn);
    }

    /// @notice Governance action that updates the default pre‑quorum voting period (seconds).
    /// @param newPeriod New default pre‑quorum voting period (seconds).
    function setPreQuorumVotingPeriodDAO(uint256 newPeriod) external onlyDAO onlyDelegatecall {
        _setPreQuorumVotingPeriod(newPeriod);
    }

    /// @notice Governance action that performs multiple external calls atomically from the templ.
    /// @dev Executes each call in-order. If any call reverts, bubbles up revert data and reverts the whole batch.
    /// @param targets Destination contracts for each call.
    /// @param values ETH values to forward for each call.
    /// @param calldatas ABI-encoded call data for each call (selector + params).
    /// @return results Return data for each call in order.
    function batchDAO(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external onlyDAO onlyDelegatecall returns (bytes[] memory results) {
        uint256 len = targets.length;
        if (len == 0 || len != values.length || len != calldatas.length) revert TemplErrors.InvalidCallData();
        results = new bytes[](len);
        for (uint256 i = 0; i < len; ++i) {
            address target = targets[i];
            if (target == address(0)) revert TemplErrors.InvalidRecipient();
            (bool success, bytes memory ret) = target.call{ value: values[i] }(calldatas[i]);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(ret, 32), mload(ret))
                }
            }
            results[i] = ret;
        }
    }
}
