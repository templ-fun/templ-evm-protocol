// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TemplErrors} from "./TemplErrors.sol";

abstract contract TemplBase is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TemplErrors for *;

    uint256 internal constant TOTAL_BPS = 100;
    address internal constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public burnBP;
    uint256 public treasuryBP;
    uint256 public memberPoolBP;
    uint256 public immutable protocolBP;

    address public priest;
    address public immutable protocolFeeRecipient;
    address public immutable accessToken;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    uint256 public memberPoolBalance;
    bool public paused;

    uint256 public quorumPercent = 33;
    uint256 public executionDelayAfterQuorum = 7 days;

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

    struct Proposal {
        uint256 id;
        address proposer;
        Action action;
        address token;
        address recipient;
        uint256 amount;
        string reason;
        bool paused;
        uint256 newEntryFee;
        uint256 newBurnBP;
        uint256 newTreasuryBP;
        uint256 newMemberPoolBP;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 endTime;
        uint256 createdAt;
        bool executed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteChoice;
        uint256 eligibleVoters;
        uint256 quorumReachedAt;
        bool quorumExempt;
        bool updateFeeSplit;
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
        uint256 endTime
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
        uint256 burnBasisPoints,
        uint256 treasuryBasisPoints,
        uint256 memberPoolBasisPoints,
        uint256 protocolBasisPoints
    );

    event ContractPaused(bool isPaused);
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

    struct ExternalRewardState {
        uint256 poolBalance;
        uint256 cumulativeRewards;
        uint256 rewardRemainder;
        bool exists;
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
        if (msg.sender != address(this)) revert TemplErrors.NotDAO();
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

    constructor(
        address _protocolFeeRecipient,
        address _accessToken,
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP,
        uint256 _protocolBP
    ) {
        if (_protocolFeeRecipient == address(0) || _accessToken == address(0)) {
            revert TemplErrors.InvalidRecipient();
        }
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _accessToken;
        protocolBP = _protocolBP;
        _setFeeSplit(_burnBP, _treasuryBP, _memberPoolBP);
    }

    function _setFeeSplit(
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP
    ) internal {
        _validateFeeSplit(_burnBP, _treasuryBP, _memberPoolBP, protocolBP);
        burnBP = _burnBP;
        treasuryBP = _treasuryBP;
        memberPoolBP = _memberPoolBP;
    }

    function _validateFeeSplit(
        uint256 _burnBP,
        uint256 _treasuryBP,
        uint256 _memberPoolBP,
        uint256 _protocolBP
    ) internal pure {
        if (
            _burnBP > TOTAL_BPS ||
            _treasuryBP > TOTAL_BPS ||
            _memberPoolBP > TOTAL_BPS ||
            _protocolBP > TOTAL_BPS
        ) revert TemplErrors.InvalidFeeSplit();
        if (_burnBP + _treasuryBP + _memberPoolBP + _protocolBP != TOTAL_BPS) {
            revert TemplErrors.InvalidFeeSplit();
        }
    }
}
