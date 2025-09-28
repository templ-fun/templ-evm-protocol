// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TemplErrors} from "./TemplErrors.sol";

/// @title Base templ storage and shared helpers
/// @notice Hosts shared state, events, and internal helpers used by membership, treasury, and governance modules.
abstract contract TemplBase is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TemplErrors for *;

    /// @dev Basis used for fee split math so every percent is represented as an integer.
    uint256 internal constant TOTAL_PERCENT = 100;
    /// @dev Precision applied to per-share reward accounting to avoid repeated loops when cohorts change.
    uint256 internal constant REWARD_SCALE = 1e18;
    /// @dev Default quorum percent applied when callers pass zero into constructors.
    uint256 internal constant DEFAULT_QUORUM_PERCENT = 33;
    /// @dev Default post-quorum execution delay used when deployers do not override it.
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    /// @dev Default burn address used when deployers do not provide a custom sink.
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice Percent of the entry fee that is burned on every purchase.
    uint256 public burnPercent;
    /// @notice Percent of the entry fee routed into the treasury balance.
    uint256 public treasuryPercent;
    /// @notice Percent of the entry fee set aside for the member rewards pool.
    uint256 public memberPoolPercent;
    /// @notice Percent of the entry fee forwarded to the protocol on every purchase.
    uint256 public immutable protocolPercent;

    /// @notice Address empowered to act as the priest (and temporary dictator).
    address public priest;
    /// @notice Address that receives the protocol share during purchases and distributions.
    address public immutable protocolFeeRecipient;
    /// @notice ERC-20 token required to join the templ.
    address public immutable accessToken;
    /// @notice Tracks whether dictatorship mode is enabled.
    bool public priestIsDictator;
    /// @notice Current entry fee denominated in the access token.
    uint256 public entryFee;
    /// @notice Treasury-held balance denominated in the access token.
    uint256 public treasuryBalance;
    /// @notice Member pool balance denominated in the access token.
    uint256 public memberPoolBalance;
    /// @notice Whether joins and other restricted flows are paused.
    bool public paused;
    /// @notice Counter for active disband proposals that temporarily block joins.
    uint256 public activeDisbandJoinLocks;
    uint256[] internal disbandLockIds;
    mapping(uint256 => uint256) internal disbandLockIndex;
    /// @notice Maximum allowed members when greater than zero (0 = uncapped).
    /// @dev Named in uppercase historically; kept for backwards compatibility with emitted ABI.
    uint256 public MAX_MEMBERS;

    /// @notice Percent of YES votes required to satisfy quorum.
    uint256 public quorumPercent;
    /// @notice Seconds governance must wait after quorum before executing a proposal.
    uint256 public executionDelayAfterQuorum;
    /// @notice Address that receives burn allocations.
    address public immutable burnAddress;
    /// @notice Canonical templ home link surfaced across UIs and off-chain services.
    string public templHomeLink;

    struct Member {
        /// @notice Whether the address has successfully purchased access.
        bool purchased;
        /// @notice Block timestamp when the member joined.
        uint256 timestamp;
        /// @notice Block number recorded at the time of the join.
        uint256 block;
        /// @notice Reward checkpoint captured when the member joined (scaled by REWARD_SCALE).
        uint256 rewardSnapshot;
    }

    mapping(address => Member) public members;
    address[] public memberList;
    mapping(address => uint256) public memberPoolClaims;
    /// @notice Aggregate rewards per member scaled by REWARD_SCALE for on-chain snapshotting.
    uint256 public cumulativeMemberRewards;
    /// @notice Reward dust retained to preserve exact accounting when rounding per-share payouts.
    uint256 public memberRewardRemainder;

    struct RewardCheckpoint {
        /// @notice Block number when the checkpoint was recorded.
        uint64 blockNumber;
        /// @notice Timestamp at checkpoint creation.
        uint64 timestamp;
        /// @notice Cumulative rewards per member (scaled by REWARD_SCALE) at that checkpoint.
        uint256 cumulative;
    }

    struct Proposal {
        uint256 id;
        address proposer;
        Action action;
        address token;
        address recipient;
        uint256 amount;
        string title;
        string description;
        string reason;
        bool paused;
        uint256 newEntryFee;
        uint256 newBurnPercent;
        uint256 newTreasuryPercent;
        uint256 newMemberPoolPercent;
        string newHomeLink;
        uint256 newMaxMembers;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 endTime;
        uint256 createdAt;
        bool executed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteChoice;
        uint256 eligibleVoters;
        uint256 postQuorumEligibleVoters;
        uint256 quorumReachedAt;
        uint256 quorumSnapshotBlock;
        bool quorumExempt;
        bool updateFeeSplit;
        uint256 preQuorumSnapshotBlock;
        bool setDictatorship;
        bool disbandJoinLock;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public activeProposalId;
    mapping(address => bool) public hasActiveProposal;
    uint256[] internal activeProposalIds;
    mapping(uint256 => uint256) internal activeProposalIndex;
    uint256 public constant DEFAULT_VOTING_PERIOD = 7 days;
    uint256 public constant MIN_VOTING_PERIOD = 7 days;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;

    enum Action {
        SetPaused,
        UpdateConfig,
        WithdrawTreasury,
        DisbandTreasury,
        ChangePriest,
        SetDictatorship,
        SetMaxMembers,
        SetHomeLink,
        Undefined
    }

    uint256 public totalPurchases;
    uint256 public totalBurned;
    uint256 public totalToTreasury;
    uint256 public totalToMemberPool;
    uint256 public totalToProtocol;

    event AccessPurchased(
        address indexed purchaser,
        uint256 totalAmount,
        uint256 burnedAmount,
        uint256 treasuryAmount,
        uint256 memberPoolAmount,
        uint256 protocolAmount,
        uint256 timestamp,
        uint256 blockNumber,
        uint256 purchaseId
    );

    event MemberPoolClaimed(
        address indexed member,
        uint256 amount,
        uint256 timestamp
    );

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 endTime,
        string title,
        string description
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 timestamp
    );

    event ProposalExecuted(uint256 indexed proposalId, bool success, bytes returnData);

    event TreasuryAction(
        uint256 indexed proposalId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        string description
    );

    event ConfigUpdated(
        address indexed token,
        uint256 entryFee,
        uint256 burnPercent,
        uint256 treasuryPercent,
        uint256 memberPoolPercent,
        uint256 protocolPercent
    );

    event ContractPaused(bool isPaused);
    event MaxMembersUpdated(uint256 maxMembers);
    event PriestChanged(address indexed oldPriest, address indexed newPriest);
    event TreasuryDisbanded(
        uint256 indexed proposalId,
        address indexed token,
        uint256 amount,
        uint256 perMember,
        uint256 remainder
    );

    event ExternalRewardClaimed(
        address indexed token,
        address indexed member,
        uint256 amount
    );

    event TemplHomeLinkUpdated(string previousLink, string newLink);

    struct ExternalRewardState {
        uint256 poolBalance;
        uint256 cumulativeRewards;
        uint256 rewardRemainder;
        bool exists;
        RewardCheckpoint[] checkpoints;
    }

    /// @notice External reward accounting keyed by ERC-20/ETH address.
    mapping(address => ExternalRewardState) internal externalRewards;
    /// @notice List of external reward tokens for enumeration in UIs.
    address[] internal externalRewardTokens;
    /// @notice Member snapshots for each external reward token.
    mapping(address => mapping(address => uint256)) internal memberExternalRewardSnapshots;
    /// @notice Cumulative amounts each member has claimed per external reward token.
    mapping(address => mapping(address => uint256)) internal memberExternalClaims;

    /// @dev Restricts a function so only wallets that successfully purchased access may call it.
    modifier onlyMember() {
        if (!members[msg.sender].purchased) revert TemplErrors.NotMember();
        _;
    }

    /// @dev Permits calls from the contract (governance) or the priest when dictatorship mode is enabled.
    modifier onlyDAO() {
        if (priestIsDictator) {
            if (msg.sender != address(this) && msg.sender != priest) revert TemplErrors.PriestOnly();
        } else if (msg.sender != address(this)) {
            revert TemplErrors.NotDAO();
        }
        _;
    }

    /// @dev Blocks direct calls from the contract to avoid double-entry during purchase flows.
    modifier notSelf() {
        if (msg.sender == address(this)) revert TemplErrors.InvalidSender();
        _;
    }

    /// @dev Ensures joins and other gated actions only execute when the templ is unpaused.
    modifier whenNotPaused() {
        if (paused) revert TemplErrors.ContractPausedError();
        _;
    }

    /// @dev Blocks membership joins while a disband proposal is pending execution.
    modifier whenDisbandUnlocked() {
        _refreshDisbandLocks();
        if (activeDisbandJoinLocks != 0) revert TemplErrors.DisbandLockActive();
        _;
    }

    event DictatorshipModeChanged(bool enabled);

    /// @notice Sets immutable configuration and initial governance parameters shared across modules.
    /// @param _protocolFeeRecipient Address receiving the protocol share of entry fees.
    /// @param _accessToken ERC-20 token that gates membership.
    /// @param _burnPercent Initial percent burned from every entry fee.
    /// @param _treasuryPercent Initial percent routed to the treasury.
    /// @param _memberPoolPercent Initial percent shared with existing members.
    /// @param _protocolPercent Protocol fee percent baked into every templ deployment.
    /// @param _quorumPercent Percent of members required to reach quorum (defaults when zero).
    /// @param _executionDelay Seconds to wait after quorum before execution (defaults when zero).
    /// @param _burnAddress Address receiving burn allocations (fallbacks to the dead address).
    /// @param _priestIsDictator Whether the templ starts in dictatorship mode.
    /// @param _homeLink Canonical templ home link emitted on initialization.
    constructor(
        address _protocolFeeRecipient,
        address _accessToken,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent,
        uint256 _quorumPercent,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator,
        string memory _homeLink
    ) {
        if (_protocolFeeRecipient == address(0) || _accessToken == address(0)) {
            revert TemplErrors.InvalidRecipient();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _accessToken;
        priestIsDictator = _priestIsDictator;
        protocolPercent = _protocolPercent;
        _setPercentSplit(_burnPercent, _treasuryPercent, _memberPoolPercent);

        if (_quorumPercent == 0) {
            quorumPercent = DEFAULT_QUORUM_PERCENT;
        } else {
            if (_quorumPercent > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
            quorumPercent = _quorumPercent;
        }

        executionDelayAfterQuorum = _executionDelay == 0 ? DEFAULT_EXECUTION_DELAY : _executionDelay;
        burnAddress = _burnAddress == address(0) ? DEFAULT_BURN_ADDRESS : _burnAddress;
        templHomeLink = _homeLink;
        if (bytes(_homeLink).length != 0) {
            emit TemplHomeLinkUpdated("", _homeLink);
        }
    }

    /// @dev Updates the split between burn, treasury, and member pool slices.
    function _setPercentSplit(
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal {
        _validatePercentSplit(_burnPercent, _treasuryPercent, _memberPoolPercent, protocolPercent);
        burnPercent = _burnPercent;
        treasuryPercent = _treasuryPercent;
        memberPoolPercent = _memberPoolPercent;
    }

    /// @dev Validates that the provided split plus the protocol fee equals 100%.
    function _validatePercentSplit(
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent
    ) internal pure {
        if (_burnPercent + _treasuryPercent + _memberPoolPercent + _protocolPercent != TOTAL_PERCENT) {
            revert TemplErrors.InvalidPercentageSplit();
        }
    }

    /// @dev Toggles dictatorship governance mode, emitting an event when the state changes.
    function _updateDictatorship(bool _enabled) internal {
        if (priestIsDictator == _enabled) revert TemplErrors.DictatorshipUnchanged();
        priestIsDictator = _enabled;
        emit DictatorshipModeChanged(_enabled);
    }

    /// @dev Sets or clears the membership cap and auto-pauses if the new cap is already met.
    function _setMaxMembers(uint256 newMaxMembers) internal {
        uint256 currentMembers = memberList.length;
        if (newMaxMembers > 0 && newMaxMembers < currentMembers) {
            revert TemplErrors.MemberLimitTooLow();
        }
        MAX_MEMBERS = newMaxMembers;
        emit MaxMembersUpdated(newMaxMembers);
        _autoPauseIfLimitReached();
    }

    /// @dev Writes a new templ home link and emits an event when it changes.
    function _setTemplHomeLink(string memory newLink) internal {
        if (keccak256(bytes(templHomeLink)) == keccak256(bytes(newLink))) {
            return;
        }
        string memory previous = templHomeLink;
        templHomeLink = newLink;
        emit TemplHomeLinkUpdated(previous, newLink);
    }

    /// @dev Pauses the templ when a membership cap is set and already reached.
    function _autoPauseIfLimitReached() internal {
        uint256 limit = MAX_MEMBERS;
        if (limit > 0 && memberList.length >= limit && !paused) {
            paused = true;
            emit ContractPaused(true);
        }
    }

    function _refreshDisbandLocks() internal virtual {}
}
