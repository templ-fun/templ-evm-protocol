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
    const currentFee = await templ.entryFee();
    await token.connect(user).approve(templAddress, currentFee);
    await templ.connect(user).join();
  }
};

module.exports = { mintToUsers, joinMembers };
