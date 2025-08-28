import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/xmtp-js';
import templArtifact from './contracts/TEMPL.json';
import './App.css';

function App() {
  const [walletAddress, setWalletAddress] = useState();
  const [signer, setSigner] = useState();
  const [xmtp, setXmtp] = useState();
  const [group, setGroup] = useState();
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');

  // deployment form
  const [tokenAddress, setTokenAddress] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [priestVoteWeight, setPriestVoteWeight] = useState('1');
  const [priestWeightThreshold, setPriestWeightThreshold] = useState('1');

  // joining form
  const [templAddress, setTemplAddress] = useState('');
  const [groupId, setGroupId] = useState('');

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    setWalletAddress(await signer.getAddress());
    const client = await Client.create(signer, { env: 'production' });
    setXmtp(client);
  }

  async function deployTempl() {
    if (!signer || !xmtp) return;
    const factory = new ethers.ContractFactory(
      templArtifact.abi,
      templArtifact.bytecode,
      signer
    );
    const contract = await factory.deploy(
      walletAddress,
      walletAddress,
      tokenAddress,
      BigInt(entryFee),
      BigInt(priestVoteWeight),
      BigInt(priestWeightThreshold)
    );
    await contract.waitForDeployment();
    const deployedAddress = await contract.getAddress();
    setTemplAddress(deployedAddress);
    const newGroup = await xmtp.conversations.newGroup([], {
      title: `Templ ${deployedAddress}`,
      description: 'Private TEMPL group'
    });
    setGroup(newGroup);
    setGroupId(newGroup.id);
  }

  async function purchaseAndJoin() {
    if (!signer || !xmtp || !templAddress || !groupId) return;
    const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
    const purchased = await contract.hasPurchased(walletAddress);
    if (!purchased) {
      const tx = await contract.purchaseAccess();
      await tx.wait();
    }
    const check = await contract.hasPurchased(walletAddress);
    if (check) {
      const grp = await xmtp.conversations.getGroup(groupId);
      setGroup(grp);
    }
  }

  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    const stream = async () => {
      for await (const msg of await group.streamMessages()) {
        if (cancelled) break;
        setMessages((m) => [...m, msg]);
      }
    };
    stream();
    return () => {
      cancelled = true;
    };
  }, [group]);

  async function sendMessage() {
    if (!group || !messageInput) return;
    await group.send(messageInput);
    setMessageInput('');
  }

  return (
    <div className="App">
      {!walletAddress && (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}

      {walletAddress && !group && (
        <div className="forms">
          <div className="deploy">
            <h2>Create Templ</h2>
            <input
              placeholder="Token address"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
            />
            <input
              placeholder="Entry fee"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
            />
            <input
              placeholder="Priest vote weight"
              value={priestVoteWeight}
              onChange={(e) => setPriestVoteWeight(e.target.value)}
            />
            <input
              placeholder="Priest weight threshold"
              value={priestWeightThreshold}
              onChange={(e) => setPriestWeightThreshold(e.target.value)}
            />
            <button onClick={deployTempl}>Deploy</button>
            {templAddress && (
              <div>
                <p>Contract: {templAddress}</p>
                <p>Group ID: {groupId}</p>
              </div>
            )}
          </div>
          <div className="join">
            <h2>Join Existing Templ</h2>
            <input
              placeholder="Contract address"
              value={templAddress}
              onChange={(e) => setTemplAddress(e.target.value)}
            />
            <input
              placeholder="Group ID"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            />
            <button onClick={purchaseAndJoin}>Purchase & Join</button>
          </div>
        </div>
      )}

      {group && (
        <div className="chat">
          <h2>Group Chat</h2>
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i}>
                <strong>{m.senderAddress}:</strong> {m.content}
              </div>
            ))}
          </div>
          <input
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      )}
    </div>
  );
}

export default App;
