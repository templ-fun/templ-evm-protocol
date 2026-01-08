const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("NFT custody and governance transfers", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const VOTING_PERIOD = 7 * DAY;

  it("blocks safeTransferFrom into templ and allows governance transferFrom out", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, nftOwner, recipient] = accounts;

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2]);

    const NFT = await ethers.getContractFactory("contracts/mocks/TestNFT.sol:TestNFT");
    const nft = await NFT.deploy("Test NFT", "TNFT");
    await nft.waitForDeployment();

    const tokenId = await nft.mint.staticCall(nftOwner.address);
    await nft.mint(nftOwner.address);

    const templAddress = await templ.getAddress();

    await expect(
      nft
        .connect(nftOwner)
        ["safeTransferFrom(address,address,uint256)"](nftOwner.address, templAddress, tokenId)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await nft.connect(nftOwner).transferFrom(nftOwner.address, templAddress, tokenId);
    expect(await nft.ownerOf(tokenId)).to.equal(templAddress);

    const selector = nft.interface.getFunction("transferFrom").selector;
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [templAddress, recipient.address, tokenId]
    );

    await templ
      .connect(member1)
      .createProposalCallExternal(
        await nft.getAddress(),
        0,
        selector,
        params,
        VOTING_PERIOD,
        "Move NFT",
        "Transfer NFT out of templ"
      );
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId))
      .to.emit(templ, "ProposalExecuted")
      .withArgs(proposalId, true, anyValue);

    expect(await nft.ownerOf(tokenId)).to.equal(recipient.address);
  });
});
