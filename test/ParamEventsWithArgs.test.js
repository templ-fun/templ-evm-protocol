const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Param update events withArgs", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  async function enableDictatorship(templ, token, member) {
    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);
    await templ.connect(member).createProposalSetDictatorship(true, 7 * DAY, "Enable", "");
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);
  }

  it("emits PostQuorumVotingPeriodUpdated and BurnAddressUpdated with exact args (onlyDAO)", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member] = accounts;
    await enableDictatorship(templ, token, member);

    const beforeDelay = await templ.postQuorumVotingPeriod();
    const newDelay = 5 * DAY;
    await expect(templ.connect(priest).setPostQuorumVotingPeriodDAO(newDelay))
      .to.emit(templ, "PostQuorumVotingPeriodUpdated")
      .withArgs(beforeDelay, BigInt(newDelay));

    const beforeBurn = await templ.burnAddress();
    const newBurn = ethers.getAddress("0x00000000000000000000000000000000000000ba");
    await expect(templ.connect(priest).setBurnAddressDAO(newBurn))
      .to.emit(templ, "BurnAddressUpdated")
      .withArgs(beforeBurn, newBurn);
  });
});
