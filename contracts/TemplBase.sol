// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "./TemplCurve.sol";

/// @title Base templ storage and shared helpers
/// @notice Hosts shared state, events, and internal helpers used by membership, treasury, and governance modules.
abstract contract TemplBase is ReentrancyGuard {
    using TemplErrors for *;
    using SafeERC20 for IERC20;

    /// @dev Basis used for fee split math so every percent is represented as an integer.
    uint256 internal constant TOTAL_PERCENT = 10_000;
    /// @dev Default quorum percent applied when callers pass zero into constructors.
    uint256 internal constant DEFAULT_QUORUM_PERCENT = 3_300;
    /// @dev Default post-quorum execution delay used when deployers do not override it.
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    /// @dev Default burn address used when deployers do not provide a custom sink.
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    /// @dev Caps the number of external reward tokens tracked to keep join gas bounded.
    uint256 internal constant MAX_EXTERNAL_REWARD_TOKENS = 256;
    /// @dev Maximum entry fee supported before arithmetic would overflow downstream accounting.
    uint256 internal constant MAX_ENTRY_FEE = type(uint128).max;

    /// @notice Percent of the entry fee that is burned on every join.
    uint256 public burnPercent;
    /// @notice Percent of the entry fee routed into the treasury balance.
    uint256 public treasuryPercent;
    /// @notice Percent of the entry fee set aside for the member rewards pool.
    uint256 public memberPoolPercent;
    /// @notice Percent of the entry fee forwarded to the protocol on every join.
    uint256 public protocolPercent;

    /// @notice Address empowered to act as the priest (and temporary dictator).
    address public priest;
    /// @notice Address that receives the protocol share during joins and distributions.
    address public protocolFeeRecipient;
    /// @notice ERC-20 token required to join the templ.
    address public accessToken;
    /// @notice Tracks whether dictatorship mode is enabled.
    bool public priestIsDictator;
    /// @notice Current entry fee denominated in the access token.
    uint256 public entryFee;
    /// @notice Entry fee recorded when zero paid joins have occurred.
    uint256 public baseEntryFee;
    /// @notice Pricing curve configuration that governs how entry fees scale with membership.
    CurveConfig public entryFeeCurve;
    /// @notice Treasury-held balance denominated in the access token.
    uint256 public treasuryBalance;
    /// @notice Member pool balance denominated in the access token.
    uint256 public memberPoolBalance;
    /// @notice Whether new member joins are currently paused.
    bool public joinPaused;
    /// @notice Maximum allowed members when greater than zero (0 = uncapped).
    /// @dev Named in uppercase historically; kept for backwards compatibility with emitted ABI.
    uint256 public MAX_MEMBERS;

    /// @notice Percent of YES votes required to satisfy quorum.
    uint256 public quorumPercent;
    /// @notice Seconds governance must wait after quorum before executing a proposal.
    uint256 public executionDelayAfterQuorum;
    /// @notice Address that receives burn allocations.
    address public burnAddress;
    /// @notice Templ metadata surfaced across UIs and off-chain services.
    string public templName;
    string public templDescription;
    string public templLogoLink;
    /// @notice Basis points of the entry fee that must be paid to create proposals.
    uint256 public proposalCreationFeeBps;
    /// @notice Basis points of the member pool share paid to a referral during joins.
    uint256 public referralShareBps;

    struct Member {
        /// @notice Whether the address has successfully joined.
        bool joined;
        /// @notice Block timestamp when the member joined.
        uint256 timestamp;
        /// @notice Block number recorded at the time of the join.
        uint256 blockNumber;
        /// @notice Reward checkpoint captured when the member joined.
        uint256 rewardSnapshot;
        /// @notice Monotonic join sequence assigned at the time of entry (0 when never joined).
        uint256 joinSequence;
    }

    mapping(address => Member) public members;
    uint256 public memberCount;
    mapping(address => uint256) public memberPoolClaims;
    /// @notice Aggregate rewards per member used for on-chain snapshotting.
    uint256 public cumulativeMemberRewards;
    /// @notice Remainder carried forward when rewards do not divide evenly across members.
    uint256 public memberRewardRemainder;
    /// @notice Total access token amount burned across all joins.
    uint256 public totalBurned;
    /// @notice Incrementing counter tracking the order of member joins (starts at 1 for the priest).
    uint256 public joinSequence;

    struct RewardCheckpoint {
        /// @notice Block number when the checkpoint was recorded.
        uint64 blockNumber;
        /// @notice Timestamp at checkpoint creation.
        uint64 timestamp;
        /// @notice Cumulative rewards per member at that checkpoint.
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
        bool joinPaused;
        uint256 newEntryFee;
        uint256 newBurnPercent;
        uint256 newTreasuryPercent;
        uint256 newMemberPoolPercent;
        string newTemplName;
        string newTemplDescription;
        string newLogoLink;
        uint256 newProposalCreationFeeBps;
        uint256 newReferralShareBps;
        uint256 newMaxMembers;
        /// @notice Target contract invoked when executing an external call proposal.
        address externalCallTarget;
        /// @notice ETH value forwarded when executing the external call.
        uint256 externalCallValue;
        /// @notice ABI-encoded calldata executed against the external target.
        bytes externalCallData;
        CurveConfig curveConfig;
        uint256 curveBaseEntryFee;
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
        /// @notice Join sequence recorded when the proposal was created.
        uint256 preQuorumJoinSequence;
        /// @notice Join sequence recorded when quorum was reached (0 if quorum never satisfied).
        uint256 quorumJoinSequence;
        bool setDictatorship;
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
        SetJoinPaused,
        UpdateConfig,
        WithdrawTreasury,
        DisbandTreasury,
        ChangePriest,
        SetDictatorship,
        SetMaxMembers,
        SetMetadata,
        SetProposalFee,
        SetReferralShare,
        CallExternal,
        SetEntryFeeCurve,
        Undefined
    }

    event MemberJoined(
        address indexed payer,
        address indexed member,
        uint256 totalAmount,
        uint256 burnedAmount,
        uint256 treasuryAmount,
        uint256 memberPoolAmount,
        uint256 protocolAmount,
        uint256 timestamp,
        uint256 blockNumber,
        uint256 joinId
    );

    event MemberRewardsClaimed(
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

    event JoinPauseUpdated(bool joinPaused);
    event MaxMembersUpdated(uint256 maxMembers);
    /// @notice Emitted whenever the entry fee curve configuration changes.
    /// @param styles Segment styles in application order (primary first).
    /// @param rateBps Segment rate parameters expressed in basis points.
    /// @param lengths Segment lengths expressed as paid joins (0 = infinite tail).
    event EntryFeeCurveUpdated(
        uint8[] styles,
        uint32[] rateBps,
        uint32[] lengths
    );
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

    event TemplMetadataUpdated(string name, string description, string logoLink);
    event ProposalCreationFeeUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    event ReferralShareBpsUpdated(uint256 previousBps, uint256 newBps);

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
    /// @notice Tracks index positions for external reward tokens (index + 1).
    mapping(address => uint256) internal externalRewardTokenIndex;
    /// @notice Member snapshots for each external reward token.
    mapping(address => mapping(address => uint256)) internal memberExternalRewardSnapshots;
    /// @dev Restricts a function so only wallets that successfully joined may call it.
    modifier onlyMember() {
        if (!members[msg.sender].joined) revert TemplErrors.NotMember();
        _;
    }

    /// @dev Permits calls from the contract (governance) or the priest when dictatorship mode is enabled.
    modifier onlyDAO() {
        // NOTE: Dictatorship mode deliberately grants the priest direct access to DAO functions.
        if (priestIsDictator) {
            if (msg.sender != address(this) && msg.sender != priest) revert TemplErrors.PriestOnly();
        } else if (msg.sender != address(this)) {
            revert TemplErrors.NotDAO();
        }
        _;
    }

    /// @dev Blocks direct calls from the contract to avoid double-entry during join flows.
    modifier notSelf() {
        if (msg.sender == address(this)) revert TemplErrors.InvalidSender();
        _;
    }

    /// @dev Ensures joins and other gated actions only execute when the templ is unpaused.
    modifier whenNotPaused() {
        if (joinPaused) revert TemplErrors.JoinIntakePaused();
        _;
    }

    event DictatorshipModeChanged(bool enabled);

    /// @dev Persists a new external reward checkpoint so future joins can baseline correctly.
    function _recordExternalCheckpoint(ExternalRewardState storage rewards) internal {
        RewardCheckpoint memory checkpoint = RewardCheckpoint({
            blockNumber: uint64(block.number),
            timestamp: uint64(block.timestamp),
            cumulative: rewards.cumulativeRewards
        });
        uint256 len = rewards.checkpoints.length;
        if (len == 0) {
            rewards.checkpoints.push(checkpoint);
            return;
        }
        RewardCheckpoint storage last = rewards.checkpoints[len - 1];
        if (last.blockNumber == checkpoint.blockNumber) {
            last.timestamp = checkpoint.timestamp;
            last.cumulative = checkpoint.cumulative;
        } else {
            rewards.checkpoints.push(checkpoint);
        }
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
    /// @param _name Initial templ name surfaced off-chain.
    /// @param _description Initial templ description.
    /// @param _logoLink Initial templ logo link.
    /// @param _proposalCreationFeeBps Proposal creation fee in basis points of the entry fee.
    /// @param _referralShareBps Referral share in basis points of the member pool allocation.
    function _initializeTempl(
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
        string memory _name,
        string memory _description,
        string memory _logoLink,
        uint256 _proposalCreationFeeBps,
        uint256 _referralShareBps
    ) internal {
        if (_protocolFeeRecipient == address(0) || _accessToken == address(0)) {
            revert TemplErrors.InvalidRecipient();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _accessToken;
        priestIsDictator = _priestIsDictator;

        uint256 burnBps = _burnPercent;
        uint256 treasuryBps = _treasuryPercent;
        uint256 memberBps = _memberPoolPercent;
        uint256 protocolBps = _protocolPercent;

        uint256 rawTotal = _burnPercent + _treasuryPercent + _memberPoolPercent + _protocolPercent;
        if (rawTotal == TOTAL_PERCENT) {
            // values already provided in basis points
        } else if (rawTotal == 100) {
            burnBps = _burnPercent * 100;
            treasuryBps = _treasuryPercent * 100;
            memberBps = _memberPoolPercent * 100;
            protocolBps = _protocolPercent * 100;
        } else {
            revert TemplErrors.InvalidPercentageSplit();
        }

        protocolPercent = protocolBps;
        _setPercentSplit(burnBps, treasuryBps, memberBps);

        if (_quorumPercent == 0) {
            quorumPercent = DEFAULT_QUORUM_PERCENT;
        } else {
            uint256 normalizedQuorum = _quorumPercent;
            if (normalizedQuorum <= 100) {
                normalizedQuorum = normalizedQuorum * 100;
            }
            if (normalizedQuorum > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
            quorumPercent = normalizedQuorum;
        }

        executionDelayAfterQuorum = _executionDelay == 0 ? DEFAULT_EXECUTION_DELAY : _executionDelay;
        burnAddress = _burnAddress == address(0) ? DEFAULT_BURN_ADDRESS : _burnAddress;
        _setTemplMetadata(_name, _description, _logoLink);
        _setProposalCreationFee(_proposalCreationFeeBps);
        _setReferralShareBps(_referralShareBps);
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

    /// @dev Configures the entry fee curve anchor and growth profile.
    function _configureEntryFeeCurve(uint256 newBaseEntryFee, CurveConfig memory newCurve) internal {
        _validateEntryFeeAmount(newBaseEntryFee);
        _validateCurveConfig(newCurve);
        baseEntryFee = newBaseEntryFee;
        entryFeeCurve = newCurve;
        _refreshEntryFeeFromState();
        _emitEntryFeeCurveUpdated();
    }

    /// @dev Updates the entry fee curve without altering the base anchor.
    function _updateEntryFeeCurve(CurveConfig memory newCurve) internal {
        _validateCurveConfig(newCurve);
        entryFeeCurve = newCurve;
        _refreshEntryFeeFromState();
        _emitEntryFeeCurveUpdated();
    }

    /// @dev Sets the current entry fee target while preserving the existing curve shape.
    function _setCurrentEntryFee(uint256 targetEntryFee) internal {
        _validateEntryFeeAmount(targetEntryFee);
        uint256 paidJoins = _currentPaidJoins();
        CurveConfig memory curve = _copyCurveConfig(entryFeeCurve);
        if (paidJoins == 0 || !_curveHasGrowth(curve)) {
            baseEntryFee = targetEntryFee;
            entryFee = targetEntryFee;
        } else {
            uint256 newBase = _solveBaseEntryFee(targetEntryFee, curve, paidJoins);
            baseEntryFee = newBase;
            entryFee = targetEntryFee;
        }
        _emitEntryFeeCurveUpdated();
    }

    /// @dev Applies a curve update driven by governance or DAO actions.
    function _applyCurveUpdate(CurveConfig memory newCurve, uint256 baseEntryFeeValue) internal {
        if (baseEntryFeeValue == 0) {
            _updateEntryFeeCurve(newCurve);
        } else {
            _configureEntryFeeCurve(baseEntryFeeValue, newCurve);
        }
    }

    /// @dev Creates a memory copy of a curve stored on-chain.
    function _copyCurveConfig(CurveConfig storage stored) internal view returns (CurveConfig memory cfg) {
        CurveSegment[] storage extras = stored.additionalSegments;
        uint256 len = extras.length;
        CurveSegment[] memory extraCopy = new CurveSegment[](len);
        for (uint256 i = 0; i < len; i++) {
            extraCopy[i] = extras[i];
        }
        cfg.primary = stored.primary;
        cfg.additionalSegments = extraCopy;
    }

    /// @dev Recomputes the entry fee for the next join in response to membership changes.
    function _advanceEntryFeeAfterJoin() internal {
        _refreshEntryFeeFromState();
    }

    /// @dev Recomputes the entry fee based on the current membership count and stored curve.
    function _refreshEntryFeeFromState() internal {
        if (baseEntryFee == 0) {
            return;
        }
        entryFee = _priceForPaidJoinsFromStorage(baseEntryFee, entryFeeCurve, _currentPaidJoins());
    }

    /// @dev Returns the number of paid joins that have occurred (excludes the auto-enrolled priest).
    function _currentPaidJoins() internal view returns (uint256) {
        if (memberCount == 0) {
            return 0;
        }
        return memberCount - 1;
    }

    /// @dev Reports whether any curve segment introduces dynamic pricing.
    function _curveHasGrowth(CurveConfig memory curve) internal pure returns (bool) {
        if (curve.primary.style != CurveStyle.Static) {
            return true;
        }
        uint256 len = curve.additionalSegments.length;
        for (uint256 i = 0; i < len; i++) {
            if (curve.additionalSegments[i].style != CurveStyle.Static) {
                return true;
            }
        }
        return false;
    }

    /// @dev Computes the entry fee for a given number of completed paid joins (memory curve).
    function _priceForPaidJoins(
        uint256 baseFee,
        CurveConfig memory curve,
        uint256 paidJoins
    ) internal pure returns (uint256) {
        if (paidJoins == 0) {
            return baseFee;
        }
        uint256 remaining = paidJoins;
        uint256 amount = baseFee;
        (amount, remaining) = _consumeSegment(amount, curve.primary, remaining, true);
        if (remaining == 0) {
            return amount;
        }
        CurveSegment[] memory extras = curve.additionalSegments;
        uint256 len = extras.length;
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            (amount, remaining) = _consumeSegment(amount, extras[i], remaining, true);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @dev Computes the entry fee for a given number of completed paid joins (storage curve).
    function _priceForPaidJoinsFromStorage(
        uint256 baseFee,
        CurveConfig storage curve,
        uint256 paidJoins
    ) internal view returns (uint256) {
        if (paidJoins == 0) {
            return baseFee;
        }
        uint256 remaining = paidJoins;
        uint256 amount = baseFee;
        (amount, remaining) = _consumeSegment(amount, curve.primary, remaining, true);
        if (remaining == 0) {
            return amount;
        }
        CurveSegment[] storage extras = curve.additionalSegments;
        uint256 len = extras.length;
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            CurveSegment memory seg = extras[i];
            (amount, remaining) = _consumeSegment(amount, seg, remaining, true);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @dev Derives the base entry fee that produces a target price after `paidJoins` joins.
    function _solveBaseEntryFee(
        uint256 targetPrice,
        CurveConfig memory curve,
        uint256 paidJoins
    ) internal pure returns (uint256) {
        if (paidJoins == 0) {
            return targetPrice;
        }
        uint256 remaining = paidJoins;
        uint256 amount = targetPrice;
        (amount, remaining) = _consumeSegment(amount, curve.primary, remaining, false);
        if (remaining == 0) {
            return amount;
        }
        CurveSegment[] memory extras = curve.additionalSegments;
        uint256 len = extras.length;
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            (amount, remaining) = _consumeSegment(amount, extras[i], remaining, false);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @dev Applies a curve segment for up to `remaining` steps and returns the updated amount + remaining steps.
    function _consumeSegment(
        uint256 amount,
        CurveSegment memory segment,
        uint256 remaining,
        bool forward
    ) internal pure returns (uint256, uint256) {
        if (remaining == 0) {
            return (amount, remaining);
        }
        uint256 segmentLength = uint256(segment.length);
        uint256 steps = segmentLength == 0 ? remaining : _min(remaining, segmentLength);
        if (steps > 0) {
            amount = _applySegment(amount, segment, steps, forward);
            remaining -= steps;
        }
        if (segmentLength == 0) {
            remaining = 0;
        }
        return (amount, remaining);
    }

    /// @dev Applies a curve segment forward or inverse for the specified number of steps.
    function _applySegment(
        uint256 amount,
        CurveSegment memory segment,
        uint256 steps,
        bool forward
    ) internal pure returns (uint256) {
        if (steps == 0 || segment.style == CurveStyle.Static) {
            return amount;
        }
        if (segment.style == CurveStyle.Linear) {
            uint256 rate = uint256(segment.rateBps);
            if (rate == 0 || steps == 0) {
                return amount;
            }
            if (steps > type(uint256).max / rate) {
                return MAX_ENTRY_FEE;
            }
            uint256 scaled = rate * steps;
            uint256 offset;
            unchecked {
                offset = TOTAL_PERCENT + scaled;
            }
            if (offset < TOTAL_PERCENT) {
                return MAX_ENTRY_FEE;
            }
            if (forward) {
                if (_mulWouldOverflow(amount, offset)) {
                    return MAX_ENTRY_FEE;
                }
                uint256 linearResult = Math.mulDiv(amount, offset, TOTAL_PERCENT);
                return linearResult > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : linearResult;
            }
            if (_mulWouldOverflow(amount, TOTAL_PERCENT)) {
                return MAX_ENTRY_FEE;
            }
            uint256 inverseResult = Math.mulDiv(amount, TOTAL_PERCENT, offset, Math.Rounding.Ceil);
            return inverseResult > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : inverseResult;
        }
        if (segment.style == CurveStyle.Exponential) {
            (uint256 factor, bool overflow) = _powBps(segment.rateBps, steps);
            if (overflow) {
                return MAX_ENTRY_FEE;
            }
            return forward ? _scaleForward(amount, factor) : _scaleInverse(amount, factor);
        }
        revert TemplErrors.InvalidCurveConfig();
    }

    /// @dev Computes a basis-point scaled exponent using exponentiation by squaring.
    function _powBps(uint256 factorBps, uint256 exponent) internal pure returns (uint256 result, bool overflow) {
        if (exponent == 0) {
            return (TOTAL_PERCENT, false);
        }
        result = TOTAL_PERCENT;
        uint256 baseFactor = factorBps;
        uint256 remaining = exponent;
        while (remaining > 0) {
            if (remaining & 1 == 1) {
                if (_mulWouldOverflow(result, baseFactor)) {
                    return (0, true);
                }
                result = Math.mulDiv(result, baseFactor, TOTAL_PERCENT);
                if (result == 0) {
                    result = 1;
                }
            }
            remaining >>= 1;
            if (remaining == 0) {
                break;
            }
            if (_mulWouldOverflow(baseFactor, baseFactor)) {
                return (0, true);
            }
            baseFactor = Math.mulDiv(baseFactor, baseFactor, TOTAL_PERCENT);
            if (baseFactor == 0) {
                baseFactor = 1;
            }
        }
        return (result, false);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @dev Validates curve configuration input.
    function _validateCurveConfig(CurveConfig memory curve) internal pure {
        _validateCurveSegment(curve.primary);
        CurveSegment[] memory extras = curve.additionalSegments;
        uint256 extrasLen = extras.length;
        if (extrasLen == 0) {
            if (curve.primary.length != 0) {
                revert TemplErrors.InvalidCurveConfig();
            }
            return;
        }
        if (curve.primary.length == 0) {
            revert TemplErrors.InvalidCurveConfig();
        }
        for (uint256 i = 0; i < extrasLen; i++) {
            CurveSegment memory segment = extras[i];
            bool isLast = i == extrasLen - 1;
            _validateCurveSegment(segment);
            if (!isLast && segment.length == 0) {
                revert TemplErrors.InvalidCurveConfig();
            }
            if (isLast && segment.length != 0) {
                revert TemplErrors.InvalidCurveConfig();
            }
        }
    }

    /// @dev Validates a single curve segment.
    function _validateCurveSegment(CurveSegment memory segment) internal pure {
        if (segment.style == CurveStyle.Static) {
            if (segment.rateBps != 0) revert TemplErrors.InvalidCurveConfig();
            return;
        }
        if (segment.style == CurveStyle.Linear) {
            return;
        }
        if (segment.style == CurveStyle.Exponential) {
            if (segment.rateBps == 0) revert TemplErrors.InvalidCurveConfig();
            return;
        }
        revert TemplErrors.InvalidCurveConfig();
    }

    /// @dev Ensures entry fee amounts satisfy templ invariants.
    function _validateEntryFeeAmount(uint256 amount) internal pure {
        if (amount < 10) revert TemplErrors.EntryFeeTooSmall();
        if (amount % 10 != 0) revert TemplErrors.InvalidEntryFee();
        if (amount > MAX_ENTRY_FEE) revert TemplErrors.EntryFeeTooLarge();
    }

    /// @dev Emits the standardized curve update event with the current configuration.
    function _emitEntryFeeCurveUpdated() internal {
        CurveConfig storage cfg = entryFeeCurve;
        uint256 additional = cfg.additionalSegments.length;
        uint256 segmentCount = 1 + additional;
        uint8[] memory styles = new uint8[](segmentCount);
        uint32[] memory rates = new uint32[](segmentCount);
        uint32[] memory lengths = new uint32[](segmentCount);
        styles[0] = uint8(cfg.primary.style);
        rates[0] = cfg.primary.rateBps;
        lengths[0] = cfg.primary.length;
        for (uint256 i = 0; i < additional; i++) {
            CurveSegment storage seg = cfg.additionalSegments[i];
            styles[i + 1] = uint8(seg.style);
            rates[i + 1] = seg.rateBps;
            lengths[i + 1] = seg.length;
        }
        emit EntryFeeCurveUpdated(styles, rates, lengths);
    }

    /// @dev Toggles dictatorship governance mode, emitting an event when the state changes.
    function _updateDictatorship(bool _enabled) internal {
        if (priestIsDictator == _enabled) revert TemplErrors.DictatorshipUnchanged();
        priestIsDictator = _enabled;
        emit DictatorshipModeChanged(_enabled);
    }

    /// @dev Sets or clears the membership cap and auto-pauses if the new cap is already met.
    function _setMaxMembers(uint256 newMaxMembers) internal {
        uint256 currentMembers = memberCount;
        if (newMaxMembers > 0 && newMaxMembers < currentMembers) {
            revert TemplErrors.MemberLimitTooLow();
        }
        MAX_MEMBERS = newMaxMembers;
        emit MaxMembersUpdated(newMaxMembers);
        _refreshEntryFeeFromState();
        _autoPauseIfLimitReached();
    }

    /// @dev Writes new templ metadata and emits an event when it changes.
    function _setTemplMetadata(
        string memory newName,
        string memory newDescription,
        string memory newLogoLink
    ) internal {
        templName = newName;
        templDescription = newDescription;
        templLogoLink = newLogoLink;
        emit TemplMetadataUpdated(newName, newDescription, newLogoLink);
    }

    /// @dev Updates the proposal creation fee and emits an event when it changes.
    function _setProposalCreationFee(uint256 newFeeBps) internal {
        if (newFeeBps > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
        uint256 previous = proposalCreationFeeBps;
        proposalCreationFeeBps = newFeeBps;
        emit ProposalCreationFeeUpdated(previous, newFeeBps);
    }

    /// @dev Updates the referral share BPS and emits an event when it changes.
    function _setReferralShareBps(uint256 newBps) internal {
        if (newBps > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
        uint256 previous = referralShareBps;
        referralShareBps = newBps;
        emit ReferralShareBpsUpdated(previous, newBps);
    }

    /// @dev Internal helper that executes a treasury withdrawal and emits the corresponding event.
    function _withdrawTreasury(
        address token,
        address recipient,
        uint256 amount,
        string memory reason,
        uint256 proposalId
    ) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (amount == 0) revert TemplErrors.AmountZero();

        if (token == accessToken) {
            uint256 currentBalance = IERC20(accessToken).balanceOf(address(this));
            if (currentBalance <= memberPoolBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 availableBalance = currentBalance - memberPoolBalance;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 debitedFromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= debitedFromFees;

            _safeTransfer(accessToken, recipient, amount);
        } else if (token == address(0)) {
            ExternalRewardState storage rewards = externalRewards[address(0)];
            uint256 currentBalance = address(this).balance;
            uint256 reservedForMembers = rewards.poolBalance;
            uint256 availableBalance = currentBalance > reservedForMembers ? currentBalance - reservedForMembers : 0;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            ExternalRewardState storage rewards = externalRewards[token];
            uint256 currentBalance = IERC20(token).balanceOf(address(this));
            uint256 reservedForMembers = rewards.poolBalance;
            uint256 availableBalance = currentBalance > reservedForMembers
                ? currentBalance - reservedForMembers
                : 0;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            _safeTransfer(token, recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount, reason);
    }

    /// @dev Applies updates to the entry fee and fee split configuration.
    function _updateConfig(
        address _token,
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal {
        if (_token != address(0) && _token != accessToken) revert TemplErrors.TokenChangeDisabled();
        if (_entryFee > 0) {
            _setCurrentEntryFee(_entryFee);
        }
        if (_updateFeeSplit) {
            _setPercentSplit(_burnPercent, _treasuryPercent, _memberPoolPercent);
        }
        emit ConfigUpdated(accessToken, entryFee, burnPercent, treasuryPercent, memberPoolPercent, protocolPercent);
    }

    /// @dev Sets the join pause flag without mutating membership limits during manual resumes.
    function _setJoinPaused(bool _paused) internal {
        joinPaused = _paused;
        emit JoinPauseUpdated(_paused);
    }

    /// @dev Backend listeners consume PriestChanged to persist the new priest and notify off-chain services.
    function _changePriest(address newPriest) internal {
        if (newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        address old = priest;
        if (newPriest == old) revert TemplErrors.InvalidCallData();
        priest = newPriest;
        emit PriestChanged(old, newPriest);
    }

    /// @dev Routes treasury balances into member or external pools so members can claim them evenly.
    function _disbandTreasury(address token, uint256 proposalId) internal {
        uint256 activeMembers = memberCount;
        if (activeMembers == 0) revert TemplErrors.NoMembers();

        if (token == accessToken) {
            uint256 accessTokenBalance = IERC20(accessToken).balanceOf(address(this));
            if (accessTokenBalance <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
            uint256 accessTokenAmount = accessTokenBalance - memberPoolBalance;

            uint256 debitedFromFees = accessTokenAmount <= treasuryBalance ? accessTokenAmount : treasuryBalance;
            treasuryBalance -= debitedFromFees;

            memberPoolBalance += accessTokenAmount;

            uint256 poolTotalRewards = accessTokenAmount + memberRewardRemainder;
            uint256 poolPerMember = poolTotalRewards / activeMembers;
            uint256 remainder = poolTotalRewards % activeMembers;

            memberRewardRemainder = remainder;
            cumulativeMemberRewards += poolPerMember;
            emit TreasuryDisbanded(proposalId, token, accessTokenAmount, poolPerMember, remainder);
            return;
        }

        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            _registerExternalToken(token);
            rewards = externalRewards[token];
        }
        uint256 tokenBalance;
        if (token == address(0)) {
            tokenBalance = address(this).balance;
        } else {
            tokenBalance = IERC20(token).balanceOf(address(this));
        }
        if (tokenBalance == 0) revert TemplErrors.NoTreasuryFunds();

        uint256 poolBalance = rewards.poolBalance;
        uint256 totalAmount = tokenBalance > poolBalance ? tokenBalance - poolBalance : 0;
        if (totalAmount == 0) revert TemplErrors.NoTreasuryFunds();

        uint256 perMember = totalAmount / activeMembers;
        uint256 remainderExternal = totalAmount % activeMembers;

        rewards.poolBalance += totalAmount;
        rewards.rewardRemainder += remainderExternal;
        rewards.cumulativeRewards += perMember;
        _recordExternalCheckpoint(rewards);

        emit TreasuryDisbanded(proposalId, token, totalAmount, perMember, remainderExternal);
    }

    function _addActiveProposal(uint256 proposalId) internal {
        activeProposalIds.push(proposalId);
        activeProposalIndex[proposalId] = activeProposalIds.length;
    }

    function _removeActiveProposal(uint256 proposalId) internal {
        uint256 indexPlusOne = activeProposalIndex[proposalId];
        if (indexPlusOne == 0) {
            return;
        }
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = activeProposalIds.length - 1;
        if (index != lastIndex) {
            uint256 movedId = activeProposalIds[lastIndex];
            activeProposalIds[index] = movedId;
            activeProposalIndex[movedId] = index + 1;
        }
        activeProposalIds.pop();
        activeProposalIndex[proposalId] = 0;
    }

    /// @dev Checks whether a member joined after a particular snapshot point using join sequences.
    /// @param memberInfo Stored membership record to inspect.
    /// @param snapshotJoinSequence Join sequence captured in the proposal snapshot (0 when unused).
    /// @return joinedAfter True when the member joined strictly after the snapshot sequence.
    function _joinedAfterSnapshot(Member storage memberInfo, uint256 snapshotJoinSequence)
        internal
        view
        returns (bool joinedAfter)
    {
        if (snapshotJoinSequence == 0) {
            return false;
        }
        if (!memberInfo.joined) {
            return true;
        }
        if (memberInfo.joinSequence == 0) {
            return true;
        }
        return memberInfo.joinSequence > snapshotJoinSequence;
    }

    /// @dev Helper that determines if a proposal is still active based on time and execution status.
    function _isActiveProposal(Proposal storage proposal, uint256 currentTime) internal view returns (bool) {
        return currentTime < proposal.endTime && !proposal.executed;
    }

    /// @dev Pauses new joins when a membership cap is set and already reached.
    function _autoPauseIfLimitReached() internal {
        uint256 limit = MAX_MEMBERS;
        if (limit > 0 && memberCount >= limit && !joinPaused) {
            joinPaused = true;
            emit JoinPauseUpdated(true);
        }
    }

    /// @dev Executes an ERC-20 call and verifies optional boolean return values.
    /// @dev Transfers tokens from the current contract to `to`, reverting on failure.
    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        IERC20(token).safeTransfer(to, amount);
    }

    /// @dev Transfers tokens from `from` to `to`, reverting when allowances are insufficient.
    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    /// @dev Registers a token so external rewards can be enumerated by frontends.
    function _registerExternalToken(address token) internal {
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            if (externalRewardTokens.length >= MAX_EXTERNAL_REWARD_TOKENS) {
                revert TemplErrors.ExternalRewardLimitReached();
            }
            rewards.exists = true;
            externalRewardTokens.push(token);
            externalRewardTokenIndex[token] = externalRewardTokens.length;
        }
    }

    /// @dev Removes a token from the external rewards enumeration list.
    function _removeExternalToken(address token) internal {
        uint256 indexPlusOne = externalRewardTokenIndex[token];
        if (indexPlusOne == 0) {
            return;
        }
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = externalRewardTokens.length - 1;
        if (index != lastIndex) {
            address movedToken = externalRewardTokens[lastIndex];
            externalRewardTokens[index] = movedToken;
            externalRewardTokenIndex[movedToken] = index + 1;
        }
        externalRewardTokens.pop();
        externalRewardTokenIndex[token] = 0;
    }

    /// @dev Scales `amount` by `multiplier` (basis points) with saturation at MAX_ENTRY_FEE.
    function _scaleForward(uint256 amount, uint256 multiplier) internal pure returns (uint256) {
        if (_mulWouldOverflow(amount, multiplier)) {
            return MAX_ENTRY_FEE;
        }
        uint256 result = Math.mulDiv(amount, multiplier, TOTAL_PERCENT);
        return result > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : result;
    }

    /// @dev Inverts the scaling by dividing `amount` by `divisor` (basis points) while rounding up.
    function _scaleInverse(uint256 amount, uint256 divisor) internal pure returns (uint256) {
        if (divisor == 0) revert TemplErrors.InvalidCurveConfig();
        if (_mulWouldOverflow(amount, TOTAL_PERCENT)) {
            return MAX_ENTRY_FEE;
        }
        uint256 result = Math.mulDiv(amount, TOTAL_PERCENT, divisor, Math.Rounding.Ceil);
        return result > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : result;
    }

    /// @dev Returns true when multiplying `a` and `b` would overflow uint256.
    function _mulWouldOverflow(uint256 a, uint256 b) internal pure returns (bool) {
        if (a == 0 || b == 0) {
            return false;
        }
        return a > type(uint256).max / b;
    }

}
