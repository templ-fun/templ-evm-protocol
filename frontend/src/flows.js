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
  
  // If XMTP isn’t ready yet on the client, skip fetching the group for now.
  if (!xmtp) {
    return { contractAddress, group: null, groupId: data.groupId };
  }
  
  // Multiple sync attempts to ensure we get the group
  console.log('Syncing conversations to find group', data.groupId);
  
  // Try syncing multiple times with a small delay
  let group = null;
  for (let i = 0; i < 3; i++) {
    await xmtp.conversations.sync();
    try {
      group = await xmtp.conversations.getConversationById(data.groupId);
    } catch (err) {
      console.log('getConversationById failed:', err.message);
    }
    if (!group) {
      const conversations = await xmtp.conversations.list();
      console.log(`Sync attempt ${i + 1}: Found ${conversations.length} conversations`);
      group = conversations.find(c => c.id === data.groupId);
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
    return { contractAddress, group: null, groupId: data.groupId };
  }
  return { contractAddress, group, groupId: data.groupId };
}

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
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const purchased = await contract.hasPurchased(walletAddress);
  if (!purchased) {
    const tx = await contract.purchaseAccess(txOptions);
    await tx.wait();
  }
  const message = `join:${templAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  
  // Get the member's inbox ID from XMTP client
  const memberInboxId = xmtp.inboxId;
  
  const res = await fetch(`${backendUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: templAddress,
      memberAddress: walletAddress,
      memberInboxId,  // Pass inbox ID so backend can add member to group
      signature
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Join failed: ${res.status} ${res.statusText} ${body}`.trim()
    );
  }
  const data = await res.json();
  // Try multiple sync attempts — joins can be eventually consistent
  let group = null;
  for (let i = 0; i < 5; i++) {
    try {
      await xmtp.conversations.sync();
    } catch {}
    try {
      group = await xmtp.conversations.getConversationById(data.groupId);
    } catch {}
    if (!group) {
      try {
        const conversations = await xmtp.conversations.list();
        group = conversations.find((c) => c.id === data.groupId) || null;
      } catch {}
    }
    if (group) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!group) throw new Error(`Could not find group ${data.groupId} after joining`);
  
  // Ensure consent is allowed if possible
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
  
  return { group, groupId: data.groupId };
}

export async function sendMessage({ group, content }) {
  await group.send(content);
}

export async function sendMessageBackend({ contractAddress, content, backendUrl = 'http://localhost:3001' }) {
  const res = await fetch(`${backendUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractAddress, content })
  });
  if (!res.ok) throw new Error('Server send failed');
  return true;
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
  return data.mutes;
}
