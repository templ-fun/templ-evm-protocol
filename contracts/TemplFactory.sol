// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "./TemplCurve.sol";
import {TemplDefaults} from "./TemplDefaults.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Templ Factory
/// @notice Deploys Templ contracts with shared protocol configuration and optional custom splits.
/// @dev Default burn/treasury/member shares assume a factory protocol share of 1,000 bps (10%).
///      If `PROTOCOL_BPS` differs, either pass explicit splits to `createTemplWithConfig` or
///      adjust the defaults so the totals continue to sum to 10_000 bps.
/// @author templ.fun
contract TemplFactory {
    using SafeERC20 for IERC20;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant DEFAULT_BURN_BPS = 3_000;
    uint256 internal constant DEFAULT_TREASURY_BPS = 3_000;
    uint256 internal constant DEFAULT_MEMBER_POOL_BPS = 3_000;
    uint256 internal constant DEFAULT_QUORUM_BPS = TemplDefaults.DEFAULT_QUORUM_BPS;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = TemplDefaults.DEFAULT_EXECUTION_DELAY;
    address internal constant DEFAULT_BURN_ADDRESS = TemplDefaults.DEFAULT_BURN_ADDRESS;
    int256 internal constant USE_DEFAULT_BPS = -1;
    uint256 internal constant DEFAULT_MAX_MEMBERS = 249;
    uint32 internal constant DEFAULT_CURVE_EXP_RATE_BPS = 10_094;
    uint256 internal constant DEFAULT_PROPOSAL_FEE_BPS = 2_500;
    uint256 internal constant DEFAULT_REFERRAL_SHARE_BPS = 2_500;
    /// @dev Probe amount used by `safeDeployFor` to sanity-check vanilla ERC-20 semantics.
    uint256 internal constant SAFE_DEPLOY_PROBE_AMOUNT = 100_000;

    /// @notice Full templ creation configuration. Use `createTemplWithConfig` to apply.
    struct CreateConfig {
        /// @notice Initial priest wallet (auto-enrolled as member #1).
        address priest;
        /// @notice ERC-20 token used for membership payments.
        address token;
        /// @notice Initial entry fee (must be ≥ 10 and divisible by 10).
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
        /// @notice Instant quorum threshold (bps) that enables immediate execution when satisfied. Must be ≥ quorum. 0 applies factory default.
        uint256 instantQuorumBps;
        /// @notice Addresses to auto-enroll as council members (and members) at deploy.
        address[] initialCouncilMembers;
    }

    /// @notice Address that receives the protocol share in newly created templs.
    address public immutable PROTOCOL_FEE_RECIPIENT;
    /// @notice Protocol fee share (bps) applied to all templs created by this factory.
    uint256 public immutable PROTOCOL_BPS;
    /// @notice Membership module implementation used by templs deployed via this factory.
    address public immutable MEMBERSHIP_MODULE;
    /// @notice Treasury module implementation used by templs deployed via this factory.
    address public immutable TREASURY_MODULE;
    /// @notice Governance module implementation used by templs deployed via this factory.
    address public immutable GOVERNANCE_MODULE;
    /// @notice Council governance module implementation used by templs deployed via this factory.
    address public immutable COUNCIL_MODULE;
    /// @notice Account allowed to create templs while permissionless mode is disabled.
    /// @dev Can be transferred by the current deployer via `transferDeployer`.
    address public factoryDeployer;
    /// @notice When true, any address may create templs via this factory.
    bool public permissionless;

    /// @notice Emitted after deploying a new templ instance.
    /// @param templ Address of the deployed templ.
    /// @param creator Transaction sender that invoked the creation.
    /// @param priest Priest wallet configured on the templ.
    /// @param token Access token used for joins.
    /// @param entryFee Initial entry fee.
    /// @param burnBps Burn share (bps) applied on joins.
    /// @param treasuryBps Treasury share (bps) applied on joins.
    /// @param memberPoolBps Member pool share (bps) applied on joins.
    /// @param quorumBps Quorum threshold (bps).
    /// @param executionDelaySeconds Seconds to wait after quorum before execution.
    /// @param burnAddress Burn sink address.
    /// @param priestIsDictator Whether dictatorship is enabled at deploy.
    /// @param maxMembers Membership cap (0 = uncapped).
    /// @param curveStyles Segment styles applied to the templ's join curve.
    /// @param curveRateBps Rate parameters for each segment (basis points).
    /// @param curveLengths Paid join counts per segment (0 = extends indefinitely).
    /// @param name Templ name.
    /// @param description Templ description.
    /// @param logoLink Templ logo URL.
    /// @param proposalFeeBps Proposal fee (bps of entry fee).
    /// @param referralShareBps Referral share (bps of member pool).
    /// @param yesVoteThresholdBps YES vote threshold (bps of votes cast).
    /// @param instantQuorumBps Instant quorum threshold (bps of eligible voters).
    /// @param councilMode Whether the templ launched in council governance mode.
    /// @param initialCouncilMembers Addresses auto-enrolled as council members at deploy.
    event TemplCreated(
        address indexed templ,
        address indexed creator,
        address indexed priest,
        address token,
        uint256 entryFee,
        uint256 burnBps,
        uint256 treasuryBps,
        uint256 memberPoolBps,
        uint256 quorumBps,
        uint256 executionDelaySeconds,
        address burnAddress,
        bool priestIsDictator,
        uint256 maxMembers,
        uint8[] curveStyles,
        uint32[] curveRateBps,
        uint32[] curveLengths,
        string name,
        string description,
        string logoLink,
        uint256 proposalFeeBps,
        uint256 referralShareBps,
        uint256 yesVoteThresholdBps,
        uint256 instantQuorumBps,
        bool councilMode,
        address[] initialCouncilMembers
    );

    /// @notice Emitted when factory permissionless mode is toggled.
    /// @param enabled True when any address may create templs.
    event PermissionlessModeUpdated(bool indexed enabled);
    /// @notice Emitted when the factory deployer is changed.
    /// @param previousDeployer The previous deployer address.
    /// @param newDeployer The new deployer address.
    event DeployerTransferred(address indexed previousDeployer, address indexed newDeployer);

    /// @notice Returns the default curve configuration applied by the factory.
    /// @return cfg Exponential until the 249th member, then static tail.
    function _defaultCurveConfig() internal pure returns (CurveConfig memory cfg) {
        CurveSegment memory primary = CurveSegment({
            style: CurveStyle.Exponential,
            rateBps: DEFAULT_CURVE_EXP_RATE_BPS,
            length: uint32(DEFAULT_MAX_MEMBERS - 1)
        });
        CurveSegment[] memory extras = new CurveSegment[](1);
        extras[0] = CurveSegment({style: CurveStyle.Static, rateBps: 0, length: 0});
        return CurveConfig({primary: primary, additionalSegments: extras});
    }

    /// @notice Initializes factory-wide protocol recipient, fee share, modules, and factory deployer.
    /// @param _factoryDeployer EOA or contract allowed to create templs until permissionless is enabled.
    /// @param _protocolFeeRecipient Address receiving the protocol share from every templ deployed.
    /// @param _protocolBps Fee share, in basis points, reserved for the protocol across all templs.
    /// @param _membershipModule Address of the deployed membership module implementation.
    /// @param _treasuryModule Address of the deployed treasury module implementation.
    /// @param _governanceModule Address of the deployed governance module implementation.
    /// @param _councilModule Address of the deployed council governance module implementation.
    constructor(
        address _factoryDeployer,
        address _protocolFeeRecipient,
        uint256 _protocolBps,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule,
        address _councilModule
    ) {
        if (_factoryDeployer == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolFeeRecipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentageSplit();
        if (
            _membershipModule == address(0) ||
            _treasuryModule == address(0) ||
            _governanceModule == address(0) ||
            _councilModule == address(0)
        ) {
            revert TemplErrors.InvalidCallData();
        }
        PROTOCOL_FEE_RECIPIENT = _protocolFeeRecipient;
        PROTOCOL_BPS = _protocolBps;
        MEMBERSHIP_MODULE = _membershipModule;
        TREASURY_MODULE = _treasuryModule;
        GOVERNANCE_MODULE = _governanceModule;
        COUNCIL_MODULE = _councilModule;
        factoryDeployer = _factoryDeployer;
        permissionless = false;
    }

    /// @notice Transfers the factory deployer role to a new address.
    /// @param newDeployer Address of the new deployer.
    function transferDeployer(address newDeployer) external {
        if (msg.sender != factoryDeployer) revert TemplErrors.NotFactoryDeployer();
        if (newDeployer == address(0)) revert TemplErrors.InvalidRecipient();
        if (newDeployer == factoryDeployer) revert TemplErrors.PermissionlessUnchanged();
        address prev = factoryDeployer;
        factoryDeployer = newDeployer;
        emit DeployerTransferred(prev, newDeployer);
    }

    /// @notice Toggles permissionless mode for templ creation.
    /// @param enabled When true any address may deploy templs, otherwise only the factory deployer may do so.
    function setPermissionless(bool enabled) external {
        if (msg.sender != factoryDeployer) revert TemplErrors.NotFactoryDeployer();
        if (permissionless == enabled) revert TemplErrors.PermissionlessUnchanged();
        permissionless = enabled;
        emit PermissionlessModeUpdated(enabled);
    }

    /// @notice Deploys a templ using default fee splits and quorum settings.
    /// @param _token ERC-20 access token for the templ.
    /// @param _entryFee Entry fee denominated in `_token`.
    /// @param _name Human-readable templ name surfaced in UIs.
    /// @param _description Short templ description.
    /// @param _logoLink Canonical logo link for the templ.
    /// @return templAddress Address of the deployed templ.
    function createTempl(
        address _token,
        uint256 _entryFee,
        string calldata _name,
        string calldata _description,
        string calldata _logoLink
    ) external returns (address templAddress) {
        return
            createTemplFor(
                msg.sender,
                _token,
                _entryFee,
                _name,
                _description,
                _logoLink,
                DEFAULT_PROPOSAL_FEE_BPS,
                DEFAULT_REFERRAL_SHARE_BPS
            );
    }

    /// @notice Deploys a templ on behalf of an explicit priest using default configuration.
    /// @param _priest Wallet that will assume the templ priest role after deployment.
    /// @param _token ERC-20 access token for the templ.
    /// @param _entryFee Entry fee denominated in `_token`.
    /// @param _name Human-readable templ name.
    /// @param _description Short templ description.
    /// @param _logoLink Canonical logo URL.
    /// @param _proposalFeeBps Proposal creation fee (bps of entry fee).
    /// @param _referralShareBps Referral share (bps of member pool allocation).
    /// @return templAddress Address of the deployed templ.
    function createTemplFor(
        address _priest,
        address _token,
        uint256 _entryFee,
        string calldata _name,
        string calldata _description,
        string calldata _logoLink,
        uint256 _proposalFeeBps,
        uint256 _referralShareBps
    ) public returns (address templAddress) {
        _enforceCreationAccess();
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        // Simple factory methods default to member-wide governance (councilMode=false)
        // since council mode requires at least 3 members for safety.
        // Use createTemplWithConfig to enable council mode with 3+ initial council members.
        address[] memory emptyCouncil = new address[](0);
        CreateConfig memory cfg = CreateConfig({
            priest: _priest,
            token: _token,
            entryFee: _entryFee,
            burnBps: int256(DEFAULT_BURN_BPS),
            treasuryBps: int256(DEFAULT_TREASURY_BPS),
            memberPoolBps: int256(DEFAULT_MEMBER_POOL_BPS),
            quorumBps: DEFAULT_QUORUM_BPS,
            executionDelaySeconds: DEFAULT_EXECUTION_DELAY,
            burnAddress: DEFAULT_BURN_ADDRESS,
            priestIsDictator: false,
            maxMembers: DEFAULT_MAX_MEMBERS,
            curveProvided: true,
            curve: _defaultCurveConfig(),
            name: _name,
            description: _description,
            logoLink: _logoLink,
            proposalFeeBps: _proposalFeeBps,
            referralShareBps: _referralShareBps,
            yesVoteThresholdBps: TemplDefaults.DEFAULT_YES_VOTE_THRESHOLD_BPS,
            councilMode: false,
            instantQuorumBps: TemplDefaults.DEFAULT_INSTANT_QUORUM_BPS,
            initialCouncilMembers: emptyCouncil
        });
        return _deploy(cfg);
    }

    /// @notice Safely deploys a templ by first probing the access token for vanilla ERC-20 semantics.
    /// @dev Requires the caller to approve this factory for `SAFE_DEPLOY_PROBE_AMOUNT` of `_token`.
    ///      The probe pulls tokens from the caller and returns them, asserting exact deltas both ways.
    ///      Any fee-on-transfer, rebasing, or hook-based deviation from exact transfer semantics
    ///      causes the deploy to revert with NonVanillaToken.
    /// @param _priest Wallet that will assume the templ priest role after deployment.
    /// @param _token ERC-20 access token for the templ.
    /// @param _entryFee Entry fee denominated in `_token`.
    /// @param _name Human-readable templ name.
    /// @param _description Short templ description.
    /// @param _logoLink Canonical logo URL.
    /// @param _proposalFeeBps Proposal creation fee (bps of entry fee).
    /// @param _referralShareBps Referral share (bps of member pool allocation).
    /// @return templAddress Address of the deployed templ.
    function safeDeployFor(
        address _priest,
        address _token,
        uint256 _entryFee,
        string calldata _name,
        string calldata _description,
        string calldata _logoLink,
        uint256 _proposalFeeBps,
        uint256 _referralShareBps
    ) external returns (address templAddress) {
        _enforceCreationAccess();
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        _probeVanillaToken(_token, msg.sender, SAFE_DEPLOY_PROBE_AMOUNT);
        return
            createTemplFor(
                _priest,
                _token,
                _entryFee,
                _name,
                _description,
                _logoLink,
                _proposalFeeBps,
                _referralShareBps
            );
    }

    /// @notice Deploys a templ using a custom configuration struct.
    /// @param config Struct containing fee splits, governance settings, and defaults.
    /// @return templAddress Address of the deployed templ.
    function createTemplWithConfig(CreateConfig calldata config) external returns (address templAddress) {
        _enforceCreationAccess();
        CreateConfig memory cfg = config;
        if (cfg.priest == address(0)) {
            cfg.priest = msg.sender;
        }
        if (cfg.quorumBps == 0) {
            cfg.quorumBps = DEFAULT_QUORUM_BPS;
        }
        if (cfg.executionDelaySeconds == 0) {
            cfg.executionDelaySeconds = DEFAULT_EXECUTION_DELAY;
        }
        if (cfg.burnAddress == address(0)) {
            cfg.burnAddress = DEFAULT_BURN_ADDRESS;
        }
        if (!cfg.curveProvided) {
            cfg.curve = _defaultCurveConfig();
        }
        if (cfg.yesVoteThresholdBps == 0) {
            cfg.yesVoteThresholdBps = TemplDefaults.DEFAULT_YES_VOTE_THRESHOLD_BPS;
        }
        if (cfg.instantQuorumBps == 0) {
            cfg.instantQuorumBps = TemplDefaults.DEFAULT_INSTANT_QUORUM_BPS;
        }
        return _deploy(cfg);
    }

    /// @notice Deploys the templ after sanitizing the provided configuration.
    /// @param cfg Struct containing the templ deployment parameters.
    /// @return templAddress Address of the deployed templ.
    function _deploy(CreateConfig memory cfg) internal returns (address templAddress) {
        if (cfg.priest == address(0) || cfg.token == address(0)) revert TemplErrors.InvalidRecipient();
        if (cfg.entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (cfg.entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        if (cfg.quorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        uint256 burnBps = _resolveBps(cfg.burnBps, DEFAULT_BURN_BPS);
        uint256 treasuryBps = _resolveBps(cfg.treasuryBps, DEFAULT_TREASURY_BPS);
        uint256 memberPoolBps = _resolveBps(cfg.memberPoolBps, DEFAULT_MEMBER_POOL_BPS);
        _validatePercentSplit(burnBps, treasuryBps, memberPoolBps);
        if (cfg.proposalFeeBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        if (cfg.referralShareBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        if (cfg.yesVoteThresholdBps < 100 || cfg.yesVoteThresholdBps > BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentage();
        }
        if (cfg.councilMode && cfg.priestIsDictator) revert TemplErrors.CouncilModeActive();
        if (cfg.instantQuorumBps == 0 || cfg.instantQuorumBps > BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentage();
        }
        uint256 effectiveQuorumBps = cfg.quorumBps == 0 ? DEFAULT_QUORUM_BPS : cfg.quorumBps;
        if (cfg.instantQuorumBps < effectiveQuorumBps) {
            revert TemplErrors.InstantQuorumBelowQuorum();
        }

        // Validate initial council members array at factory level
        _validateInitialCouncilMembers(cfg.initialCouncilMembers);

        TEMPL deployed = new TEMPL(
            cfg.priest,
            PROTOCOL_FEE_RECIPIENT,
            cfg.token,
            cfg.entryFee,
            burnBps,
            treasuryBps,
            memberPoolBps,
            PROTOCOL_BPS,
            cfg.quorumBps,
            cfg.executionDelaySeconds,
            cfg.burnAddress,
            cfg.priestIsDictator,
            cfg.maxMembers,
            cfg.name,
            cfg.description,
            cfg.logoLink,
            cfg.proposalFeeBps,
            cfg.referralShareBps,
            cfg.yesVoteThresholdBps,
            cfg.instantQuorumBps,
            cfg.councilMode,
            MEMBERSHIP_MODULE,
            TREASURY_MODULE,
            GOVERNANCE_MODULE,
            COUNCIL_MODULE,
            cfg.curve,
            cfg.initialCouncilMembers
        );
        templAddress = address(deployed);
        uint256 extraLen = cfg.curve.additionalSegments.length;
        uint8[] memory curveStyles = new uint8[](extraLen + 1);
        uint32[] memory curveRates = new uint32[](extraLen + 1);
        uint32[] memory curveLengths = new uint32[](extraLen + 1);
        curveStyles[0] = uint8(cfg.curve.primary.style);
        curveRates[0] = cfg.curve.primary.rateBps;
        curveLengths[0] = cfg.curve.primary.length;
        for (uint256 i = 0; i < extraLen; ++i) {
            CurveSegment memory seg = cfg.curve.additionalSegments[i];
            curveStyles[i + 1] = uint8(seg.style);
            curveRates[i + 1] = seg.rateBps;
            curveLengths[i + 1] = seg.length;
        }
        emit TemplCreated(
            templAddress,
            msg.sender,
            cfg.priest,
            cfg.token,
            cfg.entryFee,
            burnBps,
            treasuryBps,
            memberPoolBps,
            cfg.quorumBps,
            cfg.executionDelaySeconds,
            cfg.burnAddress,
            cfg.priestIsDictator,
            cfg.maxMembers,
            curveStyles,
            curveRates,
            curveLengths,
            cfg.name,
            cfg.description,
            cfg.logoLink,
            cfg.proposalFeeBps,
            cfg.referralShareBps,
            cfg.yesVoteThresholdBps,
            cfg.instantQuorumBps,
            cfg.councilMode,
            cfg.initialCouncilMembers
        );
    }

    /// @notice Resolves a potentially sentinel-encoded bps value to its final value.
    /// @param rawBps Raw basis points supplied by callers (-1 requests the default value).
    /// @param defaultBps Default bps used when `rawBps` is the sentinel.
    /// @return resolvedBps Final bps applied to the deployment.
    function _resolveBps(int256 rawBps, uint256 defaultBps) internal pure returns (uint256 resolvedBps) {
        if (rawBps == USE_DEFAULT_BPS) {
            return defaultBps;
        }
        if (rawBps < 0) revert TemplErrors.InvalidPercentage();
        return uint256(rawBps);
    }

    /// @notice Ensures burn, treasury, member pool, and protocol slices sum to 100%.
    /// @param _burnBps Burn share (bps).
    /// @param _treasuryBps Treasury share (bps).
    /// @param _memberPoolBps Member pool share (bps).
    function _validatePercentSplit(uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps) internal view {
        if (_burnBps + _treasuryBps + _memberPoolBps + PROTOCOL_BPS != BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentageSplit();
        }
    }

    /// @notice Ensures templ creation calls respect the permissionless flag.
    function _enforceCreationAccess() internal view {
        if (!permissionless && msg.sender != factoryDeployer) {
            revert TemplErrors.FactoryAccessRestricted();
        }
    }

    /// @notice Validates initial council members array for deployment.
    /// @param members Array of addresses to validate.
    function _validateInitialCouncilMembers(address[] memory members) internal pure {
        uint256 len = members.length;
        if (len > 100) revert TemplErrors.InitialCouncilTooLarge();
        for (uint256 i = 0; i < len; ++i) {
            if (members[i] == address(0)) revert TemplErrors.InvalidRecipient();
            // Check for duplicates
            for (uint256 j = 0; j < i; ++j) {
                if (members[j] == members[i]) {
                    revert TemplErrors.DuplicateCouncilMember();
                }
            }
        }
    }

    /// @notice Probes that `token` behaves as a vanilla ERC-20 by pulling and returning `amount`.
    /// @dev Reverts if the factory doesn't receive exactly `amount` on pull or the caller
    ///      doesn't receive exactly `amount` back on return.
    /// @param token ERC-20 token to probe.
    /// @param from Wallet expected to have approved `amount` for this factory.
    /// @param amount Amount to pull and return.
    function _probeVanillaToken(address token, address from, uint256 amount) internal {
        if (token == address(0)) revert TemplErrors.InvalidRecipient();
        if (amount == 0) revert TemplErrors.AmountZero();

        uint256 factoryBefore = IERC20(token).balanceOf(address(this));

        IERC20(token).safeTransferFrom(from, address(this), amount);
        uint256 factoryAfterPull = IERC20(token).balanceOf(address(this));
        if (factoryAfterPull != factoryBefore + amount) revert TemplErrors.NonVanillaToken();

        uint256 userBeforeReturn = IERC20(token).balanceOf(from);
        IERC20(token).safeTransfer(from, amount);
        uint256 userAfterReturn = IERC20(token).balanceOf(from);
        if (userAfterReturn != userBeforeReturn + amount) revert TemplErrors.NonVanillaToken();

        uint256 factoryAfterReturn = IERC20(token).balanceOf(address(this));
        if (factoryAfterReturn != factoryBefore) revert TemplErrors.NonVanillaToken();
    }
}
