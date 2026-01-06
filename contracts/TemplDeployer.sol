// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {CreateConfig} from "./TemplFactoryTypes.sol";

/// @title ITemplDeployer
/// @notice Deploys fresh TEMPL routers on behalf of the factory to keep factory bytecode small.
/// @author templ.fun
interface ITemplDeployer {
    /// @notice Deploy a new templ instance with the provided configuration.
    /// @param cfg Full templ creation config (router constructor inputs).
    /// @param protocolFeeRecipient Address that receives the protocol share on joins.
    /// @param protocolBps Protocol fee share in basis points.
    /// @param membershipModule Membership module implementation address.
    /// @param treasuryModule Treasury module implementation address.
    /// @param governanceModule Governance module implementation address.
    /// @param councilModule Council module implementation address.
    /// @return templAddress Address of the newly deployed templ router.
    function deployTempl(
        CreateConfig calldata cfg,
        address protocolFeeRecipient,
        uint256 protocolBps,
        address membershipModule,
        address treasuryModule,
        address governanceModule,
        address councilModule
    ) external returns (address templAddress);
}

/// @title TemplDeployer
/// @notice Thin wrapper that deploys a fresh TEMPL instance.
/// @dev Keeps the heavy creation bytecode out of the factory so the factory stays within size limits.
/// @author templ.fun
contract TemplDeployer is ITemplDeployer {
    /// @inheritdoc ITemplDeployer
    function deployTempl(
        CreateConfig calldata cfg,
        address protocolFeeRecipient,
        uint256 protocolBps,
        address membershipModule,
        address treasuryModule,
        address governanceModule,
        address councilModule
    ) external returns (address templAddress) {
        uint256 burnBps = uint256(cfg.burnBps);
        uint256 treasuryBps = uint256(cfg.treasuryBps);
        uint256 memberPoolBps = uint256(cfg.memberPoolBps);

        TEMPL templ = new TEMPL(
            cfg.priest,
            protocolFeeRecipient,
            cfg.token,
            cfg.entryFee,
            burnBps,
            treasuryBps,
            memberPoolBps,
            protocolBps,
            cfg.quorumBps,
            cfg.executionDelaySeconds,
            cfg.burnAddress,
            cfg.maxMembers,
            cfg.name,
            cfg.description,
            cfg.logoLink,
            cfg.proposalFeeBps,
            cfg.referralShareBps,
            cfg.yesVoteThresholdBps,
            cfg.instantQuorumBps,
            cfg.councilMode,
            membershipModule,
            treasuryModule,
            governanceModule,
            councilModule,
            cfg.curve
        );
        templAddress = address(templ);
    }
}
