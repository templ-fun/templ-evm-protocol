// @ts-check

function extractProposalIdFromReceipt(receipt, ethersLib, templArtifact, templAddress) {
  try {
    const abi = templArtifact?.abi;
    if (!abi || !ethersLib?.Interface || !receipt) return null;
    const iface = new ethersLib.Interface(abi);
    const target = templAddress ? String(templAddress).toLowerCase() : null;
    for (const log of receipt.logs || []) {
      try {
        if (target && String(log?.address || '').toLowerCase() !== target) continue;
        const parsed = iface.parseLog({ topics: Array.from(log?.topics || []), data: log?.data || '0x' });
        if (parsed?.name === 'ProposalCreated') {
          const rawId = parsed.args?.proposalId ?? parsed.args?.[0];
          if (rawId === undefined || rawId === null) return null;
          if (typeof rawId === 'number') return rawId;
          if (typeof rawId === 'bigint') return Number(rawId);
          const asNum = Number(rawId);
          return Number.isNaN(asNum) ? null : asNum;
        }
      } catch {
        /* ignore individual log parse failures */
      }
    }
  } catch {/* ignore */}
  return null;
}

/**
 * @param {import('../flows.types').ProposeVoteArgs} options
 */
export async function proposeVote({
  ethers,
  signer,
  templAddress,
  templArtifact,
  action,
  params = {},
  callData,
  votingPeriod = 0,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const lowerAddress = String(templAddress || '').toLowerCase();
  const waitForProposal = async (tx) => {
    const receipt = await tx.wait();
    const proposalId = extractProposalIdFromReceipt(receipt, ethers, templArtifact, lowerAddress);
    return { receipt, proposalId };
  };
  if (action) {
    /** @type {Record<string, any>} */
    const p = params || {};
    let tx;
    switch (action) {
      case 'setPaused':
        tx = await contract.createProposalSetPaused(!!p.paused, votingPeriod, txOptions); break;
      case 'withdrawTreasury':
        tx = await contract.createProposalWithdrawTreasury(p.token, p.recipient, p.amount, p.reason || '', votingPeriod, txOptions); break;
      case 'changePriest':
        tx = await contract.createProposalChangePriest(p.newPriest, votingPeriod, txOptions); break;
      case 'updateConfig': {
        const rawFee = p.newEntryFee ?? 0;
        let feeBigInt = 0n;
        try { feeBigInt = rawFee ? BigInt(rawFee) : 0n; } catch {}
        const newBurn = p.newBurnPercent ?? 0;
        const newTreasury = p.newTreasuryPercent ?? 0;
        const newMember = p.newMemberPoolPercent ?? 0;
        const updateSplit = p.updateFeeSplit !== undefined
          ? !!p.updateFeeSplit
          : (newBurn !== 0 || newTreasury !== 0 || newMember !== 0);
        tx = await contract.createProposalUpdateConfig(
          feeBigInt,
          newBurn,
          newTreasury,
          newMember,
          updateSplit,
          votingPeriod,
          txOptions
        );
        break;
      }
      case 'disbandTreasury': {
        let tokenAddr;
        const provided = String(p.token ?? '').trim();
        if (!provided) {
          tokenAddr = await contract.accessToken();
        } else if (provided.toLowerCase() === 'eth') {
          tokenAddr = ethers.ZeroAddress;
        } else {
          if (!ethers.isAddress(provided)) {
            throw new Error('Invalid disband token address');
          }
          tokenAddr = provided;
        }
        tx = await contract.createProposalDisbandTreasury(tokenAddr, votingPeriod, txOptions);
        break;
      }
      default:
        throw new Error('Unknown action: ' + action);
    }
    return await waitForProposal(tx);
  }
  if (callData) {
    const hasInterface = !!(ethers && typeof ethers.Interface === 'function');
    const fallbackCreate = () => { throw new Error('Unsupported callData'); };
    if (!hasInterface) {
      return fallbackCreate();
    }
    try {
      const sig = callData.slice(0, 10).toLowerCase();
      const full = new ethers.Interface(templArtifact.abi);
      const fn = full.getFunction(sig);
      if (fn?.name === 'setPausedDAO') {
        const [paused] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetPaused(paused, votingPeriod, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'withdrawTreasuryDAO' && fn.inputs.length === 4) {
        const [token, recipient, amount, reason] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalWithdrawTreasury(token, recipient, amount, reason, votingPeriod, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'changePriestDAO' && fn.inputs.length === 1) {
        const [newPriest] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalChangePriest(newPriest, votingPeriod, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'updateConfigDAO' && fn.inputs.length === 6) {
        const [, newEntryFee, updateSplit, burnPercentValue, treasuryPercentValue, memberPoolPercentValue] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalUpdateConfig(
          newEntryFee,
          burnPercentValue,
          treasuryPercentValue,
          memberPoolPercentValue,
          updateSplit,
          votingPeriod,
          txOptions
        );
        return await waitForProposal(tx);
      }
      if (fn?.name === 'disbandTreasuryDAO') {
        if (fn.inputs.length === 1) {
          const [token] = full.decodeFunctionData(fn, callData);
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, txOptions);
          return await waitForProposal(tx);
        }
        if (fn.inputs.length === 0) {
          const token = await contract.accessToken();
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, txOptions);
          return await waitForProposal(tx);
        }
      }
      return fallbackCreate();
    } catch {
      return fallbackCreate();
    }
  }
  throw new Error('proposeVote: provide either action or callData');
}

export async function voteOnProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId,
  support,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.vote(proposalId, support, txOptions);
  await tx.wait();
}

export async function executeProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId,
  txOptions = {}
}) {
  if (!ethers || !signer || !templAddress || !templArtifact) {
    throw new Error('Missing required executeProposal parameters');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  try {
    const tx = await contract.executeProposal(proposalId, txOptions);
    return await tx.wait();
  } catch (err) {
    throw new Error(err?.reason || err?.message || String(err));
  }
}

export function watchProposals({ ethers, provider, templAddress, templArtifact, onProposal, onVote }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, provider);
  const proposalHandler = (id, proposer, endTime) => {
    onProposal({ id: Number(id), proposer, endTime: Number(endTime) });
  };
  const voteHandler = (id, voter, support, timestamp) => {
    onVote({ id: Number(id), voter, support: Boolean(support), timestamp: Number(timestamp) });
  };
  contract.on('ProposalCreated', proposalHandler);
  contract.on('VoteCast', voteHandler);
  return () => {
    contract.off('ProposalCreated', proposalHandler);
    contract.off('VoteCast', voteHandler);
  };
}
