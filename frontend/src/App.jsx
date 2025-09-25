import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import './App.css';
import { useAppLocation } from './hooks/useAppLocation.js';
import { HomePage } from './pages/HomePage.jsx';
import { CreateTemplPage } from './pages/CreateTemplPage.jsx';
import { JoinTemplPage } from './pages/JoinTemplPage.jsx';
import { NewProposalPage } from './pages/NewProposalPage.jsx';
import { VoteProposalPage } from './pages/VoteProposalPage.jsx';
import { TemplOverviewPage } from './pages/TemplOverviewPage.jsx';
import { ClaimRewardsPage } from './pages/ClaimRewardsPage.jsx';
import { BACKEND_URL, FACTORY_CONFIG, RPC_URL } from './config.js';
import { loadFactoryTempls } from './services/templs.js';

export default function App() {
  const { path, query, navigate } = useAppLocation();
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [statusMessages, setStatusMessages] = useState([]);
  const [templs, setTempls] = useState([]);
  const [loadingTempls, setLoadingTempls] = useState(false);
  const [readProvider, setReadProvider] = useState(null);

  const pushMessage = useCallback((message) => {
    const text = String(message);
    setStatusMessages((prev) => [...prev.slice(-4), text]);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    setProvider(browserProvider);
    browserProvider.listAccounts().then((accounts) => {
      if (accounts?.length) {
        browserProvider.getSigner().then(async (s) => {
          setSigner(s);
          try {
            const addr = await s.getAddress();
            setWalletAddress(addr.toLowerCase());
          } catch {}
        });
      }
    });
    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setSigner(null);
        setWalletAddress('');
        return;
      }
      browserProvider.getSigner().then(async (s) => {
        setSigner(s);
        try {
          const addr = await s.getAddress();
          setWalletAddress(addr.toLowerCase());
        } catch {}
      });
    };
    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, []);

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      pushMessage('No wallet detected. Install MetaMask or compatible wallet.');
      return;
    }
    const browserProvider = provider || new ethers.BrowserProvider(window.ethereum);
    setProvider(browserProvider);
    try {
      await browserProvider.send('eth_requestAccounts', []);
      const s = await browserProvider.getSigner();
      setSigner(s);
      const addr = await s.getAddress();
      setWalletAddress(addr.toLowerCase());
      pushMessage(`Wallet connected: ${addr}`);
    } catch (err) {
      pushMessage(`Wallet connection failed: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (RPC_URL) {
      try {
        setReadProvider(new ethers.JsonRpcProvider(RPC_URL));
        return;
      } catch (err) {
        console.warn('[templ] Failed to create RPC provider', err);
      }
    }
    if (provider) {
      setReadProvider(provider);
    } else if (typeof window !== 'undefined' && window.ethereum) {
      try {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        setReadProvider(browserProvider);
      } catch (err) {
        console.warn('[templ] Failed to create browser provider', err);
      }
    }
  }, [provider]);

  const refreshTempls = useCallback(async () => {
    setLoadingTempls(true);
    try {
      const factoryAddress = FACTORY_CONFIG.address;
      let factoryTempls = [];
      if (factoryAddress && readProvider) {
        factoryTempls = await loadFactoryTempls({ ethers, provider: readProvider, factoryAddress });
      }

      let backendTempls = [];
      try {
        const res = await fetch(`${BACKEND_URL}/templs?include=chatId`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.templs)) {
            backendTempls = data.templs.map((row) => ({
              contract: String(row.contract || '').toLowerCase(),
              telegramChatId: row.telegramChatId || row.groupId || '',
              templHomeLink: row.templHomeLink || '',
              priest: row.priest || ''
            }));
          }
        }
      } catch {
        /* ignore backend errors; on-chain data is primary */
      }

      if (factoryTempls.length === 0 && backendTempls.length === 0) {
        setTempls([]);
        return;
      }

      const backendMap = new Map(backendTempls.map((item) => [item.contract, item]));
      const merged = factoryTempls.length ? factoryTempls.map((templ) => {
        const backendInfo = backendMap.get(templ.contract);
        return {
          ...templ,
          telegramChatId: backendInfo?.telegramChatId || '',
          templHomeLink: templ.templHomeLink || backendInfo?.templHomeLink || '',
          priest: templ.priest || backendInfo?.priest || '',
        };
      }) : backendTempls.map((templ) => ({
        contract: templ.contract,
        priest: templ.priest,
        tokenSymbol: '–',
        tokenAddress: '',
        tokenDecimals: 18,
        burnedRaw: 0n,
        burnedFormatted: '0',
        templHomeLink: templ.templHomeLink,
        telegramChatId: templ.telegramChatId || '',
        links: { overview: `/templs/${templ.contract}`, homeLink: templ.templHomeLink || undefined },
      }));

      setTempls(merged);
    } catch (err) {
      pushMessage(`Failed to load templs: ${err?.message || err}`);
    } finally {
      setLoadingTempls(false);
    }
  }, [pushMessage, readProvider]);

  useEffect(() => {
    refreshTempls();
  }, [refreshTempls]);

  const templMap = useMemo(() => {
    const map = new Map();
    for (const row of templs) {
      map.set(String(row.contract).toLowerCase(), row);
    }
    return map;
  }, [templs]);

  const renderRoute = () => {
    if (path === '/templs/create') {
      return (
        <CreateTemplPage
          ethers={ethers}
          signer={signer}
          walletAddress={walletAddress}
          onConnectWallet={connectWallet}
          pushMessage={pushMessage}
          onNavigate={navigate}
          refreshTempls={refreshTempls}
        />
      );
    }
    if (path === '/templs/join') {
      return (
        <JoinTemplPage
          ethers={ethers}
          signer={signer}
          walletAddress={walletAddress}
          onConnectWallet={connectWallet}
          pushMessage={pushMessage}
          query={query}
        />
      );
    }
    const newProposalMatch = path.match(/^\/templs\/(0x[0-9a-fA-F]{40})\/proposals\/new$/);
    if (newProposalMatch) {
      const address = newProposalMatch[1].toLowerCase();
      return (
        <NewProposalPage
          ethers={ethers}
          signer={signer}
          walletAddress={walletAddress}
          templAddress={address}
          onConnectWallet={connectWallet}
          pushMessage={pushMessage}
          onNavigate={navigate}
        />
      );
    }
    const voteMatch = path.match(/^\/templs\/(0x[0-9a-fA-F]{40})\/proposals\/([^/]+)\/vote$/);
    if (voteMatch) {
      const address = voteMatch[1].toLowerCase();
      const proposalId = voteMatch[2];
      return (
        <VoteProposalPage
          ethers={ethers}
          signer={signer}
          templAddress={address}
          proposalId={proposalId}
          onConnectWallet={connectWallet}
          pushMessage={pushMessage}
        />
      );
    }
    const claimMatch = path.match(/^\/templs\/(0x[0-9a-fA-F]{40})\/claim$/);
    if (claimMatch) {
      const address = claimMatch[1].toLowerCase();
      return (
        <ClaimRewardsPage
          ethers={ethers}
          signer={signer}
          walletAddress={walletAddress}
          templAddress={address}
          onConnectWallet={connectWallet}
          pushMessage={pushMessage}
        />
      );
    }
    const overviewMatch = path.match(/^\/templs\/(0x[0-9a-fA-F]{40})$/);
    if (overviewMatch) {
      const address = overviewMatch[1].toLowerCase();
      const templRecord = templMap.get(address) || { contract: address };
      return (
        <TemplOverviewPage
          templAddress={address}
          templRecord={templRecord}
          onNavigate={navigate}
        />
      );
    }
    return (
      <HomePage
        walletAddress={walletAddress}
        onConnectWallet={connectWallet}
        onNavigate={navigate}
        templs={templs}
        loadingTempls={loadingTempls}
        refreshTempls={refreshTempls}
      />
    );
  };

  return (
    <div className="app">
      <nav className="top-nav">
        <button type="button" onClick={() => navigate('/')}>Home</button>
        <button type="button" onClick={() => navigate('/templs/create')}>Create</button>
        <button type="button" onClick={() => navigate('/templs/join')}>Join</button>
      </nav>
      {renderRoute()}
      <footer className="status-bar">
        {statusMessages.length === 0 ? <span>Ready.</span> : statusMessages.map((msg, idx) => (
          <span key={idx}>{msg}</span>
        ))}
      </footer>
    </div>
  );
}
