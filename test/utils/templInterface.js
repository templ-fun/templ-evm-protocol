const { Interface } = require("ethers");

const templInterface = new Interface([
  "function setPausedDAO(bool)",
  "function withdrawTreasuryDAO(address,uint256,string)",
  "function withdrawAllTreasuryDAO(address,string)",
  "function updateConfigDAO(address,uint256)",
  "function withdrawTokenDAO(address,address,uint256,string)",
  "function withdrawETHDAO(address,uint256,string)",
  "function sweepMemberRewardRemainderDAO(address)",
  "function purchaseAccess()",
]);

module.exports = templInterface;
