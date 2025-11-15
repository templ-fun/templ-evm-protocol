// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig, CurveSegment, CurveStyle} from "./TemplCurve.sol";
import {TemplDefaults} from "./TemplDefaults.sol";

/// @title Base Templ Storage and Helpers
/// @notice Hosts shared state, events, and internal helpers used by membership, treasury, and governance modules.
/// @author templ.fun
abstract contract TemplBase is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Basis for fee split math (basis points per 100%).
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    /// @dev Default quorum threshold (basis points) applied when callers pass zero into constructors.
    uint256 internal constant DEFAULT_QUORUM_BPS = TemplDefaults.DEFAULT_QUORUM_BPS;
    /// @dev Default post-quorum execution delay used when deployers do not override it.
    uint256 internal constant DEFAULT_POST_QUORUM_VOTING_PERIOD = TemplDefaults.DEFAULT_EXECUTION_DELAY;
    /// @dev Default burn address used when deployers do not provide a custom sink.
    address internal constant DEFAULT_BURN_ADDRESS = TemplDefaults.DEFAULT_BURN_ADDRESS;
    /// @dev Default YES vote threshold applied when deployers do not override it.
    uint256 internal constant DEFAULT_YES_VOTE_THRESHOLD_BPS = TemplDefaults.DEFAULT_YES_VOTE_THRESHOLD_BPS;
    /// @dev Minimum allowed YES vote threshold (basis points).
    uint256 internal constant MIN_YES_VOTE_THRESHOLD_BPS = 100;
    /// @dev Caps the number of external reward tokens tracked to keep join gas bounded.
    uint256 internal constant MAX_EXTERNAL_REWARD_TOKENS = 256;
    /// @dev Maximum entry fee supported before arithmetic would overflow downstream accounting.
    uint256 internal constant MAX_ENTRY_FEE = type(uint128).max;
    /// @dev Maximum total number of curve segments (primary + additional) allowed.
    uint256 internal constant MAX_CURVE_SEGMENTS = 8;
    /// @dev Maximum allowed proposal title length in bytes.
    uint256 internal constant MAX_PROPOSAL_TITLE_LENGTH = 256;
    /// @dev Maximum allowed proposal description length in bytes.
    uint256 internal constant MAX_PROPOSAL_DESCRIPTION_LENGTH = 2048;
    /// @dev Maximum allowed templ name length in bytes.
    uint256 internal constant MAX_TEMPL_NAME_LENGTH = 256;
    /// @dev Maximum allowed templ description length in bytes.
    uint256 internal constant MAX_TEMPL_DESCRIPTION_LENGTH = 2048;
    /// @dev Maximum allowed templ logo URI length in bytes.
    uint256 internal constant MAX_TEMPL_LOGO_URI_LENGTH = 2048;

    /// @notice Basis points of the entry fee that are burned on every join.
    uint256 public burnBps;
    /// @notice Basis points of the entry fee routed into the treasury balance.
    uint256 public treasuryBps;
    /// @notice Basis points of the entry fee set aside for the member rewards pool.
    uint256 public memberPoolBps;
    /// @notice Basis points of the entry fee forwarded to the protocol on every join.
    uint256 public protocolBps;
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
    /// @notice Treasury-held balance denominated in the access token.
    uint256 public treasuryBalance;
    /// @notice Member pool balance denominated in the access token.
    uint256 public memberPoolBalance;
    /// @notice Whether new member joins are currently paused.
    bool public joinPaused;
    /// @notice Maximum allowed members when greater than zero (0 = uncapped).
    uint256 public maxMembers;
    /// @notice YES vote threshold required to satisfy quorum (basis points).
    uint256 public quorumBps;
    /// @notice Seconds governance must wait after quorum before executing a proposal.
    uint256 public postQuorumVotingPeriod;
    /// @notice Address that receives burn allocations.
    address public burnAddress;
    /// @notice Templ metadata surfaced across UIs and off-chain services.
    string public templName;
    /// @notice Short human-readable description for the templ.
    string public templDescription;
    /// @notice Canonical logo link for the templ.
    string public templLogoLink;
    /// @notice Basis points of the entry fee that must be paid to create proposals.
    uint256 public proposalCreationFeeBps;
    /// @notice Basis points of the member pool share paid to a referral during joins.
    uint256 public referralShareBps;
    /// @notice Basis points of YES votes required (relative to total votes cast) for a proposal to pass.
    uint256 public yesVoteThresholdBps;
    /// @notice When true, only council members may vote on proposals.
    bool public councilModeEnabled;
    /// @notice True once the priest-consumed bootstrap council seat has been used.
    bool public councilBootstrapConsumed;
    /// @notice Tracks whether an address currently sits on the council.
    mapping(address => bool) public councilMembers;
    /// @notice Number of active council members.
    uint256 public councilMemberCount;
    /// @notice Pricing curve configuration that governs how entry fees scale with membership.
    CurveConfig public entryFeeCurve;

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

    /// @notice Membership records keyed by wallet address.
    mapping(address => Member) public members;
    /// @notice Number of active members (includes the auto-enrolled priest).
    uint256 public memberCount;
    /// @notice Cumulative member-pool claims per wallet.
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
        CleanupExternalRewardToken,
        SetQuorumBps,
        SetPostQuorumVotingPeriod,
        SetBurnAddress,
        SetYesVoteThreshold,
        SetCouncilMode,
        AddCouncilMember,
        RemoveCouncilMember,
        Undefined
    }

    /// @notice Governance proposal payload and lifecycle state.
    struct Proposal {
        /// @notice Unique, monotonic proposal id.
        uint256 id;
        /// @notice Creator wallet that opened the proposal.
        address proposer;
        /// @notice Action type that will be executed if the proposal passes.
        Action action;
        /// @notice Token parameter for actions that require one (address(0) for ETH where applicable).
        address token;
        /// @notice Recipient wallet used by actions such as withdrawals or priest changes.
        address recipient;
        /// @notice Amount parameter used by treasury withdrawals.
        uint256 amount;
        /// @notice On-chain title string for the proposal.
        string title;
        /// @notice On-chain description string for the proposal.
        string description;
        /// @notice Desired join pause state when the action is SetJoinPaused.
        bool joinPaused;
        /// @notice Replacement entry fee when updating config (0 keeps existing value).
        uint256 newEntryFee;
        /// @notice Replacement burn split (bps) when updating config.
        uint256 newBurnBps;
        /// @notice Replacement treasury split (bps) when updating config.
        uint256 newTreasuryBps;
        /// @notice Replacement member pool split (bps) when updating config.
        uint256 newMemberPoolBps;
        /// @notice Replacement templ name when action is SetMetadata.
        string newTemplName;
        /// @notice Replacement templ description when action is SetMetadata.
        string newTemplDescription;
        /// @notice Replacement templ logo link when action is SetMetadata.
        string newLogoLink;
        /// @notice Proposed proposal-creation fee (bps of entry fee).
        uint256 newProposalCreationFeeBps;
        /// @notice Proposed referral share (bps of the member-pool slice).
        uint256 newReferralShareBps;
        /// @notice Proposed membership cap (0 uncaps).
        uint256 newMaxMembers;
        /// @notice Quorum threshold proposed (bps).
        uint256 newQuorumBps;
        /// @notice Post‑quorum voting period proposed (seconds) after quorum is reached.
        uint256 newPostQuorumVotingPeriod;
        /// @notice Burn address proposed to receive burn allocations.
        address newBurnAddress;
        /// @notice YES vote threshold (bps) proposed by SetYesVoteThreshold.
        uint256 newYesVoteThresholdBps;
        /// @notice Target contract invoked when executing an external call proposal.
        address externalCallTarget;
        /// @notice ETH value forwarded when executing the external call.
        uint256 externalCallValue;
        /// @notice ABI-encoded calldata executed against the external target.
        bytes externalCallData;
        /// @notice Entry fee curve configuration proposed when action is SetEntryFeeCurve.
        CurveConfig curveConfig;
        /// @notice Optional replacement base entry fee anchor for the curve (0 keeps current base).
        uint256 curveBaseEntryFee;
        /// @notice Count of YES votes recorded.
        uint256 yesVotes;
        /// @notice Count of NO votes recorded.
        uint256 noVotes;
        /// @notice Voting/execution deadline captured when created or when quorum is reached.
        uint256 endTime;
        /// @notice Timestamp when the proposal was created.
        uint256 createdAt;
        /// @notice True once the proposal has been executed.
        bool executed;
        /// @notice Tracks whether each voter has cast a ballot.
        mapping(address => bool) hasVoted;
        /// @notice Voter's recorded choice (true = YES, false = NO).
        mapping(address => bool) voteChoice;
        /// @notice Number of eligible voters at proposal creation.
        uint256 eligibleVoters;
        /// @notice Number of eligible voters when quorum was reached.
        uint256 postQuorumEligibleVoters;
        /// @notice Timestamp when quorum was reached (0 when never reached).
        uint256 quorumReachedAt;
        /// @notice Block number snapshot taken when quorum was reached.
        uint256 quorumSnapshotBlock;
        /// @notice When true, quorum rules do not apply (voting period only).
        bool quorumExempt;
        /// @notice When true, apply split updates alongside entry fee during UpdateConfig.
        bool updateFeeSplit;
        /// @notice Block number recorded when the proposal was created.
        uint256 preQuorumSnapshotBlock;
        /// @notice Join sequence recorded when the proposal was created.
        uint256 preQuorumJoinSequence;
        /// @notice Join sequence recorded when quorum was reached (0 if quorum never satisfied).
        uint256 quorumJoinSequence;
        /// @notice Desired dictatorship state when the action is SetDictatorship.
        bool setDictatorship;
        /// @notice Desired council mode state when the action is SetCouncilMode.
        bool setCouncilMode;
    }

    /// @notice Total proposals ever created.
    uint256 public proposalCount;
    /// @notice Proposal storage mapping keyed by proposal id.
    mapping(uint256 => Proposal) public proposals;
    /// @notice Tracks each proposer's active proposal id (0 when none active).
    mapping(address => uint256) public activeProposalId;
    /// @notice Flags whether a proposer currently has an active proposal.
    mapping(address => bool) public hasActiveProposal;
    /// @dev Dense set of currently active proposal ids for enumeration.
    uint256[] internal activeProposalIds;
    /// @dev Index (id -> position+1) for O(1) removals from `activeProposalIds`.
    mapping(uint256 => uint256) internal activeProposalIndex;
    /// @notice Minimum allowed pre‑quorum voting period.
    uint256 public constant MIN_PRE_QUORUM_VOTING_PERIOD = 36 hours;
    /// @notice Maximum allowed pre‑quorum voting period.
    uint256 public constant MAX_PRE_QUORUM_VOTING_PERIOD = 30 days;
    /// @notice Default pre‑quorum voting period applied when proposal creators pass zero.
    uint256 public preQuorumVotingPeriod;

    /// @notice Emitted after a successful join.
    /// @param payer Wallet that paid the entry fee.
    /// @param member Wallet that received membership.
    /// @param totalAmount Total entry fee paid (in access token units).
    /// @param burnedAmount Portion sent to `burnAddress`.
    /// @param treasuryAmount Portion accrued to the templ treasury.
    /// @param memberPoolAmount Portion streamed to the member pool (before referral payout).
    /// @param protocolAmount Portion forwarded to the protocol fee recipient.
    /// @param timestamp Block timestamp when the join completed.
    /// @param blockNumber Block number when the join completed.
    /// @param joinId Monotonic index for non‑priest joins, starting at 0 for the first non‑priest member.
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
        uint256 indexed joinId
    );

    /// @notice Emitted when a member claims rewards from the member pool.
    /// @param member Wallet that claimed rewards.
    /// @param amount Amount of access token paid out.
    /// @param timestamp Block timestamp when the claim was processed.
    event MemberRewardsClaimed(address indexed member, uint256 indexed amount, uint256 indexed timestamp);

    /// @notice Emitted when a proposal is created.
    /// @param proposalId Newly created proposal id.
    /// @param proposer Wallet that created the proposal.
    /// @param endTime Timestamp when voting/execution window closes.
    /// @param title On-chain title string.
    /// @param description On-chain description string.
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 indexed endTime,
        string title,
        string description
    );

    /// @notice Emitted when a member casts a vote on a proposal.
    /// @param proposalId Proposal id being voted on.
    /// @param voter Wallet that cast the vote.
    /// @param support True for YES, false for NO.
    /// @param timestamp Block timestamp when the vote was recorded.
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool indexed support, uint256 timestamp);

    /// @notice Emitted after a proposal execution attempt.
    /// @param proposalId Proposal id that was executed.
    /// @param success True when the execution succeeded.
    /// @param returnDataHash Keccak256 hash of returned bytes (or empty).
    event ProposalExecuted(uint256 indexed proposalId, bool indexed success, bytes32 returnDataHash);

    /// @notice Emitted when a treasury withdrawal is executed.
    /// @param proposalId Proposal id that authorized the withdrawal (0 for direct DAO call).
    /// @param token Token withdrawn (address(0) for ETH).
    /// @param recipient Recipient wallet.
    /// @param amount Amount transferred.
    event TreasuryAction(uint256 indexed proposalId, address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when templ configuration is updated.
    /// @param token Access token address.
    /// @param entryFee Current entry fee.
    /// @param burnBps Burn share (bps).
    /// @param treasuryBps Treasury share (bps).
    /// @param memberPoolBps Member pool share (bps).
    /// @param protocolBps Protocol share (bps).
    event ConfigUpdated(
        address indexed token,
        uint256 indexed entryFee,
        uint256 indexed burnBps,
        uint256 treasuryBps,
        uint256 memberPoolBps,
        uint256 protocolBps
    );

    /// @notice Emitted when joins are paused or resumed.
    /// @param joinPaused New pause state.
    event JoinPauseUpdated(bool indexed joinPaused);
    /// @notice Emitted when the membership cap is updated.
    /// @param maxMembers New maximum member count (0 = uncapped).

    event MaxMembersUpdated(uint256 indexed maxMembers);
    /// @notice Emitted whenever the entry fee curve configuration changes.
    /// @param styles Segment styles in application order (primary first).
    /// @param rateBps Segment rate parameters expressed in basis points.
    /// @param lengths Segment lengths expressed as paid joins (0 = infinite tail).

    event EntryFeeCurveUpdated(uint8[] styles, uint32[] rateBps, uint32[] lengths);
    /// @notice Emitted when the priest address is changed.
    /// @param oldPriest Previous priest address.
    /// @param newPriest New priest address.

    event PriestChanged(address indexed oldPriest, address indexed newPriest);
    /// @notice Emitted when treasury balances are disbanded into a reward pool.
    /// @param proposalId Proposal id that authorized the disband (0 for direct DAO call).
    /// @param token Token disbanded (address(0) for ETH).
    /// @param amount Total amount moved into the pool.
    /// @param perMember Reward amount per member.
    /// @param remainder Remainder carried forward to the next distribution.

    event TreasuryDisbanded(
        uint256 indexed proposalId,
        address indexed token,
        uint256 indexed amount,
        uint256 perMember,
        uint256 remainder
    );

    /// @notice Emitted when a member claims external rewards.
    /// @param token ERC-20 token address or address(0) for ETH.
    /// @param member Recipient wallet.
    /// @param amount Claimed amount.
    event ExternalRewardClaimed(address indexed token, address indexed member, uint256 indexed amount);

    /// @notice Emitted when templ metadata is updated.
    /// @param name New templ name.
    /// @param description New templ description.
    /// @param logoLink New templ logo link.

    event TemplMetadataUpdated(string name, string description, string logoLink);
    /// @notice Emitted when the proposal creation fee is updated.
    /// @param previousFeeBps Previous fee (bps of entry fee).
    /// @param newFeeBps New fee (bps of entry fee).

    event ProposalCreationFeeUpdated(uint256 indexed previousFeeBps, uint256 indexed newFeeBps);
    /// @notice Emitted when referral share bps is updated.
    /// @param previousBps Previous referral share bps.
    /// @param newBps New referral share bps.

    event ReferralShareBpsUpdated(uint256 indexed previousBps, uint256 indexed newBps);
    /// @notice Emitted when the quorum threshold is updated via governance.
    /// @param previousBps Previous quorum threshold (bps).
    /// @param newBps New quorum threshold (bps).

    event QuorumBpsUpdated(uint256 indexed previousBps, uint256 indexed newBps);
    /// @notice Emitted when the post‑quorum voting period is updated via governance.
    /// @param previousPeriod Previous period (seconds).
    /// @param newPeriod New period (seconds).

    event PostQuorumVotingPeriodUpdated(uint256 indexed previousPeriod, uint256 indexed newPeriod);
    /// @notice Emitted when the burn address is updated via governance.
    /// @param previousBurn Previous burn sink address.
    /// @param newBurn New burn sink address.

    event BurnAddressUpdated(address indexed previousBurn, address indexed newBurn);
    /// @notice Emitted when the default pre‑quorum voting period is updated.
    /// @param previousPeriod Previous default pre‑quorum voting period (seconds).
    /// @param newPeriod New default pre‑quorum voting period (seconds).

    event PreQuorumVotingPeriodUpdated(uint256 indexed previousPeriod, uint256 indexed newPeriod);
    /// @notice Emitted when the YES vote threshold changes.
    /// @param previousThreshold Previous threshold (bps).
    /// @param newThreshold New threshold (bps).
    event YesVoteThresholdUpdated(uint256 indexed previousThreshold, uint256 indexed newThreshold);
    /// @notice Emitted when council governance mode toggles.
    /// @param enabled True when council mode is active.
    event CouncilModeUpdated(bool indexed enabled);
    /// @notice Emitted when a council member is added.
    /// @param account Wallet that was added to the council.
    /// @param addedBy Caller that initiated the addition.
    event CouncilMemberAdded(address indexed account, address indexed addedBy);
    /// @notice Emitted when a council member is removed.
    /// @param account Wallet that left the council.
    /// @param removedBy Caller that initiated the removal.
    event CouncilMemberRemoved(address indexed account, address indexed removedBy);
    /// @notice Emitted when dictatorship mode is toggled.
    /// @param enabled True when dictatorship is enabled, false when disabled.
    event DictatorshipModeChanged(bool indexed enabled);

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

    /// @notice Persists a new external reward checkpoint so future joins can baseline correctly.
    /// @param rewards External reward state to record a checkpoint for.
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

    /// @notice Determines the cumulative rewards baseline for a member using join-time snapshots.
    /// @param rewards External reward state that holds checkpoints.
    /// @param memberInfo Membership record used to locate the baseline.
    /// @return baseline Baseline cumulative reward value for the member.
    function _externalBaselineForMember(
        ExternalRewardState storage rewards,
        Member storage memberInfo
    ) internal view returns (uint256 baseline) {
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

    /// @notice Clears an external reward token from enumeration once fully settled.
    /// @param token External reward token to remove (address(0) for ETH allowed).
    function _cleanupExternalRewardToken(address token) internal {
        if (token == accessToken) revert TemplErrors.InvalidCallData();
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) revert TemplErrors.InvalidCallData();
        if (rewards.poolBalance != 0 || rewards.rewardRemainder != 0) {
            revert TemplErrors.ExternalRewardsNotSettled();
        }
        rewards.poolBalance = 0;
        rewards.rewardRemainder = 0;
        rewards.exists = false;
        _removeExternalToken(token);
    }

    /// @notice Distributes any outstanding external reward remainders to existing members before new joins.
    function _flushExternalRemainders() internal {
        uint256 currentMembers = memberCount;
        if (currentMembers == 0) {
            return;
        }
        uint256 tokenCount = externalRewardTokens.length;
        for (uint256 i = 0; i < tokenCount; ++i) {
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
    /// @param _burnBps Initial burn share in basis points of every entry fee.
    /// @param _treasuryBps Initial treasury share in basis points.
    /// @param _memberPoolBps Initial member pool share in basis points.
    /// @param _protocolBps Protocol fee share in basis points baked into every templ deployment.
    /// @param _quorumBps YES vote threshold (basis points) required to reach quorum (defaults when zero).
    /// @param _executionDelay Seconds to wait after quorum before execution (defaults when zero).
    /// @param _burnAddress Address receiving burn allocations (fallbacks to the dead address).
    /// @param _priestIsDictator Whether the templ starts in dictatorship mode.
    /// @param _name Initial templ name surfaced off-chain.
    /// @param _description Initial templ description.
    /// @param _logoLink Initial templ logo link.
    /// @param _proposalCreationFeeBps Proposal creation fee in basis points of the entry fee.
    /// @param _referralShareBps Referral share in basis points of the member pool allocation.
    /// @dev Also initializes the default `preQuorumVotingPeriod` to `MIN_PRE_QUORUM_VOTING_PERIOD`.
    function _initializeTempl(
        address _protocolFeeRecipient,
        address _accessToken,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps,
        uint256 _protocolBps,
        uint256 _quorumBps,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator,
        string memory _name,
        string memory _description,
        string memory _logoLink,
        uint256 _proposalCreationFeeBps,
        uint256 _referralShareBps,
        uint256 _yesVoteThresholdBps
    ) internal {
        if (_protocolFeeRecipient == address(0) || _accessToken == address(0)) {
            revert TemplErrors.InvalidRecipient();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _accessToken;
        priestIsDictator = _priestIsDictator;

        uint256 rawTotal = _burnBps + _treasuryBps + _memberPoolBps + _protocolBps;
        if (rawTotal != BPS_DENOMINATOR) revert TemplErrors.InvalidPercentageSplit();

        protocolBps = _protocolBps;
        _setPercentSplit(_burnBps, _treasuryBps, _memberPoolBps);

        if (_quorumBps == 0) {
            quorumBps = DEFAULT_QUORUM_BPS;
        } else {
            if (_quorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
            quorumBps = _quorumBps;
        }

        postQuorumVotingPeriod = _executionDelay == 0 ? DEFAULT_POST_QUORUM_VOTING_PERIOD : _executionDelay;
        burnAddress = _burnAddress == address(0) ? DEFAULT_BURN_ADDRESS : _burnAddress;
        _setTemplMetadata(_name, _description, _logoLink);
        _setProposalCreationFee(_proposalCreationFeeBps);
        _setReferralShareBps(_referralShareBps);
        preQuorumVotingPeriod = MIN_PRE_QUORUM_VOTING_PERIOD;
        uint256 initialYesThreshold = _yesVoteThresholdBps == 0 ? DEFAULT_YES_VOTE_THRESHOLD_BPS : _yesVoteThresholdBps;
        _setYesVoteThreshold(initialYesThreshold);
    }

    /// @notice Updates the split between burn, treasury, and member pool slices.
    /// @param _burnBps Burn allocation in basis points.
    /// @param _treasuryBps Treasury allocation in basis points.
    /// @param _memberPoolBps Member pool allocation in basis points.
    function _setPercentSplit(uint256 _burnBps, uint256 _treasuryBps, uint256 _memberPoolBps) internal {
        _validatePercentSplit(_burnBps, _treasuryBps, _memberPoolBps, protocolBps);
        burnBps = _burnBps;
        treasuryBps = _treasuryBps;
        memberPoolBps = _memberPoolBps;
    }

    /// @notice Validates that the provided split plus the protocol fee equals 100%.
    /// @param _burnBps Burn allocation in basis points.
    /// @param _treasuryBps Treasury allocation in basis points.
    /// @param _memberPoolBps Member pool allocation in basis points.
    /// @param _protocolBps Protocol allocation in basis points.
    function _validatePercentSplit(
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps,
        uint256 _protocolBps
    ) internal pure {
        if (_burnBps + _treasuryBps + _memberPoolBps + _protocolBps != BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentageSplit();
        }
    }

    /// @notice Configures the entry fee curve anchor and growth profile.
    /// @param newBaseEntryFee New base entry fee anchor to apply.
    /// @param newCurve Curve configuration to apply.
    function _configureEntryFeeCurve(uint256 newBaseEntryFee, CurveConfig memory newCurve) internal {
        _validateEntryFeeAmount(newBaseEntryFee);
        _validateCurveConfig(newCurve);
        baseEntryFee = newBaseEntryFee;
        entryFeeCurve = newCurve;
        _refreshEntryFeeFromState();
        _emitEntryFeeCurveUpdated();
    }

    /// @notice Updates the entry fee curve without altering the base anchor.
    /// @param newCurve Curve configuration to apply.
    function _updateEntryFeeCurve(CurveConfig memory newCurve) internal {
        _validateCurveConfig(newCurve);
        entryFeeCurve = newCurve;
        _refreshEntryFeeFromState();
        _emitEntryFeeCurveUpdated();
    }

    /// @notice Sets the current entry fee target while preserving the existing curve shape.
    /// @param targetEntryFee New current entry fee target.
    function _setCurrentEntryFee(uint256 targetEntryFee) internal {
        _validateEntryFeeAmount(targetEntryFee);
        uint256 paidJoins = _currentPaidJoins();
        CurveConfig memory curve = _copyCurveConfig(entryFeeCurve);
        if (paidJoins == 0 || !_curveHasGrowth(curve)) {
            baseEntryFee = targetEntryFee;
        } else {
            uint256 newBase = _solveBaseEntryFee(targetEntryFee, curve, paidJoins);
            _validateEntryFeeAmount(newBase);
            baseEntryFee = newBase;
        }
        entryFee = targetEntryFee;
        _emitEntryFeeCurveUpdated();
    }

    /// @notice Applies a curve update driven by governance or DAO actions.
    /// @param newCurve Curve configuration to apply.
    /// @param baseEntryFeeValue Optional base entry fee anchor (0 keeps current base).
    function _applyCurveUpdate(CurveConfig memory newCurve, uint256 baseEntryFeeValue) internal {
        if (baseEntryFeeValue == 0) {
            _updateEntryFeeCurve(newCurve);
        } else {
            _configureEntryFeeCurve(baseEntryFeeValue, newCurve);
        }
    }

    /// @notice Creates a memory copy of a curve stored on-chain.
    /// @param stored Storage reference to the curve configuration.
    /// @return cfg Memory copy of the provided curve configuration.
    function _copyCurveConfig(CurveConfig storage stored) internal view returns (CurveConfig memory cfg) {
        CurveSegment[] storage extras = stored.additionalSegments;
        uint256 len = extras.length;
        CurveSegment[] memory extraCopy = new CurveSegment[](len);
        for (uint256 i = 0; i < len; ++i) {
            extraCopy[i] = extras[i];
        }
        cfg.primary = stored.primary;
        cfg.additionalSegments = extraCopy;
    }

    /// @notice Recomputes the entry fee for the next join in response to membership changes.
    function _advanceEntryFeeAfterJoin() internal {
        _refreshEntryFeeFromState();
    }

    /// @notice Recomputes the entry fee based on the current membership count and stored curve.
    function _refreshEntryFeeFromState() internal {
        if (baseEntryFee == 0) {
            return;
        }
        entryFee = _priceForPaidJoinsFromStorage(baseEntryFee, entryFeeCurve, _currentPaidJoins());
    }

    /// @notice Returns the number of paid joins that have occurred (excludes the auto-enrolled priest).
    /// @return count Number of paid joins completed.
    function _currentPaidJoins() internal view returns (uint256 count) {
        if (memberCount == 0) {
            return 0;
        }
        return memberCount - 1;
    }

    /// @notice Returns the number of wallets eligible to vote under the current governance mode.
    function _eligibleVoterCount() internal view returns (uint256 count) {
        return councilModeEnabled ? councilMemberCount : memberCount;
    }

    /// @notice Returns true when `yesVotes` satisfies the configured YES threshold relative to total votes.
    function _meetsYesVoteThreshold(uint256 yesVotes, uint256 noVotes) internal view returns (bool) {
        uint256 totalVotes = yesVotes + noVotes;
        if (totalVotes == 0) {
            return false;
        }
        uint256 lhs = yesVotes * BPS_DENOMINATOR;
        uint256 rhs = yesVoteThresholdBps * totalVotes;
        if (yesVoteThresholdBps == BPS_DENOMINATOR) {
            return lhs == rhs;
        }
        return lhs > rhs;
    }

    /// @notice Creates the base proposal structure, applies fee, and tracks proposer state.
    /// @param _votingPeriod Requested voting period (seconds). 0 applies the default.
    /// @param _title On-chain title for the proposal.
    /// @param _description On-chain description for the proposal.
    /// @return proposalId Newly created proposal id.
    /// @return proposal Storage reference to the created proposal.
    /// @dev Captures a pre-quorum snapshot (block, join sequence, eligible voters), applies a proposal fee
    ///      when configured, and auto-votes YES for the proposer.
    function _createBaseProposal(
        uint256 _votingPeriod,
        string memory _title,
        string memory _description
    ) internal returns (uint256 proposalId, Proposal storage proposal) {
        if (bytes(_title).length > MAX_PROPOSAL_TITLE_LENGTH) revert TemplErrors.InvalidCallData();
        if (bytes(_description).length > MAX_PROPOSAL_DESCRIPTION_LENGTH) revert TemplErrors.InvalidCallData();
        if (!members[msg.sender].joined) revert TemplErrors.NotMember();
        if (hasActiveProposal[msg.sender]) {
            uint256 existingId = activeProposalId[msg.sender];
            Proposal storage existingProposal = proposals[existingId];
            if (!existingProposal.executed && block.timestamp < existingProposal.endTime) {
                revert TemplErrors.ActiveProposalExists();
            } else {
                hasActiveProposal[msg.sender] = false;
                activeProposalId[msg.sender] = 0;
            }
        }
        uint256 period = _votingPeriod == 0 ? preQuorumVotingPeriod : _votingPeriod;
        if (period < MIN_PRE_QUORUM_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooShort();
        if (period > MAX_PRE_QUORUM_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooLong();
        uint256 feeBps = proposalCreationFeeBps;
        if (feeBps > 0) {
            uint256 proposalFee = (entryFee * feeBps) / BPS_DENOMINATOR;
            if (proposalFee > 0) {
                _safeTransferFrom(accessToken, msg.sender, address(this), proposalFee);
                treasuryBalance += proposalFee;
            }
        }
        proposalId = proposalCount;
        ++proposalCount;
        proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.title = _title;
        proposal.description = _description;
        proposal.preQuorumSnapshotBlock = block.number;
        proposal.preQuorumJoinSequence = joinSequence;
        proposal.executed = false;
        bool proposerCanVote = !councilModeEnabled || councilMembers[msg.sender];
        if (proposerCanVote) {
            proposal.hasVoted[msg.sender] = true;
            proposal.voteChoice[msg.sender] = true;
            proposal.yesVotes = 1;
        } else {
            proposal.yesVotes = 0;
        }
        proposal.noVotes = 0;
        proposal.eligibleVoters = _eligibleVoterCount();
        proposal.quorumReachedAt = 0;
        proposal.quorumExempt = false;
        if (
            proposal.eligibleVoters != 0 && !(proposal.yesVotes * BPS_DENOMINATOR < quorumBps * proposal.eligibleVoters)
        ) {
            proposal.quorumReachedAt = block.timestamp;
            proposal.quorumSnapshotBlock = block.number;
            proposal.postQuorumEligibleVoters = proposal.eligibleVoters;
            proposal.quorumJoinSequence = proposal.preQuorumJoinSequence;
            proposal.endTime = block.timestamp + postQuorumVotingPeriod;
        }
        _addActiveProposal(proposalId);
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        emit ProposalCreated(proposalId, msg.sender, proposal.endTime, _title, _description);
    }

    /// @notice Returns whether `proposal` has satisfied quorum, delay, and majority conditions.
    function _proposalPassed(Proposal storage proposal) internal view returns (bool passed) {
        if (proposal.quorumExempt) {
            return (!(block.timestamp < proposal.endTime) && _meetsYesVoteThreshold(proposal.yesVotes, proposal.noVotes));
        }
        if (proposal.quorumReachedAt == 0) {
            return false;
        }
        uint256 denom = proposal.postQuorumEligibleVoters;
        if (denom != 0) {
            if (proposal.yesVotes * BPS_DENOMINATOR < quorumBps * denom) {
                return false;
            }
        }
        if (block.timestamp < proposal.quorumReachedAt + postQuorumVotingPeriod) {
            return false;
        }
        return _meetsYesVoteThreshold(proposal.yesVotes, proposal.noVotes);
    }

    /// @notice Reports whether any curve segment introduces dynamic pricing.
    /// @param curve Curve configuration to inspect.
    /// @return hasGrowth True when any segment is non-static.
    function _curveHasGrowth(CurveConfig memory curve) internal pure returns (bool hasGrowth) {
        if (curve.primary.style != CurveStyle.Static) {
            return true;
        }
        uint256 len = curve.additionalSegments.length;
        for (uint256 i = 0; i < len; ++i) {
            if (curve.additionalSegments[i].style != CurveStyle.Static) {
                return true;
            }
        }
        return false;
    }

    /// @notice Computes the entry fee for a given number of completed paid joins (memory curve).
    /// @param baseFee Base entry fee anchor.
    /// @param curve Curve configuration to apply.
    /// @param paidJoins Number of completed paid joins.
    /// @return price Computed entry fee for the next join.
    function _priceForPaidJoins(
        uint256 baseFee,
        CurveConfig memory curve,
        uint256 paidJoins
    ) internal pure returns (uint256 price) {
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
        for (uint256 i = 0; i < len && remaining > 0; ++i) {
            (amount, remaining) = _consumeSegment(amount, extras[i], remaining, true);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @notice Computes the entry fee for a given number of completed paid joins (storage curve).
    /// @param baseFee Base entry fee anchor.
    /// @param curve Curve configuration loaded from storage.
    /// @param paidJoins Number of completed paid joins.
    /// @return price Computed entry fee for the next join.
    function _priceForPaidJoinsFromStorage(
        uint256 baseFee,
        CurveConfig storage curve,
        uint256 paidJoins
    ) internal view returns (uint256 price) {
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
        for (uint256 i = 0; i < len && remaining > 0; ++i) {
            CurveSegment memory seg = extras[i];
            (amount, remaining) = _consumeSegment(amount, seg, remaining, true);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @notice Derives the base entry fee that produces a target price after `paidJoins` joins.
    /// @param targetPrice Desired current entry fee.
    /// @param curve Curve configuration to apply in reverse.
    /// @param paidJoins Number of completed paid joins.
    /// @return baseFee Base entry fee that yields `targetPrice`.
    function _solveBaseEntryFee(
        uint256 targetPrice,
        CurveConfig memory curve,
        uint256 paidJoins
    ) internal pure returns (uint256 baseFee) {
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
        for (uint256 i = 0; i < len && remaining > 0; ++i) {
            (amount, remaining) = _consumeSegment(amount, extras[i], remaining, false);
        }
        if (remaining > 0) revert TemplErrors.InvalidCurveConfig();
        return amount;
    }

    /// @notice Applies a curve segment for up to `remaining` steps and returns the updated amount and remaining steps.
    /// @param amount Current amount before applying the segment.
    /// @param segment Curve segment to apply.
    /// @param remaining Steps remaining for this and subsequent segments.
    /// @param forward True to apply forward growth, false for inverse.
    /// @return newAmount Updated amount after applying up to `remaining` steps.
    /// @return newRemaining Remaining steps after this segment.
    function _consumeSegment(
        uint256 amount,
        CurveSegment memory segment,
        uint256 remaining,
        bool forward
    ) internal pure returns (uint256 newAmount, uint256 newRemaining) {
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

    /// @notice Applies a curve segment forward or inverse for the specified number of steps.
    /// @param amount Current amount before applying the segment.
    /// @param segment Curve segment to apply.
    /// @param steps Number of steps (paid joins) to apply in this segment.
    /// @param forward True to apply forward growth, false to invert.
    /// @return updated Amount after applying the segment for `steps`.
    function _applySegment(
        uint256 amount,
        CurveSegment memory segment,
        uint256 steps,
        bool forward
    ) internal pure returns (uint256 updated) {
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
                offset = BPS_DENOMINATOR + scaled;
            }
            if (offset < BPS_DENOMINATOR) {
                return MAX_ENTRY_FEE;
            }
            if (forward) {
                if (_mulWouldOverflow(amount, offset)) {
                    return MAX_ENTRY_FEE;
                }
                uint256 linearResult = Math.mulDiv(amount, offset, BPS_DENOMINATOR);
                return linearResult > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : linearResult;
            }
            if (_mulWouldOverflow(amount, BPS_DENOMINATOR)) {
                return MAX_ENTRY_FEE;
            }
            uint256 inverseResult = Math.mulDiv(amount, BPS_DENOMINATOR, offset, Math.Rounding.Ceil);
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

    /// @notice Computes a basis-point scaled exponent using exponentiation by squaring.
    /// @param factorBps Basis points multiplier base (e.g., 11_000 for +10%).
    /// @param exponent Non-negative integer exponent to raise the factor.
    /// @return result Resulting basis points after exponentiation.
    /// @return overflow True when intermediate multiplication overflowed.
    function _powBps(uint256 factorBps, uint256 exponent) internal pure returns (uint256 result, bool overflow) {
        if (exponent == 0) {
            return (BPS_DENOMINATOR, false);
        }
        result = BPS_DENOMINATOR;
        uint256 baseFactor = factorBps;
        uint256 remaining = exponent;
        while (remaining > 0) {
            if (remaining & 1 == 1) {
                if (_mulWouldOverflow(result, baseFactor)) {
                    return (0, true);
                }
                result = Math.mulDiv(result, baseFactor, BPS_DENOMINATOR);
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
            baseFactor = Math.mulDiv(baseFactor, baseFactor, BPS_DENOMINATOR);
            if (baseFactor == 0) {
                baseFactor = 1;
            }
        }
        return (result, false);
    }

    /// @notice Returns the smaller of two values.
    /// @param a First value.
    /// @param b Second value.
    /// @return minValue The minimum of `a` and `b`.
    function _min(uint256 a, uint256 b) internal pure returns (uint256 minValue) {
        return a < b ? a : b;
    }

    /// @notice Validates curve configuration input.
    /// @param curve Curve configuration to validate.
    function _validateCurveConfig(CurveConfig memory curve) internal pure {
        _validateCurveSegment(curve.primary);
        CurveSegment[] memory extras = curve.additionalSegments;
        uint256 extrasLen = extras.length;
        if (extrasLen + 1 > MAX_CURVE_SEGMENTS) {
            revert TemplErrors.InvalidCurveConfig();
        }
        if (extrasLen == 0) {
            if (curve.primary.length != 0) {
                revert TemplErrors.InvalidCurveConfig();
            }
            return;
        }
        if (curve.primary.length == 0) {
            revert TemplErrors.InvalidCurveConfig();
        }
        for (uint256 i = 0; i < extrasLen; ++i) {
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

    /// @notice Validates a single curve segment.
    /// @param segment Curve segment to validate.
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

    /// @notice Ensures entry fee amounts satisfy templ invariants.
    /// @param amount Entry fee to validate.
    function _validateEntryFeeAmount(uint256 amount) internal pure {
        if (amount < 10) revert TemplErrors.EntryFeeTooSmall();
        if (amount % 10 != 0) revert TemplErrors.InvalidEntryFee();
        if (amount > MAX_ENTRY_FEE) revert TemplErrors.EntryFeeTooLarge();
    }

    /// @notice Emits the standardized curve update event with the current configuration.
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
        for (uint256 i = 0; i < additional; ++i) {
            CurveSegment storage seg = cfg.additionalSegments[i];
            styles[i + 1] = uint8(seg.style);
            rates[i + 1] = seg.rateBps;
            lengths[i + 1] = seg.length;
        }
        emit EntryFeeCurveUpdated(styles, rates, lengths);
    }

    /// @notice Toggles dictatorship governance mode, emitting an event when the state changes.
    /// @param _enabled New dictatorship state (true to enable).
    function _updateDictatorship(bool _enabled) internal {
        if (priestIsDictator == _enabled) revert TemplErrors.DictatorshipUnchanged();
        if (_enabled && councilModeEnabled) revert TemplErrors.CouncilModeActive();
        priestIsDictator = _enabled;
        emit DictatorshipModeChanged(_enabled);
    }

    /// @notice Sets or clears the membership cap and auto-pauses if the new cap is already met.
    /// @param newMaxMembers New membership cap (0 removes the cap).
    function _setMaxMembers(uint256 newMaxMembers) internal {
        uint256 currentMembers = memberCount;
        if (newMaxMembers > 0 && newMaxMembers < currentMembers) {
            revert TemplErrors.MemberLimitTooLow();
        }
        maxMembers = newMaxMembers;
        emit MaxMembersUpdated(newMaxMembers);
        _refreshEntryFeeFromState();
        _autoPauseIfLimitReached();
    }

    /// @notice Writes new templ metadata and emits an event when it changes.
    /// @param newName New templ name.
    /// @param newDescription New templ description.
    /// @param newLogoLink New templ logo link.
    function _setTemplMetadata(
        string memory newName,
        string memory newDescription,
        string memory newLogoLink
    ) internal {
        if (bytes(newName).length > MAX_TEMPL_NAME_LENGTH) revert TemplErrors.InvalidCallData();
        if (bytes(newDescription).length > MAX_TEMPL_DESCRIPTION_LENGTH) revert TemplErrors.InvalidCallData();
        if (bytes(newLogoLink).length > MAX_TEMPL_LOGO_URI_LENGTH) revert TemplErrors.InvalidCallData();
        templName = newName;
        templDescription = newDescription;
        templLogoLink = newLogoLink;
        emit TemplMetadataUpdated(newName, newDescription, newLogoLink);
    }

    /// @notice Updates the proposal creation fee (bps of current entry fee).
    /// @param newFeeBps New proposal creation fee in basis points.
    function _setProposalCreationFee(uint256 newFeeBps) internal {
        if (newFeeBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        uint256 previous = proposalCreationFeeBps;
        proposalCreationFeeBps = newFeeBps;
        emit ProposalCreationFeeUpdated(previous, newFeeBps);
    }

    /// @notice Updates the referral share basis points (slice of member pool).
    /// @param newBps New referral share in basis points.
    function _setReferralShareBps(uint256 newBps) internal {
        if (newBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        uint256 previous = referralShareBps;
        referralShareBps = newBps;
        emit ReferralShareBpsUpdated(previous, newBps);
    }

    /// @notice Updates the quorum threshold in basis points (0-10_000).
    /// @param newQuorumBps New quorum threshold (bps).
    function _setQuorumBps(uint256 newQuorumBps) internal {
        if (newQuorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
        uint256 previous = quorumBps;
        quorumBps = newQuorumBps;
        emit QuorumBpsUpdated(previous, newQuorumBps);
    }

    /// @notice Updates the post‑quorum voting period in seconds.
    /// @param newPeriod New period (seconds) applied after quorum before execution.
    function _setPostQuorumVotingPeriod(uint256 newPeriod) internal {
        uint256 previous = postQuorumVotingPeriod;
        postQuorumVotingPeriod = newPeriod;
        emit PostQuorumVotingPeriodUpdated(previous, newPeriod);
    }

    /// @notice Updates the burn sink address.
    /// @param newBurn Address that will receive burn allocations.
    function _setBurnAddress(address newBurn) internal {
        if (newBurn == address(0)) revert TemplErrors.InvalidRecipient();
        address previous = burnAddress;
        burnAddress = newBurn;
        emit BurnAddressUpdated(previous, newBurn);
    }

    /// @notice Updates the default pre‑quorum voting period used when proposals do not supply one.
    /// @param newPeriod New default pre‑quorum voting period (seconds).
    function _setPreQuorumVotingPeriod(uint256 newPeriod) internal {
        if (newPeriod < MIN_PRE_QUORUM_VOTING_PERIOD || newPeriod > MAX_PRE_QUORUM_VOTING_PERIOD) {
            revert TemplErrors.InvalidCallData();
        }
        uint256 previous = preQuorumVotingPeriod;
        preQuorumVotingPeriod = newPeriod;
        emit PreQuorumVotingPeriodUpdated(previous, newPeriod);
    }

    /// @notice Updates the YES vote threshold expressed in basis points of total votes cast.
    /// @param newThresholdBps New threshold (must be within [MIN_YES_VOTE_THRESHOLD_BPS, 10_000]).
    function _setYesVoteThreshold(uint256 newThresholdBps) internal {
        if (newThresholdBps < MIN_YES_VOTE_THRESHOLD_BPS || newThresholdBps > BPS_DENOMINATOR) {
            revert TemplErrors.InvalidPercentage();
        }
        uint256 previous = yesVoteThresholdBps;
        yesVoteThresholdBps = newThresholdBps;
        emit YesVoteThresholdUpdated(previous, newThresholdBps);
    }

    /// @notice Enables or disables council governance mode.
    /// @param enabled True to enable council mode, false to return to membership voting.
    function _setCouncilMode(bool enabled) internal {
        if (councilModeEnabled == enabled) revert TemplErrors.InvalidCallData();
        if (enabled) {
            if (priestIsDictator) revert TemplErrors.CouncilModeActive();
            if (councilMemberCount == 0) revert TemplErrors.NoMembers();
        }
        councilModeEnabled = enabled;
        emit CouncilModeUpdated(enabled);
    }

    /// @notice Adds a member to the council.
    /// @param account Wallet to add.
    /// @param addedBy Caller initiating the addition (used for events).
    function _addCouncilMember(address account, address addedBy) internal {
        if (account == address(0)) revert TemplErrors.InvalidRecipient();
        if (!members[account].joined) revert TemplErrors.NotMember();
        if (councilMembers[account]) revert TemplErrors.CouncilMemberExists();
        councilMembers[account] = true;
        ++councilMemberCount;
        emit CouncilMemberAdded(account, addedBy);
    }

    /// @notice Removes a member from the council.
    /// @param account Wallet to remove.
    /// @param removedBy Caller initiating the removal (used for events).
    function _removeCouncilMember(address account, address removedBy) internal {
        if (!councilMembers[account]) revert TemplErrors.CouncilMemberMissing();
        if (councilMemberCount <= 2) revert TemplErrors.CouncilMemberMinimum();
        councilMembers[account] = false;
        --councilMemberCount;
        emit CouncilMemberRemoved(account, removedBy);
    }

    /// @notice Allows the priest to add a single bootstrap council member outside of governance.
    /// @param account Wallet receiving the bootstrap council seat.
    /// @param caller Original msg.sender forwarded for event context.
    function _bootstrapCouncilMember(address account, address caller) internal {
        if (!councilModeEnabled) revert TemplErrors.CouncilModeInactive();
        if (councilBootstrapConsumed) revert TemplErrors.CouncilBootstrapConsumed();
        if (caller != priest) revert TemplErrors.PriestOnly();
        councilBootstrapConsumed = true;
        _addCouncilMember(account, caller);
    }

    /// @notice Executes a treasury withdrawal and emits the corresponding event.
    /// @param token Token to withdraw (`address(0)` for ETH, or ERC-20 address).
    /// @param recipient Destination wallet.
    /// @param amount Amount to transfer.
    /// @param proposalId Proposal id authorizing the withdrawal (0 for direct DAO call).
    function _withdrawTreasury(address token, address recipient, uint256 amount, uint256 proposalId) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (amount == 0) revert TemplErrors.AmountZero();

        if (token == accessToken) {
            uint256 currentBalance = IERC20(accessToken).balanceOf(address(this));
            if (!(currentBalance > memberPoolBalance)) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 availableBalance = currentBalance - memberPoolBalance;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 debitedFromFees = amount < treasuryBalance ? amount : treasuryBalance;
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
            uint256 availableBalance = currentBalance > reservedForMembers ? currentBalance - reservedForMembers : 0;
            if (amount > availableBalance) revert TemplErrors.InsufficientTreasuryBalance();
            _safeTransfer(token, recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount);
    }

    /// @notice Applies updates to the entry fee and/or fee split configuration.
    /// @dev The access token, protocol recipient, and protocol basis points are immutable
    ///      post-deploy and cannot be changed via this update.
    /// @param _entryFee Optional new entry fee (0 keeps current).
    /// @param _updateFeeSplit Whether to apply the new split values.
    /// @param _burnBps New burn share (bps) when `_updateFeeSplit` is true.
    /// @param _treasuryBps New treasury share (bps) when `_updateFeeSplit` is true.
    /// @param _memberPoolBps New member pool share (bps) when `_updateFeeSplit` is true.
    function _updateConfig(
        uint256 _entryFee,
        bool _updateFeeSplit,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps
    ) internal {
        if (_entryFee > 0) {
            _setCurrentEntryFee(_entryFee);
        }
        if (_updateFeeSplit) {
            _setPercentSplit(_burnBps, _treasuryBps, _memberPoolBps);
        }
        emit ConfigUpdated(accessToken, entryFee, burnBps, treasuryBps, memberPoolBps, protocolBps);
    }

    /// @notice Sets the join pause flag without mutating membership limits during manual resumes.
    /// @param _paused Desired pause state.
    function _setJoinPaused(bool _paused) internal {
        joinPaused = _paused;
        emit JoinPauseUpdated(_paused);
    }

    /// @notice Updates the priest address and emits an event.
    /// @param newPriest Address of the new priest.
    function _changePriest(address newPriest) internal {
        if (newPriest == address(0)) revert TemplErrors.InvalidRecipient();
        address old = priest;
        if (newPriest == old) revert TemplErrors.InvalidCallData();
        priest = newPriest;
        emit PriestChanged(old, newPriest);
    }

    /// @notice Routes treasury balances into member or external pools so members can claim them evenly.
    /// @param token Token to disband (`address(0)` for ETH or ERC-20 address).
    /// @param proposalId Proposal id authorizing the disband (0 for direct DAO call).
    function _disbandTreasury(address token, uint256 proposalId) internal {
        uint256 activeMembers = memberCount;
        if (activeMembers == 0) revert TemplErrors.NoMembers();

        if (token == accessToken) {
            uint256 accessTokenBalance = IERC20(accessToken).balanceOf(address(this));
            if (!(accessTokenBalance > memberPoolBalance)) revert TemplErrors.NoTreasuryFunds();
            uint256 accessTokenAmount = accessTokenBalance - memberPoolBalance;
            uint256 debitedFromFees = accessTokenAmount < treasuryBalance ? accessTokenAmount : treasuryBalance;
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

        uint256 carry = rewards.rewardRemainder;
        uint256 toSplit = totalAmount + carry;
        uint256 perMember = toSplit / activeMembers;
        uint256 newRemainder = toSplit % activeMembers;

        rewards.poolBalance += totalAmount;
        rewards.rewardRemainder = newRemainder;
        rewards.cumulativeRewards += perMember;
        _recordExternalCheckpoint(rewards);

        emit TreasuryDisbanded(proposalId, token, totalAmount, perMember, newRemainder);
    }

    /// @notice Tracks a newly active `proposalId` for enumeration by views.
    /// @param proposalId Identifier of the proposal to add.
    function _addActiveProposal(uint256 proposalId) internal {
        activeProposalIds.push(proposalId);
        activeProposalIndex[proposalId] = activeProposalIds.length;
    }

    /// @notice Removes an inactive `proposalId` from the active index.
    /// @param proposalId Identifier of the proposal to remove.
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

    /// @notice Checks whether a member joined after a particular snapshot point using join sequences.
    /// @param memberInfo Stored membership record to inspect.
    /// @param snapshotJoinSequence Join sequence captured in the proposal snapshot (0 when unused).
    /// @return joinedAfter True when the member joined strictly after the snapshot sequence.
    function _joinedAfterSnapshot(
        Member storage memberInfo,
        uint256 snapshotJoinSequence
    ) internal view returns (bool joinedAfter) {
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

    /// @notice Returns whether `proposal` is currently active at `currentTime`.
    /// @param proposal Proposal storage reference to inspect.
    /// @param currentTime Timestamp to evaluate against.
    /// @return active True when voting/execution window remains open and not executed.
    function _isActiveProposal(Proposal storage proposal, uint256 currentTime) internal view returns (bool active) {
        return currentTime < proposal.endTime && !proposal.executed;
    }

    /// @notice Auto-pauses new joins when a non-zero membership cap has been reached.
    function _autoPauseIfLimitReached() internal {
        uint256 limit = maxMembers;
        if (limit > 0 && memberCount == limit && !joinPaused) {
            joinPaused = true;
            emit JoinPauseUpdated(true);
        }
    }

    /// @notice Transfers `amount` of `token` from this contract to `to`.
    /// @param token ERC-20 token address.
    /// @param to Recipient wallet.
    /// @param amount Amount to transfer.
    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Transfers `amount` of `token` from `from` to `to` using allowance.
    /// @param token ERC-20 token address.
    /// @param from Source wallet.
    /// @param to Recipient wallet.
    /// @param amount Amount to transfer.
    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    /// @notice Registers `token` so external rewards can be enumerated in views.
    /// @param token ERC-20 token address or address(0) for ETH.
    function _registerExternalToken(address token) internal {
        ExternalRewardState storage rewards = externalRewards[token];
        if (!rewards.exists) {
            if (externalRewardTokens.length > MAX_EXTERNAL_REWARD_TOKENS - 1) {
                revert TemplErrors.ExternalRewardLimitReached();
            }
            rewards.exists = true;
            externalRewardTokens.push(token);
            externalRewardTokenIndex[token] = externalRewardTokens.length;
        }
    }

    /// @notice Removes `token` from the external rewards enumeration set.
    /// @param token ERC-20 token address or address(0) for ETH.
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

    /// @notice Scales `amount` by `multiplier` (bps), saturating at `MAX_ENTRY_FEE`.
    /// @param amount Base value to scale.
    /// @param multiplier Basis points multiplier to apply.
    /// @return result Scaled value with saturation at `MAX_ENTRY_FEE`.
    function _scaleForward(uint256 amount, uint256 multiplier) internal pure returns (uint256 result) {
        if (_mulWouldOverflow(amount, multiplier)) {
            return MAX_ENTRY_FEE;
        }
        uint256 r = Math.mulDiv(amount, multiplier, BPS_DENOMINATOR);
        return r > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : r;
    }

    /// @notice Inverts scaling by dividing `amount` by `divisor` (bps) rounding up.
    /// @param amount Base value to unscale.
    /// @param divisor Basis points divisor.
    /// @return result Unscaled value with saturation at `MAX_ENTRY_FEE`.
    function _scaleInverse(uint256 amount, uint256 divisor) internal pure returns (uint256 result) {
        if (divisor == 0) revert TemplErrors.InvalidCurveConfig();
        if (_mulWouldOverflow(amount, BPS_DENOMINATOR)) {
            return MAX_ENTRY_FEE;
        }
        uint256 r = Math.mulDiv(amount, BPS_DENOMINATOR, divisor, Math.Rounding.Ceil);
        return r > MAX_ENTRY_FEE ? MAX_ENTRY_FEE : r;
    }

    /// @notice Returns true when multiplying `a` and `b` would overflow uint256.
    /// @param a Multiplicand.
    /// @param b Multiplier.
    /// @return overflow True when `a * b` would overflow uint256.
    function _mulWouldOverflow(uint256 a, uint256 b) internal pure returns (bool overflow) {
        if (a == 0 || b == 0) {
            return false;
        }
        return a > type(uint256).max / b;
    }
}
