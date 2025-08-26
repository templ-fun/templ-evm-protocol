// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title TEMPL - Token Entry Management Protocol with DAO Governance
 * @notice Decentralized membership system with autonomous treasury management
 * @dev Fee distribution: 30% burn, 30% DAO treasury, 30% member pool, 10% protocol
 */
contract TEMPL {
    // Reentrancy guard state
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    
    address public immutable priest;
    address public immutable protocolFeeRecipient;
    address public accessToken;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    uint256 public memberPoolBalance;
    bool public paused;
    
    uint256 public immutable priestVoteWeight;
    uint256 public immutable priestWeightThreshold;
    
    mapping(address => bool) public hasPurchased;
    mapping(address => uint256) public purchaseTimestamp;
    mapping(address => uint256) public purchaseBlock;
    
    address[] public members;
    mapping(address => uint256) public memberIndex;
    mapping(address => uint256) public memberPoolClaims;
    uint256[] public poolDeposits;
    
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
        address indexed recipient,
        uint256 amount,
        string description
    );
    
    event TreasuryWithdrawn(
        address indexed priest,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );
    
    event ConfigUpdated(
        address indexed token,
        uint256 entryFee
    );
    
    event ContractPaused(bool isPaused);
    
    modifier onlyMember() {
        require(hasPurchased[msg.sender], "Only members can call this");
        _;
    }
    
    modifier onlyDAO() {
        require(msg.sender == address(this), "Only DAO can call this");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    /**
     * @dev Constructor sets immutable parameters
     * @param _priest Temple creator with enhanced voting weight until threshold
     * @param _protocolFeeRecipient Receives 10% protocol fee
     * @param _token ERC20 token for membership payments
     * @param _entryFee Membership cost (minimum 10 for proper distribution)
     * @param _priestVoteWeight Vote multiplier for priest
     * @param _priestWeightThreshold Member count when priest advantage expires
     */
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee,
        uint256 _priestVoteWeight,
        uint256 _priestWeightThreshold
    ) {
        require(_priest != address(0), "Invalid priest address");
        require(_protocolFeeRecipient != address(0), "Invalid protocol fee recipient address");
        require(_token != address(0), "Invalid token address");
        require(_entryFee > 0, "Entry fee must be greater than 0");
        require(_entryFee >= 10, "Entry fee too small for distribution");
        require(_priestVoteWeight > 0, "Priest vote weight must be greater than 0");
        require(_priestWeightThreshold > 0, "Priest weight threshold must be greater than 0");
        
        priest = _priest;
        protocolFeeRecipient = _protocolFeeRecipient;
        accessToken = _token;
        entryFee = _entryFee;
        priestVoteWeight = _priestVoteWeight;
        priestWeightThreshold = _priestWeightThreshold;
        paused = false;
        _status = _NOT_ENTERED; // Initialize reentrancy guard
    }
    
    /**
     * @notice Purchase membership with automatic fee distribution
     * @dev Executes 4 transfers: burn (30%), treasury (30%), member pool (30%), protocol (10%)
     */
    function purchaseAccess() external whenNotPaused nonReentrant {
        require(!hasPurchased[msg.sender], "Already purchased access");
        
        uint256 thirtyPercent = (entryFee * 30) / 100;
        uint256 tenPercent = (entryFee * 10) / 100;
        
        uint256 totalRequired = thirtyPercent * 3 + tenPercent;
        require(totalRequired <= entryFee, "Calculation error");
        
        require(
            IERC20(accessToken).balanceOf(msg.sender) >= entryFee,
            "Insufficient token balance"
        );
        
        bool burnSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(0x000000000000000000000000000000000000dEaD),
            thirtyPercent
        );
        require(burnSuccess, "Burn transfer failed");
        
        bool treasurySuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(this),
            thirtyPercent
        );
        require(treasurySuccess, "Treasury transfer failed");
        
        bool poolSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(this),
            thirtyPercent
        );
        require(poolSuccess, "Pool transfer failed");
        
        bool protocolSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            protocolFeeRecipient,
            tenPercent
        );
        require(protocolSuccess, "Protocol transfer failed");
        
        treasuryBalance += thirtyPercent;
        memberPoolBalance += thirtyPercent;
        totalBurned += thirtyPercent;
        totalToTreasury += thirtyPercent;
        totalToMemberPool += thirtyPercent;
        totalToProtocol += tenPercent;
        
        if (members.length > 0) {
            poolDeposits.push(thirtyPercent);
        } else {
            poolDeposits.push(0);
        }
        hasPurchased[msg.sender] = true;
        purchaseTimestamp[msg.sender] = block.timestamp;
        purchaseBlock[msg.sender] = block.number;
        memberIndex[msg.sender] = members.length;
        members.push(msg.sender);
        totalPurchases++;
        
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
     * @dev One active proposal per member allowed
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
        require(bytes(_title).length > 0, "Title required");
        require(bytes(_description).length > 0, "Description required");
        require(_callData.length > 0, "Call data required");
        
        if (hasActiveProposal[msg.sender]) {
            uint256 existingId = activeProposalId[msg.sender];
            Proposal storage existingProposal = proposals[existingId];
            if (!existingProposal.executed && block.timestamp < existingProposal.endTime) {
                revert("You already have an active proposal");
            } else {
                hasActiveProposal[msg.sender] = false;
                activeProposalId[msg.sender] = 0;
            }
        }
        
        uint256 period = _votingPeriod;
        if (period == 0) {
            period = DEFAULT_VOTING_PERIOD;
        }
        require(period >= MIN_VOTING_PERIOD, "Voting period too short");
        require(period <= MAX_VOTING_PERIOD, "Voting period too long");
        
        uint256 proposalId = proposalCount++;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = _title;
        proposal.description = _description;
        proposal.callData = _callData;
        proposal.endTime = block.timestamp + period;
        proposal.createdAt = block.timestamp;
        proposal.eligibleVoters = members.length;
        proposal.executed = false;
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        
        emit ProposalCreated(proposalId, msg.sender, _title, proposal.endTime);
        
        return proposalId;
    }
    
    /**
     * @notice Cast vote on an active proposal
     * @dev Voting power: 1 for members, priestVoteWeight for priest below threshold
     * @param _proposalId Proposal to vote on
     * @param _support Vote choice (true = yes, false = no)
     */
    function vote(uint256 _proposalId, bool _support) external onlyMember {
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        
        require(purchaseTimestamp[msg.sender] < proposal.createdAt, 
            "You cannot vote on proposals created before you joined");
        
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = _support;
        
        uint256 voteWeight = 1;
        if (msg.sender == priest && members.length < priestWeightThreshold) {
            voteWeight = priestVoteWeight;
        }
        
        if (_support) {
            proposal.yesVotes += voteWeight;
        } else {
            proposal.noVotes += voteWeight;
        }
        
        emit VoteCast(_proposalId, msg.sender, _support, block.timestamp);
    }
    
    /**
     * @notice Execute a passed proposal after voting ends
     * @dev Requires simple majority (yesVotes > noVotes)
     * @param _proposalId Proposal to execute
     */
    function executeProposal(uint256 _proposalId) external {
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        require(block.timestamp >= proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Already executed");
        
        require(proposal.yesVotes > proposal.noVotes, "Proposal did not pass");
        
        proposal.executed = true;
        
        address proposer = proposal.proposer;
        if (hasActiveProposal[proposer] && activeProposalId[proposer] == _proposalId) {
            hasActiveProposal[proposer] = false;
            activeProposalId[proposer] = 0;
        }
        
        (bool success, bytes memory returnData) = address(this).call(proposal.callData);
        
        emit ProposalExecuted(_proposalId, success, returnData);
        
        if (!success) {
            proposal.executed = false;
            hasActiveProposal[proposer] = true;
            activeProposalId[proposer] = _proposalId;
            revert("Proposal execution failed");
        }
    }
    
    /**
     * @notice Withdraw funds from DAO treasury (proposal required)
     * @param recipient Address to receive treasury funds
     * @param amount Token amount to withdraw
     * @param reason Withdrawal explanation
     */
    function withdrawTreasuryDAO(address recipient, uint256 amount, string memory reason) external onlyDAO nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= treasuryBalance, "Insufficient treasury balance");
        
        treasuryBalance -= amount;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        emit TreasuryAction(proposalCount - 1, recipient, amount, reason);
    }
    
    /**
     * @notice DEPRECATED - Use withdrawTreasuryDAO through proposal
     */
    function withdrawTreasury(address, uint256) external pure {
        revert("Treasury withdrawals require DAO approval. Use withdrawTreasuryDAO through a proposal.");
    }
    
    /**
     * @notice DEPRECATED - Use withdrawAllTreasuryDAO through proposal
     */
    function withdrawAllTreasury(address) external pure {
        revert("Treasury withdrawals require DAO approval. Use withdrawTreasuryDAO through a proposal.");
    }
    
    /**
     * @notice Withdraw entire treasury balance (proposal required)
     * @param recipient Address to receive all treasury funds
     * @param reason Withdrawal explanation
     */
    function withdrawAllTreasuryDAO(address recipient, string memory reason) external onlyDAO nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(treasuryBalance > 0, "No treasury funds");
        
        uint256 amount = treasuryBalance;
        treasuryBalance = 0;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        emit TreasuryAction(proposalCount - 1, recipient, amount, reason);
    }
    
    /**
     * @notice Execute arbitrary external calls on behalf of DAO
     * @dev CRITICAL: Can interact with any contract - proposals must be carefully reviewed
     * @param target Contract address to call
     * @param value ETH amount to send
     * @param data Function call data
     * @return Result data from external call
     */
    function executeDAO(address target, uint256 value, bytes memory data) external onlyDAO nonReentrant returns (bytes memory) {
        require(target != address(0), "Invalid target");
        
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "External call failed");
        
        return result;
    }
    
    /**
     * @notice Update contract configuration via DAO proposal
     * @param _token New ERC20 token address (or address(0) to keep current)
     * @param _entryFee New entry fee amount (or 0 to keep current)
     */
    function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO {
        if (_token != address(0)) {
            accessToken = _token;
        }
        if (_entryFee > 0) {
            require(_entryFee >= 10, "Entry fee too small for distribution");
            entryFee = _entryFee;
        }
        
        emit ConfigUpdated(accessToken, entryFee);
    }
    
    /**
     * @notice DEPRECATED - Use updateConfigDAO through proposal
     */
    function updateConfig(address, uint256) external pure {
        revert("Config updates require DAO approval. Use updateConfigDAO through a proposal.");
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
     * @notice DEPRECATED - Use setPausedDAO through proposal
     */
    function setPaused(bool) external pure {
        revert("Pause/unpause requires DAO approval. Use setPausedDAO through a proposal.");
    }
    
    /**
     * @notice Calculate member's unclaimed rewards from pool
     * @param member Address to check rewards for
     * @return Claimable token amount from member pool
     */
    function getClaimablePoolAmount(address member) public view returns (uint256) {
        if (!hasPurchased[member]) {
            return 0;
        }
        
        uint256 memberIdx = memberIndex[member];
        uint256 totalClaimable = 0;
        
        for (uint256 i = memberIdx + 1; i < poolDeposits.length; i++) {
            if (poolDeposits[i] > 0) {
                uint256 eligibleMembers = i;
                if (eligibleMembers > 0) {
                    uint256 sharePerMember = poolDeposits[i] / eligibleMembers;
                    totalClaimable += sharePerMember;
                }
            }
        }
        
        return totalClaimable > memberPoolClaims[member] ? 
               totalClaimable - memberPoolClaims[member] : 0;
    }
    
    /**
     * @notice Claim accumulated rewards from member pool
     */
    function claimMemberPool() external nonReentrant {
        uint256 claimable = getClaimablePoolAmount(msg.sender);
        require(claimable > 0, "No rewards to claim");
        require(memberPoolBalance >= claimable, "Insufficient pool balance");
        
        memberPoolClaims[msg.sender] += claimable;
        memberPoolBalance -= claimable;
        
        bool success = IERC20(accessToken).transfer(msg.sender, claimable);
        require(success, "Pool claim transfer failed");
        
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
     * @return passed Whether proposal has enough votes to pass
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
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        return (
            proposal.proposer,
            proposal.title,
            proposal.description,
            proposal.yesVotes,
            proposal.noVotes,
            proposal.endTime,
            proposal.executed,
            proposal.yesVotes > proposal.noVotes
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
        require(_proposalId < proposalCount, "Invalid proposal");
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
        require(limit > 0 && limit <= 100, "Limit must be 1-100");
        
        uint256[] memory tempIds = new uint256[](limit);
        uint256 count = 0;
        uint256 scanned = 0;
        
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
        return hasPurchased[user];
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
        return (
            hasPurchased[user],
            purchaseTimestamp[user],
            purchaseBlock[user]
        );
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
        return members.length;
    }
    
    /**
     * @notice Get voting power for a specific address
     * @param voter Address to check voting weight for
     * @return Current voting power (0, 1, or priestVoteWeight)
     */
    function getVoteWeight(address voter) external view returns (uint256) {
        if (!hasPurchased[voter]) {
            return 0;
        }
        if (voter == priest && members.length < priestWeightThreshold) {
            return priestVoteWeight;
        }
        return 1;
    }
    
}