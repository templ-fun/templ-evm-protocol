// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplBase is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TemplErrors for *;

    uint256 internal constant TOTAL_PERCENT = 100;
    uint256 internal constant DEFAULT_QUORUM_PERCENT = 33;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public burnPercent;
    uint256 public treasuryPercent;
    uint256 public memberPoolPercent;
    uint256 public immutable protocolPercent;

    address public priest;
    address public immutable protocolFeeRecipient;
    address public immutable accessToken;
    bool public priestIsDictator;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    uint256 public memberPoolBalance;
    bool public paused;
    uint256 public MAX_MEMBERS;

    uint256 public quorumPercent;
    uint256 public executionDelayAfterQuorum;
    address public immutable burnAddress;
    string public templHomeLink;

    struct Member {
        bool purchased;
        uint256 timestamp;
        uint256 block;
        uint256 rewardSnapshot;
    }

    mapping(address => Member) public members;
    address[] public memberList;
    mapping(address => uint256) public memberPoolClaims;
    uint256 public cumulativeMemberRewards;
    uint256 public memberRewardRemainder;

    struct RewardCheckpoint {
        uint64 blockNumber;
        uint64 timestamp;
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
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public activeProposalId;
    mapping(address => bool) public hasActiveProposal;
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

    mapping(address => ExternalRewardState) internal externalRewards;
    address[] internal externalRewardTokens;
    mapping(address => mapping(address => uint256)) internal memberExternalRewardSnapshots;
    mapping(address => mapping(address => uint256)) internal memberExternalClaims;

    modifier onlyMember() {
        if (!members[msg.sender].purchased) revert TemplErrors.NotMember();
        _;
    }

    modifier onlyDAO() {
        if (priestIsDictator) {
            if (msg.sender != address(this) && msg.sender != priest) revert TemplErrors.PriestOnly();
        } else if (msg.sender != address(this)) {
            revert TemplErrors.NotDAO();
        }
        _;
    }

    modifier notSelf() {
        if (msg.sender == address(this)) revert TemplErrors.InvalidSender();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert TemplErrors.ContractPausedError();
        _;
    }

    event DictatorshipModeChanged(bool enabled);

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

    function _updateDictatorship(bool _enabled) internal {
        if (priestIsDictator == _enabled) revert TemplErrors.DictatorshipUnchanged();
        priestIsDictator = _enabled;
        emit DictatorshipModeChanged(_enabled);
    }

    function _setMaxMembers(uint256 newMaxMembers) internal {
        uint256 currentMembers = memberList.length;
        if (newMaxMembers > 0 && newMaxMembers < currentMembers) {
            revert TemplErrors.MemberLimitTooLow();
        }
        MAX_MEMBERS = newMaxMembers;
        emit MaxMembersUpdated(newMaxMembers);
        _autoPauseIfLimitReached();
    }

    function _setTemplHomeLink(string memory newLink) internal {
        if (keccak256(bytes(templHomeLink)) == keccak256(bytes(newLink))) {
            return;
        }
        string memory previous = templHomeLink;
        templHomeLink = newLink;
        emit TemplHomeLinkUpdated(previous, newLink);
    }

    function _autoPauseIfLimitReached() internal {
        uint256 limit = MAX_MEMBERS;
        if (limit > 0 && memberList.length >= limit && !paused) {
            paused = true;
            emit ContractPaused(true);
        }
    }
}
