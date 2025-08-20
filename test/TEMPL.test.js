const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TEMPL", function () {
  let contract;
  let token;
  let deployer;
  let priest;
  let user1;
  let user2;
  const ENTRY_FEE = 100;
  
  beforeEach(async function () {
    [deployer, priest, user1, user2] = await ethers.getSigners();
    const MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();
    await token.mint(user1.address, ethers.parseEther("1000"));
    await token.mint(user2.address, ethers.parseEther("1000"));
    const TEMPL = await ethers.getContractFactory("TEMPL");
    contract = await TEMPL.deploy(
      priest.address,
      await token.getAddress(),
      ENTRY_FEE
    );
    await contract.waitForDeployment();
    await token.connect(user1).approve(await contract.getAddress(), ethers.parseEther("1000"));
    await token.connect(user2).approve(await contract.getAddress(), ethers.parseEther("1000"));
  });
  
  describe("Deployment", function () {
    it("Should set the correct priest address", async function () {
      expect(await contract.priest()).to.equal(priest.address);
    });
    
    it("Should set the correct token and entry fee", async function () {
      const config = await contract.getConfig();
      expect(config[0]).to.equal(await token.getAddress());
      expect(config[1]).to.equal(ENTRY_FEE);
    });
    
    it("Should reject deployment with odd entry fee", async function () {
      const TEMPL = await ethers.getContractFactory("TEMPL");
      await expect(
        TEMPL.deploy(priest.address, await token.getAddress(), 101)
      ).to.be.revertedWith("Entry fee must be even for 50/50 split");
    });
    
    it("Should have immutable priest address", async function () {
      // No function to change priest address should exist
      expect(contract.setPriest).to.be.undefined;
    });
  });
  
  describe("Purchase Access", function () {
    it("Should split payment 50/50 between treasury and burn", async function () {
      const contractAddress = await contract.getAddress();
      const burnAddress = "0x000000000000000000000000000000000000dEaD";
      
      const initialContractBalance = await token.balanceOf(contractAddress);
      const initialBurnBalance = await token.balanceOf(burnAddress);
      
      await contract.connect(user1).purchaseAccess();
      const expectedAmount = BigInt(ENTRY_FEE) * ethers.parseEther("1") / 1n;
      const halfAmount = expectedAmount / 2n;
      
      expect(await token.balanceOf(contractAddress)).to.equal(initialContractBalance + halfAmount);
      expect(await token.balanceOf(burnAddress)).to.equal(initialBurnBalance + halfAmount);
      const treasuryInfo = await contract.getTreasuryInfo();
      expect(treasuryInfo[0]).to.equal(halfAmount); // balance
      expect(treasuryInfo[1]).to.equal(halfAmount); // totalReceived
      expect(treasuryInfo[2]).to.equal(halfAmount); // totalBurned
    });
    
    it("Should prevent double purchase", async function () {
      await contract.connect(user1).purchaseAccess();
      await expect(
        contract.connect(user1).purchaseAccess()
      ).to.be.revertedWith("Already purchased access");
    });
    
    it("Should track purchase details", async function () {
      await contract.connect(user1).purchaseAccess();
      
      const hasAccess = await contract.hasAccess(user1.address);
      expect(hasAccess).to.be.true;
      
      const details = await contract.getPurchaseDetails(user1.address);
      expect(details[0]).to.be.true; // purchased
      expect(details[1]).to.be.gt(0); // timestamp
      expect(details[2]).to.be.gt(0); // block number
    });
    
    it("Should emit AccessPurchased event with correct values", async function () {
      const expectedTotal = BigInt(ENTRY_FEE) * ethers.parseEther("1") / 1n;
      const halfAmount = expectedTotal / 2n;
      
      await expect(contract.connect(user1).purchaseAccess())
        .to.emit(contract, "AccessPurchased")
        .withArgs(
          user1.address,
          expectedTotal,
          halfAmount, // burned
          halfAmount, // treasury
          await ethers.provider.getBlock('latest').then(b => b.timestamp + 1),
          await ethers.provider.getBlockNumber() + 1
        );
    });
  });
  
  describe("Treasury Management", function () {
    beforeEach(async function () {
      await contract.connect(user1).purchaseAccess();
    });
    
    it("Should only allow priest to withdraw treasury", async function () {
      const treasuryInfo = await contract.getTreasuryInfo();
      const balance = treasuryInfo[0];
      
      // Deployer cannot withdraw (only priest can)
      await expect(
        contract.connect(deployer).withdrawTreasury(deployer.address, balance)
      ).to.be.revertedWith("Only priest can call this");
      
      // User cannot withdraw
      await expect(
        contract.connect(user1).withdrawTreasury(user1.address, balance)
      ).to.be.revertedWith("Only priest can call this");
      
      // Priest can withdraw
      await expect(
        contract.connect(priest).withdrawTreasury(priest.address, balance)
      ).to.not.be.reverted;
    });
    
    it("Should correctly withdraw specific amount", async function () {
      const treasuryInfo = await contract.getTreasuryInfo();
      const balance = treasuryInfo[0];
      const withdrawAmount = balance / 2n;
      
      const initialPriestBalance = await token.balanceOf(priest.address);
      
      await contract.connect(priest).withdrawTreasury(priest.address, withdrawAmount);
      
      expect(await token.balanceOf(priest.address)).to.equal(initialPriestBalance + withdrawAmount);
      
      const newTreasuryInfo = await contract.getTreasuryInfo();
      expect(newTreasuryInfo[0]).to.equal(balance - withdrawAmount);
    });
    
    it("Should correctly withdraw all treasury", async function () {
      const treasuryInfo = await contract.getTreasuryInfo();
      const balance = treasuryInfo[0];
      
      const initialPriestBalance = await token.balanceOf(priest.address);
      
      await contract.connect(priest).withdrawAllTreasury(priest.address);
      
      expect(await token.balanceOf(priest.address)).to.equal(initialPriestBalance + balance);
      
      const newTreasuryInfo = await contract.getTreasuryInfo();
      expect(newTreasuryInfo[0]).to.equal(0);
    });
    
    it("Should emit TreasuryWithdrawn event", async function () {
      const treasuryInfo = await contract.getTreasuryInfo();
      const balance = treasuryInfo[0];
      
      await expect(contract.connect(priest).withdrawAllTreasury(priest.address))
        .to.emit(contract, "TreasuryWithdrawn")
        .withArgs(
          priest.address,
          priest.address,
          balance,
          await ethers.provider.getBlock('latest').then(b => b.timestamp + 1)
        );
    });
    
    it("Should prevent withdrawing more than balance", async function () {
      const treasuryInfo = await contract.getTreasuryInfo();
      const balance = treasuryInfo[0];
      
      await expect(
        contract.connect(priest).withdrawTreasury(priest.address, balance + 1n)
      ).to.be.revertedWith("Insufficient treasury balance");
    });
  });
  
  describe("Security Features", function () {
    it("Should prevent purchases when paused", async function () {
      await contract.connect(priest).setPaused(true);
      
      await expect(
        contract.connect(user1).purchaseAccess()
      ).to.be.revertedWith("Contract is paused");
    });
    
    it("Should only allow priest to pause", async function () {
      await expect(
        contract.connect(user1).setPaused(true)
      ).to.be.revertedWith("Only priest can call this");
    });
    
    it("Should only allow priest to update config", async function () {
      await expect(
        contract.connect(user1).updateConfig(await token.getAddress(), 200)
      ).to.be.revertedWith("Only priest can call this");
    });
    
    it("Should require even entry fee in config update", async function () {
      await expect(
        contract.connect(priest).updateConfig(await token.getAddress(), 201)
      ).to.be.revertedWith("Entry fee must be even for 50/50 split");
    });
    
    it("Should prevent recovering access token through recoverWrongToken", async function () {
      await expect(
        contract.connect(priest).recoverWrongToken(await token.getAddress(), priest.address)
      ).to.be.revertedWith("Use withdrawTreasury for access tokens");
    });
  });
  
  describe("Multiple Purchases", function () {
    it("Should correctly track multiple users and treasury", async function () {
      await contract.connect(user1).purchaseAccess();
      await contract.connect(user2).purchaseAccess();
      expect(await contract.hasAccess(user1.address)).to.be.true;
      expect(await contract.hasAccess(user2.address)).to.be.true;
      
      // Check treasury accumulated correctly
      const expectedTotal = BigInt(ENTRY_FEE) * ethers.parseEther("1") / 1n;
      const expectedTreasury = expectedTotal; // Two purchases, each contributing half
      
      const treasuryInfo = await contract.getTreasuryInfo();
      expect(treasuryInfo[0]).to.equal(expectedTreasury); // balance
      expect(treasuryInfo[1]).to.equal(expectedTreasury); // totalReceived
      expect(treasuryInfo[2]).to.equal(expectedTreasury); // totalBurned (same amount)
      
      // Check total purchases
      const config = await contract.getConfig();
      expect(config[3]).to.equal(2); // total purchases
    });
  });
});

// Mock ERC20 for testing
const MockERC20 = `
pragma solidity ^0.8.19;

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        return true;
    }
}
`;