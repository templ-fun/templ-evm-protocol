const { ethers } = require("hardhat");

function encodeSetPausedDAO(paused) {
  const iface = new ethers.Interface(["function setPausedDAO(bool)"]);
  return iface.encodeFunctionData("setPausedDAO", [paused]);
}

function encodeWithdrawTreasuryDAO(token, recipient, amount, reason) {
  const iface = new ethers.Interface([
    "function withdrawTreasuryDAO(address,address,uint256,string)"
  ]);
  return iface.encodeFunctionData("withdrawTreasuryDAO", [token, recipient, amount, reason]);
}

// withdrawAll removed

function encodeUpdateConfigDAO(token, entryFee, updateSplit, burnBP, treasuryBP, memberPoolBP) {
  const iface = new ethers.Interface([
    "function updateConfigDAO(address,uint256,bool,uint256,uint256,uint256)"
  ]);
  return iface.encodeFunctionData("updateConfigDAO", [
    token,
    entryFee,
    updateSplit,
    burnBP,
    treasuryBP,
    memberPoolBP
  ]);
}

function encodePurchaseAccess() {
  const iface = new ethers.Interface(["function purchaseAccess()"]);
  return iface.encodeFunctionData("purchaseAccess", []);
}

module.exports = {
  encodeSetPausedDAO,
  encodeWithdrawTreasuryDAO,
  encodeUpdateConfigDAO,
  encodePurchaseAccess,
};
