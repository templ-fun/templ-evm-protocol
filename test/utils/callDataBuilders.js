const { ethers } = require("hardhat");

function encodeSetPausedDAO(paused) {
  const iface = new ethers.Interface(["function setPausedDAO(bool)"]);
  return iface.encodeFunctionData("setPausedDAO", [paused]);
}

function encodeWithdrawTreasuryDAO(recipient, amount, reason) {
  const iface = new ethers.Interface([
    "function withdrawTreasuryDAO(address,uint256,string)"
  ]);
  return iface.encodeFunctionData("withdrawTreasuryDAO", [recipient, amount, reason]);
}

function encodeWithdrawAllTreasuryDAO(recipient, reason) {
  const iface = new ethers.Interface([
    "function withdrawAllTreasuryDAO(address,string)"
  ]);
  return iface.encodeFunctionData("withdrawAllTreasuryDAO", [recipient, reason]);
}

function encodeUpdateConfigDAO(token, entryFee) {
  const iface = new ethers.Interface([
    "function updateConfigDAO(address,uint256)"
  ]);
  return iface.encodeFunctionData("updateConfigDAO", [token, entryFee]);
}

function encodePurchaseAccess() {
  const iface = new ethers.Interface(["function purchaseAccess()"]);
  return iface.encodeFunctionData("purchaseAccess", []);
}

module.exports = {
  encodeSetPausedDAO,
  encodeWithdrawTreasuryDAO,
  encodeWithdrawAllTreasuryDAO,
  encodeUpdateConfigDAO,
  encodePurchaseAccess,
};
