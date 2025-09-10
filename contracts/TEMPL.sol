// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TemplErrors} from "./TemplErrors.sol";

/**
 * @title TEMPL - Token Entry Management Protocol with DAO Governance
 * @notice Decentralized membership system with autonomous treasury management
 * @dev Fee distribution: 30% burn, 30% DAO treasury, 30% member pool, 10% protocol
 */
contract TEMPL is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using TemplErrors for *;

    address public immutable priest;
    address public immutable protocolFeeRecipient;
    address public accessToken;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    uint256 public memberPoolBalance;
    bool public paused;
    
    
    struct Member {
        bool purchased;
        uint256 timestamp;
        uint256 block;
        uint256 rewardSnapshot;
    }

    mapping(address => Member) public members;
    address[] public memberList;
    mapping(address => uint256) public memberIndex;
    mapping(address => uint256) public memberPoolClaims;
    uint256 public cumulativeMemberRewards;
    uint256 public memberRewardRemainder;
    
    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        bytes callData;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 endTime;
        uint256 createdAt;
        uint256 eligibleVoters;
        bool executed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteChoice;
    }
    
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public activeProposalId;
    mapping(address => bool) public hasActiveProposal;
    uint256 public constant DEFAULT_VOTING_PERIOD = 7 days;
    uint256 public constant MIN_VOTING_PERIOD = 7 days;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;

    uint256 private executingProposalId = type(uint256).max;
    
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
    
    event ProposalExecuted(
        uint256 indexed proposalId,
        bool success,
        bytes returnData
    );
    
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
     * @dev Executes 4 transfers: burn (30%), treasury (30%), member pool (30%), protocol (10%)
     */
    function purchaseAccess() external whenNotPaused notSelf nonReentrant {
        Member storage m = members[msg.sender];
        if (m.purchased) revert TemplErrors.AlreadyPurchased();

        uint256 thirtyPercent = (entryFee * 30) / 100;
        uint256 tenPercent = (entryFee * 10) / 100;

        if (IERC20(accessToken).balanceOf(msg.sender) < entryFee) revert TemplErrors.InsufficientBalance();

        m.purchased = true;
        m.timestamp = block.timestamp;
        m.block = block.number;
        memberIndex[msg.sender] = memberList.length;
        memberList.push(msg.sender);
        totalPurchases++;

        if (memberList.length > 1) {
            uint256 totalRewards = thirtyPercent + memberRewardRemainder;
            uint256 rewardPerMember = totalRewards / (memberList.length - 1);
            memberRewardRemainder = totalRewards % (memberList.length - 1);
            cumulativeMemberRewards += rewardPerMember;
        }

        m.rewardSnapshot = cumulativeMemberRewards;

        treasuryBalance += thirtyPercent;
        memberPoolBalance += thirtyPercent;
        totalBurned += thirtyPercent;
        totalToTreasury += thirtyPercent;
        totalToMemberPool += thirtyPercent;
        totalToProtocol += tenPercent;

        IERC20 token = IERC20(accessToken);
        token.safeTransferFrom(
            msg.sender,
            address(0x000000000000000000000000000000000000dEaD),
            thirtyPercent
        );
        token.safeTransferFrom(msg.sender, address(this), thirtyPercent);
        token.safeTransferFrom(msg.sender, address(this), thirtyPercent);
        token.safeTransferFrom(msg.sender, protocolFeeRecipient, tenPercent);
        
        emit AccessPurchased(
            msg.sender,
            entryFee,
            thirtyPercent,
            thirtyPercent,
            thirtyPercent,
            tenPercent,
            block.timestamp,
            block.number,
            totalPurchases - 1
        );
    }
    
    /**
     * @notice Create a governance proposal for DAO voting
     * @dev One active proposal per member allowed. Proposer automatically casts a YES vote.
     * @param _title Proposal title
     * @param _description Proposal description
     * @param _callData Function call to execute
     * @param _votingPeriod Voting duration in seconds
     * @return proposalId Proposal identifier
     */
    function createProposal(
        string memory _title,
        string memory _description,
        bytes memory _callData,
        uint256 _votingPeriod
    ) external onlyMember returns (uint256) {
        if (bytes(_title).length == 0) revert TemplErrors.TitleRequired();
        if (bytes(_description).length == 0) revert TemplErrors.DescriptionRequired();
        if (_callData.length == 0) revert TemplErrors.CallDataRequired();
        if (_callData.length < 4) revert TemplErrors.CallDataTooShort();
        // Restrict proposals to allowed DAO function selectors
        bytes4 selector;
        assembly {
            selector := mload(add(_callData, 32))
        }
        bool allowed = _isAllowedSelector(selector);
        if (!allowed) revert TemplErrors.InvalidCallData();
        
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
        
        uint256 period = _votingPeriod;
        if (period == 0) {
            period = DEFAULT_VOTING_PERIOD;
        }
        if (period < MIN_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooShort();
        if (period > MAX_VOTING_PERIOD) revert TemplErrors.VotingPeriodTooLong();
        
        uint256 proposalId = proposalCount++;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = _title;
        proposal.description = _description;
        proposal.callData = _callData;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.eligibleVoters = memberList.length;
        proposal.executed = false;
        // Auto-cast proposer YES vote as first vote
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = true;
        proposal.yesVotes = 1;
        proposal.noVotes = 0;
        
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        
        emit ProposalCreated(proposalId, msg.sender, _title, proposal.endTime);
        
        return proposalId;
    }
    
    /**
     * @notice Cast or change a vote on an active proposal
     * @dev Each member has 1 vote. Members can change their vote until the deadline.
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

        // Set vote state
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = _support;

        if (!hadVoted) {
            // First-time vote: increment corresponding counter
            if (_support) {
                proposal.yesVotes += 1;
            } else {
                proposal.noVotes += 1;
            }
        } else if (previous != _support) {
            // Changing vote: move one count from previous bucket to the other
            if (previous) {
                // was YES -> now NO
                proposal.yesVotes -= 1;
                proposal.noVotes += 1;
            } else {
                // was NO -> now YES
                proposal.noVotes -= 1;
                proposal.yesVotes += 1;
            }
        } // else: same choice again, no-op on tallies
        
        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }
    
    /**
     * @notice Execute a passed proposal after voting ends
     * @dev Requires simple majority (yesVotes > noVotes)
     * @param _proposalId Proposal to execute
     */
    function executeProposal(uint256 _proposalId) external nonReentrant {
        if (_proposalId >= proposalCount) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        if (block.timestamp < proposal.endTime) revert TemplErrors.VotingNotEnded();
        if (proposal.executed) revert TemplErrors.AlreadyExecuted();

        if (proposal.yesVotes <= proposal.noVotes) revert TemplErrors.ProposalNotPassed();

        proposal.executed = true;

        address proposer = proposal.proposer;
        if (hasActiveProposal[proposer] && activeProposalId[proposer] == _proposalId) {
            hasActiveProposal[proposer] = false;
            activeProposalId[proposer] = 0;
        }

        _startProposalExecution(_proposalId);
        bytes memory returnData = _executeCall(proposal.callData);
        _clearProposalExecution();

        emit ProposalExecuted(_proposalId, true, returnData);
    }

    function _startProposalExecution(uint256 proposalId) internal {
        executingProposalId = proposalId;
    }

    function _clearProposalExecution() internal {
        executingProposalId = type(uint256).max;
    }

    function _executeCall(bytes memory callData) internal returns (bytes memory) {
        bytes4 selector;
        assembly {
            selector := mload(add(callData, 32))
        }

        // Allow only specific DAO functions to be executed by proposals
        bool allowed = _isAllowedSelector(selector);

        if (!allowed) {
            revert TemplErrors.InvalidCallData();
        }

        (bool success, bytes memory returnData) = address(this).call(callData);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            } else {
                revert TemplErrors.ProposalExecutionFailed();
            }
        }
        return returnData;
    }

    function _isAllowedSelector(bytes4 selector) internal pure returns (bool) {
        return (
            selector == this.setPausedDAO.selector ||
            selector == this.updateConfigDAO.selector ||
            selector == this.withdrawTreasuryDAO.selector ||
            selector == this.withdrawAllTreasuryDAO.selector ||
            selector == this.disbandTreasuryDAO.selector
        );
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
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (amount == 0) revert TemplErrors.AmountZero();

        uint256 proposalId = executingProposalId;
        if (proposalId >= proposalCount) revert TemplErrors.InvalidProposal();

        if (token == accessToken) {
            if (amount > treasuryBalance) revert TemplErrors.InsufficientTreasuryBalance();
            treasuryBalance -= amount;
            IERC20(accessToken).safeTransfer(recipient, amount);
        } else if (token == address(0)) {
            if (amount > address(this).balance) revert TemplErrors.InsufficientTreasuryBalance();
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TemplErrors.ProposalExecutionFailed();
        } else {
            if (amount > IERC20(token).balanceOf(address(this))) {
                revert TemplErrors.InsufficientTreasuryBalance();
            }
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit TreasuryAction(proposalId, token, recipient, amount, reason);
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
        if (recipient == address(0)) revert TemplErrors.InvalidRecipient();

        uint256 proposalId = executingProposalId;
        if (proposalId >= proposalCount) revert TemplErrors.InvalidProposal();

        uint256 amount;
        if (token == accessToken) {
            if (treasuryBalance == 0) revert TemplErrors.NoTreasuryFunds();
            amount = treasuryBalance;
            treasuryBalance = 0;
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

    // Governance can move any assets held by the contract
    
    /**
     * @notice Update contract configuration via DAO proposal
     * @param _token New ERC20 token address (or address(0) to keep current)
     * @param _entryFee New entry fee amount (or 0 to keep current)
     */
    function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO {
        // Token changes via governance are disabled; only repricing is allowed.
        if (_token != address(0) && _token != accessToken) {
            revert TemplErrors.TokenChangeDisabled();
        }
        if (_entryFee > 0) {
            if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
            if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
            entryFee = _entryFee;
        }
        
        emit ConfigUpdated(accessToken, entryFee);
    }
    
    /**
     * @notice Pause or unpause new memberships via DAO proposal
     * @param _paused true to pause, false to unpause
     */
    function setPausedDAO(bool _paused) external onlyDAO {
        paused = _paused;
        emit ContractPaused(_paused);
    }

    /**
     * @notice Distribute entire treasury equally among all current members by allocating to the member pool.
     * @dev Increases memberPoolBalance by treasury amount and increments cumulativeMemberRewards by per-member share.
     *      Any division remainder is added to memberRewardRemainder for future distribution.
     */
    function disbandTreasuryDAO() external onlyDAO {
        uint256 amount = treasuryBalance;
        if (amount == 0) revert TemplErrors.NoTreasuryFunds();
        uint256 n = memberList.length;
        if (n == 0) revert TemplErrors.NoMembers();

        uint256 proposalId = executingProposalId;
        if (proposalId >= proposalCount) revert TemplErrors.InvalidProposal();

        // Move accounting from treasury to member pool
        treasuryBalance = 0;
        memberPoolBalance += amount;

        uint256 perMember = amount / n;
        uint256 remainder = amount % n;

        // Make per-member share claimable for all members via cumulative global increment
        cumulativeMemberRewards += perMember;
        // Carry remainder for future distribution to keep accounting exact
        memberRewardRemainder += remainder;

        emit TreasuryDisbanded(proposalId, amount, perMember, remainder);
    }
    
    /**
     * @notice Calculate member's unclaimed rewards from pool
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
     * @notice Claim accumulated rewards from member pool
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
     * @return endTime Timestamp when voting ends
     * @return executed Whether proposal has been executed
     * @return passed Whether proposal has passed (voting ended and yes votes exceed no votes)
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
        passed = block.timestamp >= proposal.endTime && proposal.yesVotes > proposal.noVotes;

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
     * @dev WARNING: Gas usage grows with proposal count. Use paginated version for large counts.
     * @return Array of active proposal IDs
     */
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 activeCount = 0;
        
        for (uint256 i = 0; i < proposalCount; i++) {
            if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                activeCount++;
            }
        }
        uint256[] memory activeIds = new uint256[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < proposalCount; i++) {
            if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                activeIds[index++] = i;
            }
        }
        
        return activeIds;
    }
    
    /**
     * @notice Get paginated list of active proposals (gas-efficient)
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
     * @notice Get comprehensive treasury and fee distribution info
     * @return treasury Current DAO treasury balance
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
        return (
            treasuryBalance,
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
     * @return treasury Current treasury balance
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
        return (accessToken, entryFee, paused, totalPurchases, treasuryBalance, memberPoolBalance);
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
