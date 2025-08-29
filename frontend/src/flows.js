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
  backendUrl = 'http://localhost:3001'
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
    BigInt(priestWeightThreshold)
  );
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const message = `create:${contractAddress.toLowerCase()}`;
  const signature = await signer.signMessage(message);
  
  // Get the priest's inbox ID from XMTP client
  const priestInboxId = xmtp.inboxId;
  console.log('Priest XMTP client:', {
    inboxId: priestInboxId,
    address: xmtp.address,
    env: xmtp.env
  });
  
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
  
  // Multiple sync attempts to ensure we get the group
  console.log('Syncing conversations to find group', data.groupId);
  
  // Try syncing multiple times with a small delay
  let group = null;
  for (let i = 0; i < 3; i++) {
    // Use sync() - syncAll() doesn't exist in Node SDK
    await xmtp.conversations.sync();
    
    // Try to get the conversation by ID
    try {
      group = await xmtp.conversations.getConversationById(data.groupId);
    } catch (err) {
      console.log('getConversationById failed:', err.message);
    }
    
    if (!group) {
      // List all conversations including all consent states
      const conversations = await xmtp.conversations.list();
      console.log(`Sync attempt ${i + 1}: Found ${conversations.length} conversations`);
      group = conversations.find(c => c.id === data.groupId);
    }
    
    if (group) {
      console.log('Found group:', group.id, 'consent state:', group.consentState);
      // Ensure the group is allowed
      if (group.consentState !== 'allowed') {
        console.log('Updating consent state to allowed');
        await group.updateConsentState('allowed');
      }
      break;
    }
    
    // Wait a bit before next sync attempt
    if (i < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (!group) {
    // Log available conversations for debugging
    const conversations = await xmtp.conversations.list();
    console.error('Available conversations after multiple syncs:', conversations.map(c => ({ id: c.id, name: c.name })));
    console.error('Looking for group ID:', data.groupId);
    console.error('Priest inbox ID:', xmtp.inboxId);
    throw new Error(`Could not find group ${data.groupId} after creation`);
  }
  
  return { contractAddress, group, groupId: data.groupId };
}

export async function purchaseAndJoin({ ethers, xmtp, signer, walletAddress, templAddress, templArtifact, backendUrl = 'http://localhost:3001' }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const purchased = await contract.hasPurchased(walletAddress);
  if (!purchased) {
    const tx = await contract.purchaseAccess();
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
  // Use sync to discover the group we just joined
  await xmtp.conversations.sync();
  
  // Try to get the conversation
  let group = await xmtp.conversations.getConversationById(data.groupId);
  
  if (!group) {
    // Try listing all conversations
    const conversations = await xmtp.conversations.list();
    group = conversations.find(c => c.id === data.groupId);
  }
  
  if (!group) {
    throw new Error(`Could not find group ${data.groupId} after joining`);
  }
  
  // Ensure consent is allowed
  if (group.consentState !== 'allowed') {
    await group.updateConsentState('allowed');
  }
  
  return { group, groupId: data.groupId };
}

export async function sendMessage({ group, content }) {
  await group.send(content);
}

export async function proposeVote({
  ethers,
  signer,
  templAddress,
  templArtifact,
  title,
  description,
  callData,
  votingPeriod = 0
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.createProposal(title, description, callData, votingPeriod);
  await tx.wait();
}

export async function voteOnProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId,
  support
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.vote(proposalId, support);
  await tx.wait();
}

export async function executeProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.executeProposal(proposalId);
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
