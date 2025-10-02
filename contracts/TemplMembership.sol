// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TemplBase} from "./TemplBase.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title templ membership module
/// @notice Handles joins, reward accounting, and member-facing views.
abstract contract TemplMembership is TemplBase {
    using SafeERC20 for IERC20;

    /// @notice Join the templ by paying the configured entry fee on behalf of the caller.
    function join() external whenNotPaused notSelf nonReentrant {
        _join(msg.sender, msg.sender);
    }

    /// @notice Join the templ on behalf of another wallet by covering their entry fee.
    /// @param recipient Wallet receiving membership. Must not already be a member.
    function joinFor(address recipient) external whenNotPaused notSelf nonReentrant {
        _join(msg.sender, recipient);
    }

    /// @dev Shared join workflow that handles accounting updates for new members.
    function _join(address payer, address recipient) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();

        Member storage joiningMember = members[recipient];
        if (joiningMember.joined) revert TemplErrors.MemberAlreadyJoined();

        uint256 currentMemberCount = memberCount;

        if (MAX_MEMBERS > 0 && currentMemberCount >= MAX_MEMBERS) {
            revert TemplErrors.MemberLimitReached();
        }

        if (currentMemberCount > 0) {
            _flushExternalRemainders();
        }

        uint256 price = entryFee;

        uint256 burnAmount = Math.mulDiv(price, burnPercent, TOTAL_PERCENT);
        uint256 memberPoolAmount = Math.mulDiv(price, memberPoolPercent, TOTAL_PERCENT);
        uint256 protocolAmount = Math.mulDiv(price, protocolPercent, TOTAL_PERCENT);
        uint256 treasuryAmount = price - burnAmount - memberPoolAmount - protocolAmount;
        uint256 toContract = treasuryAmount + memberPoolAmount;

        if (IERC20(accessToken).balanceOf(payer) < price) revert TemplErrors.InsufficientBalance();

        joiningMember.joined = true;
        joiningMember.timestamp = block.timestamp;
        joiningMember.blockNumber = block.number;
        memberCount = currentMemberCount + 1;

        if (currentMemberCount > 0) {
            uint256 totalRewards = memberPoolAmount + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / currentMemberCount;
            memberRewardRemainder = totalRewards % currentMemberCount;
            cumulativeMemberRewards += rewardPerMember;
        }

        joiningMember.rewardSnapshot = cumulativeMemberRewards;

        treasuryBalance += treasuryAmount;
        memberPoolBalance += memberPoolAmount;
        IERC20 accessTokenContract = IERC20(accessToken);
        // NOTE: Fee-on-transfer tokens are unsupported; transfer-based fees break internal accounting.
        accessTokenContract.safeTransferFrom(payer, burnAddress, burnAmount);
        accessTokenContract.safeTransferFrom(payer, address(this), toContract);
        accessTokenContract.safeTransferFrom(payer, protocolFeeRecipient, protocolAmount);

        uint256 joinId = currentMemberCount == 0 ? 0 : currentMemberCount - 1;

        emit MemberJoined(
            payer,
            recipient,
            price,
            burnAmount,
            treasuryAmount,
            memberPoolAmount,
            protocolAmount,
            block.timestamp,
            block.number,
            joinId
        );

        _autoPauseIfLimitReached();
        _advanceEntryFeeAfterJoin();
    }

    /// @notice Returns the member pool allocation pending for a given wallet.
    /// @param member Wallet to inspect.
    /// @return amount Claimable balance denominated in the access token.
    function getClaimableMemberRewards(address member) public view returns (uint256) {
        if (!members[member].joined) {
            return 0;
        }

        uint256 accrued = cumulativeMemberRewards;
        uint256 snapshot = members[member].rewardSnapshot;
        return accrued > snapshot ? accrued - snapshot : 0;
    }

    /// @notice Lists ERC-20 (or ETH) reward tokens with active external pools.
    /// @return tokens Array of reward token addresses currently tracked.
    function getExternalRewardTokens() external view returns (address[] memory tokens) {
        return externalRewardTokens;
    }

    /// @notice Returns the global accounting for an external reward token.
    /// @param token ERC-20 token address or address(0) for ETH.
    /// @return poolBalance Amount reserved for members but not yet claimed.
    /// @return cumulativeRewards Cumulative reward per member used for snapshots.
    /// @return remainder Remainder carried forward for the next distribution.
    function getExternalRewardState(address token) external view returns (
        uint256 poolBalance,
        uint256 cumulativeRewards,
        uint256 remainder
    ) {
        ExternalRewardState storage rewards = externalRewards[token];
        return (rewards.poolBalance, rewards.cumulativeRewards, rewards.rewardRemainder);
    }

    /// @notice Computes how much of an external reward token a member can claim.
    /// @param member Wallet to inspect.
    /// @param token ERC-20 token address or address(0) for ETH.
    /// @return amount Claimable balance of the external reward for the member.
    function getClaimableExternalReward(address member, address token) public view returns (uint256 amount) {
        if (!members[member].joined) {
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

    /// @notice Claims the caller's accrued share of the member rewards pool.
    function claimMemberRewards() external onlyMember nonReentrant {
        uint256 claimableAmount = getClaimableMemberRewards(msg.sender);
        if (claimableAmount == 0) revert TemplErrors.NoRewardsToClaim();
        uint256 distributableBalance = memberPoolBalance - memberRewardRemainder;
        if (distributableBalance < claimableAmount) revert TemplErrors.InsufficientPoolBalance();

        members[msg.sender].rewardSnapshot = cumulativeMemberRewards;
        memberPoolClaims[msg.sender] += claimableAmount;
        memberPoolBalance -= claimableAmount;

        IERC20(accessToken).safeTransfer(msg.sender, claimableAmount);

        emit MemberRewardsClaimed(msg.sender, claimableAmount, block.timestamp);
    }

    /// @notice Claims the caller's accrued share of an external reward token or ETH.
    /// @param token ERC-20 token address or address(0) for ETH.
    function claimExternalReward(address token) external onlyMember nonReentrant {
        if (token == accessToken) revert TemplErrors.InvalidCallData();
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) revert TemplErrors.NoRewardsToClaim();

        uint256 claimable = getClaimableExternalReward(msg.sender, token);
        if (claimable == 0) revert TemplErrors.NoRewardsToClaim();

        uint256 remaining = rewards.poolBalance;
        if (remaining < claimable) revert TemplErrors.InsufficientPoolBalance();

        memberExternalRewardSnapshots[msg.sender][token] = rewards.cumulativeRewards;
        rewards.poolBalance = remaining - claimable;

        if (token == address(0)) {
            (bool success, ) = payable(msg.sender).call{value: claimable}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, claimable);
        }

        emit ExternalRewardClaimed(token, msg.sender, claimable);
    }

    /// @notice Reports whether a wallet currently counts as a member.
    function isMember(address user) external view returns (bool) {
        return members[user].joined;
    }

    /// @notice Returns metadata about when a wallet joined.
    /// @param user Wallet to inspect.
    /// @return joined True if the wallet has joined.
    /// @return timestamp Block timestamp when the join completed.
    /// @return blockNumber Block number when the join completed.
    function getJoinDetails(address user) external view returns (
        bool joined,
        uint256 timestamp,
        uint256 blockNumber
    ) {
        Member storage m = members[user];
        return (m.joined, m.timestamp, m.blockNumber);
    }

    /// @notice Exposes treasury balances, member pool totals, and protocol receipts.
    /// @return treasury Access-token balance currently available for governance-controlled withdrawals.
    /// @return memberPool Access-token balance locked for member pool claims.
    /// @return protocolAddress Wallet that receives protocol fee splits during joins.
    function getTreasuryInfo()
        external
        view
        returns (
            uint256 treasury,
            uint256 memberPool,
            address protocolAddress
        )
    {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (available, memberPoolBalance, protocolFeeRecipient);
    }

    /// @notice Returns high level configuration and aggregate balances for the templ.
    /// @return token Address of the access token required for membership.
    /// @return fee Current entry fee denominated in the access token.
    /// @return joinPaused Whether membership joins are paused.
    /// @return joins Historical count of successful joins (excluding the auto-enrolled priest).
    /// @return treasury Treasury balance currently available to governance.
    /// @return pool Aggregate member pool balance reserved for claims.
    /// @return burnPercentOut Burn allocation expressed in basis points.
    /// @return treasuryPercentOut Treasury allocation expressed in basis points.
    /// @return memberPoolPercentOut Member pool allocation expressed in basis points.
    /// @return protocolPercentOut Protocol allocation expressed in basis points.
    function getConfig() external view returns (
        address token,
        uint256 fee,
        bool joinPaused,
        uint256 joins,
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
            joinPaused,
            totalJoins(),
            available,
            memberPoolBalance,
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            protocolPercent
        );
    }

    /// @notice Returns the number of active members.
    /// @return count Number of wallets with active membership (includes the auto-enrolled priest).
    function getMemberCount() external view returns (uint256) {
        return memberCount;
    }

    /// @notice Historical counter for total successful joins (mirrors member count without storing extra state).
    /// @return joins Number of completed joins excluding the auto-enrolled priest.
    function totalJoins() public view returns (uint256) {
        if (memberCount == 0) {
            return 0;
        }
        return memberCount - 1;
    }

    /// @notice Exposes a voter's current vote weight (1 per active member).
    /// @param voter Address to inspect for voting rights.
    /// @return weight Voting weight (1 when the wallet is a member, 0 otherwise).
    function getVoteWeight(address voter) external view returns (uint256 weight) {
        if (!members[voter].joined) {
            return 0;
        }
        return 1;
    }

    /// @dev Determines the cumulative rewards baseline for a member given join-time snapshots.
    function _externalBaselineForMember(
        ExternalRewardState storage rewards,
        Member storage memberInfo
    ) internal view returns (uint256) {
        RewardCheckpoint[] storage checkpoints = rewards.checkpoints;
        uint256 len = checkpoints.length;
        if (len == 0) {
            return rewards.cumulativeRewards;
        }

        uint256 memberBlockNumber = memberInfo.blockNumber;
        uint256 memberTimestamp = memberInfo.timestamp;
        uint256 low = 0;
        uint256 high = len;

        while (low < high) {
            uint256 mid = (low + high) >> 1;
            RewardCheckpoint storage cp = checkpoints[mid];
            if (memberBlockNumber < cp.blockNumber) {
                high = mid;
            } else if (memberBlockNumber > cp.blockNumber) {
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

    /// @dev Distributes any outstanding external reward remainders to existing members before new joins.
    function _flushExternalRemainders() internal {
        uint256 currentMembers = memberCount;
        if (currentMembers == 0) {
            return;
        }
        uint256 tokenCount = externalRewardTokens.length;
        for (uint256 i = 0; i < tokenCount; i++) {
            address token = externalRewardTokens[i];
            ExternalRewardState storage rewards = externalRewards[token];
            uint256 remainder = rewards.rewardRemainder;
            if (remainder == 0) {
                continue;
            }
            uint256 perMember = remainder / currentMembers;
            if (perMember == 0) {
                continue;
            }
            uint256 leftover = remainder % currentMembers;
            rewards.rewardRemainder = leftover;
            rewards.cumulativeRewards += perMember;
            _recordExternalCheckpoint(rewards);
        }
    }
}
