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

export async function proposeVote({
  ethers,
  signer,
  templAddress,
  templArtifact,
  action,
  params = {},
  callData,
  votingPeriod = 0,
  title,
  description,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const lowerAddress = String(templAddress || '').toLowerCase();
  const proposalTitle = String(title || '').trim();
  const proposalDescription = String(description || '').trim();
  if (!proposalTitle) {
    throw new Error('Proposal title is required');
  }
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
        tx = await contract.createProposalSetPaused(!!p.paused, votingPeriod, proposalTitle, proposalDescription, txOptions); break;
      case 'withdrawTreasury':
        tx = await contract.createProposalWithdrawTreasury(p.token, p.recipient, p.amount, p.reason || '', votingPeriod, proposalTitle, proposalDescription, txOptions); break;
      case 'changePriest':
        tx = await contract.createProposalChangePriest(p.newPriest, votingPeriod, proposalTitle, proposalDescription, txOptions); break;
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
          proposalTitle,
          proposalDescription,
          txOptions
        );
        break;
      }
      case 'setMaxMembers': {
        const rawLimit = p.newMaxMembers ?? p.maxMembers ?? p.limit ?? p.value ?? 0;
        let limitBigInt = 0n;
        try { limitBigInt = BigInt(rawLimit); } catch { throw new Error('Invalid max member limit'); }
        if (limitBigInt < 0n) throw new Error('Max member limit must be non-negative');
        tx = await contract.createProposalSetMaxMembers(limitBigInt, votingPeriod, proposalTitle, proposalDescription, txOptions);
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
        tx = await contract.createProposalDisbandTreasury(tokenAddr, votingPeriod, proposalTitle, proposalDescription, txOptions);
        break;
      }
      case 'setDictatorship':
        tx = await contract.createProposalSetDictatorship(!!p.enable, votingPeriod, proposalTitle, proposalDescription, txOptions);
        break;
      case 'setHomeLink':
        tx = await contract.createProposalSetHomeLink(String(p.newHomeLink || ''), votingPeriod, proposalTitle, proposalDescription, txOptions);
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
      if (fn?.name === 'setPausedDAO') {
        const [paused] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetPaused(paused, votingPeriod, proposalTitle, proposalDescription, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'withdrawTreasuryDAO' && fn.inputs.length === 4) {
        const [token, recipient, amount, reason] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalWithdrawTreasury(token, recipient, amount, reason, votingPeriod, proposalTitle, proposalDescription, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'changePriestDAO' && fn.inputs.length === 1) {
        const [newPriest] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalChangePriest(newPriest, votingPeriod, proposalTitle, proposalDescription, txOptions);
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
          proposalTitle,
          proposalDescription,
          txOptions
        );
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setMaxMembersDAO' && fn.inputs.length === 1) {
        const [limit] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetMaxMembers(limit, votingPeriod, proposalTitle, proposalDescription, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setDictatorshipDAO' && fn.inputs.length === 1) {
        const [enable] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetDictatorship(enable, votingPeriod, proposalTitle, proposalDescription, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'setTemplHomeLinkDAO' && fn.inputs.length === 1) {
        const [link] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetHomeLink(link, votingPeriod, proposalTitle, proposalDescription, txOptions);
        return await waitForProposal(tx);
      }
      if (fn?.name === 'disbandTreasuryDAO') {
        if (fn.inputs.length === 1) {
          const [token] = full.decodeFunctionData(fn, callData);
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, proposalTitle, proposalDescription, txOptions);
          return await waitForProposal(tx);
        }
        if (fn.inputs.length === 0) {
          const token = await contract.accessToken();
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, proposalTitle, proposalDescription, txOptions);
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
    onProposal({ id: Number(id), proposer, endTime: Number(endTime), title: title || '', description: description || '' });
  };
  const voteHandler = async (id, voter, support, timestamp) => {
    let title = '';
    try {
      const meta = await contract.getProposal(id);
      title = meta?.title || '';
    } catch {/* ignore */}
    onVote({ id: Number(id), voter, support: Boolean(support), timestamp: Number(timestamp), title });
  };
  contract.on('ProposalCreated', proposalHandler);
  contract.on('VoteCast', voteHandler);
  return () => {
    contract.off('ProposalCreated', proposalHandler);
    contract.off('VoteCast', voteHandler);
  };
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value, fallback = '0') {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

export async function fetchGovernanceParameters({
  ethers,
  provider,
  templAddress,
  templArtifact
}) {
  if (!ethers || !provider || !templAddress || !templArtifact) {
    return null;
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, provider);
  try {
    const [defaultVotingPeriod, minVotingPeriod, maxVotingPeriod, quorumPercent, executionDelay] = await Promise.all([
      contract.DEFAULT_VOTING_PERIOD?.().catch(() => null),
      contract.MIN_VOTING_PERIOD?.().catch(() => null),
      contract.MAX_VOTING_PERIOD?.().catch(() => null),
      contract.quorumPercent?.().catch(() => null),
      contract.executionDelayAfterQuorum?.().catch(() => null)
    ]);
    return {
      defaultVotingPeriod: toNumber(defaultVotingPeriod, 7 * 24 * 60 * 60),
      minVotingPeriod: toNumber(minVotingPeriod, 7 * 24 * 60 * 60),
      maxVotingPeriod: toNumber(maxVotingPeriod, 30 * 24 * 60 * 60),
      quorumPercent: toNumber(quorumPercent, 0),
      executionDelay: toNumber(executionDelay, 0)
    };
  } catch (err) {
    console.warn('[templ] Failed to load governance parameters', err);
    return null;
  }
}

export async function fetchTemplProposals({
  ethers,
  provider,
  templAddress,
  templArtifact,
  voterAddress,
  limit = 50
}) {
  if (!ethers || !provider || !templAddress || !templArtifact) {
    return [];
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, provider);
  let count = 0;
  try {
    const rawCount = await contract.proposalCount();
    count = toNumber(rawCount, 0);
  } catch (err) {
    console.warn('[templ] Failed to read proposal count', err);
    return [];
  }
  if (count <= 0) {
    return [];
  }
  const max = Math.max(0, Math.min(count, limit));
  const ids = [];
  for (let i = count - 1; i >= 0 && ids.length < max; i--) {
    ids.push(i);
  }
  const voter = voterAddress ? String(voterAddress).toLowerCase() : '';
  const results = await Promise.all(ids.map(async (id) => {
    try {
      const [rawProposal, proposalView, voteInfo] = await Promise.all([
        contract.proposals(id),
        contract.getProposal(id).catch(() => null),
        voter ? contract.hasVoted(id, voter).catch(() => [false, false]) : [false, false]
      ]);
      const voted = Array.isArray(voteInfo) ? voteInfo[0] : voteInfo?.voted;
      const support = Array.isArray(voteInfo) ? voteInfo[1] : voteInfo?.support;
      const passed = proposalView?.passed ?? (Array.isArray(proposalView) ? proposalView[5] : false);
      return {
        id,
        proposer: rawProposal?.proposer || proposalView?.proposer || ethers.ZeroAddress,
        action: toNumber(rawProposal?.action, 8),
        token: rawProposal?.token || ethers.ZeroAddress,
        recipient: rawProposal?.recipient || ethers.ZeroAddress,
        amount: toStringValue(rawProposal?.amount),
        title: rawProposal?.title || proposalView?.title || '',
        description: rawProposal?.description || proposalView?.description || '',
        reason: rawProposal?.reason || '',
        paused: Boolean(rawProposal?.paused),
        newEntryFee: toStringValue(rawProposal?.newEntryFee),
        newBurnPercent: toNumber(rawProposal?.newBurnPercent),
        newTreasuryPercent: toNumber(rawProposal?.newTreasuryPercent),
        newMemberPoolPercent: toNumber(rawProposal?.newMemberPoolPercent),
        newHomeLink: rawProposal?.newHomeLink || '',
        newMaxMembers: toStringValue(rawProposal?.newMaxMembers),
        yesVotes: toNumber(rawProposal?.yesVotes),
        noVotes: toNumber(rawProposal?.noVotes),
        endTime: toNumber(rawProposal?.endTime),
        createdAt: toNumber(rawProposal?.createdAt),
        executed: Boolean(rawProposal?.executed),
        eligibleVoters: toNumber(rawProposal?.eligibleVoters),
        postQuorumEligibleVoters: toNumber(rawProposal?.postQuorumEligibleVoters),
        quorumReachedAt: toNumber(rawProposal?.quorumReachedAt),
        quorumSnapshotBlock: toNumber(rawProposal?.quorumSnapshotBlock),
        quorumExempt: Boolean(rawProposal?.quorumExempt),
        updateFeeSplit: Boolean(rawProposal?.updateFeeSplit),
        preQuorumSnapshotBlock: toNumber(rawProposal?.preQuorumSnapshotBlock),
        setDictatorship: Boolean(rawProposal?.setDictatorship),
        voted: Boolean(voted),
        support: Boolean(support),
        passed: Boolean(passed)
      };
    } catch (err) {
      console.warn('[templ] Failed to load proposal', id, err);
      return null;
    }
  }));
  return results.filter(Boolean);
}
