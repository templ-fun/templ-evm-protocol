// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CurveConfig} from "./TemplCurve.sol";

/// @notice Shared factory deployment configuration.
/// @dev Kept in a standalone file so helper contracts can reuse the layout without duplication.
struct CreateConfig {
    /// @notice Initial priest wallet (auto-enrolled as member #1).
    address priest;
    /// @notice ERC-20 token used for membership payments.
    address token;
    /// @notice Initial entry fee (must be >= 10 and divisible by 10).
    uint256 entryFee;
    /// @notice Burn share (bps). Use -1 to apply factory default.
    int256 burnBps;
    /// @notice Treasury share (bps). Use -1 to apply factory default.
    int256 treasuryBps;
    /// @notice Member pool share (bps). Use -1 to apply factory default.
    int256 memberPoolBps;
    /// @notice Quorum threshold (bps). 0 applies factory default.
    uint256 quorumBps;
    /// @notice Execution delay after quorum (seconds). 0 applies factory default.
    uint256 executionDelaySeconds;
    /// @notice Burn address (zero applies default dead address).
    address burnAddress;
    /// @notice Start in dictatorship mode (priest may call onlyDAO actions directly).
    bool priestIsDictator;
    /// @notice Optional membership cap (0 = uncapped).
    uint256 maxMembers;
    /// @notice Whether a custom curve is provided (false uses factory default curve).
    bool curveProvided;
    /// @notice Pricing curve configuration (see TemplCurve).
    CurveConfig curve;
    /// @notice Human-readable templ name.
    string name;
    /// @notice Short description.
    string description;
    /// @notice Canonical logo URL.
    string logoLink;
    /// @notice Proposal creation fee (bps of current entry fee).
    uint256 proposalFeeBps;
    /// @notice Referral share (bps of the member pool allocation).
    uint256 referralShareBps;
    /// @notice YES vote threshold (bps of votes cast). 0 applies factory default.
    uint256 yesVoteThresholdBps;
    /// @notice Whether the templ should start in council governance mode.
    bool councilMode;
    /// @notice Instant quorum threshold (bps) that enables immediate execution when satisfied. Must be >= quorum. 0 applies factory default.
    uint256 instantQuorumBps;
}
