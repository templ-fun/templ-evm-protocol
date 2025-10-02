const { ethers } = require("hardhat");

const mintToUsers = async (token, users, amount) => {
  const mintAmount = BigInt(amount);
  for (const user of users) {
    await token.mint(user.address, mintAmount);
  }
};

const joinMembers = async (templ, token, users) => {
  const templAddress = await templ.getAddress();
  for (const user of users) {
    if (await templ.isMember(user.address)) {
      continue;
    }
    await token.connect(user).approve(templAddress, ethers.MaxUint256);
    await templ.connect(user).join();
  }
};

module.exports = { mintToUsers, joinMembers };
