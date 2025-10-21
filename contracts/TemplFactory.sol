// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "./TemplCurve.sol";
import {SSTORE2} from "./libraries/SSTORE2.sol";

/// @title Factory for deploying templ instances
/// @notice Deploys templ contracts with shared protocol configuration and optional custom splits.
contract TemplFactory {
    uint256 internal constant TOTAL_PERCENT = 10_000;
    // NOTE: The default burn/treasury/member percentages deliberately assume a
    // factory-level protocol share of 10%. Factories deployed with a different
    // `protocolPercent` should either adjust these constants prior to
    // deployment or call `createTemplWithConfig` with explicit splits so the
    // totals continue to sum to 100% (10_000 basis points).
    uint256 internal constant DEFAULT_BURN_PERCENT = 3_000;
    uint256 internal constant DEFAULT_TREASURY_PERCENT = 3_000;
    uint256 internal constant DEFAULT_MEMBER_POOL_PERCENT = 3_000;
    uint256 internal constant DEFAULT_QUORUM_PERCENT = 3_300;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    int256 internal constant USE_DEFAULT_PERCENT = -1;
    uint256 internal constant DEFAULT_MAX_MEMBERS = 249;
    uint32 internal constant DEFAULT_CURVE_EXP_RATE_BPS = 11_000;
    uint256 internal constant DEFAULT_PROPOSAL_FEE_BPS = 0;
    uint256 internal constant MAX_INIT_CODE_CHUNK_SIZE = 24_000;

    struct CreateConfig {
        address priest;
        address token;
        uint256 entryFee;
        int256 burnPercent;
        int256 treasuryPercent;
        int256 memberPoolPercent;
        uint256 quorumPercent;
        uint256 executionDelaySeconds;
        address burnAddress;
        bool priestIsDictator;
        uint256 maxMembers;
        bool curveProvided;
        CurveConfig curve;
        string name;
        string description;
        string logoLink;
        uint256 proposalFeeBps;
        uint256 referralShareBps;
    }

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolPercent;
    address public immutable membershipModule;
    address public immutable treasuryModule;
    address public immutable governanceModule;
    address public immutable factoryDeployer;
    bool public permissionless;
    address[] internal templInitCodePointers;
    uint256 internal templInitCodeLength;

    /// @notice Emitted after deploying a new templ instance.
    /// @param curveStyles Segment styles applied to the templ's join curve.
    /// @param curveRateBps Rate parameters for each segment (basis points).
    /// @param curveLengths Paid join counts per segment (0 = extends indefinitely).
    event TemplCreated(
        address indexed templ,
        address indexed creator,
        address indexed priest,
        address token,
        uint256 entryFee,
        uint256 burnPercent,
        uint256 treasuryPercent,
        uint256 memberPoolPercent,
        uint256 quorumPercent,
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

    /// @notice Initializes factory-wide protocol recipient and fee percent.
    /// @param _protocolFeeRecipient Address receiving the protocol share for every templ deployed.
    /// @param _protocolPercent Fee percent reserved for the protocol across all templs.
    constructor(
        address _protocolFeeRecipient,
        uint256 _protocolPercent,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule
    ) {
        if (_protocolFeeRecipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolPercent > TOTAL_PERCENT) revert TemplErrors.InvalidPercentageSplit();
        if (_membershipModule == address(0) || _treasuryModule == address(0) || _governanceModule == address(0)) {
            revert TemplErrors.InvalidCallData();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolPercent = _protocolPercent;
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
            burnPercent: int256(DEFAULT_BURN_PERCENT),
            treasuryPercent: int256(DEFAULT_TREASURY_PERCENT),
            memberPoolPercent: int256(DEFAULT_MEMBER_POOL_PERCENT),
            quorumPercent: DEFAULT_QUORUM_PERCENT,
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
        if (cfg.quorumPercent == 0) {
            cfg.quorumPercent = DEFAULT_QUORUM_PERCENT;
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
        if (cfg.quorumPercent > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
        uint256 burnPercent = _resolvePercent(cfg.burnPercent, DEFAULT_BURN_PERCENT);
        uint256 treasuryPercent = _resolvePercent(cfg.treasuryPercent, DEFAULT_TREASURY_PERCENT);
        uint256 memberPoolPercent = _resolvePercent(cfg.memberPoolPercent, DEFAULT_MEMBER_POOL_PERCENT);
        _validatePercentSplit(burnPercent, treasuryPercent, memberPoolPercent);
        if (cfg.proposalFeeBps > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
        if (cfg.referralShareBps > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();

        bytes memory constructorArgs = abi.encode(
            cfg.priest,
            protocolFeeRecipient,
            cfg.token,
            cfg.entryFee,
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            protocolPercent,
            cfg.quorumPercent,
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
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            cfg.quorumPercent,
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

    /// @dev Resolves a potentially sentinel-encoded percent to its final value.
    /// @param rawPercent Raw percent supplied by callers (-1 requests the default value).
    /// @param defaultPercent Default percent used when `rawPercent` is the sentinel.
    /// @return resolvedPercent Final percent applied to the deployment.
    function _resolvePercent(int256 rawPercent, uint256 defaultPercent) internal pure returns (uint256 resolvedPercent) {
        if (rawPercent == USE_DEFAULT_PERCENT) {
            return defaultPercent;
        }
        if (rawPercent < 0) revert TemplErrors.InvalidPercentage();
        return uint256(rawPercent);
    }

    /// @dev Ensures burn, treasury, member pool, and protocol slices sum to 100%.
    function _validatePercentSplit(
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal view {
        if (_burnPercent + _treasuryPercent + _memberPoolPercent + protocolPercent != TOTAL_PERCENT) {
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
