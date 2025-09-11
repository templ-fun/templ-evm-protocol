// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TemplErrors} from "./TemplErrors.sol";

contract TEMPL is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TemplErrors for *;

    uint256 private constant BURN_BP = 30;
    uint256 private constant TREASURY_BP = 30;
    uint256 private constant MEMBER_POOL_BP = 30;
    uint256 private constant PROTOCOL_BP = 10;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public immutable priest;
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
        string title;
        string description;
        Action action;
        address token;
        address recipient;
        uint256 amount;
        string reason;
        bool paused;
        uint256 newEntryFee;
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
        WithdrawAllTreasury,
        DisbandTreasury
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
        string title,
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
        uint256 entryFee
    );

    event ContractPaused(bool isPaused);
    event TreasuryDisbanded(
        uint256 indexed proposalId,
        uint256 amount,
        uint256 perMember,
        uint256 remainder
    );

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
    
    /**
     * @dev Constructor sets immutable parameters
     * @param _priest Temple creator address
     * @param _protocolFeeRecipient Receives 10% protocol fee
     * @param _token ERC20 token for membership payments
     * @param _entryFee Membership cost (minimum 10 and divisible by 10)
     * All members have 1 vote.
     */
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee
    ) {
        if (_priest == address(0) || _protocolFeeRecipient == address(0) || _token == address(0)) {
            revert TemplErrors.InvalidRecipient();
        }
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        
        priest = _priest;
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _token;
        entryFee = _entryFee;
        paused = false;
    }

    /// @notice Accept ETH donations or direct transfers
    receive() external payable {}
    
    /**
     * @notice Purchase membership with automatic fee distribution
     * @dev Distributes 30% burn, 30% treasury, 30% member pool, 10% protocol
     */
    function purchaseAccess() external whenNotPaused notSelf nonReentrant {
        Member storage m = members[msg.sender];
        if (m.purchased) revert TemplErrors.AlreadyPurchased();

        uint256 burnAmount = (entryFee * BURN_BP) / 100;
        uint256 toContract = (entryFee * (TREASURY_BP + MEMBER_POOL_BP)) / 100;
        uint256 protocolAmount = (entryFee * PROTOCOL_BP) / 100;

        if (IERC20(accessToken).balanceOf(msg.sender) < entryFee) revert TemplErrors.InsufficientBalance();

        m.purchased = true;
        m.timestamp = block.timestamp;
        m.block = block.number;
        memberList.push(msg.sender);
        totalPurchases++;

        if (memberList.length > 1) {
            uint256 totalRewards = ((entryFee * MEMBER_POOL_BP) / 100) + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / (memberList.length - 1);
            memberRewardRemainder = totalRewards % (memberList.length - 1);
            cumulativeMemberRewards += rewardPerMember;
        }

        m.rewardSnapshot = cumulativeMemberRewards;

        uint256 thirtyPercent = (entryFee * 30) / 100;
        treasuryBalance += thirtyPercent;
        memberPoolBalance += thirtyPercent;
        totalBurned += burnAmount;
        totalToTreasury += thirtyPercent;
        totalToMemberPool += thirtyPercent;
        totalToProtocol += protocolAmount;

        IERC20 token = IERC20(accessToken);
        token.safeTransferFrom(msg.sender, DEAD_ADDRESS, burnAmount);
        token.safeTransferFrom(msg.sender, address(this), toContract);
        token.safeTransferFrom(msg.sender, protocolFeeRecipient, protocolAmount);
        
        emit AccessPurchased(
            msg.sender,
            entryFee,
            burnAmount,
            thirtyPercent,
            thirtyPercent,
            protocolAmount,
            block.timestamp,
            block.number,
            totalPurchases - 1
        );
    }
    
    function _createBaseProposal(
        string memory _title,
        string memory _description,
        uint256 _votingPeriod
    ) internal returns (uint256 proposalId, Proposal storage proposal) {
        if (bytes(_title).length == 0) revert TemplErrors.TitleRequired();
        if (bytes(_description).length == 0) revert TemplErrors.DescriptionRequired();
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
        uint256 period = _votingPeriod == 0 ? DEFAULT_VOTING_PERIOD : _votingPeriod;
        if (period < MIN_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooShort();
        if (period > MAX_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooLong();
        proposalId = proposalCount++;
        proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = _title;
        proposal.description = _description;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.executed = false;
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = true;
        proposal.yesVotes = 1;
        proposal.noVotes = 0;
        // quorum snapshot and defaults
        proposal.eligibleVoters = memberList.length;
        proposal.quorumReachedAt = 0;
        proposal.quorumExempt = false;
        if (proposal.eligibleVoters > 0) {
            if (proposal.yesVotes * 100 >= quorumPercent * proposal.eligibleVoters) {
                proposal.quorumReachedAt = block.timestamp;
                proposal.endTime = block.timestamp + executionDelayAfterQuorum;
            }
        }
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        emit ProposalCreated(proposalId, msg.sender, _title, proposal.endTime);
    }

    function createProposalSetPaused(
        string memory _title,
        string memory _description,
        bool _paused,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        (uint256 id, Proposal storage p) = _createBaseProposal(_title, _description, _votingPeriod);
        p.action = Action.SetPaused;
        p.paused = _paused;
        return id;
    }

    function createProposalUpdateConfig(
        string memory _title,
        string memory _description,
        uint256 _newEntryFee,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        if (_newEntryFee > 0) {
            if (_newEntryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_newEntryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        }
        (uint256 id, Proposal storage p) = _createBaseProposal(_title, _description, _votingPeriod);
        p.action = Action.UpdateConfig;
        p.newEntryFee = _newEntryFee;
        return id;
    }

    function createProposalWithdrawTreasury(
        string memory _title,
        string memory _description,
        address _token,
        address _recipient,
        uint256 _amount,
        string memory _reason,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        (uint256 id, Proposal storage p) = _createBaseProposal(_title, _description, _votingPeriod);
        p.action = Action.WithdrawTreasury;
        p.token = _token;
        p.recipient = _recipient;
        p.amount = _amount;
        p.reason = _reason;
        return id;
    }

    function createProposalWithdrawAllTreasury(
        string memory _title,
        string memory _description,
        address _token,
        address _recipient,
        string memory _reason,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        (uint256 id, Proposal storage p) = _createBaseProposal(_title, _description, _votingPeriod);
        p.action = Action.WithdrawAllTreasury;
        p.token = _token;
        p.recipient = _recipient;
        p.reason = _reason;
        return id;
    }

    /**
     * @notice Create a proposal to disband the treasury into the member pool
     * @dev If proposed by the priest, quorum is not required
     */
    function createProposalDisbandTreasury(
        string memory _title,
        string memory _description,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        (uint256 id, Proposal storage p) = _createBaseProposal(_title, _description, _votingPeriod);
        p.action = Action.DisbandTreasury;
        // priest exception: disband proposed by priest has no quorum requirement
        if (msg.sender == priest) {
            p.quorumExempt = true;
        }
        return id;
    }
    
    /**
     * @notice Cast or change a vote on an active proposal
     * @dev One vote per member; vote can be changed until deadline
     * @param _proposalId Proposal to vote on
     * @param _support Vote choice (true = yes, false = no)
     */
    function vote(uint256 _proposalId, bool _support) external onlyMember {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (block.timestamp >= proposal.endTime) revert TemplErrors.VotingEnded();
        if (members[msg.sender].timestamp >= proposal.createdAt)
            revert TemplErrors.JoinedAfterProposal();

        bool hadVoted = proposal.hasVoted[msg.sender];
        bool previous = proposal.voteChoice[msg.sender];

        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = _support;

        if (!hadVoted) {
            if (_support) {
                proposal.yesVotes += 1;
            } else {
                proposal.noVotes += 1;
            }
        } else if (previous != _support) {
            if (previous) {
                proposal.yesVotes -= 1;
                proposal.noVotes += 1;
            } else {
                proposal.noVotes -= 1;
                proposal.yesVotes += 1;
            }
        }
        
        if (!proposal.quorumExempt && proposal.quorumReachedAt == 0) {
            if (proposal.yesVotes * 100 >= quorumPercent * proposal.eligibleVoters) {
                proposal.quorumReachedAt = block.timestamp;
                proposal.endTime = block.timestamp + executionDelayAfterQuorum;
            }
        }

        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }
    
    /**
     * @notice Execute a passed proposal
     * @dev Requires simple majority. If quorum is required, execution is allowed only after the delay from first quorum.
     * @param _proposalId Proposal to execute
     */
    function executeProposal(uint256 _proposalId) external nonReentrant {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        
        if (proposal.quorumExempt) {
            if (block.timestamp < proposal.endTime) revert TemplErrors.VotingNotEnded();
        } else {
            if (proposal.quorumReachedAt == 0) {
                // Not enough participation to execute
                revert TemplErrors.QuorumNotReached();
            }
            if (block.timestamp < proposal.quorumReachedAt + executionDelayAfterQuorum) {
                revert TemplErrors.ExecutionDelayActive();
            }
        }
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();

        if (proposal.yesVotes <= proposal.noVotes) revert TemplErrors.ProposalNotPassed();

        proposal.executed = true;

        address proposerAddr = proposal.proposer;
        if (hasActiveProposal[proposerAddr] && activeProposalId[proposerAddr] == _proposalId) {
            hasActiveProposal[proposerAddr] = false;
            activeProposalId[proposerAddr] = 0;
        }

        if (proposal.action == Action.SetPaused) {
            _setPaused(proposal.paused);
        } else if (proposal.action == Action.UpdateConfig) {
            _updateConfig(proposal.token, proposal.newEntryFee);
        } else if (proposal.action == Action.WithdrawTreasury) {
            _withdrawTreasury(proposal.token, proposal.recipient, proposal.amount, proposal.reason, _proposalId);
        } else if (proposal.action == Action.WithdrawAllTreasury) {
            _withdrawAllTreasury(proposal.token, proposal.recipient, proposal.reason, _proposalId);
        } else if (proposal.action == Action.DisbandTreasury) {
            _disbandTreasury(_proposalId);
        } else {
            revert TemplErrors.InvalidCallData();
        }

        emit ProposalExecuted(_proposalId, true, hex"");
    }

    /**
     * @notice Withdraw assets held by this contract (proposal required)
     * @dev Enables the DAO to move entry-fee treasury or tokens/ETH donated via direct transfer
     * @param token Asset to withdraw (address(0) for ETH)
     * @param recipient Address to receive assets
     * @param amount Amount to withdraw
     * @param reason Withdrawal explanation
     */
    function withdrawTreasuryDAO(
        address token,
        address recipient,
        uint256 amount,
        string memory reason
    ) external onlyDAO {
        _withdrawTreasury(token, recipient, amount, reason, 0);
    }

    /**
     * @notice Withdraw entire balance of a token or ETH held by the contract (proposal required)
     * @dev Covers entry-fee treasury and any donated assets
     * @param token Asset to withdraw (address(0) for ETH)
     * @param recipient Address to receive assets
     * @param reason Withdrawal explanation
     */
    function withdrawAllTreasuryDAO(
        address token,
        address recipient,
        string memory reason
    ) external onlyDAO {
        _withdrawAllTreasury(token, recipient, reason, 0);
    }

    /**
     * @notice Update contract configuration via DAO proposal
     * @param _token New ERC20 token address (or address(0) to keep current)
     * @param _entryFee New entry fee amount (or 0 to keep current)
     */
    function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO {
        _updateConfig(_token, _entryFee);
    }
    
    /**
     * @notice Pause or unpause new memberships via DAO proposal
     * @param _paused true to pause, false to unpause
     */
    function setPausedDAO(bool _paused) external onlyDAO { _setPaused(_paused); }

    /**
     * @notice Distribute all treasury to the member pool equally
     * @dev Increases memberPoolBalance and updates reward snapshots
     */
    function disbandTreasuryDAO() external onlyDAO { _disbandTreasury(0); }

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
            uint256 current = IERC20(accessToken).balanceOf(address(this));
            if (current <= memberPoolBalance) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 available = current - memberPoolBalance;
            if (amount > available) revert TemplErrors.InsufficientTreasuryBalance();
            uint256 fromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= fromFees;

            IERC20(accessToken).safeTransfer(recipient, amount);
        } else if (token == address(0)) {
            if (amount > address(this).balance) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            if (amount > IERC20(token).balanceOf(address(this))) revert TemplErrors.InsufficientTreasuryBalance();
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount, reason);
    }

    function _withdrawAllTreasury(
        address token,
        address recipient,
        string memory reason,
        uint256 proposalId
    ) internal {
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();
        uint256 amount;
        if (token == accessToken) {
            uint256 current = IERC20(accessToken).balanceOf(address(this));
            if (current <= memberPoolBalance) revert TemplErrors.NoTreasuryFunds();
            amount = current - memberPoolBalance;
            uint256 fromFees = amount <= treasuryBalance ? amount : treasuryBalance;
            treasuryBalance -= fromFees;

            IERC20(accessToken).safeTransfer(recipient, amount);
        } else if (token == address(0)) {
            amount = address(this).balance;
            if (amount == 0) revert TemplErrors.NoTreasuryFunds();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            amount = IERC20(token).balanceOf(address(this));
            if (amount == 0) revert TemplErrors.NoTreasuryFunds();
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit TreasuryAction(proposalId, token, recipient, amount, reason);
    }

    function _updateConfig(address _token, uint256 _entryFee) internal {
        if (_token != address(0) && _token != accessToken) revert TemplErrors.TokenChangeDisabled();
        if (_entryFee > 0) {
            if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
            entryFee = _entryFee;
        }
        emit ConfigUpdated(accessToken, entryFee);
    }

    function _setPaused(bool _paused) internal {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    function _disbandTreasury(uint256 proposalId) internal {
        uint256 amount = treasuryBalance;
        if (amount == 0) revert TemplErrors.NoTreasuryFunds();
        uint256 n = memberList.length;
        if (n == 0) revert TemplErrors.NoMembers();

        treasuryBalance = 0;
        memberPoolBalance += amount;

        uint256 perMember = amount / n;
        uint256 remainder = amount % n;
        cumulativeMemberRewards += perMember;
        memberRewardRemainder += remainder;

        emit TreasuryDisbanded(proposalId, amount, perMember, remainder);
    }
    
    /**
     * @notice Get unclaimed rewards for a member
     * @param member Address to check rewards for
     * @return Claimable token amount from member pool
     */
    function getClaimablePoolAmount(address member) public view returns (uint256) {
        if (!members[member].purchased) {
            return 0;
        }

        uint256 accrued = cumulativeMemberRewards;
        uint256 snapshot = members[member].rewardSnapshot;
        return accrued > snapshot ? accrued - snapshot : 0;
    }
    
    /**
     * @notice Claim accumulated rewards from the member pool
     */
    function claimMemberPool() external onlyMember nonReentrant {
        uint256 claimable = getClaimablePoolAmount(msg.sender);
        if (claimable == 0) revert TemplErrors.NoRewardsToClaim();
        uint256 distributable = memberPoolBalance - memberRewardRemainder;
        if (distributable < claimable) revert TemplErrors.InsufficientPoolBalance();

        members[msg.sender].rewardSnapshot = cumulativeMemberRewards;
        memberPoolClaims[msg.sender] += claimable;
        memberPoolBalance -= claimable;

        IERC20(accessToken).safeTransfer(msg.sender, claimable);

        emit MemberPoolClaimed(msg.sender, claimable, block.timestamp);
    }

    /**
     * @notice Get comprehensive proposal information
     * @param _proposalId Proposal ID to query
     * @return proposer Address that created the proposal
     * @return title Proposal title
     * @return description Detailed description
     * @return yesVotes Total weighted yes votes
     * @return noVotes Total weighted no votes
     * @return endTime Current deadline/earliest execution time
     * @return executed Whether proposal has been executed
     * @return passed Whether proposal is eligible to pass based on timing and votes
     */
    function getProposal(uint256 _proposalId) external view returns (
        address proposer,
        string memory title,
        string memory description,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 endTime,
        bool executed,
        bool passed
    ) {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.quorumExempt) {
            passed = block.timestamp >= proposal.endTime && proposal.yesVotes > proposal.noVotes;
        } else if (proposal.quorumReachedAt != 0) {
            passed = (block.timestamp >= (proposal.quorumReachedAt + executionDelayAfterQuorum)) && (proposal.yesVotes > proposal.noVotes);
        } else {
            passed = false;
        }

        return (
            proposal.proposer,
            proposal.title,
            proposal.description,
            proposal.yesVotes,
            proposal.noVotes,
            proposal.endTime,
            proposal.executed,
            passed
        );
    }
    
    /**
     * @notice Check member's vote on a specific proposal
     * @param _proposalId Proposal to check
     * @param _voter Address to check vote for
     * @return voted Whether the address has voted
     * @return support Vote choice (true = yes, false = no)
     */
    function hasVoted(uint256 _proposalId, address _voter) external view returns (bool voted, bool support) {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        
        return (proposal.hasVoted[_voter], proposal.voteChoice[_voter]);
    }
    
    /**
     * @notice Get list of currently active proposals
     * @dev Gas usage grows with proposal count; use paginated for large sets
     * @return Array of active proposal IDs
     */
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 pc = proposalCount;
        uint256[] memory temp = new uint256[](pc);
        uint256 count = 0;

        for (uint256 i = 0; i < pc; i++) {
            if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                temp[count++] = i;
            }
        }

        uint256[] memory activeIds = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            activeIds[j] = temp[j];
        }
        return activeIds;
    }
    
    /**
     * @notice Get paginated list of active proposals
     * @param offset Starting position in proposal list
     * @param limit Maximum proposals to return
     * @return proposalIds Array of active proposal IDs
     * @return hasMore True if more active proposals exist
     */
    function getActiveProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory proposalIds,
        bool hasMore
    ) {
        if (limit == 0 || limit > 100) revert TemplErrors.LimitOutOfRange();
        if (offset >= proposalCount) {
            return (new uint256[](0), false);
        }

        uint256[] memory tempIds = new uint256[](limit);
        uint256 count = 0;
        uint256 scanned = offset;

        for (uint256 i = offset; i < proposalCount && count < limit; i++) {
            if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                tempIds[count++] = i;
            }
            scanned = i + 1;
        }
        hasMore = false;
        if (scanned < proposalCount) {
            for (uint256 i = scanned; i < proposalCount; i++) {
                if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                    hasMore = true;
                    break;
                }
            }
        }

        proposalIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            proposalIds[i] = tempIds[i];
        }

        return (proposalIds, hasMore);
    }
    
    /**
     * @notice Check if an address has purchased membership
     * @param user Address to check
     * @return True if user has purchased access
     */
    function hasAccess(address user) external view returns (bool) {
        return members[user].purchased;
    }
    
    /**
     * @notice Get membership purchase details for an address
     * @param user Address to query
     * @return purchased Whether user has membership
     * @return timestamp When membership was purchased
     * @return blockNum Block number of purchase
     */
    function getPurchaseDetails(address user) external view returns (
        bool purchased,
        uint256 timestamp,
        uint256 blockNum
    ) {
        Member storage m = members[user];
        return (m.purchased, m.timestamp, m.block);
    }
    
    /**
     * @notice Get treasury and fee distribution info
     * @return treasury Current DAO treasury balance (available)
     * @return memberPool Current member pool balance
     * @return totalReceived Total amount sent to treasury
     * @return totalBurnedAmount Total tokens burned
     * @return totalProtocolFees Total protocol fees collected
     * @return protocolAddress Protocol fee recipient address
     */
    function getTreasuryInfo() external view returns (
        uint256 treasury,
        uint256 memberPool,
        uint256 totalReceived,
        uint256 totalBurnedAmount,
        uint256 totalProtocolFees,
        address protocolAddress
    ) {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (
            available,
            memberPoolBalance,
            totalToTreasury,
            totalBurned,
            totalToProtocol,
            protocolFeeRecipient
        );
    }
    
    /**
     * @notice Get current contract configuration
     * @return token ERC20 token address for payments
     * @return fee Membership entry fee amount
     * @return isPaused Whether purchases are paused
     * @return purchases Total number of members
     * @return treasury Current treasury balance (available)
     * @return pool Current member pool balance
     */
    function getConfig() external view returns (
        address token,
        uint256 fee,
        bool isPaused,
        uint256 purchases,
        uint256 treasury,
        uint256 pool
    ) {
        uint256 current = IERC20(accessToken).balanceOf(address(this));
        uint256 available = current > memberPoolBalance ? current - memberPoolBalance : 0;
        return (accessToken, entryFee, paused, totalPurchases, available, memberPoolBalance);
    }
    
    /**
     * @notice Get total number of members
     * @return Current member count
     */
    function getMemberCount() external view returns (uint256) {
        return memberList.length;
    }
    
    /**
     * @notice Get voting power for a specific address
     * @param voter Address to check voting weight for
     * @return Current voting power (0 for non-members, 1 for members)
     */
    function getVoteWeight(address voter) external view returns (uint256) {
        if (!members[voter].purchased) {
            return 0;
        }
        return 1;
    }
    
}
