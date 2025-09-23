// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplMembership is TemplBase {
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
    )
        TemplBase(
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
        )
    {}

    function purchaseAccess() external whenNotPaused notSelf nonReentrant {
        Member storage m = members[msg.sender];
        if (m.purchased) revert TemplErrors.AlreadyPurchased();

        uint256 burnAmount = (entryFee * burnPercent) / TOTAL_PERCENT;
        uint256 treasuryAmount = (entryFee * treasuryPercent) / TOTAL_PERCENT;
        uint256 memberPoolAmount = (entryFee * memberPoolPercent) / TOTAL_PERCENT;
        uint256 protocolAmount = (entryFee * protocolPercent) / TOTAL_PERCENT;

        uint256 distributed = burnAmount + treasuryAmount + memberPoolAmount + protocolAmount;
        if (distributed < entryFee) {
            uint256 remainder = entryFee - distributed;
            treasuryAmount += remainder;
            distributed += remainder;
        }

        uint256 toContract = treasuryAmount + memberPoolAmount;

        if (IERC20(accessToken).balanceOf(msg.sender) < entryFee) revert TemplErrors.InsufficientBalance();

        m.purchased = true;
        m.timestamp = block.timestamp;
        m.block = block.number;
        memberList.push(msg.sender);
        totalPurchases++;

        if (memberList.length > 1) {
            uint256 totalRewards = memberPoolAmount + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / (memberList.length - 1);
            memberRewardRemainder = totalRewards % (memberList.length - 1);
            cumulativeMemberRewards += rewardPerMember;
        }

        m.rewardSnapshot = cumulativeMemberRewards;

        treasuryBalance += treasuryAmount;
        memberPoolBalance += memberPoolAmount;
        totalBurned += burnAmount;
        totalToTreasury += treasuryAmount;
        totalToMemberPool += memberPoolAmount;
        totalToProtocol += protocolAmount;

        IERC20 token = IERC20(accessToken);
        // NOTE: Fee-on-transfer tokens are unsupported; transfer-based fees break internal accounting.
        token.safeTransferFrom(msg.sender, burnAddress, burnAmount);
        token.safeTransferFrom(msg.sender, address(this), toContract);
        token.safeTransferFrom(msg.sender, protocolFeeRecipient, protocolAmount);

        emit AccessPurchased(
            msg.sender,
            entryFee,
            burnAmount,
            treasuryAmount,
            memberPoolAmount,
            protocolAmount,
            block.timestamp,
            block.number,
            totalPurchases - 1
        );
    }

    function getClaimablePoolAmount(address member) public view returns (uint256) {
        if (!members[member].purchased) {
            return 0;
        }

        uint256 accrued = cumulativeMemberRewards;
        uint256 snapshot = members[member].rewardSnapshot;
        return accrued > snapshot ? accrued - snapshot : 0;
    }

    function getExternalRewardTokens() external view returns (address[] memory) {
        return externalRewardTokens;
    }

    function getExternalRewardState(address token) external view returns (
        uint256 poolBalance,
        uint256 cumulativeRewards,
        uint256 remainder
    ) {
        ExternalRewardState storage rewards = externalRewards[token];
        return (rewards.poolBalance, rewards.cumulativeRewards, rewards.rewardRemainder);
    }

    function getClaimableExternalToken(address member, address token) public view returns (uint256) {
        if (!members[member].purchased) {
            return 0;
        }
        if (token == accessToken) {
            return 0;
        }
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            return 0;
        }
        Member storage memberInfo = members[member];
        uint256 accrued = rewards.cumulativeRewards;
        uint256 baseline = _externalBaselineForMember(rewards, memberInfo);
        uint256 snapshot = memberExternalRewardSnapshots[member][token];
        if (snapshot < baseline) {
            snapshot = baseline;
        }
        return accrued > snapshot ? accrued - snapshot : 0;
    }

    function claimMemberPool() external onlyMember nonReentrant {
        uint256 claimable = getClaimablePoolAmount(msg.sender);
        if (claimable == 0) revert TemplErrors.NoRewardsToClaim();
        uint256 distributable = memberPoolBalance - memberRewardRemainder;
        if (distributable < claimable) revert TemplErrors.InsufficientPoolBalance();

        members[msg.sender].rewardSnapshot = cumulativeMemberRewards;
        memberPoolClaims[msg.sender] += claimable;
        memberPoolBalance -= claimable;

        IERC20(accessToken).safeTransfer(msg.sender, claimable);

        emit MemberPoolClaimed(msg.sender, claimable, block.timestamp);
    }

    function claimExternalToken(address token) external onlyMember nonReentrant {
        if (token == accessToken) revert TemplErrors.InvalidCallData();
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) revert TemplErrors.NoRewardsToClaim();

        uint256 claimable = getClaimableExternalToken(msg.sender, token);
        if (claimable == 0) revert TemplErrors.NoRewardsToClaim();

        uint256 remaining = rewards.poolBalance;
        if (remaining < claimable) revert TemplErrors.InsufficientPoolBalance();

        memberExternalRewardSnapshots[msg.sender][token] = rewards.cumulativeRewards;
        memberExternalClaims[msg.sender][token] += claimable;
        rewards.poolBalance = remaining - claimable;

        if (token == address(0)) {
            (bool success, ) = payable(msg.sender).call{value: claimable}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, claimable);
        }

        emit ExternalRewardClaimed(token, msg.sender, claimable);
    }

    function hasAccess(address user) external view returns (bool) {
        return members[user].purchased;
    }

    function getPurchaseDetails(address user) external view returns (
        bool purchased,
        uint256 timestamp,
        uint256 blockNum
    ) {
        Member storage m = members[user];
        return (m.purchased, m.timestamp, m.block);
    }

    function getTreasuryInfo() external view returns (
        uint256 treasury,
        uint256 memberPool,
        uint256 totalReceived,
        uint256 totalBurnedAmount,
        uint256 totalProtocolFees,
        address protocolAddress
    ) {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (
            available,
            memberPoolBalance,
            totalToTreasury,
            totalBurned,
            totalToProtocol,
            protocolFeeRecipient
        );
    }

    function getConfig() external view returns (
        address token,
        uint256 fee,
        bool isPaused,
        uint256 purchases,
        uint256 treasury,
        uint256 pool,
        uint256 burnPercentOut,
        uint256 treasuryPercentOut,
        uint256 memberPoolPercentOut,
        uint256 protocolPercentOut
    ) {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (
            accessToken,
            entryFee,
            paused,
            totalPurchases,
            available,
            memberPoolBalance,
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            protocolPercent
        );
    }

    function getMemberCount() external view returns (uint256) {
        return memberList.length;
    }

    function getVoteWeight(address voter) external view returns (uint256) {
        if (!members[voter].purchased) {
            return 0;
        }
        return 1;
    }

    function _recordExternalCheckpoint(ExternalRewardState storage rewards) internal {
        RewardCheckpoint memory checkpoint = RewardCheckpoint({
            blockNumber: uint64(block.number),
            timestamp: uint64(block.timestamp),
            cumulative: rewards.cumulativeRewards
        });
        uint256 len = rewards.checkpoints.length;
        if (len == 0) {
            rewards.checkpoints.push(checkpoint);
            return;
        }
        RewardCheckpoint storage last = rewards.checkpoints[len - 1];
        if (last.blockNumber == checkpoint.blockNumber) {
            last.timestamp = checkpoint.timestamp;
            last.cumulative = checkpoint.cumulative;
        } else {
            rewards.checkpoints.push(checkpoint);
        }
    }

    function _externalBaselineForMember(
        ExternalRewardState storage rewards,
        Member storage memberInfo
    ) internal view returns (uint256) {
        RewardCheckpoint[] storage checkpoints = rewards.checkpoints;
        uint256 len = checkpoints.length;
        if (len == 0) {
            return rewards.cumulativeRewards;
        }

        uint256 memberBlock = memberInfo.block;
        uint256 memberTimestamp = memberInfo.timestamp;
        uint256 low = 0;
        uint256 high = len;

        while (low < high) {
            uint256 mid = (low + high) >> 1;
            RewardCheckpoint storage cp = checkpoints[mid];
            if (memberBlock < cp.blockNumber) {
                high = mid;
            } else if (memberBlock > cp.blockNumber) {
                low = mid + 1;
            } else if (memberTimestamp < cp.timestamp) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        if (low == 0) {
            return 0;
        }

        return checkpoints[low - 1].cumulative;
    }
}
