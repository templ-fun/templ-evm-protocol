const { ethers } = require("hardhat");

function encodeSetJoinPausedDAO(paused) {
  const iface = new ethers.Interface(["function setJoinPausedDAO(bool)"]);
  return iface.encodeFunctionData("setJoinPausedDAO", [paused]);
}

function encodeWithdrawTreasuryDAO(token, recipient, amount) {
  const iface = new ethers.Interface([
    "function withdrawTreasuryDAO(address,address,uint256)"
  ]);
  return iface.encodeFunctionData("withdrawTreasuryDAO", [token, recipient, amount]);
}

//

function encodeUpdateConfigDAO(entryFee, updateSplit, burnBps, treasuryBps, memberPoolBps) {
  const iface = new ethers.Interface([
  "function updateConfigDAO(uint256,bool,uint256,uint256,uint256)"
  ]);
  return iface.encodeFunctionData("updateConfigDAO", [
    entryFee,
    updateSplit,
    burnBps,
    treasuryBps,
    memberPoolBps
  ]);
}

function encodeSetMaxMembersDAO(limit) {
  const iface = new ethers.Interface(["function setMaxMembersDAO(uint256)"]);
  return iface.encodeFunctionData("setMaxMembersDAO", [limit]);
}

function encodeSetTemplMetadataDAO(name, description, logoLink) {
  const iface = new ethers.Interface([
    "function setTemplMetadataDAO(string,string,string)"
  ]);
  return iface.encodeFunctionData("setTemplMetadataDAO", [name, description, logoLink]);
}

function encodeSetProposalCreationFeeBpsDAO(feeBps) {
  const iface = new ethers.Interface([
    "function setProposalCreationFeeBpsDAO(uint256)"
  ]);
  return iface.encodeFunctionData("setProposalCreationFeeBpsDAO", [feeBps]);
}

function encodeSetReferralShareBpsDAO(referralBps) {
  const iface = new ethers.Interface([
    "function setReferralShareBpsDAO(uint256)"
  ]);
  return iface.encodeFunctionData("setReferralShareBpsDAO", [referralBps]);
}

function encodeSetEntryFeeCurveDAO(curve, baseEntryFee) {
  const iface = new ethers.Interface([
    "function setEntryFeeCurveDAO((uint8,uint32),uint256)"
  ]);
  return iface.encodeFunctionData("setEntryFeeCurveDAO", [curve, baseEntryFee]);
}

module.exports = {
  encodeSetJoinPausedDAO,
  encodeWithdrawTreasuryDAO,
  encodeUpdateConfigDAO,
  encodeSetMaxMembersDAO,
  encodeSetTemplMetadataDAO,
  encodeSetProposalCreationFeeBpsDAO,
  encodeSetReferralShareBpsDAO,
  encodeSetEntryFeeCurveDAO,
};
