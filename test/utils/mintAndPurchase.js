const mintToUsers = async (token, users, amount) => {
  const mintAmount = BigInt(amount);
  for (const user of users) {
    await token.mint(user.address, mintAmount);
  }
};

const purchaseAccess = async (templ, token, users, entryFee) => {
  const fee = entryFee !== undefined ? BigInt(entryFee) : await templ.entryFee();
  const templAddress = await templ.getAddress();
  for (const user of users) {
    if (await templ.hasAccess(user.address)) {
      continue;
    }
    await token.connect(user).approve(templAddress, fee);
    await templ.connect(user).purchaseAccess();
  }
};

module.exports = { mintToUsers, purchaseAccess };
