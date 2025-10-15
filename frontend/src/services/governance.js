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
  txOptions = {},
  title,
  description
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const lowerAddress = String(templAddress || '').toLowerCase();
  const proposalTitle = typeof title === 'string' && title.trim().length ? title.trim() : 'Untitled Proposal';
  const proposalDescription = typeof description === 'string' ? description : '';
  const overrides = txOptions && Object.keys(txOptions).length ? txOptions : undefined;
  const withOverrides = async (methodName, args) => {
    if (overrides) {
      return await contract[methodName](...args, overrides);
    }
    return await contract[methodName](...args);
  };
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
        tx = await withOverrides('createProposalSetJoinPaused', [!!p.paused, votingPeriod, proposalTitle, proposalDescription]); break;
      case 'withdrawTreasury':
        tx = await withOverrides('createProposalWithdrawTreasury', [p.token, p.recipient, p.amount, p.reason || '', votingPeriod, proposalTitle, proposalDescription]); break;
      case 'changePriest':
        tx = await withOverrides('createProposalChangePriest', [p.newPriest, votingPeriod, proposalTitle, proposalDescription]); break;
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
        tx = await withOverrides('createProposalUpdateConfig', [
          feeBigInt,
          newBurn,
          newTreasury,
          newMember,
          updateSplit,
          votingPeriod,
          proposalTitle,
          proposalDescription
        ]);
        break;
      }
      case 'setMaxMembers': {
        const rawLimit = p.newMaxMembers ?? p.maxMembers ?? p.limit ?? p.value ?? 0;
        let limitBigInt = 0n;
        try { limitBigInt = BigInt(rawLimit); } catch { throw new Error('Invalid max member limit'); }
        if (limitBigInt < 0n) throw new Error('Max member limit must be non-negative');
        tx = await withOverrides('createProposalSetMaxMembers', [limitBigInt, votingPeriod, proposalTitle, proposalDescription]);
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
        tx = await withOverrides('createProposalDisbandTreasury', [tokenAddr, votingPeriod, proposalTitle, proposalDescription]);
        break;
      }
      case 'setDictatorship':
        tx = await withOverrides('createProposalSetDictatorship', [!!p.enable, votingPeriod, proposalTitle, proposalDescription]);
        break;
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
      if (fn?.name === 'setJoinPausedDAO') {
        const [paused] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalSetJoinPaused', [paused, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'withdrawTreasuryDAO' && fn.inputs.length === 4) {
        const [token, recipient, amount, reason] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalWithdrawTreasury', [token, recipient, amount, reason, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'changePriestDAO' && fn.inputs.length === 1) {
        const [newPriest] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalChangePriest', [newPriest, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'updateConfigDAO' && fn.inputs.length === 6) {
        const [, newEntryFee, updateSplit, burnPercentValue, treasuryPercentValue, memberPoolPercentValue] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalUpdateConfig', [
          newEntryFee,
          burnPercentValue,
          treasuryPercentValue,
          memberPoolPercentValue,
          updateSplit,
          votingPeriod,
          proposalTitle,
          proposalDescription
        ]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setMaxMembersDAO' && fn.inputs.length === 1) {
        const [limit] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalSetMaxMembers', [limit, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setDictatorshipDAO' && fn.inputs.length === 1) {
        const [enable] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalSetDictatorship', [enable, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setTemplHomeLinkDAO' && fn.inputs.length === 1) {
        const [link] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalSetHomeLink', [link, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setEntryFeeCurveDAO' && fn.inputs.length === 2) {
        const [curve, baseFee] = full.decodeFunctionData(fn, callData);
        const tx = await withOverrides('createProposalSetEntryFeeCurve', [curve, baseFee, votingPeriod, proposalTitle, proposalDescription]);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'disbandTreasuryDAO') {
        if (fn.inputs.length === 1) {
          const [token] = full.decodeFunctionData(fn, callData);
          const tx = await withOverrides('createProposalDisbandTreasury', [token, votingPeriod, proposalTitle, proposalDescription]);
          return await waitForProposal(tx);
        }
        if (fn.inputs.length === 0) {
          const token = await contract.accessToken();
          const tx = await withOverrides('createProposalDisbandTreasury', [token, votingPeriod, proposalTitle, proposalDescription]);
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
  try {
    const tx = await contract.vote(proposalId, support, txOptions);
    await tx.wait();
  } catch (err) {
    const message = String(
      err?.error?.message || err?.reason || err?.shortMessage || err?.message || err
    );
    if (
      message.includes('VotingEnded') ||
      message.includes('DictatorshipEnabled') ||
      message.includes('DictatorshipUnchanged')
    ) {
      return;
    }
    throw err;
  }
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
  const proposalHandler = (id, proposer, endTime, title, description) => {
    onProposal({
      id: Number(id),
      proposer,
      endTime: Number(endTime),
      title,
      description
    });
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
