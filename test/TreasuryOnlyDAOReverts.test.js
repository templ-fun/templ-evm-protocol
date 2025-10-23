const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl, STATIC_CURVE } = require("./utils/deploy");

describe("Treasury onlyDAO reverts per function", function () {
  it("EOA calls to DAO functions revert NotDAO when dictatorship is disabled", async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , eoa] = accounts;

    // Ensure dictatorship disabled
    expect(await templ.priestIsDictator()).to.equal(false);

    // Call every treasury DAO function directly from an EOA and expect NotDAO
    await expect(templ.connect(eoa).withdrawTreasuryDAO(await token.getAddress(), eoa.address, 1, "x"))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).updateConfigDAO(ethers.ZeroAddress, 0, false, 0, 0, 0))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setJoinPausedDAO(true))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setMaxMembersDAO(10))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).disbandTreasuryDAO(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).changePriestDAO(eoa.address))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setDictatorshipDAO(true))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setTemplMetadataDAO("A", "B", "C"))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setProposalCreationFeeBpsDAO(500))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setReferralShareBpsDAO(1200))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setEntryFeeCurveDAO(STATIC_CURVE, 0))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).cleanupExternalRewardToken(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setQuorumBpsDAO(40))
      .to.be.revertedWithCustomError(templ, "NotDAO");

  await expect(templ.connect(eoa).setPostQuorumVotingPeriodDAO(3600))
      .to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(templ.connect(eoa).setBurnAddressDAO("0x0000000000000000000000000000000000000002"))
      .to.be.revertedWithCustomError(templ, "NotDAO");
  });
});
