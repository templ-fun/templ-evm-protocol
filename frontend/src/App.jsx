import { useState } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/browser-sdk';
import CreateTempl from './pages/CreateTempl.jsx';
import JoinTempl from './pages/JoinTempl.jsx';
import Chat from './pages/Chat.jsx';
import './App.css';

function App() {
  const [walletAddress, setWalletAddress] = useState();
  const [signer, setSigner] = useState();
  const [xmtp, setXmtp] = useState();
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [view, setView] = useState('create');
  const [status, setStatus] = useState([]);

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    const address = await signer.getAddress();
    setWalletAddress(address);
    setStatus(['Wallet connected']);

    const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
    const xmtpEnv =
      forcedEnv ||
      (['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'dev'
        : 'production');

    const storageKey = `xmtp:nonce:${address.toLowerCase()}`;
    let stableNonce = 1;
    try {
      const saved = Number.parseInt(localStorage.getItem(storageKey) || '1', 10);
      if (Number.isFinite(saved) && saved > 0) stableNonce = saved;
    } catch {}
    const xmtpSigner = {
      type: 'EOA',
      getAddress: () => address,
      getIdentifier: () => ({
        identifier: address.toLowerCase(),
        identifierKind: 'Ethereum',
        nonce: stableNonce,
      }),
      signMessage: async (message) => {
        let toSign;
        if (message instanceof Uint8Array) {
          try {
            toSign = ethers.toUtf8String(message);
          } catch {
            toSign = ethers.hexlify(message);
          }
        } else if (typeof message === 'string') {
          toSign = message;
        } else {
          toSign = String(message);
        }
        const signature = await signer.signMessage(toSign);
        return ethers.getBytes(signature);
      },
    };

    const client = await Client.create(xmtpSigner, {
      env: xmtpEnv,
      appVersion: 'templ/0.1.0',
    });
    try {
      localStorage.setItem(storageKey, String(stableNonce));
    } catch {}
    setXmtp(client);
    setStatus((s) => [...s, 'Messaging client ready']);
  }

  function handleCreated(session) {
    const all = [...sessions, session];
    setSessions(all);
    setCurrentSession(session);
    setView('chat');
  }

  function handleJoined(session) {
    const all = [...sessions, session];
    setSessions(all);
    setCurrentSession(session);
    setView('chat');
  }

  return (
    <div>
      {!walletAddress && (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}
      <div className="status">{status.join(' ')}</div>
      <nav>
        <button onClick={() => setView('create')}>Create</button>
        <button onClick={() => setView('join')}>Join</button>
        {sessions.length > 0 && (
          <button onClick={() => setView('chat')}>Chat</button>
        )}
      </nav>
      {view === 'create' && (
        <CreateTempl
          walletAddress={walletAddress}
          signer={signer}
          xmtp={xmtp}
          onCreated={handleCreated}
          setStatus={setStatus}
        />
      )}
      {view === 'join' && (
        <JoinTempl
          walletAddress={walletAddress}
          signer={signer}
          xmtp={xmtp}
          onJoined={handleJoined}
          setStatus={setStatus}
        />
      )}
      {view === 'chat' && currentSession && (
        <div>
          {sessions.length > 1 && (
            <select
              value={currentSession.templAddress}
              onChange={(e) => {
                const sess = sessions.find(
                  (s) => s.templAddress === e.target.value
                );
                setCurrentSession(sess);
              }}
            >
              {sessions.map((s) => (
                <option key={s.templAddress} value={s.templAddress}>
                  {s.name || s.templAddress}
                </option>
              ))}
            </select>
          )}
          <Chat
            walletAddress={walletAddress}
            signer={signer}
            xmtp={xmtp}
            session={currentSession}
            setStatus={setStatus}
          />
        </div>
      )}
    </div>
  );
}

export default App;
// @ts-check
