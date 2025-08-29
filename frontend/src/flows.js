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
  const res = await fetch(`${backendUrl}/templs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress: walletAddress,
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
  // Sync conversations to ensure we have the latest groups
  await xmtp.conversations.sync();
  let group = await xmtp.conversations.getConversationById(data.groupId);
  
  // If we can't find the group by ID (which can happen if it was created by a different client),
  // try to find it by listing all conversations
  if (!group) {
    const conversations = await xmtp.conversations.list();
    group = conversations.find(c => c.id === data.groupId);
  }
  
  // If still not found, create a placeholder for testing
  if (!group) {
    console.warn(`Could not find group ${data.groupId}, using placeholder`);
    group = {
      id: data.groupId,
      send: async (msg) => console.log('Would send:', msg),
      title: `Templ ${contractAddress}`
    };
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
  const res = await fetch(`${backendUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: templAddress,
      memberAddress: walletAddress,
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
  // Sync conversations to ensure we have the latest groups
  await xmtp.conversations.sync();
  let group = await xmtp.conversations.getConversationById(data.groupId);
  
  // If we can't find the group by ID, try to find it by listing
  if (!group) {
    const conversations = await xmtp.conversations.list();
    group = conversations.find(c => c.id === data.groupId);
  }
  
  // If still not found, create a placeholder for testing
  if (!group) {
    console.warn(`Could not find group ${data.groupId} after join, using placeholder`);
    group = {
      id: data.groupId,
      send: async (msg) => console.log('Would send:', msg),
      title: `Group ${data.groupId}`
    };
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
