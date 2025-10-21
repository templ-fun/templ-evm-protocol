// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "./TemplCurve.sol";
import {SSTORE2} from "./libraries/SSTORE2.sol";

/// @title Factory for deploying templ instances
/// @notice Deploys templ contracts with shared protocol configuration and optional custom splits.
contract TemplFactory {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    // NOTE: The default burn/treasury/member shares deliberately assume a
    // factory-level protocol share of 10% (1,000 bps). Factories deployed with a different
    // `protocolBps` should either adjust these constants prior to
    // deployment or call `createTemplWithConfig` with explicit splits so the
    // totals continue to sum to 100% (10_000 basis points).
    uint256 internal constant DEFAULT_BURN_BPS = 3_000;
    uint256 internal constant DEFAULT_TREASURY_BPS = 3_000;
    uint256 internal constant DEFAULT_MEMBER_POOL_BPS = 3_000;
    uint256 internal constant DEFAULT_QUORUM_BPS = 3_300;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    int256 internal constant USE_DEFAULT_BPS = -1;
    uint256 internal constant DEFAULT_MAX_MEMBERS = 249;
    uint32 internal constant DEFAULT_CURVE_EXP_RATE_BPS = 11_000;
    uint256 internal constant DEFAULT_PROPOSAL_FEE_BPS = 0;
    uint256 internal constant MAX_INIT_CODE_CHUNK_SIZE = 24_000;

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
    }

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolBps;
    address public immutable membershipModule;
    address public immutable treasuryModule;
    address public immutable governanceModule;
    address public immutable factoryDeployer;
    bool public permissionless;
    address[] internal templInitCodePointers;
    uint256 internal templInitCodeLength;

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
        uint256 referralShareBps
    );

    /// @notice Emitted when factory permissionless mode is toggled.
    /// @param enabled True when any address may create templs.
    event PermissionlessModeUpdated(bool enabled);

    function _defaultCurveConfig() internal pure returns (CurveConfig memory) {
        CurveSegment memory primary = CurveSegment({
            style: CurveStyle.Exponential,
            rateBps: DEFAULT_CURVE_EXP_RATE_BPS,
            length: 0
        });
        CurveSegment[] memory extras = new CurveSegment[](0);
        return CurveConfig({primary: primary, additionalSegments: extras});
    }

    /// @notice Initializes factory-wide protocol recipient and fee share (bps).
    /// @param _protocolFeeRecipient Address receiving the protocol share from every templ deployed.
    /// @param _protocolBps Fee share, in basis points, reserved for the protocol across all templs.
    /// @param _membershipModule Address of the deployed membership module implementation.
    /// @param _treasuryModule Address of the deployed treasury module implementation.
    /// @param _governanceModule Address of the deployed governance module implementation.
    constructor(
        address _protocolFeeRecipient,
        uint256 _protocolBps,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule
    ) {
        if (_protocolFeeRecipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentageSplit();
        if (_membershipModule == address(0) || _treasuryModule == address(0) || _governanceModule == address(0)) {
            revert TemplErrors.InvalidCallData();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolBps = _protocolBps;
        membershipModule = _membershipModule;
        treasuryModule = _treasuryModule;
        governanceModule = _governanceModule;
        factoryDeployer = msg.sender;
        permissionless = false;
        bytes memory initCode = type(TEMPL).creationCode;
        templInitCodeLength = initCode.length;
        templInitCodePointers = _writeInitCodeChunks(initCode);
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
        return createTemplFor(
            msg.sender,
            _token,
            _entryFee,
            _name,
            _description,
            _logoLink,
            DEFAULT_PROPOSAL_FEE_BPS,
            0
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
    )
        public
        returns (address templAddress)
    {
        _enforceCreationAccess();
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
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
            referralShareBps: _referralShareBps
        });
        return _deploy(cfg);
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
        return _deploy(cfg);
    }

    /// @dev Deploys the templ after sanitizing the provided configuration.
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

        bytes memory constructorArgs = abi.encode(
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
            cfg.priestIsDictator,
            cfg.maxMembers,
            cfg.name,
            cfg.description,
            cfg.logoLink,
            cfg.proposalFeeBps,
            cfg.referralShareBps,
            membershipModule,
            treasuryModule,
            governanceModule,
            cfg.curve
        );
        bytes memory templInitCode = _loadTemplInitCode();
        if (templInitCode.length == 0) revert TemplErrors.DeploymentFailed();
        bytes memory initCode = abi.encodePacked(templInitCode, constructorArgs);

        address deployed;
        assembly ("memory-safe") {
            let dataPtr := add(initCode, 0x20)
            let dataLen := mload(initCode)
            deployed := create(0, dataPtr, dataLen)
        }
        if (deployed == address(0)) revert TemplErrors.DeploymentFailed();
        templAddress = deployed;
        uint256 extraLen = cfg.curve.additionalSegments.length;
        uint8[] memory curveStyles = new uint8[](extraLen + 1);
        uint32[] memory curveRates = new uint32[](extraLen + 1);
        uint32[] memory curveLengths = new uint32[](extraLen + 1);
        curveStyles[0] = uint8(cfg.curve.primary.style);
        curveRates[0] = cfg.curve.primary.rateBps;
        curveLengths[0] = cfg.curve.primary.length;
        for (uint256 i = 0; i < extraLen; i++) {
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
            cfg.referralShareBps
        );
    }

    function _writeInitCodeChunks(bytes memory initCode) internal returns (address[] memory pointers) {
        uint256 totalLength = initCode.length;
        if (totalLength == 0) revert TemplErrors.DeploymentFailed();
        uint256 chunkCount = (totalLength + MAX_INIT_CODE_CHUNK_SIZE - 1) / MAX_INIT_CODE_CHUNK_SIZE;
        pointers = new address[](chunkCount);
        for (uint256 i = 0; i < chunkCount; ++i) {
            uint256 offset = i * MAX_INIT_CODE_CHUNK_SIZE;
            uint256 remaining = totalLength - offset;
            uint256 chunkSize = remaining > MAX_INIT_CODE_CHUNK_SIZE ? MAX_INIT_CODE_CHUNK_SIZE : remaining;
            bytes memory chunk = new bytes(chunkSize);
            for (uint256 j = 0; j < chunkSize; ++j) {
                chunk[j] = initCode[offset + j];
            }
            pointers[i] = SSTORE2.write(chunk);
        }
    }

    function _loadTemplInitCode() internal view returns (bytes memory initCode) {
        address[] storage pointers = templInitCodePointers;
        uint256 pointerCount = pointers.length;
        uint256 expectedLength = templInitCodeLength;
        if (pointerCount == 0 || expectedLength == 0) revert TemplErrors.DeploymentFailed();
        initCode = new bytes(expectedLength);
        uint256 offset = 0;
        for (uint256 i = 0; i < pointerCount; ++i) {
            bytes memory chunk = SSTORE2.read(pointers[i]);
            uint256 chunkLength = chunk.length;
            if (chunkLength == 0 || offset + chunkLength > expectedLength) {
                revert TemplErrors.DeploymentFailed();
            }
            for (uint256 j = 0; j < chunkLength; ++j) {
                initCode[offset + j] = chunk[j];
            }
            offset += chunkLength;
        }
        if (offset != expectedLength) revert TemplErrors.DeploymentFailed();
    }

    /// @dev Resolves a potentially sentinel-encoded bps value to its final value.
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

    /// @dev Ensures burn, treasury, member pool, and protocol slices sum to 100%.
    function _validatePercentSplit(
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps
    ) internal view {
        if (_burnBps + _treasuryBps + _memberPoolBps + protocolBps != BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentageSplit();
        }
    }

    /// @dev Ensures templ creation calls respect the permissionless flag.
    function _enforceCreationAccess() internal view {
        if (!permissionless && msg.sender != factoryDeployer) {
            revert TemplErrors.FactoryAccessRestricted();
        }
    }
}
