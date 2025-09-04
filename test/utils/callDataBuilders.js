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

function encodeWithdrawTokenDAO(token, recipient, amount, reason) {
  const iface = new ethers.Interface([
    "function withdrawTokenDAO(address,address,uint256,string)"
  ]);
  return iface.encodeFunctionData("withdrawTokenDAO", [token, recipient, amount, reason]);
}

function encodeWithdrawETHDAO(recipient, amount, reason) {
  const iface = new ethers.Interface([
    "function withdrawETHDAO(address,uint256,string)"
  ]);
  return iface.encodeFunctionData("withdrawETHDAO", [recipient, amount, reason]);
}

function encodeSweepMemberRewardRemainderDAO(recipient) {
  const iface = new ethers.Interface([
    "function sweepMemberRewardRemainderDAO(address)"
  ]);
  return iface.encodeFunctionData("sweepMemberRewardRemainderDAO", [recipient]);
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
  encodeWithdrawTokenDAO,
  encodeWithdrawETHDAO,
  encodeSweepMemberRewardRemainderDAO,
  encodeUpdateConfigDAO,
  encodePurchaseAccess,
};
