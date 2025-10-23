## `TemplFactory`

Deploys Templ contracts with shared protocol configuration and optional custom splits.


Default burn/treasury/member shares assume a factory protocol share of 1,000 bps (10%).
     If `PROTOCOL_BPS` differs, either pass explicit splits to `createTemplWithConfig` or
     adjust the defaults so the totals continue to sum to 10_000 bps.



### `_defaultCurveConfig() → struct CurveConfig cfg` (internal)

/ @notice Returns the default curve configuration applied by the factory.




### `constructor(address _factoryDeployer, address _protocolFeeRecipient, uint256 _protocolBps, address _membershipModule, address _treasuryModule, address _governanceModule)` (public)

/ @notice Initializes factory-wide protocol recipient, fee share, modules, and factory deployer.




### `transferDeployer(address newDeployer)` (external)

/ @notice Transfers the factory deployer role to a new address.




### `setPermissionless(bool enabled)` (external)

/ @notice Toggles permissionless mode for templ creation.




### `createTempl(address _token, uint256 _entryFee, string _name, string _description, string _logoLink) → address templAddress` (external)

/ @notice Deploys a templ using default fee splits and quorum settings.




### `createTemplFor(address _priest, address _token, uint256 _entryFee, string _name, string _description, string _logoLink, uint256 _proposalFeeBps, uint256 _referralShareBps) → address templAddress` (public)

/ @notice Deploys a templ on behalf of an explicit priest using default configuration.




### `createTemplWithConfig(struct TemplFactory.CreateConfig config) → address templAddress` (external)

/ @notice Deploys a templ using a custom configuration struct.




### `_deploy(struct TemplFactory.CreateConfig cfg) → address templAddress` (internal)

/ @notice Deploys the templ after sanitizing the provided configuration.




### `_resolveBps(int256 rawBps, uint256 defaultBps) → uint256 resolvedBps` (internal)

/ @notice Resolves a potentially sentinel-encoded bps value to its final value.




### `_validatePercentSplit(uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps)` (internal)

/ @notice Ensures burn, treasury, member pool, and protocol slices sum to 100%.




### `_enforceCreationAccess()` (internal)

/ @notice Ensures templ creation calls respect the permissionless flag.




### `TemplCreated(address templ, address creator, address priest, address token, uint256 entryFee, uint256 burnBps, uint256 treasuryBps, uint256 memberPoolBps, uint256 quorumBps, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, uint8[] curveStyles, uint32[] curveRateBps, uint32[] curveLengths, string name, string description, string logoLink, uint256 proposalFeeBps, uint256 referralShareBps)`

/ @notice Emitted after deploying a new templ instance.




### `PermissionlessModeUpdated(bool enabled)`

/ @notice Emitted when factory permissionless mode is toggled.




### `DeployerTransferred(address previousDeployer, address newDeployer)`

/ @notice Emitted when the factory deployer is changed.





### `CreateConfig`


address priest


address token


uint256 entryFee


int256 burnBps


int256 treasuryBps


int256 memberPoolBps


uint256 quorumBps


uint256 executionDelaySeconds


address burnAddress


bool priestIsDictator


uint256 maxMembers


bool curveProvided


struct CurveConfig curve


string name


string description


string logoLink


uint256 proposalFeeBps


uint256 referralShareBps



