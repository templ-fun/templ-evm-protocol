// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "../TEMPL.sol";
import {TemplMembershipModule} from "../TemplMembership.sol";
import {TemplTreasuryModule} from "../TemplTreasury.sol";
import {TemplGovernanceModule} from "../TemplGovernance.sol";
import {TemplCouncilModule} from "../TemplCouncil.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "../TemplCurve.sol";
import {TestToken} from "../mocks/TestToken.sol";

/// @title EchidnaTemplHarness
/// @notice Echidna property-based fuzzing harness for TEMPL.
/// - Exposes safe state-changing targets: joinFor and joinForWithReferral
/// - Asserts invariants over fee split and entry fee bounds
contract EchidnaTemplHarness {
    // System under test
    TEMPL public templ;
    TestToken public token;

    // Fixed actors for deterministic setup
    address public priest;
    address public protocolFeeRecipient;

    uint256 private lastCumulativeMemberRewards;
    uint256 private lastTreasuryBalance;
    uint256 private lastMemberCount;

    constructor() {
        priest = address(this);
        protocolFeeRecipient = address(0xB0B);

        // Deploy access token (anyone can mint in TestToken)
        token = new TestToken("EchidnaToken", "ECH", 18);

        // Deploy delegatecall modules
        TemplMembershipModule membership = new TemplMembershipModule();
        TemplTreasuryModule treasury = new TemplTreasuryModule();
        TemplGovernanceModule governance = new TemplGovernanceModule();
        TemplCouncilModule council = new TemplCouncilModule();

        // Exponential curve with 11_000 bps growth, infinite tail
        CurveConfig memory curve;
        curve.primary = CurveSegment({style: CurveStyle.Exponential, rateBps: 11_000, length: 0});
        // no additional segments

        // Deploy TEMPL root contract
        templ = new TEMPL(
            priest, // priest
            protocolFeeRecipient, // protocol fee recipient
            address(token), // access token
            10 ether, // entry fee (arbitrary >= 10 units)
            3000, // burn bps
            3000, // treasury bps
            3000, // member pool bps
            1000, // protocol bps
            3300, // quorum bps
            1, // execution delay (short so Echidna can pass time if needed)
            0x000000000000000000000000000000000000dEaD, // burn sink
            false, // dictatorship off
            0, // no member cap
            "Echidna Templ", // name
            "", // description
            "", // logo
            0, // proposal fee bps
            0, // referral share bps
            5_100, // yes vote threshold bps
            10_000, // instant quorum bps
            false, // start in council mode
            address(membership),
            address(treasury),
            address(governance),
            address(council),
            curve
        );

        // Initialize monotonic trackers
        lastCumulativeMemberRewards = templ.cumulativeMemberRewards();
        lastTreasuryBalance = templ.treasuryBalance();
        lastMemberCount = templ.memberCount();
    }

    // --- Fuzz Targets ---

    /// @notice Pay for another wallet to join using the harness balance.
    function fuzzJoinFor(address recipient) external {
        if (recipient == address(0)) return;
        uint256 fee = templ.entryFee();
        // fund harness with enough tokens and approve
        token.mint(address(this), fee);
        token.approve(address(templ), type(uint256).max);
        // ignore outcome (may revert due to cap/pause/member already joined)
        (bool ok, ) = address(templ).call(abi.encodeWithSignature("joinFor(address)", recipient));
        ok; // silence warning
        // update trackers post-action
        _syncTrackers();
    }

    /// @notice Pay for another wallet to join and attempt a referral credit.
    function fuzzJoinForWithReferral(address recipient, address referral) external {
        if (recipient == address(0) || referral == recipient) return;
        uint256 fee = templ.entryFee();
        token.mint(address(this), fee);
        token.approve(address(templ), type(uint256).max);
        (bool ok, ) = address(templ).call(
            abi.encodeWithSignature("joinForWithReferral(address,address)", recipient, referral)
        );
        ok;
        _syncTrackers();
    }

    // --- Invariants ---

    /// @notice Fee split always sums to 10_000 bps including protocol share.
    function echidna_fee_split_sums_to_10000() external view returns (bool) {
        return templ.burnBps() + templ.treasuryBps() + templ.memberPoolBps() + templ.protocolBps() == 10_000;
    }

    /// @notice Entry fee never exceeds the uint128 saturation limit used in on-chain math.
    function echidna_entry_fee_bounded() external view returns (bool) {
        return templ.entryFee() <= type(uint128).max;
    }

    /// @notice Member count never exceeds configured cap (0 = uncapped).
    function echidna_membercount_respects_cap() external view returns (bool) {
        uint256 cap = templ.maxMembers();
        return cap == 0 || templ.memberCount() <= cap;
    }

    /// @notice Cumulative per-member rewards never decrease.
    function echidna_cumulative_rewards_monotonic() external view returns (bool) {
        return templ.cumulativeMemberRewards() >= lastCumulativeMemberRewards;
    }

    /// @notice Treasury balance does not decrease during join operations.
    function echidna_treasury_balance_monotonic() external view returns (bool) {
        return templ.treasuryBalance() >= lastTreasuryBalance;
    }

    /// @notice Member count never decreases (there is no member removal flow).
    function echidna_membercount_monotonic() external view returns (bool) {
        return templ.memberCount() >= lastMemberCount;
    }

    function _syncTrackers() internal {
        uint256 cur = templ.cumulativeMemberRewards();
        if (cur > lastCumulativeMemberRewards) lastCumulativeMemberRewards = cur;
        uint256 tb = templ.treasuryBalance();
        if (tb > lastTreasuryBalance) lastTreasuryBalance = tb;
        uint256 mc = templ.memberCount();
        if (mc > lastMemberCount) lastMemberCount = mc;
    }
}
