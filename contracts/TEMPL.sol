// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title TEMPL - Telegram Entry Management Protocol with DAO Governance
 * @dev Splits: 30% burn, 30% DAO treasury, 30% member pool, 10% protocol
 * @dev Treasury is controlled by member voting, not by priest
 */
contract TEMPL {
    // State variables
    address public immutable priest; // Temple creator with special voting weight
    address public immutable protocolFeeRecipient; // Receives 10% protocol fee
    address public accessToken;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    uint256 public memberPoolBalance;
    bool public paused;
    
    // Priest voting weight configuration
    uint256 public immutable priestVoteWeight; // Weight of priest's vote when below threshold
    uint256 public immutable priestWeightThreshold; // Member count threshold for priest weight reduction
    
    // Track purchases
    mapping(address => bool) public hasPurchased;
    mapping(address => uint256) public purchaseTimestamp;
    mapping(address => uint256) public purchaseBlock;
    
    // Member pool tracking
    address[] public members;
    mapping(address => uint256) public memberIndex;
    mapping(address => uint256) public memberPoolClaims;
    uint256[] public poolDeposits;
    
    // DAO Governance
    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        bytes callData; // The code to execute if approved
        uint256 yesVotes;
        uint256 noVotes;
        uint256 endTime;
        uint256 createdAt; // Timestamp when proposal was created
        uint256 eligibleVoters; // Number of members who can vote (joined before proposal)
        bool executed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteChoice; // true = yes, false = no
    }
    
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public activeProposalId; // Track active proposal per user (0 = no active proposal)
    mapping(address => bool) public hasActiveProposal; // Quick check if user has active proposal
    uint256 public constant DEFAULT_VOTING_PERIOD = 7 days;
    uint256 public constant MIN_VOTING_PERIOD = 7 days;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;
    
    // Totals
    uint256 public totalPurchases;
    uint256 public totalBurned;
    uint256 public totalToTreasury;
    uint256 public totalToMemberPool;
    uint256 public totalToProtocol;
    
    // Events
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
    
    // Modifiers
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
     * @dev Constructor
     * @param _priest Address of the temple creator (has special voting weight)
     * @param _protocolFeeRecipient Address that receives 10% protocol fee
     * @param _token Address of the ERC20 token
     * @param _entryFee Total entry fee in wei (absolute value)
     * @param _priestVoteWeight Weight of priest's vote when below threshold (default 10)
     * @param _priestWeightThreshold Member count threshold for priest weight reduction (default 10)
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
    }
    
    /**
     * @dev Purchase group access
     * Splits: 30% burn, 30% DAO treasury, 30% member pool, 10% protocol
     */
    function purchaseAccess() external whenNotPaused {
        require(!hasPurchased[msg.sender], "Already purchased access");
        
        // Calculate splits (30%, 30%, 30%, 10%)
        uint256 thirtyPercent = (entryFee * 30) / 100;
        uint256 tenPercent = (entryFee * 10) / 100;
        
        // Ensure we have the full amount
        uint256 totalRequired = thirtyPercent * 3 + tenPercent;
        require(totalRequired <= entryFee, "Calculation error");
        
        require(
            IERC20(accessToken).balanceOf(msg.sender) >= entryFee,
            "Insufficient token balance"
        );
        
        // 1. Burn 30%
        bool burnSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(0x000000000000000000000000000000000000dEaD),
            thirtyPercent
        );
        require(burnSuccess, "Burn transfer failed");
        
        // 2. Treasury 30% (DAO-controlled)
        bool treasurySuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(this),
            thirtyPercent
        );
        require(treasurySuccess, "Treasury transfer failed");
        
        // 3. Member Pool 30% (stays in contract)
        bool poolSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(this),
            thirtyPercent
        );
        require(poolSuccess, "Pool transfer failed");
        
        // 4. Protocol fee 10% (to protocolFeeRecipient)
        bool protocolSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            protocolFeeRecipient,
            tenPercent
        );
        require(protocolSuccess, "Protocol transfer failed");
        
        // Update balances
        treasuryBalance += thirtyPercent;
        memberPoolBalance += thirtyPercent;
        totalBurned += thirtyPercent;
        totalToTreasury += thirtyPercent;
        totalToMemberPool += thirtyPercent;
        totalToProtocol += tenPercent;
        
        // Record pool deposit for existing members
        if (members.length > 0) {
            poolDeposits.push(thirtyPercent);
        } else {
            poolDeposits.push(0); // First member doesn't get rewards from own purchase
        }
        
        // Mark purchase and add to members list
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
     * @dev Create a proposal for DAO voting
     * @param _title Title of the proposal
     * @param _description Description of what the proposal does
     * @param _callData Encoded function call to execute if approved
     * @param _votingPeriod How long voting lasts (in seconds)
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
        
        // Check if user has an active proposal
        if (hasActiveProposal[msg.sender]) {
            uint256 existingId = activeProposalId[msg.sender];
            Proposal storage existingProposal = proposals[existingId];
            // Check if the existing proposal is still active (not executed and not expired)
            if (!existingProposal.executed && block.timestamp < existingProposal.endTime) {
                revert("You already have an active proposal");
            } else {
                // Clear the stale active proposal flag
                hasActiveProposal[msg.sender] = false;
                activeProposalId[msg.sender] = 0;
            }
        }
        
        // Validate voting period
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
        proposal.eligibleVoters = members.length; // Current member count = eligible voters
        proposal.executed = false;
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        
        // Mark this proposal as the user's active proposal
        hasActiveProposal[msg.sender] = true;
        activeProposalId[msg.sender] = proposalId;
        
        emit ProposalCreated(proposalId, msg.sender, _title, proposal.endTime);
        
        return proposalId;
    }
    
    /**
     * @dev Vote on a proposal
     * @param _proposalId The proposal to vote on
     * @param _support True for yes, false for no
     */
    function vote(uint256 _proposalId, bool _support) external onlyMember {
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        
        // Check if voter joined before proposal was created
        require(purchaseTimestamp[msg.sender] < proposal.createdAt, 
            "You cannot vote on proposals created before you joined");
        
        proposal.hasVoted[msg.sender] = true;
        proposal.voteChoice[msg.sender] = _support;
        
        // Calculate vote weight (priest gets special weight if below threshold)
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
     * @dev Execute a proposal if it passed
     * @param _proposalId The proposal to execute
     */
    function executeProposal(uint256 _proposalId) external {
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        require(block.timestamp >= proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Already executed");
        
        // Check if proposal passed: >50% of eligible voters voted yes
        // Note: Using simple majority of votes cast (yes > no) as 50% threshold
        // Could be changed to require yes > eligibleVoters/2 for absolute majority
        require(proposal.yesVotes > proposal.noVotes, "Proposal did not pass");
        
        proposal.executed = true;
        
        // Clear the proposer's active proposal status
        address proposer = proposal.proposer;
        if (hasActiveProposal[proposer] && activeProposalId[proposer] == _proposalId) {
            hasActiveProposal[proposer] = false;
            activeProposalId[proposer] = 0;
        }
        
        // Execute the proposal
        (bool success, bytes memory returnData) = address(this).call(proposal.callData);
        
        emit ProposalExecuted(_proposalId, success, returnData);
        
        if (!success) {
            // If execution failed, revert the executed flag and restore active status
            proposal.executed = false;
            hasActiveProposal[proposer] = true;
            activeProposalId[proposer] = _proposalId;
            revert("Proposal execution failed");
        }
    }
    
    /**
     * @dev DAO-controlled function to withdraw treasury funds
     * Can only be called by the DAO through a proposal
     */
    function withdrawTreasuryDAO(address recipient, uint256 amount, string memory reason) external onlyDAO {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= treasuryBalance, "Insufficient treasury balance");
        
        treasuryBalance -= amount;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        // proposalCount - 1 because this is called during proposal execution
        emit TreasuryAction(proposalCount - 1, recipient, amount, reason);
    }
    
    /**
     * @dev Legacy function - now requires DAO approval
     * Kept for interface compatibility but redirects to DAO function
     */
    function withdrawTreasury(address recipient, uint256 amount) external {
        revert("Treasury withdrawals require DAO approval. Use withdrawTreasuryDAO through a proposal.");
    }
    
    /**
     * @dev Legacy function - now requires DAO approval
     * Kept for interface compatibility but redirects to DAO function
     */
    function withdrawAllTreasury(address recipient) external {
        revert("Treasury withdrawals require DAO approval. Use withdrawTreasuryDAO through a proposal.");
    }
    
    /**
     * @dev DAO-controlled function to withdraw all treasury funds
     */
    function withdrawAllTreasuryDAO(address recipient, string memory reason) external onlyDAO {
        require(recipient != address(0), "Invalid recipient");
        require(treasuryBalance > 0, "No treasury funds");
        
        uint256 amount = treasuryBalance;
        treasuryBalance = 0;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        emit TreasuryAction(proposalCount - 1, recipient, amount, reason);
    }
    
    /**
     * @dev DAO-controlled function to execute arbitrary calls
     * Allows DAO to interact with other contracts (transfer tokens, approve, stake, etc.)
     * @param target The contract to call
     * @param value ETH to send (usually 0 for token operations)
     * @param data The calldata to execute
     */
    function executeDAO(address target, uint256 value, bytes memory data) external onlyDAO returns (bytes memory) {
        require(target != address(0), "Invalid target");
        
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "External call failed");
        
        return result;
    }
    
    /**
     * @dev DAO-controlled function to update contract configuration
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
     * @dev Legacy function - now requires DAO approval
     * Kept for interface compatibility
     */
    function updateConfig(address _token, uint256 _entryFee) external {
        revert("Config updates require DAO approval. Use updateConfigDAO through a proposal.");
    }
    
    /**
     * @dev DAO-controlled pause function
     */
    function setPausedDAO(bool _paused) external onlyDAO {
        paused = _paused;
        emit ContractPaused(_paused);
    }
    
    /**
     * @dev Legacy function - now requires DAO approval
     * Kept for interface compatibility
     */
    function setPaused(bool _paused) external {
        revert("Pause/unpause requires DAO approval. Use setPausedDAO through a proposal.");
    }
    
    /**
     * @dev Calculate claimable amount from member pool
     */
    function getClaimablePoolAmount(address member) public view returns (uint256) {
        if (!hasPurchased[member]) {
            return 0;
        }
        
        uint256 memberIdx = memberIndex[member];
        uint256 totalClaimable = 0;
        
        // Calculate share from each deposit after this member joined
        for (uint256 i = memberIdx + 1; i < poolDeposits.length; i++) {
            if (poolDeposits[i] > 0) {
                uint256 eligibleMembers = i;
                if (eligibleMembers > 0) {
                    uint256 sharePerMember = poolDeposits[i] / eligibleMembers;
                    totalClaimable += sharePerMember;
                }
            }
        }
        
        // Subtract already claimed amount
        return totalClaimable > memberPoolClaims[member] ? 
               totalClaimable - memberPoolClaims[member] : 0;
    }
    
    /**
     * @dev Claim member pool rewards
     */
    function claimMemberPool() external {
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
     * @dev Get proposal details
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
     * @dev Check if user has voted on a proposal
     */
    function hasVoted(uint256 _proposalId, address _voter) external view returns (bool voted, bool support) {
        require(_proposalId < proposalCount, "Invalid proposal");
        Proposal storage proposal = proposals[_proposalId];
        
        return (proposal.hasVoted[_voter], proposal.voteChoice[_voter]);
    }
    
    /**
     * @dev Get active proposals (not expired, not executed)
     */
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 activeCount = 0;
        
        // Count active proposals
        for (uint256 i = 0; i < proposalCount; i++) {
            if (block.timestamp < proposals[i].endTime && !proposals[i].executed) {
                activeCount++;
            }
        }
        
        // Collect active proposal IDs
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
     * @dev Check if an address has purchased access
     */
    function hasAccess(address user) external view returns (bool) {
        return hasPurchased[user];
    }
    
    /**
     * @dev Get purchase details for an address
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
     * @dev Get treasury and pool information
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
     * @dev Get current configuration
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
     * @dev Get member count
     */
    function getMemberCount() external view returns (uint256) {
        return members.length;
    }
    
    /**
     * @dev Get current vote weight for an address
     * @param voter The address to check
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