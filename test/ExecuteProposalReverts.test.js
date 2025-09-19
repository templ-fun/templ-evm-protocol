const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("executeProposal reverts", function () {
  let templ;
  let token;
  let owner;
  let priest;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest] = accounts;
  });

  it("reverts for proposal ID >= proposalCount", async function () {
    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
  });

  it("rejects invalid update fee at creation", async function () {
    await mintToUsers(token, [owner], ENTRY_FEE);
    await purchaseAccess(templ, token, [owner]);
    await expect(
      templ.connect(owner).createProposalUpdateConfig(5, 7 * 24 * 60 * 60)
    ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");
  });

  it("reverts when executing before quorum is reached", async function () {
    const [, , member1, member2, member3, member4] = accounts;
    await mintToUsers(token, [member1, member2, member3, member4], ENTRY_FEE * 5n);
    await purchaseAccess(templ, token, [member1, member2, member3, member4]);

    await templ
      .connect(member1)
      .createProposalSetPaused(false, 7 * 24 * 60 * 60);

    await expect(templ.executeProposal(0))
      .to.be.revertedWithCustomError(templ, "QuorumNotReached");
  });

  it("reverts with InvalidCallData when proposal action is undefined", async function () {
    const signers = await ethers.getSigners();
    const [, priestSigner, member1, member2] = signers;

    const Token = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const harnessToken = await Token.deploy("Harness", "HRN", 18);
    await harnessToken.waitForDeployment();

    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const harness = await Harness.deploy(
      priestSigner.address,
      priestSigner.address,
      harnessToken.target,
      ENTRY_FEE
    );
    await harness.waitForDeployment();

    await mintToUsers(harnessToken, [member1, member2], ENTRY_FEE * 5n);
    await purchaseAccess(harness, harnessToken, [member1, member2]);

    await harness
      .connect(member1)
      .createProposalSetPaused(true, 7 * 24 * 60 * 60);
    await harness.setUndefinedAction(0);

    const delay = Number(await harness.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(harness.executeProposal(0))
      .to.be.revertedWithCustomError(harness, "InvalidCallData");
  });

});
