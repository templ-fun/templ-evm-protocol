// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TemplModuleBase} from "./TemplModuleBase.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title Templ Membership Module
/// @notice Handles joins, reward accounting, and member-facing views.
/// @author templ.fun
contract TemplMembershipModule is TemplModuleBase {

    /// @notice Emitted when a valid referral is credited during a join.
    /// @param referral The referrer wallet that receives the payout.
    /// @param newMember The wallet that just joined.
    /// @param amount Amount of access token paid to `referral`.
    event ReferralRewardPaid(address indexed referral, address indexed newMember, uint256 indexed amount);

    /// @notice Join the templ by paying the configured entry fee on behalf of the caller.
    function join() external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, msg.sender, address(0), type(uint256).max);
    }

    /// @notice Join the templ by paying the entry fee on behalf of the caller with a referral.
    /// @param referral Member credited with the referral reward.
    function joinWithReferral(address referral) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, msg.sender, referral, type(uint256).max);
    }

    /// @notice Join the templ on behalf of another wallet by covering their entry fee.
    /// @param recipient Wallet receiving membership. Must not already be a member.
    function joinFor(address recipient) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, recipient, address(0), type(uint256).max);
    }

    /// @notice Join the templ for another wallet while crediting a referral.
    /// @param recipient Wallet receiving membership. Must not already be a member.
    /// @param referral Member credited with the referral reward.
    function joinForWithReferral(
        address recipient,
        address referral
    ) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, recipient, referral, type(uint256).max);
    }

    /// @notice Join the templ with a maximum entry fee to protect against slippage.
    /// @param maxEntryFee Maximum entry fee the caller is willing to pay.
    function joinWithMaxEntryFee(uint256 maxEntryFee) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, msg.sender, address(0), maxEntryFee);
    }

    /// @notice Join the templ with a referral and a maximum entry fee.
    /// @param referral Member credited with the referral reward.
    /// @param maxEntryFee Maximum entry fee the caller is willing to pay.
    function joinWithReferralMaxEntryFee(
        address referral,
        uint256 maxEntryFee
    ) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, msg.sender, referral, maxEntryFee);
    }

    /// @notice Join the templ on behalf of another wallet with a maximum entry fee.
    /// @param recipient Wallet receiving membership. Must not already be a member.
    /// @param maxEntryFee Maximum entry fee the caller is willing to pay.
    function joinForWithMaxEntryFee(
        address recipient,
        uint256 maxEntryFee
    ) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, recipient, address(0), maxEntryFee);
    }

    /// @notice Join the templ for another wallet with a referral and a maximum entry fee.
    /// @param recipient Wallet receiving membership. Must not already be a member.
    /// @param referral Member credited with the referral reward.
    /// @param maxEntryFee Maximum entry fee the caller is willing to pay.
    function joinForWithReferralMaxEntryFee(
        address recipient,
        address referral,
        uint256 maxEntryFee
    ) external whenNotPaused notSelf nonReentrant onlyDelegatecall {
        _join(msg.sender, recipient, referral, maxEntryFee);
    }
    /// @notice Shared join workflow that handles accounting updates for new members.
    /// @param payer Wallet that pays the entry fee.
    /// @param recipient Wallet that receives membership.
    /// @param referral Optional referrer credited from the member pool.
    /// @param maxEntryFee Maximum entry fee the caller is willing to pay.
    function _join(address payer, address recipient, address referral, uint256 maxEntryFee) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();

        Member storage joiningMember = members[recipient];
        if (joiningMember.joined) revert TemplErrors.MemberAlreadyJoined();

        uint256 currentMemberCount = memberCount;

        if (maxMembers > 0 && currentMemberCount == maxMembers) {
            revert TemplErrors.MemberLimitReached();
        }

        uint256 price = entryFee;
        if (price > maxEntryFee) revert TemplErrors.EntryFeeTooHigh();

        uint256 burnAmount = (price * burnBps) / BPS_DENOMINATOR;
        uint256 memberPoolAmount = (price * memberPoolBps) / BPS_DENOMINATOR;
        uint256 referralAmount = 0;
        address referralTarget = address(0);
        if (referral != address(0) && referralShareBps != 0) {
            Member storage referralMember = members[referral];
            if (referralMember.joined && referral != recipient) {
                referralAmount = (memberPoolAmount * referralShareBps) / BPS_DENOMINATOR;
                referralTarget = referral;
            }
        }
        uint256 protocolAmount = (price * protocolBps) / BPS_DENOMINATOR;
        uint256 treasuryAmount = price - burnAmount - memberPoolAmount - protocolAmount;
        if (IERC20(accessToken).balanceOf(payer) < price) revert TemplErrors.InsufficientBalance();

        joiningMember.joined = true;
        joiningMember.timestamp = block.timestamp;
        joiningMember.blockNumber = block.number;
        uint256 sequence = ++joinSequence;
        memberCount = currentMemberCount + 1;

        uint256 distributablePool = memberPoolAmount - referralAmount;

        if (currentMemberCount > 0) {
            uint256 totalRewards = distributablePool + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / currentMemberCount;
            memberRewardRemainder = totalRewards % currentMemberCount;
            cumulativeMemberRewards += rewardPerMember;
        }

        joiningMember.rewardSnapshot = cumulativeMemberRewards;
        joiningMember.joinSequence = sequence;

        treasuryBalance += treasuryAmount;
        memberPoolBalance += distributablePool;

        if (burnAmount > 0) {
            totalBurned += burnAmount;
        }
        _safeTransferFrom(accessToken, payer, address(this), price);
        _safeTransfer(accessToken, burnAddress, burnAmount);
        _safeTransfer(accessToken, protocolFeeRecipient, protocolAmount);

        if (referralAmount > 0) {
            _safeTransfer(accessToken, referralTarget, referralAmount);
            emit ReferralRewardPaid(referralTarget, recipient, referralAmount);
        }

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
    function getClaimableMemberRewards(address member) public view onlyDelegatecall returns (uint256 amount) {
        if (!members[member].joined) {
            return 0;
        }

        uint256 accrued = cumulativeMemberRewards;
        uint256 snapshot = members[member].rewardSnapshot;
        return accrued > snapshot ? accrued - snapshot : 0;
    }

    /// @notice Claims the caller's accrued share of the member rewards pool.
    function claimMemberRewards() external onlyMember nonReentrant onlyDelegatecall {
        uint256 claimableAmount = getClaimableMemberRewards(msg.sender);
        if (claimableAmount == 0) revert TemplErrors.NoRewardsToClaim();
        uint256 distributableBalance = memberPoolBalance - memberRewardRemainder;
        if (distributableBalance < claimableAmount) revert TemplErrors.InsufficientPoolBalance();

        members[msg.sender].rewardSnapshot = cumulativeMemberRewards;
        memberPoolClaims[msg.sender] += claimableAmount;
        memberPoolBalance -= claimableAmount;

        _safeTransfer(accessToken, msg.sender, claimableAmount);

        emit MemberRewardsClaimed(msg.sender, claimableAmount, block.timestamp);
    }

    /// @notice Reports whether a wallet currently counts as a member.
    /// @param user Wallet to inspect.
    /// @return joined True when the wallet has an active membership.
    function isMember(address user) external view onlyDelegatecall returns (bool joined) {
        return members[user].joined;
    }

    /// @notice Returns metadata about when a wallet joined.
    /// @param user Wallet to inspect.
    /// @return joined True if the wallet has joined.
    /// @return timestamp Block timestamp when the join completed.
    /// @return blockNumber Block number when the join completed.
    function getJoinDetails(
        address user
    ) external view onlyDelegatecall returns (bool joined, uint256 timestamp, uint256 blockNumber) {
        Member storage m = members[user];
        return (m.joined, m.timestamp, m.blockNumber);
    }

    /// @notice Exposes treasury balances, member pool totals, and protocol receipts.
    /// @return treasury Access-token balance currently available for governance-controlled withdrawals.
    /// @return memberPool Access-token balance locked for member pool claims.
    /// @return protocolAddress Wallet that receives protocol fee splits during joins.
    /// @return burned Cumulative access-token amount sent to the burn address.
    function getTreasuryInfo()
        external
        view
        onlyDelegatecall
        returns (uint256 treasury, uint256 memberPool, address protocolAddress, uint256 burned)
    {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (available, memberPoolBalance, protocolFeeRecipient, totalBurned);
    }

    /// @notice Returns high level configuration and aggregate balances for the templ.
    /// @return token Address of the access token required for membership.
    /// @return fee Current entry fee denominated in the access token.
    /// @return joinPaused Whether membership joins are paused.
    /// @return joins Total count of successful joins (excluding the auto-enrolled priest).
    /// @return treasury Treasury balance currently available to governance.
    /// @return pool Aggregate member pool balance reserved for claims.
    /// @return burnBpsOut Burn allocation expressed in basis points.
    /// @return treasuryBpsOut Treasury allocation expressed in basis points.
    /// @return memberPoolBpsOut Member pool allocation expressed in basis points.
    /// @return protocolBpsOut Protocol allocation expressed in basis points.
    function getConfig()
        external
        view
        onlyDelegatecall
        returns (
            address token,
            uint256 fee,
            bool joinPaused,
            uint256 joins,
            uint256 treasury,
            uint256 pool,
            uint256 burnBpsOut,
            uint256 treasuryBpsOut,
            uint256 memberPoolBpsOut,
            uint256 protocolBpsOut
        )
    {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (
            accessToken,
            entryFee,
            joinPaused,
            totalJoins(),
            available,
            memberPoolBalance,
            burnBps,
            treasuryBps,
            memberPoolBps,
            protocolBps
        );
    }

    /// @notice Returns the number of active members.
    /// @return count Number of wallets with active membership (includes the auto-enrolled priest).
    function getMemberCount() external view onlyDelegatecall returns (uint256 count) {
        return memberCount;
    }

    /// @notice Total counter for successful joins (mirrors member count without storing extra state).
    /// @return joins Number of completed joins excluding the auto-enrolled priest.
    function totalJoins() public view onlyDelegatecall returns (uint256 joins) {
        if (memberCount == 0) {
            return 0;
        }
        return memberCount - 1;
    }

    /// @notice Exposes a voter's current vote weight (1 per active member).
    /// @param voter Address to inspect for voting rights.
    /// @return weight Voting weight (1 when the wallet is a member, 0 otherwise).
    function getVoteWeight(address voter) external view onlyDelegatecall returns (uint256 weight) {
        if (!members[voter].joined) {
            return 0;
        }
        if (councilModeEnabled && !councilMembers[voter]) {
            return 0;
        }
        return 1;
    }
}
