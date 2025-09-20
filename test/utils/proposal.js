const { ethers } = require("hardhat");

const IF_SET_PAUSED = new ethers.Interface(["function setPausedDAO(bool)"]);
const IF_WT = new ethers.Interface(["function withdrawTreasuryDAO(address,address,uint256,string)"]);
const IF_UC = new ethers.Interface([
  "function updateConfigDAO(address,uint256,bool,uint256,uint256,uint256)"
]);
const IF_DISBAND = new ethers.Interface(["function disbandTreasuryDAO(address)"]);
const IF_DISBAND_LEGACY = new ethers.Interface(["function disbandTreasuryDAO()"]);

async function createProposal({ templ, signer, title, description, callData, votingPeriod }) {
  const conn = templ.connect(signer);
  try {
    const [paused] = IF_SET_PAUSED.decodeFunctionData("setPausedDAO", callData);
    const tx = await conn.createProposalSetPaused(paused, votingPeriod);
    return await tx.wait();
  } catch {}
  try {
    const [token, recipient, amount, reason] = IF_WT.decodeFunctionData("withdrawTreasuryDAO", callData);
    const tx = await conn.createProposalWithdrawTreasury(token, recipient, amount, reason, votingPeriod);
    return await tx.wait();
  } catch {}
  try {
    const [, newFee, updateSplit, burnBP, treasuryBP, memberPoolBP] =
      IF_UC.decodeFunctionData("updateConfigDAO", callData);
    const tx = await conn.createProposalUpdateConfig(
      newFee,
      burnBP,
      treasuryBP,
      memberPoolBP,
      updateSplit,
      votingPeriod
    );
    return await tx.wait();
  } catch {}
  try {
    const [token] = IF_DISBAND.decodeFunctionData("disbandTreasuryDAO", callData);
    const tx = await conn.createProposalDisbandTreasury(token, votingPeriod);
    return await tx.wait();
  } catch {}
  try {
    IF_DISBAND_LEGACY.decodeFunctionData("disbandTreasuryDAO", callData);
    const accessToken = await templ.accessToken();
    const tx = await conn.createProposalDisbandTreasury(accessToken, votingPeriod);
    return await tx.wait();
  } catch {}
  throw new Error("Unsupported callData for createProposal adapter");
}

module.exports = { createProposal };
module.exports.attachCreateProposalCompat = function(templ) {
  const origConnect = templ.connect.bind(templ);
  templ.connect = (signer) => {
    const instance = origConnect(signer);
    instance.createProposal = (title, description, callData, votingPeriod) =>
      createProposal({ templ, signer, title, description, callData, votingPeriod });
    return instance;
  };
  return templ;
};
