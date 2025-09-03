/**
 * Deploy a new TEMPL contract and register a group with the backend.
 * @param {import('./flows.types').DeployRequest} params
 * @returns {Promise<import('./flows.types').DeployResponse>}
 */
export async function deployTempl({
  ethers,
  xmtp,
  signer,
  walletAddress,
  tokenAddress,
  protocolFeeRecipient,
  entryFee,
  priestVoteWeight = 10,
  priestWeightThreshold = 10,
  templArtifact,
  backendUrl = 'http://localhost:3001',
  txOptions = {}
}) {
  if (!ethers || !signer || !walletAddress || !tokenAddress || !protocolFeeRecipient || !templArtifact) {
    throw new Error('Missing required deployTempl parameters');
  }
  const factory = new ethers.ContractFactory(
    templArtifact.abi,
    templArtifact.bytecode,
    signer
  );
  const contract = await factory.deploy(
    walletAddress,
    protocolFeeRecipient,
    tokenAddress,
    BigInt(entryFee),
    BigInt(priestVoteWeight),
    BigInt(priestWeightThreshold),
    txOptions
  );
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const message = `create:${contractAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  
  // Get the priest's inbox ID from XMTP client if available
  const priestInboxId = xmtp?.inboxId;
  if (priestInboxId) {
    console.log('Priest XMTP client:', {
      inboxId: priestInboxId,
      address: xmtp.address,
      env: xmtp.env
    });
  } else {
    console.log('XMTP not ready at deploy; backend will derive inboxId');
  }
  
  const res = await fetch(`${backendUrl}/templs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress: walletAddress,
      priestInboxId,  // Pass inbox ID so backend can add priest to group
      signature
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim()
    );
  }
  const data = await res.json();
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /templs response: missing groupId');
  }
  const groupId = String(data.groupId).replace(/^0x/i, '');
  
  // If XMTP isn’t ready yet on the client, skip fetching the group for now.
  if (!xmtp) {
    return { contractAddress, group: null, groupId };
  }
  
  // Multiple sync attempts to ensure we get the group
  console.log('Syncing conversations to find group', groupId);
  
  // Try syncing multiple times with a small delay
  let group = null;
  for (let i = 0; i < 6; i++) {
    try { await xmtp.conversations?.sync?.(); } catch {}
    try { await xmtp.preferences?.sync?.(); } catch {}
    try { await xmtp.conversations.syncAll?.(['allowed','unknown','denied']); } catch {}
    try {
      group = await xmtp.conversations.getConversationById(groupId);
    } catch (err) {
      console.log('getConversationById failed:', err.message);
    }
    if (!group) {
      const conversations = await xmtp.conversations.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
      console.log(`Sync attempt ${i + 1}: Found ${conversations.length} conversations; firstIds=`, conversations.slice(0,3).map(c=>c.id));
      group = conversations.find(c => c.id === groupId);
    }
    if (group) {
      console.log('Found group:', group.id, 'consent state:', group.consentState);
      if (
        group.consentState !== 'allowed' &&
        typeof group.updateConsentState === 'function'
      ) {
        try {
          await group.updateConsentState('allowed');
        } catch (err) {
          console.log('updateConsentState failed:', err.message);
        }
      }
      break;
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!group) {
    console.error('Could not find group after creation; will rely on join step');
    return { contractAddress, group: null, groupId };
  }
  return { contractAddress, group, groupId };
}

/**
 * Purchase membership (if needed) and join the group via backend.
 * @param {import('./flows.types').JoinRequest} params
 * @returns {Promise<import('./flows.types').JoinResponse>}
 */
export async function purchaseAndJoin({
  ethers,
  xmtp,
  signer,
  walletAddress,
  templAddress,
  templArtifact,
  backendUrl = 'http://localhost:3001',
  txOptions = {}
}) {
  // Ensure the browser identity is registered and key package published
  try {
    await xmtp?.preferences?.inboxState?.(true);
    for (let i = 0; i < 10; i++) {
      try {
        const agg = await xmtp?.debugInformation?.apiAggregateStatistics?.();
        if (typeof agg === 'string' && /UploadKeyPackage\s+([0-9]+)/.test(agg)) {
          const m = agg.match(/UploadKeyPackage\s+(\d+)/);
          const uploads = m ? Number(m[1]) : 0;
          if (uploads >= 1) break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {}
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const purchased = await contract.hasPurchased(walletAddress);
  if (!purchased) {
    // Auto-approve entry fee if allowance is insufficient
    let tokenAddress;
    let entryFee;
    try {
      // Prefer a single call if available
      if (typeof contract.getConfig === 'function') {
        const cfg = await contract.getConfig();
        tokenAddress = cfg[0];
        entryFee = BigInt(cfg[1]);
      } else {
        tokenAddress = await contract.accessToken();
        entryFee = BigInt(await contract.entryFee());
      }
    } catch {
      // Fallback to explicit reads if getConfig unavailable
      tokenAddress = await contract.accessToken();
      entryFee = BigInt(await contract.entryFee());
    }
    const erc20 = new ethers.Contract(
      tokenAddress,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 value) returns (bool)'
      ],
      signer
    );
    try {
      const current = BigInt(await erc20.allowance(walletAddress, templAddress));
      if (current < entryFee) {
        const atx = await erc20.approve(templAddress, entryFee);
        await atx.wait();
      }
    } catch {}
    const tx = await contract.purchaseAccess(txOptions);
    await tx.wait();
  }
  const message = `join:${templAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  
  // Get the member's inbox ID from XMTP client if available (optional)
  const memberInboxId = xmtp?.inboxId;
  
  const res = await fetch(`${backendUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: templAddress,
      memberAddress: walletAddress,
      ...(memberInboxId ? { memberInboxId } : {}),
      signature
    })
  });
  // If identity not yet registered, poll until backend accepts the invite
  if (res.status === 503) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const again = await fetch(`${backendUrl}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: templAddress,
          memberAddress: walletAddress,
          ...(memberInboxId ? { memberInboxId } : {}),
          signature
        })
      });
      if (again.ok) {
        const data = await again.json();
        if (data && typeof data.groupId === 'string') {
          return await finalizeJoin({ xmtp, groupId: String(data.groupId).replace(/^0x/i, '') });
        }
      }
    }
    throw new Error('Join failed: identity not registered');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('purchaseAndJoin: /join failed', { status: res.status, statusText: res.statusText, body });
    throw new Error(`Join failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  const data = await res.json();
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /join response: missing groupId');
  }
  const groupId = String(data.groupId).replace(/^0x/i, '');
  console.log('purchaseAndJoin: backend returned groupId=', data.groupId);
  // Optional diagnostics: verify membership server-side when debug endpoints are enabled
  try {
    const dbg = await fetch(`${backendUrl}/debug/membership?contractAddress=${templAddress}&inboxId=${memberInboxId || ''}`).then(r => r.json());
    console.log('purchaseAndJoin: server membership snapshot', dbg);
  } catch {}
  return await finalizeJoin({ xmtp, groupId });
}

