const { ethers } = require("hardhat");

function encodeSetJoinPausedDAO(paused) {
  const iface = new ethers.Interface(["function setJoinPausedDAO(bool)"]);
  return iface.encodeFunctionData("setJoinPausedDAO", [paused]);
}

function encodeWithdrawTreasuryDAO(token, recipient, amount, reason) {
  const iface = new ethers.Interface([
    "function withdrawTreasuryDAO(address,address,uint256,string)"
  ]);
  return iface.encodeFunctionData("withdrawTreasuryDAO", [token, recipient, amount, reason]);
}

// withdrawAll removed

function encodeUpdateConfigDAO(token, entryFee, updateSplit, burnPercent, treasuryPercent, memberPoolPercent) {
  const iface = new ethers.Interface([
    "function updateConfigDAO(address,uint256,bool,uint256,uint256,uint256)"
  ]);
  return iface.encodeFunctionData("updateConfigDAO", [
    token,
    entryFee,
    updateSplit,
    burnPercent,
    treasuryPercent,
    memberPoolPercent
  ]);
}

function encodeSetMaxMembersDAO(limit) {
  const iface = new ethers.Interface(["function setMaxMembersDAO(uint256)"]);
  return iface.encodeFunctionData("setMaxMembersDAO", [limit]);
}

module.exports = {
  encodeSetJoinPausedDAO,
  encodeWithdrawTreasuryDAO,
  encodeUpdateConfigDAO,
  encodeSetMaxMembersDAO,
};
