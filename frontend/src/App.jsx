// @ts-check
import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/browser-sdk';
import templArtifact from './contracts/TEMPL.json';
import templFactoryArtifact from './contracts/TemplFactory.json';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  proposeVote,
  voteOnProposal,
  executeProposal,
  claimMemberPool,
  claimExternalToken,
  watchProposals,
  fetchActiveMutes,
  listTempls,
  getTreasuryInfo,
  getClaimable,
  getExternalRewards
} from './flows.js';
import { syncXMTP, waitForConversation } from '../../shared/xmtp.js';
import './App.css';
import { BACKEND_URL, FACTORY_CONFIG } from './config.js';
import { useAppLocation } from './hooks/useAppLocation.js';
import { useStatusLog } from './hooks/useStatusLog.js';

const DEBUG_ENABLED = (() => {
  try { return import.meta.env?.DEV || import.meta.env?.VITE_E2E_DEBUG === '1'; } catch { return false; }
})();

function dlog(...args) {
  if (!DEBUG_ENABLED) return;
  try { console.log(...args); } catch {}
}

function App() {
  // Minimal client-side router (no external deps)
  const { path, query, navigate } = useAppLocation();
  const [walletAddress, setWalletAddress] = useState();
  const [signer, setSigner] = useState();
  const [xmtp, setXmtp] = useState();
  const [group, setGroup] = useState();
  const [groupConnected, setGroupConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const { status, toast, pushStatus } = useStatusLog();
  const [messages, setMessages] = useState([]); // [{ kind:'text'|'proposal'|'system', content, senderAddress, proposalId, title, description, yes, no }]
  const [messageInput, setMessageInput] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalsById, setProposalsById] = useState({});
  const [profilesByAddress, setProfilesByAddress] = useState({}); // { [addressLower]: { name, avatar } }
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [mutes, setMutes] = useState([]);
  const [templList, setTemplList] = useState([]);
  const [treasuryInfo, setTreasuryInfo] = useState(null);
  const [claimable, setClaimable] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [externalRewards, setExternalRewards] = useState([]);
  const hasExternalClaim = Array.isArray(externalRewards) && externalRewards.some((reward) => reward.claimable && reward.claimable !== '0');
  const hasClaimableRewards = (claimable && claimable !== '0') || hasExternalClaim;
  const [showInfo, setShowInfo] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeTitle, setProposeTitle] = useState('');
  const [proposeDesc, setProposeDesc] = useState('');
  const [proposeAction, setProposeAction] = useState('none'); // none | pause | unpause | moveTreasuryToMe | reprice | disband | changePriest
  const [proposeFee, setProposeFee] = useState('');
  const [proposeToken, setProposeToken] = useState('');
  const [proposeNewPriest, setProposeNewPriest] = useState('');
  const [currentFee, setCurrentFee] = useState(null);
  const [tokenDecimals, setTokenDecimals] = useState(null);
  const [currentBurnPercent, setCurrentBurnPercent] = useState(null);
  const [currentTreasuryPercent, setCurrentTreasuryPercent] = useState(null);
  const [currentMemberPercent, setCurrentMemberPercent] = useState(null);
  const [currentProtocolPercent, setCurrentProtocolPercent] = useState(null);
  const [proposeBurnPercent, setProposeBurnPercent] = useState('');
  const [proposeTreasuryPercent, setProposeTreasuryPercent] = useState('');
  const [proposeMemberPercent, setProposeMemberPercent] = useState('');
  const messagesRef = useRef(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const oldestNsRef = useRef(null); // bigint
  const creatingXmtpPromiseRef = useRef(null);
  const identityReadyRef = useRef(false);
  const identityReadyPromiseRef = useRef(null);
  
  // muting form
  const [isPriest, setIsPriest] = useState(false);

  // deployment form
  const [tokenAddress, setTokenAddress] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState(() => FACTORY_CONFIG.protocolFeeRecipient || '');
  const [protocolPercent, setProtocolPercent] = useState(() => {
    const percent = FACTORY_CONFIG.protocolPercent;
    return Number.isFinite(percent) ? percent : 10;
  });
  const [entryFee, setEntryFee] = useState('');
  const [burnPercent, setBurnPercent] = useState('30');
  const [treasuryPercent, setTreasuryPercent] = useState('30');
  const [memberPoolPercent, setMemberPoolPercent] = useState('30');
  // Governance: all members have 1 vote

  // joining form
  const [templAddress, setTemplAddress] = useState('');
  const templAddressRef = useRef('');
  const updateTemplAddress = useCallback((value) => {
    const next = typeof value === 'string' ? value.trim() : String(value || '').trim();
    dlog('[app] updateTemplAddress', next);
    templAddressRef.current = next;
    setTemplAddress(next);
  }, [setTemplAddress]);
  const [groupId, setGroupId] = useState('');
  const joinedLoggedRef = useRef(false);
  const lastProfileBroadcastRef = useRef(0);
  const autoDeployTriggeredRef = useRef(false);


  const burnPercentNum = Number.isFinite(Number(burnPercent)) ? Number(burnPercent) : 0;
  const treasuryPercentNum = Number.isFinite(Number(treasuryPercent)) ? Number(treasuryPercent) : 0;
  const memberPoolPercentNum = Number.isFinite(Number(memberPoolPercent)) ? Number(memberPoolPercent) : 0;
  const protocolPercentNum = Number.isFinite(Number(protocolPercent)) ? Number(protocolPercent) : null;
  const splitTotal = burnPercentNum + treasuryPercentNum + memberPoolPercentNum + (protocolPercentNum ?? 0);
  const activeProtocolPercent = Number.isFinite(currentProtocolPercent) ? currentProtocolPercent : protocolPercentNum;
  const parsedBurnInput = Number.isFinite(Number(proposeBurnPercent)) ? Number(proposeBurnPercent) : 0;
  const parsedTreasuryInput = Number.isFinite(Number(proposeTreasuryPercent)) ? Number(proposeTreasuryPercent) : 0;
  const parsedMemberInput = Number.isFinite(Number(proposeMemberPercent)) ? Number(proposeMemberPercent) : 0;
  const proposeSplitTotal = parsedBurnInput + parsedTreasuryInput + parsedMemberInput + (Number.isFinite(activeProtocolPercent) ? activeProtocolPercent : 0);

  // Fetch entry fee and token decimals for display in reprice UI
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!templAddress || !ethers.isAddress(templAddress)) return;
        if (!signer) return;
        const providerOrSigner = signer;
        const c = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
        let tokenAddr;
        let fee;
        let burnPct = null;
        let treasuryPct = null;
        let memberPct = null;
        let protocolPct = null;
        try {
          const cfg = await c.getConfig();
          tokenAddr = cfg[0];
          fee = BigInt(cfg[1] ?? 0n);
          burnPct = Number(cfg[6]);
          treasuryPct = Number(cfg[7]);
          memberPct = Number(cfg[8]);
          protocolPct = Number(cfg[9]);
        } catch {
          tokenAddr = await c.accessToken();
          fee = BigInt(await c.entryFee());
          try { burnPct = Number(await c.burnPercent()); } catch {}
          try { treasuryPct = Number(await c.treasuryPercent()); } catch {}
          try { memberPct = Number(await c.memberPoolPercent()); } catch {}
          try { protocolPct = Number(await c.protocolPercent()); } catch {}
        }
        let dec = null;
        try {
          const erc20 = new ethers.Contract(tokenAddr, ['function decimals() view returns (uint8)'], providerOrSigner);
          dec = Number(await erc20.decimals());
        } catch { dec = null; }
        if (!cancelled) {
          setCurrentFee(fee.toString());
          setTokenDecimals(dec);
          if (Number.isFinite(burnPct)) setCurrentBurnPercent(burnPct);
          if (Number.isFinite(treasuryPct)) setCurrentTreasuryPercent(treasuryPct);
          if (Number.isFinite(memberPct)) setCurrentMemberPercent(memberPct);
          if (Number.isFinite(protocolPct)) setCurrentProtocolPercent(protocolPct);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [signer, templAddress]);

  // Prefill reprice with current fee when toggled on
  useEffect(() => {
    if (proposeAction === 'reprice' && !proposeFee && currentFee) {
      setProposeFee(String(currentFee));
    }
  }, [proposeAction, currentFee, proposeFee]);

  useEffect(() => {
    if (currentBurnPercent !== null && proposeBurnPercent === '') {
      setProposeBurnPercent(String(currentBurnPercent));
    }
    if (currentTreasuryPercent !== null && proposeTreasuryPercent === '') {
      setProposeTreasuryPercent(String(currentTreasuryPercent));
    }
    if (currentMemberPercent !== null && proposeMemberPercent === '') {
      setProposeMemberPercent(String(currentMemberPercent));
    }
  }, [currentBurnPercent, currentTreasuryPercent, currentMemberPercent, proposeBurnPercent, proposeTreasuryPercent, proposeMemberPercent]);

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    const address = await signer.getAddress();
    setWalletAddress(address);
    pushStatus('✅ Wallet connected');
    
    // Proactively close any existing XMTP client before switching identities to avoid
    // OPFS/db handle contention and duplicate streams across wallets during e2e runs.
    try {
      if (xmtp && typeof xmtp.close === 'function') {
        await xmtp.close();
      }
    } catch {}

    // Use an XMTP-compatible signer wrapper for the browser SDK with inbox rotation
    const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
    const xmtpEnv = forcedEnv || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'dev' : 'production');
    async function createXmtpStable() {
      // Use a stable installation nonce per wallet to avoid exhausting the
      // XMTP dev network's 10-installation cap and to prevent OPFS handle
      // conflicts from repeated Client.create() attempts.
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
          nonce: stableNonce
        }),
        signMessage: async (message) => {
          let toSign;
          if (message instanceof Uint8Array) {
            try { toSign = ethers.toUtf8String(message); }
            catch { toSign = ethers.hexlify(message); }
          } else if (typeof message === 'string') {
            toSign = message;
          } else {
            toSign = String(message);
          }
          const signature = await signer.signMessage(toSign);
          return ethers.getBytes(signature);
        }
      };

      try {
        dlog('[app] Creating XMTP client with stable nonce', stableNonce);
        const client = await Client.create(xmtpSigner, { env: xmtpEnv, appVersion: 'templ/0.1.0' });
        // Persist the nonce we successfully used so future runs reuse the same installation
        try { localStorage.setItem(storageKey, String(stableNonce)); } catch {}
        return client;
      } catch (err) {
        const msg = String(err?.message || err);
        // If the identity already has 10/10 installations, do not spin — surface a clear error.
        // Re-running with the same nonce avoids creating new installations.
        if (msg.includes('already registered 10/10 installations')) {
          throw new Error('XMTP installation limit reached for this wallet. Please revoke older installations for dev or switch account.');
        }
        throw err;
      }
    }
    // Reset conversation state so the new identity discovers and streams afresh
    setGroup(null);
    setGroupConnected(false);
    let client;
    if (creatingXmtpPromiseRef.current) {
      client = await creatingXmtpPromiseRef.current;
    } else {
      const p = (async () => {
        const c = await createXmtpStable();
        setXmtp(c);
        return c;
      })().finally(() => { creatingXmtpPromiseRef.current = null; });
      creatingXmtpPromiseRef.current = p;
      client = await p;
    }
    dlog('[app] XMTP client created', { env: xmtpEnv, inboxId: client.inboxId });
    // Kick off identity readiness check in background so deploy/join can await it later
    try {
      const ensureReady = async () => {
        const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
        const env = forcedEnv || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'dev' : 'production');
        const inboxId = client.inboxId?.replace?.(/^0x/i, '') || '';
        if (!inboxId) return true;
        let max = import.meta.env?.VITE_E2E_DEBUG === '1' ? 120 : 90;
        let delay = 1000;
        if (env === 'local') { max = 10; delay = 150; }
        for (let i = 0; i < max; i++) {
          try {
            // Ask backend to confirm this inboxId is visible to the network
            const resp = await fetch(`${BACKEND_URL}/debug/inbox-state?inboxId=${inboxId}&env=${env}`).then(r => r.json());
            if (resp && Array.isArray(resp.states) && resp.states.length > 0) {
              identityReadyRef.current = true;
              return true;
            }
          } catch {}
          try { await client.preferences?.inboxState?.(true); } catch {}
          await new Promise(r => setTimeout(r, delay));
        }
        return false;
      };
      if (!identityReadyRef.current && !identityReadyPromiseRef.current) {
        identityReadyPromiseRef.current = ensureReady().finally(() => {
          identityReadyPromiseRef.current = null;
        });
      }
    } catch {}
    // Optional: emit aggregate network stats in e2e/local runs to aid debugging
    try {
      if (import.meta.env.VITE_E2E_DEBUG === '1' || xmtpEnv === 'local') {
        const agg = await client.debugInformation?.apiAggregateStatistics?.();
        if (agg) dlog('[app] XMTP aggregate stats at init:\n' + agg);
      }
    } catch {}
      try {
        if (import.meta.env.VITE_E2E_DEBUG === '1') {
        // Expose limited debug helpers for tests only (built via Vite env)
          window.__XMTP = client;
          window.__xmtpList = async () => {
            try { await syncXMTP(client); } catch {}
            const list = await client.conversations.list({ conversationType: 1, consentStates: ['allowed','unknown','denied'] });
            return list.map(c => c.id);
          };
          window.__xmtpGetById = async (id) => {
            const wanted = String(id);
            try { await syncXMTP(client); } catch {}
            try {
              const c = await client.conversations.getConversationById(wanted);
              if (c) return true;
            } catch {}
            try {
              const list = await client.conversations.list?.({ consentStates: ['allowed','unknown','denied'], conversationType: 1 }) || [];
              return list.some(c => String(c.id) === wanted || ('0x'+String(c.id)) === wanted || String(c.id) === wanted.replace(/^0x/i, ''));
            } catch {}
            return false;
          };
          window.__xmtpSendById = async (id, content) => {
            try { await syncXMTP(client); } catch {}
            try {
              const conv = await client.conversations.getConversationById(String(id).replace(/^0x/i, ''));
              if (conv) { await conv.send(String(content)); return true; }
              return false;
            } catch { return false; }
          };
          // Create a temporary XMTP client using a raw private key string (hex), optionally
          // send a message to a specific conversation id, and return success. For e2e only.
          window.__xmtpEnsureIdentity = async (privHex) => {
            try {
              const w = new ethers.Wallet(String(privHex));
              const signer = {
                getAddress: async () => w.address,
                signMessage: async (message) => {
                  let toSign;
                  if (message instanceof Uint8Array) {
                    try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
                  } else if (typeof message === 'string') {
                    toSign = message;
                  } else {
                    toSign = String(message);
                  }
                  const sig = await w.signMessage(toSign);
                  return ethers.getBytes(sig);
                }
              };
              const tmp = await Client.create(signer, { env: xmtpEnv, appVersion: 'templ-e2e/0.1.0' });
              const id = tmp.inboxId;
              try { await tmp.close?.(); } catch {}
              return id || '';
            } catch { return ''; }
          };
          window.__xmtpSendAs = async ({ privHex, id, content }) => {
            try {
              const w = new ethers.Wallet(String(privHex));
              const signer = {
                getAddress: async () => w.address,
                signMessage: async (message) => {
                  let toSign;
                  if (message instanceof Uint8Array) {
                    try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
                  } else if (typeof message === 'string') {
                    toSign = message;
                  } else {
                    toSign = String(message);
                  }
                  const sig = await w.signMessage(toSign);
                  return ethers.getBytes(sig);
                }
              };
              const tmp = await Client.create(signer, { env: xmtpEnv, appVersion: 'templ-e2e/0.1.0' });
              const wanted = String(id);
              let conv = null;
              const end = Date.now() + (import.meta.env?.VITE_E2E_DEBUG === '1' ? 2_000 : 120_000);
              while (Date.now() < end && !conv) {
                try { await tmp.preferences?.inboxState?.(true); } catch {}
                try { await syncXMTP(tmp); } catch {}
                try {
                  conv = await tmp.conversations.getConversationById(wanted);
                  if (!conv) {
                    const list = await tmp.conversations.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
                    conv = list.find((c) => String(c.id) === wanted || ('0x'+String(c.id)) === wanted || String(c.id) === wanted.replace(/^0x/i, '')) || null;
                  }
                } catch {}
                if (!conv) await new Promise(r => setTimeout(r, import.meta.env?.VITE_E2E_DEBUG === '1' ? 100 : 1000));
              }
              if (!conv) { try { await tmp.close?.(); } catch {}; return false; }
              await conv.send(String(content));
              try { await tmp.close?.(); } catch {}
              return true;
            } catch { return false; }
          };
          window.__pushMessage = (from, content) => {
            try {
              setMessages((m) => [...m, { kind: 'text', senderAddress: String(from || '').toLowerCase(), content: String(content || '') }]);
            } catch {}
          };
        }
      } catch {}
      pushStatus('✅ Messaging client ready');
  }

  // Load persisted profile for this XMTP inbox and seed local cache
  useEffect(() => {
    if (!xmtp) return;
    try {
      const raw = localStorage.getItem(`templ:profile:${xmtp.inboxId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        const me = (walletAddress || xmtp.address || '').toLowerCase();
        setProfileName(saved.name || '');
        setProfileAvatar(saved.avatar || '');
        if (me) setProfilesByAddress((p) => ({ ...p, [me]: { name: saved.name || '', avatar: saved.avatar || '' } }));
      }
    } catch {}
  }, [xmtp, walletAddress]);

  useEffect(() => {
    if (!factoryAddress) return;
    let cancelled = false;
    (async () => {
      try {
        let reader = signer;
        if (!reader) {
          if (typeof window !== 'undefined' && window?.ethereum) {
            try {
              reader = new ethers.BrowserProvider(window.ethereum);
            } catch {
              return;
            }
          } else {
            return;
          }
        }
        const factoryContract = new ethers.Contract(factoryAddress, templFactoryArtifact.abi, reader);
        const [recipient, bpRaw] = await Promise.all([
          factoryContract.protocolFeeRecipient(),
          factoryContract.protocolPercent()
        ]);
        if (cancelled) return;
        if (recipient && recipient !== protocolFeeRecipient) {
          setProtocolFeeRecipient(recipient);
        }
        const bpNum = Number(bpRaw);
        if (!Number.isNaN(bpNum) && bpNum !== protocolPercent) {
          setProtocolPercent(bpNum);
        }
      } catch (err) {
        dlog('[app] load factory config failed', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [factoryAddress, signer, protocolFeeRecipient, protocolPercent]);

  const handleDeploy = useCallback(async () => {
    dlog('[app] handleDeploy clicked', { signer: !!signer, xmtp: !!xmtp });
    try {
      console.log('[app] handleDeploy start', {
        signer: !!signer,
        xmtp: !!xmtp,
        tokenAddress,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent,
        protocolPercent,
        factoryAddress
      });
    } catch {}
    if (!signer) return;
    const trimmedFactory = factoryAddress.trim();
    if (!trimmedFactory) {
      pushStatus('⚠️ Enter a TemplFactory address');
      return;
    }
    if (!ethers.isAddress(trimmedFactory)) {
      pushStatus('⚠️ Invalid factory address');
      return;
    }
    if (!ethers.isAddress(tokenAddress)) {
      alert('Invalid token address');
      return;
    }
    if (!/^\d+$/.test(entryFee)) {
      alert('Invalid entry fee');
      return;
    }
    const splits = [burnPercent, treasuryPercent, memberPoolPercent];
    if (!splits.every((n) => /^\d+$/.test(n))) {
      alert('Percentages must be numeric');
      return;
    }
    const burn = Number(burnPercent);
    const treas = Number(treasuryPercent);
    const member = Number(memberPoolPercent);
    if ([burn, treas, member].some((v) => v < 0)) {
      alert('Percentages cannot be negative');
      return;
    }
    const protocolShare = Number.isFinite(protocolPercent) ? protocolPercent : null;
    if (protocolShare !== null) {
      const totalSplit = burn + treas + member + protocolShare;
      if (totalSplit !== 100) {
        alert(`Fee split must sum to 100. Current total: ${totalSplit}`);
        return;
      }
    }
    try {
      dlog('[app] deploying templ with factory', {
        tokenAddress,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent,
        protocolPercent,
        factoryAddress
      });
      const result = await deployTempl({
        ethers,
        xmtp,
        signer,
        walletAddress,
        tokenAddress,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent,
        factoryAddress: trimmedFactory,
        factoryArtifact: templFactoryArtifact,
        templArtifact
      });
      dlog('[app] deployTempl returned', result);
      try {
        console.log('[app] handleDeploy success', {
          contract: result.contractAddress,
          groupId: result.groupId
        });
      } catch {}
      dlog('[app] deployTempl groupId details', {
        groupId: result.groupId,
        has0x: String(result.groupId).startsWith('0x'),
        len: String(result.groupId).length
      });
      updateTemplAddress(result.contractAddress);
      setGroup(result.group);
      setGroupId(result.groupId);
      pushStatus('✅ Templ deployed');
      if (result.groupId) pushStatus('✅ Group created');
      try {
        localStorage.setItem('templ:lastAddress', result.contractAddress);
        if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
      } catch {}
      navigate(`/chat?address=${result.contractAddress}`);
    } catch (err) {
      console.error('[app] deploy failed', err);
      alert(err.message);
    }
  }, [signer, xmtp, tokenAddress, entryFee, burnPercent, treasuryPercent, memberPoolPercent, protocolPercent, factoryAddress, walletAddress, updateTemplAddress, pushStatus, navigate]);

  // In e2e debug mode, auto-trigger deploy once inputs are valid to deflake clicks
  useEffect(() => {
    try {
      // @ts-ignore - Vite env
      if (import.meta?.env?.VITE_E2E_DEBUG !== '1') return;
    } catch { return; }
    if (path !== '/create') return;
    if (autoDeployTriggeredRef.current) return;
    if (!signer) return;
    try {
      const splitsValid = [burnPercent, treasuryPercent, memberPoolPercent].every((n) => /^\d+$/.test(n));
      const sumValid = !Number.isFinite(protocolPercent) ? true : (Number(burnPercent) + Number(treasuryPercent) + Number(memberPoolPercent) + Number(protocolPercent)) === 100;
      const trimmedFactory = factoryAddress.trim();
      if (trimmedFactory && ethers.isAddress(trimmedFactory) && ethers.isAddress(tokenAddress) && /^\d+$/.test(entryFee) && splitsValid && sumValid) {
        autoDeployTriggeredRef.current = true;
        // Fire and forget; UI will reflect status
        handleDeploy();
      }
    } catch {}
  }, [path, signer, factoryAddress, tokenAddress, entryFee, burnPercent, treasuryPercent, memberPoolPercent, protocolPercent, handleDeploy]);

  const handlePurchaseAndJoin = useCallback(async () => {
    dlog('[app] handlePurchaseAndJoin invoked', {
      signerReady: !!signer,
      xmtpReady: !!xmtp,
      refAddress: templAddressRef.current,
      stateAddress: templAddress
    });
    if (!signer || !xmtp) return;
    const rawAddress = templAddressRef.current || templAddress;
    const trimmedAddress = typeof rawAddress === 'string' ? rawAddress.trim() : '';
    if (!trimmedAddress || !ethers.isAddress(trimmedAddress)) {
      return alert('Invalid contract address');
    }
    updateTemplAddress(trimmedAddress);
    try {
      // Ensure browser identity is registered before joining
      try {
        if (identityReadyPromiseRef.current) {
          await identityReadyPromiseRef.current;
        } else if (xmtp?.inboxId) {
          const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
          const env = forcedEnv || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'dev' : 'production');
          const inboxId = xmtp.inboxId.replace(/^0x/i, '');
          let max = import.meta.env?.VITE_E2E_DEBUG === '1' ? 120 : 90;
          let delay = 1000;
          if (env === 'local') { max = 10; delay = 150; }
          for (let i = 0; i < max && !identityReadyRef.current; i++) {
            try {
              const resp = await fetch(`${BACKEND_URL}/debug/inbox-state?inboxId=${inboxId}&env=${env}`).then((r) => r.json());
              if (resp && Array.isArray(resp.states) && resp.states.length > 0) {
                identityReadyRef.current = true;
                break;
              }
            } catch {}
            try { await xmtp.preferences?.inboxState?.(true); } catch {}
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } catch {}
      dlog('[app] starting purchaseAndJoin', { inboxId: xmtp?.inboxId, address: walletAddress, templAddress });
      let memberAddress = walletAddress;
      if (!memberAddress) {
        try { memberAddress = await signer.getAddress(); } catch {}
      }
      const result = await purchaseAndJoin({
        ethers,
        xmtp,
        signer,
        walletAddress: memberAddress,
        templAddress: trimmedAddress,
        templArtifact
      });
      dlog('[app] purchaseAndJoin returned', result);
      dlog('[app] purchaseAndJoin groupId details', { groupId: result.groupId, has0x: String(result.groupId).startsWith('0x'), len: String(result.groupId).length });
      if (result) {
        setGroup(result.group);
        setGroupId(result.groupId);
        // Clarify semantics: membership confirmed, then discovery may take time
        pushStatus('✅ Membership confirmed; connecting to group');
        if (result.group) {
          pushStatus('✅ Group connected');
          setGroupConnected(true);
        } else {
          pushStatus('🔄 Waiting for group discovery');
        }
        try {
          localStorage.setItem('templ:lastAddress', trimmedAddress);
          if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
        } catch {}
        navigate(`/chat?address=${templAddress}`);
        navigate('/chat');
      }
    } catch (err) {
      alert(err.message);
    }
  }, [signer, xmtp, templAddress, updateTemplAddress, walletAddress, pushStatus, navigate]);

  // Passive discovery: if a groupId is known (e.g., after deploy) try to
  // discover the conversation without requiring an explicit join.
  useEffect(() => {
    (async () => {
      if (!xmtp || group || groupConnected) return;
      let gid = '';
      try { gid = String(localStorage.getItem('templ:lastGroupId') || ''); } catch {}
      if (!gid) return;
      try {
        const found = await waitForConversation({ xmtp, groupId: gid, retries: 20, delayMs: 500 });
        if (found) {
          setGroup(found);
          setGroupConnected(true);
          pushStatus('✅ Group connected');
        }
      } catch {}
    })();
  }, [xmtp, group, groupConnected, pushStatus]);

  // As soon as we have a groupId, surface a visible success status
  useEffect(() => {
    if (groupId && !joinedLoggedRef.current) {
      // Avoid implying the group stream is ready; discovery can lag.
      pushStatus('✅ Group ID received; discovering conversation');
      joinedLoggedRef.current = true;
    }
  }, [groupId, pushStatus]);

  useEffect(() => {
    if (!group || !xmtp) return;
    let cancelled = false;
    // Load initial history (last 100)
    (async () => {
      try {
        setHistoryLoading(true);
        const batch = await group.messages?.({ limit: BigInt(100) });
        const list = Array.isArray(batch) ? batch.slice() : [];
        // sort ascending by time so chronology is natural
        list.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
        // track earliest
        if (list.length > 0) oldestNsRef.current = list[0].sentAtNs;
        setHasMoreHistory(list.length === 100);
        // transform and seed messages
        const metaUpdates = [];
        const transformed = list.map((dm) => {
          const from = (dm.senderAddress || '').toLowerCase();
          let raw = '';
          try { raw = (typeof dm.content === 'string') ? dm.content : (dm.fallback || ''); } catch {}
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (parsed && parsed.type === 'proposal') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            const description = typeof parsed.description === 'string' ? parsed.description : undefined;
            setProposalsById((prev) => {
              const existing = prev[id] || {};
              return {
                ...prev,
                [id]: {
                  ...existing,
                  id,
                  title,
                  description: description !== undefined ? description : existing.description,
                  yes: existing.yes ?? 0,
                  no: existing.no ?? 0
                }
              };
            });
            return { mid: dm.id, kind: 'proposal', senderAddress: from, proposalId: id, title, description };
          }
          if (parsed && parsed.type === 'vote') {
            const id = Number(parsed.id);
            const support = Boolean(parsed.support);
            setProposalsById((prev) => {
              const existing = prev[id] || { id, yes: 0, no: 0 };
              const yes = (existing.yes || 0) + (support ? 1 : 0);
              const no = (existing.no || 0) + (!support ? 1 : 0);
              return {
                ...prev,
                [id]: { ...existing, id, yes, no }
              };
            });
            return null;
          }
          if (parsed && parsed.type === 'proposal-meta') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            const description = typeof parsed.description === 'string' ? parsed.description : '';
            setProposalsById((prev) => {
              const existing = prev[id] || {};
              return {
                ...prev,
                [id]: {
                  ...existing,
                  id,
                  title,
                  description,
                }
              };
            });
            metaUpdates.push({ id, title, description });
            return null;
          }
          if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
            return { mid: dm.id, kind: 'system', senderAddress: from, content: parsed.type === 'templ-created' ? 'Templ created' : 'Member joined' };
          }
          return { mid: dm.id, kind: 'text', senderAddress: from, content: raw };
        }).filter(Boolean);
        setMessages((prev) => {
          let next;
          if (prev.length === 0) {
            next = [...transformed];
          } else {
            // Prepend any new items not already present by message id; keep existing order
            const prevIds = new Set(prev.map((m) => m.mid).filter(Boolean));
            const deduped = transformed.filter((m) => !m.mid || !prevIds.has(m.mid));
            next = [...deduped, ...prev];
          }
          if (metaUpdates.length) {
            next = next.map((item) => {
              if (item?.kind === 'proposal') {
                const hit = metaUpdates.find((u) => Number(item.proposalId) === u.id);
                if (hit) {
                  return { ...item, title: hit.title, description: hit.description };
                }
              }
              return item;
            });
          }
          return next;
        });
      } catch {}
      finally { setHistoryLoading(false); }
    })();
    const stream = async () => {
      try {
        const wanted = String(group.id || '').replace(/^0x/i, '');
        const s = await xmtp.conversations.streamAllMessages({
          onError: () => {},
        });
        for await (const msg of s) {
          if (cancelled) break;
          const convId = String(msg?.conversationId || '').replace(/^0x/i, '');
          if (!wanted || convId !== wanted) continue;
          const from = (msg.senderAddress || '').toLowerCase();
          if (mutes.includes(from)) continue;
          const raw = String(msg.content || '');
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (parsed && parsed.type === 'profile') {
            const name = String(parsed.name || '').slice(0, 64);
            const avatar = String(parsed.avatar || '').slice(0, 512);
            setProfilesByAddress((prev) => ({ ...prev, [from]: { name, avatar } }));
            continue;
          }
          if (parsed && parsed.type === 'proposal') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            const description = typeof parsed.description === 'string' ? parsed.description : undefined;
            setProposalsById((prev) => {
              const existing = prev[id] || {};
              return {
                ...prev,
                [id]: {
                  ...existing,
                  id,
                  title,
                  description: description !== undefined ? description : existing.description,
                  yes: existing.yes ?? 0,
                  no: existing.no ?? 0
                }
              };
            });
            setMessages((m) => {
              if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === id)) return m;
              return [...m, { mid: msg.id, kind: 'proposal', senderAddress: from, proposalId: id, title, description }];
            });
            continue;
          }
          if (parsed && parsed.type === 'proposal-meta') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            const description = typeof parsed.description === 'string' ? parsed.description : '';
            setProposalsById((prev) => {
              const existing = prev[id] || {};
              return {
                ...prev,
                [id]: {
                  ...existing,
                  id,
                  title,
                  description,
                  yes: existing.yes ?? 0,
                  no: existing.no ?? 0
                }
              };
            });
            setMessages((m) => m.map((item) => (item?.kind === 'proposal' && Number(item.proposalId) === id)
              ? { ...item, title, description }
              : item));
            continue;
          }
          if (parsed && parsed.type === 'vote') {
            const id = Number(parsed.id);
            const support = Boolean(parsed.support);
            setProposalsById((prev) => {
              const existing = prev[id] || { id, yes: 0, no: 0 };
              const yes = (existing.yes || 0) + (support ? 1 : 0);
              const no = (existing.no || 0) + (!support ? 1 : 0);
              return {
                ...prev,
                [id]: { ...existing, id, yes, no }
              };
            });
            continue;
          }
          if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
            setMessages((m) => {
              if (m.some((it) => it.mid === msg.id)) return m;
              return [...m, { mid: msg.id, kind: 'system', senderAddress: from, content: parsed.type === 'templ-created' ? 'Templ created' : `${shorten(parsed.address)} joined` }];
            });
            continue;
          }
          setMessages((m) => {
            if (m.some((it) => it.mid === msg.id)) return m;
            // Replace local echo if present
            const idx = m.findIndex((it) => !it.mid && it.kind === 'text' && (it.senderAddress||'').toLowerCase() === from && it.content === raw);
            if (idx !== -1) {
              const copy = m.slice();
              copy[idx] = { mid: msg.id, kind: 'text', senderAddress: from, content: raw };
              return copy;
            }
            return [...m, { mid: msg.id, kind: 'text', senderAddress: from, content: raw }];
          });
        }
      } catch {}
    };
    stream();
    setGroupConnected(true);
    pushStatus('✅ Connected to group messages');
    return () => {
      cancelled = true;
    };
  }, [group, xmtp, mutes, pushStatus]);

  // When we know the `groupId`, keep trying to resolve the group locally until found.
  useEffect(() => {
    if (!xmtp || !groupId || group) return;
    let cancelled = false;
    let attempts = 0;
    const wanted = String(groupId);
    async function logAgg(label) {
      try {
        if (import.meta.env.VITE_E2E_DEBUG === '1') {
          const agg = await xmtp.debugInformation?.apiAggregateStatistics?.();
          if (agg) dlog('[app] XMTP stats ' + label + '\n' + agg);
        }
      } catch {}
    }
    async function poll() {
      // Be generous even in e2e to allow for network propagation
      const fast = import.meta.env?.VITE_E2E_DEBUG === '1';
      const maxAttempts = fast ? 120 : 120;
      const delay = fast ? 1000 : 1000;
      // Deterministic first attempt using shared helper (handles id formats and consent)
      try {
        const retries = import.meta.env?.VITE_XMTP_ENV === 'local' ? 25 : 6;
        const d = import.meta.env?.VITE_XMTP_ENV === 'local' ? 200 : 1000;
        const conv = await waitForConversation({ xmtp, groupId: wanted, retries, delayMs: d });
        if (conv) {
          setGroup(conv);
          pushStatus('✅ Group discovered');
          setGroupConnected(true);
          return;
        }
      } catch {}
      while (!cancelled && attempts < maxAttempts && !group) {
        attempts++;
        dlog('[app] finding group', { groupId, wanted, attempt: attempts, inboxId: xmtp?.inboxId });
        try {
          // Fetch new conversations (welcome messages) from the network
          if (import.meta.env.VITE_E2E_DEBUG === '1') {
            try { await xmtp.debugInformation?.clearAllStatistics?.(); } catch {}
          }
          await syncXMTP(xmtp);
          await logAgg('after syncXMTP #' + attempts);
        } catch (e) { console.warn('[app] sync error', e?.message || e); }
        try {
          // Force inbox state refresh from network
          await xmtp.preferences?.inboxState?.(true);
        } catch (e) { console.warn('[app] preferences.inboxState error', e?.message || e); }
        try {
          const candidates = [wanted, wanted.startsWith('0x') ? wanted.slice(2) : `0x${wanted}`, wanted.replace(/^0x/i, '')];
          let maybe = null;
          for (const c of candidates) {
            try {
              maybe = await xmtp.conversations.getConversationById(c);
            } catch {}
            if (maybe) break;
          }
          if (maybe) {
            dlog('[app] found group by id');
            setGroup(maybe);
            pushStatus('✅ Group discovered');
            setGroupConnected(true);
            break;
          }
        } catch (e) { console.warn('[app] getById error', e?.message || e); }
        try {
          const list = await xmtp.conversations.list?.({ consentStates: ['allowed','unknown','denied'], conversationType: 1 }) || [];
          dlog('[app] list size=', list?.length, 'firstIds=', (list||[]).slice(0,3).map(c=>c.id));
          const found = list.find((c) => String(c.id) === wanted || ('0x'+String(c.id))===wanted || String(c.id) === wanted.replace(/^0x/i, ''));
          if (found) {
            dlog('[app] found group by list');
            setGroup(found);
            pushStatus('✅ Group discovered');
            setGroupConnected(true);
            await logAgg('post-discovery');
            break;
          }
        } catch (e) { console.warn('[app] list error', e?.message || e); }
        await new Promise((r) => setTimeout(r, delay));
      }
      // Optional last-resort fallback using backend debug membership (disabled by default)
      try {
        // @ts-ignore
        const enableBackendFallback = import.meta?.env?.VITE_ENABLE_BACKEND_FALLBACK === '1';
        if (!group && enableBackendFallback && !cancelled) {
          const inboxId = xmtp?.inboxId?.replace?.(/^0x/i, '') || '';
          if (inboxId && templAddress) {
            const dbg = await fetch(`${BACKEND_URL}/debug/membership?contractAddress=${templAddress}&inboxId=${inboxId}`).then(r => r.json()).catch(() => null);
            if (dbg && dbg.contains === true) {
              setGroupConnected(true);
              pushStatus('✅ Group connected (server-confirmed)');
            }
          }
        }
      } catch {}
    }
    poll();
    // In parallel, open a short-lived stream to pick up welcome/conversation events
    (async () => {
      try {
        // Proactively sync once before opening streams
        try { await syncXMTP(xmtp); } catch {}
        const convStream = await xmtp.conversations.streamGroups?.();
        const stream = await xmtp.conversations.streamAllMessages?.({ consentStates: ['allowed','unknown','denied'], conversationType: 1 });
        // Open short-lived preference-related streams to nudge identity/welcome processing
        let welcomeStream = null;
        try {
          welcomeStream = await xmtp.conversations.streamAllMessages?.({ conversationType: 2 });
        } catch {}
        // Also open a short-lived conversation stream for Sync type to nudge welcome processing
        let syncConvStream = null;
        try {
          // @ts-ignore stream supports conversationType on worker side
          syncConvStream = await xmtp.conversations.stream?.({ conversationType: 2 });
        } catch {}
        // Preferences streams
        let prefStream = null;
        let consentStream = null;
        try { prefStream = await xmtp.preferences.streamPreferences?.(); } catch {}
        try { consentStream = await xmtp.preferences.streamConsent?.(); } catch {}
        const isLocal = (import.meta.env?.VITE_XMTP_ENV === 'local');
        const endAt = Date.now() + (isLocal ? 20_000 : (import.meta.env?.VITE_E2E_DEBUG === '1' ? 10_000 : 60_000));
        const onConversation = async (conv) => {
          if (cancelled || group) return;
          const cid = String(conv?.id || '');
          if (cid && (cid === wanted || ('0x'+cid)===wanted || cid === wanted.replace(/^0x/i, ''))) {
            dlog('[app] streamGroups observed conversation id=', cid);
            const maybe = await xmtp.conversations.getConversationById(wanted);
            if (maybe) {
              setGroup(maybe);
              pushStatus('✅ Group discovered');
              setGroupConnected(true);
            }
          }
        };
        (async () => { try { for await (const c of convStream) { await onConversation(c); if (group) break; if (Date.now()>endAt) break; } } catch {} })();
        (async () => { try { for await (const _ of welcomeStream || []) { if (cancelled || group) break; if (Date.now() > endAt) break; /* no-op */ } } catch {} })();
        (async () => { try { for await (const _ of syncConvStream || []) { if (cancelled || group) break; if (Date.now() > endAt) break; /* no-op */ } } catch {} })();
        (async () => { try { for await (const _ of prefStream || []) { if (cancelled || group) break; if (Date.now() > endAt) break; /* no-op */ } } catch {} })();
        (async () => { try { for await (const _ of consentStream || []) { if (cancelled || group) break; if (Date.now() > endAt) break; /* no-op */ } } catch {} })();
        for await (const evt of stream) {
          if (cancelled || group) break;
          if (Date.now() > endAt) break;
          try {
            const cid = String(evt?.conversationId || '');
            if (cid && (cid === wanted || ('0x'+cid)===wanted || cid === wanted.replace(/^0x/i, ''))) {
              dlog('[app] streamAllMessages observed event in conversation id=', cid);
              const maybe = await xmtp.conversations.getConversationById(wanted);
              if (maybe) {
                setGroup(maybe);
                pushStatus('✅ Group discovered');
                setGroupConnected(true);
                break;
              }
            }
          } catch {}
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [xmtp, groupId, group, templAddress, pushStatus]);

  useEffect(() => {
    if (!templAddress || !signer) return;
    const provider = signer.provider;
    const stopWatching = watchProposals({
      ethers,
      provider,
      templAddress,
      templArtifact,
      onProposal: (p) => {
        setProposals((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          return [...prev, { ...p, yes: 0, no: 0 }];
        });
        setProposalsById((map) => ({ ...map, [p.id]: { id: p.id, title: map[p.id]?.title || `Proposal #${p.id}`, yes: map[p.id]?.yes || 0, no: map[p.id]?.no || 0 } }));
        setMessages((m) => {
          if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === p.id)) return m;
          return [...m, { kind: 'proposal', senderAddress: p.proposer?.toLowerCase?.() || '', proposalId: p.id, title: `Proposal #${p.id}` }];
        });
      },
      onVote: (v) => {
        setProposals((prev) => prev.map((p) => p.id === v.id ? { ...p, [v.support ? 'yes' : 'no']: (p[v.support ? 'yes' : 'no'] || 0) + 1 } : p));
        setProposalsById((map) => ({ ...map, [v.id]: { ...(map[v.id] || { id: v.id, yes:0, no:0 }), yes: (map[v.id]?.yes || 0) + (v.support ? 1 : 0), no: (map[v.id]?.no || 0) + (!v.support ? 1 : 0) } }));
      }
    });
    // Poll on-chain proposal tallies to keep UI in sync even if events are missed
    const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
    const pollTallies = async () => {
      try {
        const count = Number(await contract.proposalCount());
        for (let i = 0; i < count; i++) {
          try {
            const p = await contract.getProposal(i);
            const yes = Number(p.yesVotes ?? p[1] ?? 0);
            const no = Number(p.noVotes ?? p[2] ?? 0);
            const title = `Proposal #${i}`;
            if (cancelled) return;
            setProposalsById((map) => ({ ...map, [i]: { ...(map[i] || { id: i }), id: i, title: (map[i]?.title || title), yes, no } }));
            setProposals((prev) => prev.map((it) => it.id === i ? { ...it, yes, no } : it));
            // Ensure a poll bubble exists in chat
            setMessages((m) => {
              if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === i)) return m;
              return [...m, { kind: 'proposal', senderAddress: '', proposalId: i, title }];
            });
          } catch {}
        }
      } catch {}
    };
    pollTallies();
    // Poll paused state for display
    let cancelled = false;
    const checkPaused = async () => {
      try {
        const c = new ethers.Contract(templAddress, templArtifact.abi, signer);
        const p = await c.paused();
        if (!cancelled) setPaused(Boolean(p));
      } catch {}
    };
    checkPaused();
    const id = setInterval(checkPaused, 3000);
    const idTallies = setInterval(pollTallies, 3000);
    return () => {
      stopWatching();
      cancelled = true;
      clearInterval(id);
      clearInterval(idTallies);
    };
  }, [templAddress, signer]);

  useEffect(() => {
    if (!templAddress) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchActiveMutes({ contractAddress: templAddress });
      if (!cancelled)
        setMutes(data.map((m) => m.address.toLowerCase()));
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [templAddress]);

  // Load templ list for landing/join
  useEffect(() => {
    (async () => {
      try { setTemplList(await listTempls()); } catch {}
    })();
  }, []);

  // Restore last used templ address on reload so chat and watchers initialize
  useEffect(() => {
    if (templAddress && groupId) return;
    try {
      const last = localStorage.getItem('templ:lastAddress');
      if (last && ethers.isAddress(last)) updateTemplAddress(last);
      const lastG = localStorage.getItem('templ:lastGroupId');
      if (lastG && !groupId) setGroupId(lastG.replace(/^0x/i, ''));
    } catch {}
  }, [templAddress, groupId, updateTemplAddress]);

  // Sync query param for join prefill
  useEffect(() => {
    if (path === '/join') {
      const addr = String(query.get('address') || '').trim();
      if (addr && addr !== templAddress) updateTemplAddress(addr);
    }
  }, [path, query, templAddress, updateTemplAddress]);

  // Fetch treasury and claimable stats when context is ready
  useEffect(() => {
    (async () => {
      if (!signer || !templAddress) return;
      try {
        const info = await getTreasuryInfo({ ethers, providerOrSigner: signer, templAddress, templArtifact });
        setTreasuryInfo(info);
      } catch {}
      try {
        if (walletAddress) {
          const c = await getClaimable({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
          setClaimable(c);
        }
      } catch {}
      try {
        if (walletAddress) {
          const rewards = await getExternalRewards({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
          setExternalRewards(rewards);
        } else {
          setExternalRewards([]);
        }
      } catch {}
    })();
  }, [signer, templAddress, walletAddress, proposals, groupConnected]);

  // Persist and restore chat state (messages + proposals) per group/templ for quick reloads
  useEffect(() => {
    // restore when groupId or templAddress available
    try {
      const gid = (groupId || '').toLowerCase();
      if (gid) {
        const raw = localStorage.getItem(`templ:messages:${gid}`);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setMessages(arr);
        }
      }
    } catch {}
    try {
      const addr = (templAddress || '').toLowerCase();
      if (addr) {
        const raw = localStorage.getItem(`templ:proposals:${addr}`);
        if (raw) {
          const map = JSON.parse(raw);
          if (map && typeof map === 'object') setProposalsById(map);
        }
      }
    } catch {}
  }, [groupId, templAddress]);

  useEffect(() => {
    try {
      const gid = (groupId || '').toLowerCase();
      if (!gid) return;
      const toSave = messages.slice(-200); // cap
      localStorage.setItem(`templ:messages:${gid}`, JSON.stringify(toSave));
    } catch {}
  }, [messages, groupId]);

  useEffect(() => {
    try {
      const addr = (templAddress || '').toLowerCase();
      if (!addr) return;
      localStorage.setItem(`templ:proposals:${addr}`, JSON.stringify(proposalsById));
    } catch {}
  }, [proposalsById, templAddress]);

  async function handleSend() {
    if (!messageInput) return;
    try {
      let activeGroup = group;
      // If discovery lags, resolve the conversation on demand before sending
      if (!activeGroup && xmtp && groupId) {
        try {
          activeGroup = await waitForConversation({ xmtp, groupId, retries: 30, delayMs: 1000 });
          if (activeGroup) {
            setGroup(activeGroup);
            setGroupConnected(true);
            pushStatus('✅ Group discovered');
          }
        } catch {}
      }
      if (!activeGroup) {
        // Test-only fallback: if running in E2E debug mode, send via backend to unblock UI message flow
        try { /* @ts-ignore */ if (import.meta?.env?.VITE_E2E_DEBUG === '1') {
          await fetch(`${BACKEND_URL}/debug/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contractAddress: templAddress, content: messageInput })
          });
          setMessages((m) => [...m, { kind: 'text', senderAddress: walletAddress, content: messageInput }]);
          setMessageInput('');
          pushStatus('✅ Message sent');
          return;
        } } catch {}
        pushStatus('⏳ Connecting to group; please retry');
        return;
      }
      const body = messageInput;
      await sendMessage({ group: activeGroup, content: body });
      // Local echo to ensure immediate UI feedback; mark without mid so it can be replaced by stream
      setMessages((m) => [...m, { kind: 'text', senderAddress: walletAddress, content: body }]);
      setMessageInput('');
      pushStatus('✅ Message sent');
    } catch (err) {
      console.error('Send failed', err);
    }
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    try {
      const el = messagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }, [messages]);

  function saveProfileLocally({ name, avatar }) {
    try {
      if (!xmtp) return;
      const data = { name: String(name || '').slice(0, 64), avatar: String(avatar || '').slice(0, 512) };
      localStorage.setItem(`templ:profile:${xmtp.inboxId}`, JSON.stringify(data));
      const me = (walletAddress || xmtp.address || '').toLowerCase();
      if (me) setProfilesByAddress((p) => ({ ...p, [me]: data }));
    } catch {}
  }

  async function broadcastProfileToGroup() {
    try {
      if (!group || !profileName) return;
      const now = Date.now();
      if (now - lastProfileBroadcastRef.current < 10_000) return; // throttle 10s
      lastProfileBroadcastRef.current = now;
      const payload = JSON.stringify({ type: 'profile', name: profileName, avatar: profileAvatar });
      await sendMessage({ group, content: payload });
    } catch {}
  }

  // When joining or switching groups, broadcast profile once for discovery
  useEffect(() => {
    if (!group || !profileName) return;
    (async () => { try { await broadcastProfileToGroup(); } catch {} })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, profileName]);

  async function handleVote(id, support) {
    if (!templAddress || !signer) return;
    await voteOnProposal({
      ethers,
      signer,
      templAddress,
      templArtifact,
      proposalId: id,
      support
    });
  }

  // moderation actions are available via contract-level APIs and backend endpoints,
  // but there is no dedicated form in the chat UI anymore

  async function handleExecuteProposal(proposalId) {
    if (!templAddress || !signer) return;
    try {
      await executeProposal({
        ethers,
        signer,
        templAddress,
        templArtifact,
        proposalId
      });
      alert(`Executed proposal ${proposalId}`);
      pushStatus(`✅ Proposal ${proposalId} executed`);
    } catch (err) {
      alert('Execution failed: ' + err.message);
    }
  }

  async function handleClaimAll() {
    if (!templAddress || !signer) return;
    setClaimLoading(true);
    let claimedSomething = false;
    try {
      if (claimable && claimable !== '0') {
        try {
          await claimMemberPool({ ethers, signer, templAddress, templArtifact });
          claimedSomething = true;
        } catch (err) {
          const msg = err?.message || String(err || '');
          if (!/NoRewardsToClaim/i.test(msg) && !/No rewards/i.test(msg)) {
            throw err;
          }
        }
      }

      let rewardsSnapshot = externalRewards || [];
      if (walletAddress) {
        try {
          rewardsSnapshot = await getExternalRewards({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
          setExternalRewards(rewardsSnapshot);
        } catch {}
      }

      const tokensToClaim = rewardsSnapshot
        .filter((reward) => reward.claimable && reward.claimable !== '0')
        .map((reward) => reward.token);
      for (const token of tokensToClaim) {
        try {
          await claimExternalToken({ ethers, signer, templAddress, templArtifact, token });
          claimedSomething = true;
        } catch (err) {
          const msg = err?.message || String(err || '');
          if (!/NoRewardsToClaim/i.test(msg) && !/No rewards/i.test(msg)) {
            throw err;
          }
        }
      }

      try {
        const info = await getTreasuryInfo({ ethers, providerOrSigner: signer, templAddress, templArtifact });
        setTreasuryInfo(info);
      } catch {}

      if (walletAddress) {
        try {
          const [nextClaimable, rewards] = await Promise.all([
            getClaimable({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress }),
            getExternalRewards({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress })
          ]);
          setClaimable(nextClaimable);
          setExternalRewards(rewards);
        } catch {
          try {
            const nextClaimable = await getClaimable({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
            setClaimable(nextClaimable);
          } catch {}
          try {
            const rewards = await getExternalRewards({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
            setExternalRewards(rewards);
          } catch {}
        }
      }

      pushStatus(claimedSomething ? '✅ Rewards claimed' : 'ℹ️ Nothing to claim');
    } catch (err) {
      alert('Claim failed: ' + (err?.message || String(err)));
    } finally {
      setClaimLoading(false);
    }
  }

  useEffect(() => {
    try {
      // @ts-ignore - expose testing helpers in e2e mode only
      if (import.meta?.env?.VITE_E2E_DEBUG === '1' && typeof window !== 'undefined') {
        window.__templTrigger = (action) => {
          dlog('[app] __templTrigger called', action);
          if (action === 'deploy') {
            handleDeploy();
          } else if (action === 'join') {
            handlePurchaseAndJoin();
          } else if (action === 'navigate-chat') {
            navigate('/chat');
          }
        };
      }
    } catch {}
  }, [navigate, handleDeploy, handlePurchaseAndJoin]);

  // Check if user is priest
  useEffect(() => {
    async function checkPriest() {
      if (!templAddress || !walletAddress || !signer) return;
      try {
        const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
        const priestAddr = await contract.priest();
        setIsPriest(priestAddr?.toLowerCase() === walletAddress.toLowerCase());
      } catch (err) {
        console.error('Error checking priest status:', err);
      }
    }
    checkPriest();
  }, [templAddress, walletAddress, signer]);

  function shorten(addr) {
    try {
      const a = String(addr);
      if (a.length <= 12) return a;
      return a.slice(0, 6) + '...' + a.slice(-6);
    } catch {
      return addr;
    }
  }
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard?.writeText(text);
      pushStatus('📋 Copied to clipboard');
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        pushStatus('📋 Copied to clipboard');
      } catch {}
    }
  }

  return (
    <div className="App min-h-screen flex flex-col overflow-x-hidden">
      {/* Header / Nav */}
      <div className="w-full border-b border-black/10">
        <div className="max-w-screen-md mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/')}>Home</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/create')}>Create</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/join')}>Join</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/chat')}>Chat</button>
          </div>
          <div className="flex items-center gap-2">
            {walletAddress && (
              <button className="px-3 py-1 rounded border border-black/20" onClick={() => setProfileOpen(true)}>Profile</button>
            )}
            <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={connectWallet}>Connect Wallet</button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-md w-full mx-auto px-4 py-4 flex-1 flex flex-col min-h-0">
        {/* Hidden debug payloads for tooling if needed */}
        {templAddress && (
          <div
            data-testid="deploy-info"
            data-contract-address={templAddress}
            data-group-id={groupId}
            // Keep this minimally visible for Playwright to detect
            style={{ position: 'fixed', bottom: '2px', right: '2px', width: '2px', height: '2px', opacity: 0.01 }}
          />
        )}

        {/* Contract info block accessible via Info drawer in Chat */}

        {/* Routes */}
        {path === '/' && (
          <div data-testid="templ-list" className="space-y-3">
            <h2 className="text-xl font-semibold">Templs</h2>
            {templList.length === 0 && <p>No templs yet</p>}
            {templList.map((t) => (
              <div key={t.contract} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <button type="button" title="Copy address" data-address={String(t.contract).toLowerCase()} className="text-left underline underline-offset-4 font-mono text-sm flex-1 break-words" onClick={() => copyToClipboard(t.contract)}>
                  {shorten(t.contract)}
                </button>
                <button className="px-3 py-1 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={() => navigate(`/join?address=${t.contract}`)}>Join</button>
              </div>
            ))}
            <div className="pt-2">
              <button className="px-4 py-2 rounded bg-primary text-black font-semibold" onClick={() => navigate('/create')}>Create Templ</button>
            </div>
          </div>
        )}

        {path === '/create' && (
          <div className="forms space-y-3">
        <div className="deploy space-y-2">
          <h2 className="text-xl font-semibold">Create Templ</h2>
          <div>
            <label className="block text-sm font-medium text-black/70 mb-1">Access token address</label>
            <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Token address" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-black/70 mb-1">TemplFactory address</label>
            <input
              className={`w-full border border-black/20 rounded px-3 py-2 ${FACTORY_CONFIG.address ? 'bg-black/5' : ''}`}
              placeholder="Factory address"
              value={factoryAddress}
              readOnly={Boolean(FACTORY_CONFIG.address)}
              onChange={(e) => setFactoryAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-black/70 mb-1">Protocol fee recipient (fixed)</label>
              <input className="w-full border border-black/20 rounded px-3 py-2 bg-black/5" value={protocolFeeRecipient || 'fetching…'} readOnly />
            </div>
                <div>
                <label className="block text-sm font-medium text-black/70 mb-1">Protocol percent</label>
                  <input className="w-full border border-black/20 rounded px-3 py-2 bg-black/5" value={protocolPercentNum ?? 'fetching…'} readOnly />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">Entry fee (wei)</label>
                <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Entry fee" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">Fee split (%)</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input className="border border-black/20 rounded px-3 py-2" placeholder="Burn" value={burnPercent} onChange={(e) => setBurnPercent(e.target.value)} />
                  <input className="border border-black/20 rounded px-3 py-2" placeholder="Treasury" value={treasuryPercent} onChange={(e) => setTreasuryPercent(e.target.value)} />
                  <input className="border border-black/20 rounded px-3 py-2" placeholder="Member pool" value={memberPoolPercent} onChange={(e) => setMemberPoolPercent(e.target.value)} />
                </div>
                {Number.isFinite(protocolPercentNum) && (
                  <div className={`text-xs mt-1 ${splitTotal === 100 ? 'text-black/60' : 'text-red-600'}`}>
                    Fee split total: {splitTotal}/100 (includes protocol {protocolPercentNum})
                  </div>
                )}
              </div>
              <button className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handleDeploy}>Deploy</button>
            </div>
          </div>
        )}

        {path === '/join' && (
          <div className="join space-y-3">
            <h2 className="text-xl font-semibold">Join Existing Templ</h2>
            <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Contract address" value={templAddress} onChange={(e) => updateTemplAddress(e.target.value)} />
            <button className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handlePurchaseAndJoin}>Purchase & Join</button>
            {/* Optional list if no prefill */}
            {(!templAddress || templAddress.trim() === '') && (
              <div className="space-y-2">
                {templList.map((t) => (
                  <div key={t.contract} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button type="button" title="Copy address" data-address={String(t.contract).toLowerCase()} className="text-left underline underline-offset-4 font-mono text-sm flex-1 break-words" onClick={() => copyToClipboard(t.contract)}>
                      {shorten(t.contract)}
                    </button>
                    <button className="px-3 py-1 rounded border border-black/20 w-full sm:w-auto" onClick={() => navigate(`/join?address=${t.contract}`)}>Select</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {path === '/chat' && (
          <div className="chat-shell">
            <div className="chat-header flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="avatar avatar--group" aria-hidden />
                <div>
                  <div className="text-lg font-semibold">Group Chat</div>
                  {templAddress && (
                    <div className="text-xs text-black/60">{shorten(templAddress)}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {templAddress && (
                  <button className="px-2 py-1 text-xs rounded border border-black/20" onClick={() => copyToClipboard(`${window.location.origin}/join?address=${templAddress}`)}>Copy Invite Link</button>
                )}
                {groupConnected && <span className="text-xs text-green-600" data-testid="group-connected">● Connected</span>}
                {!groupConnected && <span className="text-xs text-black/60">Connecting…</span>}
                <button className="btn" onClick={() => setProposeOpen(true)}>Propose vote</button>
                <button className="btn" onClick={() => {
                  try {
                    const el = messagesRef.current;
                    if (!el) return;
                    const poll = el.querySelector('.chat-item--poll');
                    if (poll && poll.scrollIntoView) poll.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } catch {}
                }}>See open votes</button>
                <button className="btn" onClick={() => setShowInfo((v) => !v)}>{showInfo ? 'Hide' : 'Info'}</button>
              </div>
            </div>

            {/* Always-on brief stats */}
            {templAddress && (
              <div className="text-xs text-black/70 px-1 py-1 flex items-center gap-2">
                <span>Treasurey: {treasuryInfo?.treasury || '0'}</span>
                <span>· Burned: {treasuryInfo?.totalBurnedAmount || '0'}</span>
                <span>· Claimable: <span data-testid="claimable-amount">{claimable || '0'}</span></span>
                {hasExternalClaim && (
                  <span>· External tokens: {externalRewards.filter((r) => r.claimable && r.claimable !== '0').length}</span>
                )}
                <button
                  className="btn btn-primary !px-2 !py-0.5"
                  data-testid="claim-fees-top"
                  disabled={claimLoading || !hasClaimableRewards}
                  onClick={handleClaimAll}
                >{claimLoading ? 'Claiming…' : 'Claim'}</button>
              </div>
            )}

            {showInfo && (
              <div className="drawer my-2">
                <div className="drawer-title">Group Info</div>
                <div className="drawer-grid">
                  <div className="text-sm text-black/70">DAO Status: {paused ? 'Paused' : 'Active'}</div>
                  {templAddress && (
                    <>
                      <div className="text-sm">Treasury: {treasuryInfo?.treasury || '0'}</div>
                      <div className="text-sm">Total Burned: {treasuryInfo?.totalBurnedAmount || '0'}</div>
                      <div className="text-sm flex items-center gap-2">
                        <span>Claimable (you): <span data-testid="claimable-amount-info">{claimable || '0'}</span></span>
                      </div>
                      {externalRewards.length > 0 && (
                        <div className="text-sm flex flex-col gap-1" data-testid="external-claimables">
                          <div>External claimables:</div>
                          {externalRewards.map((reward) => {
                            const isEth = reward.token === ethers.ZeroAddress;
                            const label = isEth ? 'ETH' : shorten(reward.token);
                            return (
                              <div key={reward.token} className="flex items-center gap-2">
                                <span>{label}: {reward.claimable || '0'}</span>
                                <span className="text-xs text-black/50">(pool {reward.poolBalance})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex gap-2 items-center">
                        <input className="flex-1 border border-black/20 rounded px-3 py-2" readOnly value={`${window.location.origin}/join?address=${templAddress}`} />
                        <button className="btn" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/join?address=${templAddress}`).catch(()=>{}); pushStatus('📋 Invite link copied'); }}>Copy Invite</button>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={() => navigate('/create')}>Create Proposal</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesRef} className="messages chat-main chat-list border border-black/10 rounded">
            {hasMoreHistory && (
              <div className="w-full flex justify-center py-1">
                <button className="btn" disabled={historyLoading} onClick={async () => {
                  if (!group || historyLoading) return;
                  setHistoryLoading(true);
                  const el = messagesRef.current;
                  const prevHeight = el ? el.scrollHeight : 0;
                  try {
                    const before = oldestNsRef.current;
                    const opts = before ? { limit: BigInt(100), sentBeforeNs: before } : { limit: BigInt(100) };
                    const batch = await group.messages?.(opts);
                    const list = Array.isArray(batch) ? batch.slice() : [];
                    list.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
                    if (list.length > 0) oldestNsRef.current = list[0].sentAtNs;
                    setHasMoreHistory(list.length === 100);
                    const metaUpdates = [];
                    const transformed = list.map((dm) => {
                      let raw = '';
                      try { raw = (typeof dm.content === 'string') ? dm.content : (dm.fallback || ''); } catch {}
                      let parsed = null;
                      try { parsed = JSON.parse(raw); } catch {}
                      if (parsed && parsed.type === 'proposal') {
                        const id = Number(parsed.id);
                        const title = String(parsed.title || `Proposal #${id}`);
                        const description = typeof parsed.description === 'string' ? parsed.description : undefined;
                        setProposalsById((prev) => {
                          const existing = prev[id] || {};
                          return {
                            ...prev,
                            [id]: {
                              ...existing,
                              id,
                              title,
                              description: description !== undefined ? description : existing.description,
                              yes: existing.yes ?? 0,
                              no: existing.no ?? 0
                            }
                          };
                        });
                        return { mid: dm.id, kind: 'proposal', senderAddress: '', proposalId: id, title, description };
                      }
                      if (parsed && parsed.type === 'vote') {
                        const id = Number(parsed.id);
                        const support = Boolean(parsed.support);
                        setProposalsById((prev) => {
                          const existing = prev[id] || { id, yes: 0, no: 0 };
                          const yes = (existing.yes || 0) + (support ? 1 : 0);
                          const no = (existing.no || 0) + (!support ? 1 : 0);
                          return {
                            ...prev,
                            [id]: { ...existing, id, yes, no }
                          };
                        });
                        return null;
                      }
                      if (parsed && parsed.type === 'proposal-meta') {
                        const id = Number(parsed.id);
                        const title = String(parsed.title || `Proposal #${id}`);
                        const description = typeof parsed.description === 'string' ? parsed.description : '';
                        setProposalsById((prev) => {
                          const existing = prev[id] || {};
                          return {
                            ...prev,
                            [id]: {
                              ...existing,
                              id,
                              title,
                              description,
                              yes: existing.yes ?? 0,
                              no: existing.no ?? 0
                            }
                          };
                        });
                        metaUpdates.push({ id, title, description });
                        return null;
                      }
                      if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
                        return { mid: dm.id, kind: 'system', senderAddress: '', content: parsed.type === 'templ-created' ? 'Templ created' : 'Member joined' };
                      }
                      return { mid: dm.id, kind: 'text', senderAddress: '', content: raw };
                    }).filter(Boolean);
                    setMessages((prev) => {
                      const seen = new Set(prev.map((m) => m.mid).filter(Boolean));
                      let merged = [...transformed, ...prev.filter((m) => !m.mid || !seen.has(m.mid))];
                      if (metaUpdates.length) {
                        merged = merged.map((item) => {
                          if (item?.kind === 'proposal') {
                            const hit = metaUpdates.find((u) => Number(item.proposalId) === u.id);
                            if (hit) {
                              return { ...item, title: hit.title, description: hit.description };
                            }
                          }
                          return item;
                        });
                      }
                      return merged;
                    });
                  } catch {}
                  finally {
                    setHistoryLoading(false);
                    // maintain scroll position after prepending
                    setTimeout(() => {
                      const afterEl = messagesRef.current;
                      if (el && afterEl) {
                        const delta = afterEl.scrollHeight - prevHeight;
                        afterEl.scrollTop = delta + afterEl.scrollTop;
                      }
                    }, 0);
                  }
                }}>Load previous</button>
              </div>
            )}
            {messages.map((m, i) => {
              if (m.kind === 'proposal') {
                const pid = m.proposalId;
                const poll = proposalsById[pid] || { yes: 0, no: 0 };
                const total = (poll.yes || 0) + (poll.no || 0);
                const yesPct = total ? Math.round((poll.yes || 0) * 100 / total) : 0;
                const noPct = total ? 100 - yesPct : 0;
                return (
                  <div key={i} className="chat-item chat-item--poll">
                    <div className="chat-poll">
                      <div className="chat-poll__title">{m.title || `Proposal #${pid}`}</div>
                      {poll.description && (
                        <div className="chat-poll__description" data-testid={`proposal-description-${pid}`}>{poll.description}</div>
                      )}
                      <div className="chat-poll__bars">
                        <div className="chat-poll__bar is-yes" style={{ width: `${yesPct}%` }} />
                        <div className="chat-poll__bar is-no" style={{ width: `${noPct}%` }} />
                      </div>
                      <div className="chat-poll__legend" data-testid="poll-legend">Yes <span data-testid="poll-yes-count">{poll.yes || 0}</span> · No <span data-testid="poll-no-count">{poll.no || 0}</span></div>
                      <div className="chat-poll__actions">
                        <button className="btn" onClick={() => handleVote(pid, true)}>Vote Yes</button>
                        <button className="btn" onClick={() => handleVote(pid, false)}>Vote No</button>
                        {isPriest && (
                          <button className="btn btn-primary" onClick={() => handleExecuteProposal(pid)}>Execute</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              if (m.kind === 'system') {
                return (
                  <div key={i} className="chat-item chat-item--system">{m.content}</div>
                );
              }
              const mine = walletAddress && m.senderAddress && m.senderAddress.toLowerCase() === walletAddress.toLowerCase();
              const addr = (m.senderAddress || '').toLowerCase();
              const prof = profilesByAddress[addr] || {};
              const display = (mine ? (profileName || 'You') : (prof.name || shorten(m.senderAddress)));
              return (
                <div key={i} className={`chat-item ${mine ? 'is-mine' : ''}`}>
                  {!mine && (
                    <div className="chat-ava" aria-hidden>{avatarFallback(prof.avatar, display)}</div>
                  )}
                  <div className={`chat-bubble ${mine ? 'mine' : ''}`}>
                    <div className="chat-meta">
                      <button className="chat-name" title={m.senderAddress} onClick={() => copyToClipboard(m.senderAddress)}>
                        {display}
                      </button>
                      <span className="chat-time">{formatTime(new Date())}</span>
                    </div>
                    <div className="chat-text">{m.content}</div>
                  </div>
                </div>
              );
            })}
            </div>
            <div className="chat-composer flex gap-2">
              <input className="flex-1 border border-black/20 rounded px-3 py-2" data-testid="chat-input" placeholder="Type a message" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} />
              <button className="px-3 py-2 rounded bg-primary text-black font-semibold" data-testid="chat-send" onClick={handleSend} disabled={!group && !groupId}>Send</button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden status bucket for tests (not user-facing) */}
      <div className="status" style={{ position: 'absolute', left: '-10000px', width: 0, height: 0, overflow: 'hidden' }}>{status.join('\n')}</div>

      {/* Profile Modal */}
      {profileOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setProfileOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <div className="modal__title">Your Profile</div>
              <button className="modal__close" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <div className="modal__body">
              <div className="mb-2 text-sm text-black/70">Set a display name and an optional avatar URL. This will be reused across all Templs. We’ll also broadcast it to the current group so others can see it.</div>
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-2" placeholder="Display name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Avatar URL (optional)" value={profileAvatar} onChange={(e) => setProfileAvatar(e.target.value)} />
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setProfileOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => { saveProfileLocally({ name: profileName, avatar: profileAvatar }); await broadcastProfileToGroup(); setProfileOpen(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Propose Modal */}
      {proposeOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setProposeOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <div className="modal__title">Propose a Vote</div>
              <button className="modal__close" onClick={() => setProposeOpen(false)}>×</button>
            </div>
            <div className="modal__body">
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-2" placeholder="Title" value={proposeTitle} onChange={(e) => setProposeTitle(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-3" placeholder="Description (optional)" value={proposeDesc} onChange={(e) => setProposeDesc(e.target.value)} />
              <div className="text-sm mb-2">Quick Actions</div>
              <div className="flex gap-2 mb-2">
                <button className={`btn ${proposeAction==='pause'?'btn-primary':''}`} onClick={() => setProposeAction('pause')}>Pause DAO</button>
                <button className={`btn ${proposeAction==='unpause'?'btn-primary':''}`} onClick={() => setProposeAction('unpause')}>Unpause DAO</button>
                <button className={`btn ${proposeAction==='moveTreasuryToMe'?'btn-primary':''}`} onClick={() => setProposeAction('moveTreasuryToMe')}>Move Treasury To Me</button>
                <button className={`btn ${proposeAction==='disband'?'btn-primary':''}`} onClick={() => setProposeAction('disband')}>Disband Treasury</button>
                <button className={`btn ${proposeAction==='reprice'?'btn-primary':''}`} onClick={() => setProposeAction('reprice')}>Reprice Entry Fee</button>
                <button className={`btn ${proposeAction==='rebalance'?'btn-primary':''}`} onClick={() => setProposeAction('rebalance')}>Adjust Fee Split</button>
                <button className={`btn ${proposeAction==='changePriest'?'btn-primary':''}`} onClick={() => setProposeAction('changePriest')}>Change Priest</button>
                <button className={`btn ${proposeAction==='none'?'btn-primary':''}`} onClick={() => setProposeAction('none')}>Custom/None</button>
              </div>
              <div className="text-xs text-black/60">Tip: Pause/Unpause and Move Treasury encode the call data automatically. Reprice expects a new fee in raw token units. Adjust Fee Split collects the burn/treasury/member percentages (protocol share stays at the contract’s configured value).</div>
              {proposeAction === 'reprice' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="New Entry Fee (raw units)" value={proposeFee} onChange={(e) => setProposeFee(e.target.value)} />
                  </div>
                  <div className="text-xs text-black/60">
                    Current fee: {currentFee ?? '…'}{typeof tokenDecimals === 'number' ? ` (decimals ${tokenDecimals})` : ''}
                  </div>
                </div>
              )}
              {proposeAction === 'moveTreasuryToMe' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Token address or ETH" value={proposeToken} onChange={(e) => setProposeToken(e.target.value)} />
                  </div>
                  <div className="text-xs text-black/60">Leave blank to use entry fee token.</div>
                </div>
              )}
              {proposeAction === 'disband' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Token address or ETH" value={proposeToken} onChange={(e) => setProposeToken(e.target.value)} />
                  </div>
                  <div className="text-xs text-black/60">Leave blank to disband the entry fee token. Enter ETH to target native.</div>
                </div>
              )}
              {proposeAction === 'rebalance' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div>Current split: burn {currentBurnPercent ?? '…'} / treasury {currentTreasuryPercent ?? '…'} / member {currentMemberPercent ?? '…'} / protocol {activeProtocolPercent ?? '…'}</div>
                  <div className="flex flex-col gap-2">
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Burn percent" value={proposeBurnPercent} onChange={(e) => setProposeBurnPercent(e.target.value)} />
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Treasury percent" value={proposeTreasuryPercent} onChange={(e) => setProposeTreasuryPercent(e.target.value)} />
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Member pool percent" value={proposeMemberPercent} onChange={(e) => setProposeMemberPercent(e.target.value)} />
                  </div>
                  {Number.isFinite(activeProtocolPercent) && (
                    <div className="text-xs text-black/60">Total with protocol share ({activeProtocolPercent}%): {proposeSplitTotal}/100</div>
                  )}
                </div>
              )}
              {proposeAction === 'changePriest' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="New priest address" value={proposeNewPriest} onChange={(e) => setProposeNewPriest(e.target.value)} />
                  </div>
                  <div className="text-xs text-black/60">Must be a valid address.</div>
                </div>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setProposeOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => {
                try {
                  if (!templAddress || !signer) return;
                  let callData = '0x';
                  if (proposeAction === 'pause' || proposeAction === 'unpause') {
                    try {
                      const iface = new ethers.Interface(['function setPausedDAO(bool)']);
                      callData = iface.encodeFunctionData('setPausedDAO', [proposeAction === 'pause']);
                    } catch {}
                  } else if (proposeAction === 'moveTreasuryToMe') {
                    try {
                      const me = await signer.getAddress();
                      const templ = new ethers.Contract(templAddress, templArtifact.abi, signer);
                      let tokenAddr;
                      if (!proposeToken.trim()) {
                        tokenAddr = await templ.accessToken();
                      } else if (proposeToken.trim().toLowerCase() === 'eth') {
                        tokenAddr = ethers.ZeroAddress;
                      } else {
                        tokenAddr = proposeToken.trim();
                      }
                      // Determine full withdrawable amount for the chosen token
                      let amount = 0n;
                      if (tokenAddr === ethers.ZeroAddress) {
                        amount = BigInt(await signer.provider.getBalance(templAddress));
                      } else {
                        const erc20 = new ethers.Contract(tokenAddr, ['function balanceOf(address) view returns (uint256)'], signer);
                        const bal = BigInt(await erc20.balanceOf(templAddress));
                        // For access token, available = balance - memberPoolBalance
                        if (tokenAddr.toLowerCase() === (await templ.accessToken()).toLowerCase()) {
                          const pool = BigInt(await templ.memberPoolBalance());
                          amount = bal > pool ? (bal - pool) : 0n;
                        } else {
                          amount = bal;
                        }
                      }
                      const iface = new ethers.Interface(['function withdrawTreasuryDAO(address token, address recipient, uint256 amount, string reason)']);
                      callData = iface.encodeFunctionData('withdrawTreasuryDAO', [tokenAddr, me, amount, 'Tech demo payout']);
                      if (!proposeTitle) setProposeTitle('Move Treasury to me');
                    } catch {}
                  } else if (proposeAction === 'reprice') {
                    try {
                      const newFee = BigInt(String(proposeFee || '0'));
                      const iface = new ethers.Interface(['function updateConfigDAO(address _token, uint256 _entryFee, bool _updateFeeSplit, uint256 _burnPercent, uint256 _treasuryPercent, uint256 _memberPoolPercent)']);
                      callData = iface.encodeFunctionData('updateConfigDAO', [ethers.ZeroAddress, newFee, false, 0, 0, 0]);
                      if (!proposeTitle) setProposeTitle('Reprice Entry Fee');
                      if (!proposeDesc) setProposeDesc(`Set new entry fee to ${String(newFee)}`);
                    } catch {}
                  } else if (proposeAction === 'rebalance') {
                    try {
                      if (!Number.isFinite(activeProtocolPercent)) {
                        throw new Error('Protocol percentage unavailable');
                      }
                      const burnValue = Number(proposeBurnPercent);
                      const treasuryValue = Number(proposeTreasuryPercent);
                      const memberValue = Number(proposeMemberPercent);
                      if ([burnValue, treasuryValue, memberValue].some((v) => !Number.isFinite(v) || v < 0)) {
                        throw new Error('Enter valid percentages for burn, treasury, and member pool');
                      }
                      if (![burnValue, treasuryValue, memberValue].every((v) => Number.isInteger(v))) {
                        throw new Error('Percentages must be whole numbers');
                      }
                      const total = burnValue + treasuryValue + memberValue + activeProtocolPercent;
                      if (total !== 100) {
                        throw new Error(`Percentages must sum to 100 including protocol share (${activeProtocolPercent}%)`);
                      }
                      const iface = new ethers.Interface(['function updateConfigDAO(address _token, uint256 _entryFee, bool _updateFeeSplit, uint256 _burnPercent, uint256 _treasuryPercent, uint256 _memberPoolPercent)']);
                      callData = iface.encodeFunctionData('updateConfigDAO', [ethers.ZeroAddress, 0, true, burnValue, treasuryValue, memberValue]);
                      if (!proposeTitle) setProposeTitle('Adjust Fee Split');
                      if (!proposeDesc) {
                        setProposeDesc(`Set burn/treasury/member to ${burnValue}/${treasuryValue}/${memberValue}`);
                      }
                    } catch (e) {
                      alert(e?.message || 'Invalid fee split');
                      return;
                    }
                  } else if (proposeAction === 'disband') {
                    try {
                      const templ = new ethers.Contract(templAddress, templArtifact.abi, signer);
                      const provided = String(proposeToken || '').trim();
                      let tokenAddr;
                      if (!provided) {
                        tokenAddr = await templ.accessToken();
                      } else if (provided.toLowerCase() === 'eth') {
                        tokenAddr = ethers.ZeroAddress;
                      } else {
                        if (!ethers.isAddress(provided)) throw new Error('Invalid disband token address');
                        tokenAddr = provided;
                      }
                      const iface = new ethers.Interface(['function disbandTreasuryDAO(address)']);
                      callData = iface.encodeFunctionData('disbandTreasuryDAO', [tokenAddr]);
                      if (!proposeTitle) setProposeTitle('Disband Treasury');
                      if (!proposeDesc) {
                        const label = tokenAddr === ethers.ZeroAddress ? 'ETH' : tokenAddr;
                        setProposeDesc(`Disband treasury holdings for ${label}`);
                      }
                    } catch (e) {
                      alert(e?.message || 'Invalid disband token');
                      return;
                    }
                  } else if (proposeAction === 'changePriest') {
                    try {
                      const addr = String(proposeNewPriest || '').trim();
                      if (!addr || !ethers.isAddress(addr)) throw new Error('Invalid priest address');
                      const iface = new ethers.Interface(['function changePriestDAO(address)']);
                      callData = iface.encodeFunctionData('changePriestDAO', [addr]);
                      if (!proposeTitle) setProposeTitle('Change Priest');
                      if (!proposeDesc) setProposeDesc(`Set new priest to ${addr}`);
                    } catch (e) {
                      alert(e?.message || 'Invalid address');
                      return;
                    }
                  }
                  const metaTitle = proposeTitle || 'Untitled';
                  const metaDescription = (proposeDesc || '').trim();
                  const { proposalId } = await proposeVote({ ethers, signer, templAddress, templArtifact, title: metaTitle, description: metaDescription, callData });
                  if (proposalId !== null && proposalId !== undefined) {
                    const numericId = Number(proposalId);
                    setProposalsById((prev) => {
                      const existing = prev[numericId] || {};
                      return {
                        ...prev,
                        [numericId]: {
                          ...existing,
                          id: numericId,
                          title: metaTitle,
                          description: metaDescription,
                          yes: existing.yes ?? 0,
                          no: existing.no ?? 0
                        }
                      };
                    });
                    setMessages((items) => items.map((item) => (item?.kind === 'proposal' && Number(item.proposalId) === numericId)
                      ? { ...item, title: metaTitle, description: metaDescription }
                      : item));
                    try {
                      if (xmtp) {
                        let convo = group;
                        if ((!convo || !convo.id) && groupId) {
                          convo = await waitForConversation({ xmtp, groupId, retries: 6, delayMs: 500 });
                        }
                        if (convo && typeof convo.send === 'function') {
                          const payload = { type: 'proposal-meta', id: numericId, title: metaTitle };
                          if (metaDescription) payload.description = metaDescription;
                          await convo.send(JSON.stringify(payload));
                        }
                      }
                    } catch (err) {
                      dlog('Failed to send proposal metadata', err?.message || err);
                    }
                  }
                  setProposeOpen(false);
                  setProposeTitle('');
                  setProposeDesc('');
                  setProposeAction('none');
                  setProposeFee('');
                  setProposeToken('');
                  setProposeNewPriest('');
                  setProposeBurnPercent('');
                  setProposeTreasuryPercent('');
                  setProposeMemberPercent('');
                  pushStatus('✅ Proposal submitted');
                } catch (err) {
                  alert('Proposal failed: ' + (err?.message || String(err)));
                }
              }}>Submit Proposal</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 bg-black text-white text-sm px-3 py-2 rounded shadow">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;

// UI helpers kept at bottom to avoid re-renders
function formatTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function avatarFallback(url, label) {
  if (url && /^https?:\/\//i.test(url)) {
    return <img className="avatar-img" src={url} alt="avatar" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  }
  const initials = (label || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase() || '👤';
  return <div className="avatar-fallback">{initials}</div>;
}