export async function sendMessage({ group, content }) {
  await group.send(content);
}

async function finalizeJoin({ xmtp, groupId }) {
  // Try multiple sync attempts — joins can be eventually consistent
  let group = null;
  for (let i = 0; i < 60; i++) {
    try { await xmtp.conversations?.sync?.(); } catch {}
    try { await xmtp.preferences?.sync?.(); } catch {}
    try { await xmtp.conversations.syncAll?.(['allowed','unknown','denied']); } catch {}
    try {
      group = await xmtp.conversations.getConversationById(groupId);
    } catch {}
    if (!group) {
      try {
        const conversations = await xmtp.conversations.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
        group = conversations.find((c) => c.id === groupId) || null;
      } catch {}
    }
    if (group) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!group) return { group: null, groupId };
  if (
    group.consentState !== 'allowed' &&
    typeof group.updateConsentState === 'function'
  ) {
    try { await group.updateConsentState('allowed'); } catch {}
  }
  return { group, groupId };
}

/**
 * Fallback: ask backend to post into the group conversation.
 * @returns {Promise<boolean>}
 */
export async function sendMessageBackend({ contractAddress, content, backendUrl = 'http://localhost:3001' }) {
  // Retries to ride out XMTP dev eventual consistency on the backend
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${backendUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractAddress, content })
    });
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error('Server send failed');
}

export async function proposeVote({
  ethers,
  signer,
  templAddress,
  templArtifact,
  title,
  description,
  callData,
  votingPeriod = 0,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.createProposal(
    title,
    description,
    callData,
    votingPeriod,
    txOptions
  );
  await tx.wait();
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
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.executeProposal(proposalId, txOptions);
  await tx.wait();
}

export function watchProposals({
  ethers,
  provider,
  templAddress,
  templArtifact,
  onProposal,
  onVote
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, provider);
  contract.on('ProposalCreated', (id, proposer, title, endTime) => {
    onProposal({ id: Number(id), proposer, title, endTime: Number(endTime) });
  });
  contract.on('VoteCast', (id, voter, support, timestamp) => {
    onVote({
      id: Number(id),
      voter,
      support: Boolean(support),
      timestamp: Number(timestamp)
    });
  });
  return contract;
}

export async function delegateMute({
  signer,
  contractAddress,
  priestAddress,
  delegateAddress,
  backendUrl = 'http://localhost:3001'
}) {
  const message = `delegate:${contractAddress.toLowerCase()}:${delegateAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  const res = await fetch(`${backendUrl}/delegates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress,
      delegateAddress,
      signature
    })
  });
  if (!res.ok) return false;
  const data = await res.json();
  if (!data || typeof data.delegated !== 'boolean') {
    throw new Error('Invalid /delegates response');
  }
  return data.delegated;
}

export async function muteMember({
  signer,
  contractAddress,
  moderatorAddress,
  targetAddress,
  backendUrl = 'http://localhost:3001'
}) {
  const message = `mute:${contractAddress.toLowerCase()}:${targetAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  const res = await fetch(`${backendUrl}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      moderatorAddress,
      targetAddress,
      signature
    })
  });
  if (!res.ok) return 0;
  const data = await res.json();
  if (!data || typeof data.mutedUntil !== 'number') {
    throw new Error('Invalid /mute response');
  }
  return data.mutedUntil;
}

export async function fetchActiveMutes({
  contractAddress,
  backendUrl = 'http://localhost:3001'
}) {
  const res = await fetch(
    `${backendUrl}/mutes?contractAddress=${contractAddress}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !Array.isArray(data.mutes)) {
    throw new Error('Invalid /mutes response');
  }
  return data.mutes;
}
// @ts-check
