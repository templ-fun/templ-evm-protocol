// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplMembership is TemplBase {
    using SafeERC20 for IERC20;

    constructor(address _protocolFeeRecipient, address _accessToken)
        TemplBase(_protocolFeeRecipient, _accessToken)
    {}

    function purchaseAccess() external whenNotPaused notSelf nonReentrant {
        Member storage m = members[msg.sender];
        if (m.purchased) revert TemplErrors.AlreadyPurchased();

        uint256 burnAmount = (entryFee * BURN_BP) / 100;
        uint256 toContract = (entryFee * (TREASURY_BP + MEMBER_POOL_BP)) / 100;
        uint256 protocolAmount = (entryFee * PROTOCOL_BP) / 100;

        if (IERC20(accessToken).balanceOf(msg.sender) < entryFee) revert TemplErrors.InsufficientBalance();

        m.purchased = true;
        m.timestamp = block.timestamp;
        m.block = block.number;
        memberList.push(msg.sender);
        totalPurchases++;

        if (memberList.length > 1) {
            uint256 totalRewards = ((entryFee * MEMBER_POOL_BP) / 100) + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / (memberList.length - 1);
            memberRewardRemainder = totalRewards % (memberList.length - 1);
            cumulativeMemberRewards += rewardPerMember;
        }

        m.rewardSnapshot = cumulativeMemberRewards;

        uint256 thirtyPercent = (entryFee * 30) / 100;
        treasuryBalance += thirtyPercent;
        memberPoolBalance += thirtyPercent;
        totalBurned += burnAmount;
        totalToTreasury += thirtyPercent;
        totalToMemberPool += thirtyPercent;
        totalToProtocol += protocolAmount;

        IERC20 token = IERC20(accessToken);
        token.safeTransferFrom(msg.sender, DEAD_ADDRESS, burnAmount);
        token.safeTransferFrom(msg.sender, address(this), toContract);
        token.safeTransferFrom(msg.sender, protocolFeeRecipient, protocolAmount);

        emit AccessPurchased(
            msg.sender,
            entryFee,
            burnAmount,
            thirtyPercent,
            thirtyPercent,
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
        uint256 pool
    ) {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (accessToken, entryFee, paused, totalPurchases, available, memberPoolBalance);
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
}
