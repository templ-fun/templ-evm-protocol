// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title TEMPL - Telegram Entry Management Protocol
 */
contract TEMPL {
    // State variables
    address public immutable priest;
    address public accessToken;
    uint256 public entryFee;
    uint256 public treasuryBalance;
    bool public paused;
    
    // Track purchases
    mapping(address => bool) public hasPurchased;
    mapping(address => uint256) public purchaseTimestamp;
    mapping(address => uint256) public purchaseBlock;
    uint256 public totalPurchases;
    uint256 public totalBurned;
    uint256 public totalToTreasury;
    
    // Events
    event AccessPurchased(
        address indexed purchaser,
        uint256 totalAmount,
        uint256 burnedAmount,
        uint256 treasuryAmount,
        uint256 timestamp,
        uint256 blockNumber
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
    modifier onlyPriest() {
        require(msg.sender == priest, "Only priest can call this");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    /**
     * @dev Constructor
     * @param _priest Address that controls treasury and admin functions (immutable)
     * @param _token Address of the ERC20 token
     * @param _entryFee Total entry fee in wei (absolute value) - half burned, half to treasury
     */
    constructor(
        address _priest,
        address _token,
        uint256 _entryFee
    ) {
        require(_priest != address(0), "Invalid priest address");
        require(_token != address(0), "Invalid token address");
        require(_entryFee > 0, "Entry fee must be greater than 0");
        require(_entryFee % 2 == 0, "Entry fee must be even for 50/50 split");
        
        priest = _priest;
        accessToken = _token;
        entryFee = _entryFee;
        paused = false;
    }
    
    /**
     * @dev Purchase group access
     * Splits payment: 50% to treasury, 50% burned
     * Can only purchase once per wallet
     */
    function purchaseAccess() external whenNotPaused {
        require(!hasPurchased[msg.sender], "Already purchased access");
        
        // entryFee is already in wei (absolute value)
        uint256 halfAmount = entryFee / 2;
        
        require(
            IERC20(accessToken).balanceOf(msg.sender) >= entryFee,
            "Insufficient token balance"
        );
        
        bool treasurySuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(this),
            halfAmount
        );
        require(treasurySuccess, "Treasury transfer failed");
        
        bool burnSuccess = IERC20(accessToken).transferFrom(
            msg.sender,
            address(0x000000000000000000000000000000000000dEaD),
            halfAmount
        );
        require(burnSuccess, "Burn transfer failed");
        
        treasuryBalance += halfAmount;
        totalToTreasury += halfAmount;
        totalBurned += halfAmount;
        
        hasPurchased[msg.sender] = true;
        purchaseTimestamp[msg.sender] = block.timestamp;
        purchaseBlock[msg.sender] = block.number;
        totalPurchases++;
        
        emit AccessPurchased(
            msg.sender,
            entryFee,
            halfAmount,
            halfAmount,
            block.timestamp,
            block.number
        );
    }
    
    /**
     * @dev Withdraw treasury funds - ONLY PRIEST CAN CALL
     * @param recipient Address to receive the funds
     * @param amount Amount to withdraw (with decimals)
     */
    function withdrawTreasury(address recipient, uint256 amount) external onlyPriest {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= treasuryBalance, "Insufficient treasury balance");
        
        treasuryBalance -= amount;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        emit TreasuryWithdrawn(
            msg.sender,
            recipient,
            amount,
            block.timestamp
        );
    }
    
    /**
     * @dev Withdraw all treasury funds - ONLY PRIEST CAN CALL
     * @param recipient Address to receive all treasury funds
     */
    function withdrawAllTreasury(address recipient) external onlyPriest {
        require(recipient != address(0), "Invalid recipient");
        require(treasuryBalance > 0, "No treasury funds");
        
        uint256 amount = treasuryBalance;
        treasuryBalance = 0;
        
        bool success = IERC20(accessToken).transfer(recipient, amount);
        require(success, "Treasury withdrawal failed");
        
        emit TreasuryWithdrawn(
            msg.sender,
            recipient,
            amount,
            block.timestamp
        );
    }
    
    /**
     * @dev Check if an address has purchased access
     * @param user Address to check
     * @return bool Whether the address has purchased
     */
    function hasAccess(address user) external view returns (bool) {
        return hasPurchased[user];
    }
    
    /**
     * @dev Get purchase details for an address
     * @param user Address to query
     * @return purchased Whether purchased
     * @return timestamp When purchased (0 if not)
     * @return blockNum Block number of purchase (0 if not)
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
     * @dev Get treasury information
     * @return balance Current treasury balance
     * @return totalReceived Total ever sent to treasury
     * @return totalBurnedAmount Total ever burned
     * @return priestAddress The priest who controls everything
     */
    function getTreasuryInfo() external view returns (
        uint256 balance,
        uint256 totalReceived,
        uint256 totalBurnedAmount,
        address priestAddress
    ) {
        return (
            treasuryBalance,
            totalToTreasury,
            totalBurned,
            priest
        );
    }
    
    /**
     * @dev Update contract configuration (priest only)
     * @param _token New token address (use address(0) to keep current)
     * @param _entryFee New entry fee (use 0 to keep current)
     */
    function updateConfig(
        address _token,
        uint256 _entryFee
    ) external onlyPriest {
        if (_token != address(0)) {
            accessToken = _token;
        }
        if (_entryFee > 0) {
            require(_entryFee % 2 == 0, "Entry fee must be even for 50/50 split");
            entryFee = _entryFee;
        }
        
        emit ConfigUpdated(accessToken, entryFee);
    }
    
    /**
     * @dev Pause or unpause the contract (priest only)
     */
    function setPaused(bool _paused) external onlyPriest {
        paused = _paused;
        emit ContractPaused(_paused);
    }
    
    /**
     * @dev Get current configuration
     * @return token Token address
     * @return fee Entry fee (without decimals)
     * @return isPaused Contract pause status
     * @return purchases Total number of purchases
     * @return treasury Current treasury balance
     */
    function getConfig() external view returns (
        address token,
        uint256 fee,
        bool isPaused,
        uint256 purchases,
        uint256 treasury
    ) {
        return (accessToken, entryFee, paused, totalPurchases, treasuryBalance);
    }
    
    /**
     * @dev Emergency recovery for tokens sent by mistake (priest only)
     * This is ONLY for recovering wrong tokens sent to the contract by accident
     * Cannot be used to withdraw the treasury (use withdrawTreasury instead)
     * @param token Token to recover (must not be the access token)
     * @param to Address to send tokens to
     */
    function recoverWrongToken(address token, address to) external onlyPriest {
        require(token != accessToken, "Use withdrawTreasury for access tokens");
        require(to != address(0), "Invalid recipient");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to recover");
        
        bool success = IERC20(token).transfer(to, balance);
        require(success, "Token recovery failed");
    }
}