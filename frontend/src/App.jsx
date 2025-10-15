// @ts-check
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  fetchDelegates,
  delegateMute,
  muteMember,
  listTempls,
  getTokenAllowance,
  getTreasuryInfo,
  getClaimable,
  getExternalRewards
} from './flows.js';
import { syncXMTP, waitForConversation } from '@shared/xmtp.js';
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

const JOINED_STORAGE_PREFIX = 'templ:joined';

function normalizeAddressLower(address) {
  if (!address) return '';
  const raw = typeof address === 'string' ? address.trim() : String(address || '').trim();
  if (!raw) return '';
  try {
    return ethers.getAddress(raw).toLowerCase();
  } catch {
    if (ethers.isAddress(raw)) {
      try {
        return ethers.getAddress(raw).toLowerCase();
      } catch {
        return raw.toLowerCase();
      }
    }
  }
  return '';
}

function loadJoinedTemplsFromStorage(storageKey = JOINED_STORAGE_PREFIX) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((value) => normalizeAddressLower(value))
      .filter(Boolean);
    return Array.from(new Set(normalized));
  } catch {
    return [];
  }
}

function joinedStorageKeyForWallet(walletLower) {
  return walletLower ? `${JOINED_STORAGE_PREFIX}:${walletLower}` : JOINED_STORAGE_PREFIX;
}

function xmtpCacheKeyForWallet(address) {
  return address ? `xmtp:cache:${address.toLowerCase()}` : null;
}

function loadXmtpCache(address) {
  const key = xmtpCacheKeyForWallet(address);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveXmtpCache(address, data) {
  const key = xmtpCacheKeyForWallet(address);
  if (!key) return;
  try {
    const existing = (() => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    })();
    const next = { ...existing, ...data };
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function installationIdToBytes(id) {
  if (!id) return null;
  try {
    if (/^0x/i.test(id)) {
      return ethers.getBytes(id);
    }
  } catch {}
  try {
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      const binary = window.atob(padded);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined') {
      return globalThis.Buffer.from(padded, 'base64');
    }
    // Fallback manual decode
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of padded) {
      if (char === '=') break;
      const index = alphabet.indexOf(char);
      if (index === -1) continue;
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return Uint8Array.from(bytes);
  } catch {
    return null;
  }
}

function formatInstallationRecord(inst) {
  if (!inst) return { id: '', timestamp: 0, bytes: null };
  let timestamp = 0;
  try {
    if (typeof inst.clientTimestampNs === 'bigint') {
      timestamp = Number(inst.clientTimestampNs / 1000000n);
    }
  } catch {}
  return {
    id: inst.id || '',
    timestamp,
    bytes: inst.bytes instanceof Uint8Array ? inst.bytes : null
  };
}

async function clearXmtpOpfs() {
  if (typeof navigator === 'undefined') return;
  const storage = navigator.storage;
  if (!storage || typeof storage.getDirectory !== 'function') return;
  try {
    const root = await storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (typeof name === 'string' && name.startsWith('xmtp-')) {
        try {
          await root.removeEntry(name, { recursive: true });
        } catch {}
      }
    }
  } catch {}
}

function resolveXmtpEnv() {
  const forced = import.meta.env.VITE_XMTP_ENV?.trim();
  if (forced) return forced;
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'dev';
  }
  return 'production';
}

function makeXmtpSigner({ address, signer, nonce }) {
  return {
    type: 'EOA',
    getAddress: () => address,
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: 'Ethereum',
      nonce
    }),
    signMessage: async (message) => {
      let toSign;
      if (message instanceof Uint8Array) {
        try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
      } else if (typeof message === 'string') {
        toSign = message;
      } else {
        toSign = String(message);
      }
      const signature = await signer.signMessage(toSign);
      return ethers.getBytes(signature);
    }
  };
}

function getStableNonce(address) {
  if (!address) return 1;
  const cache = loadXmtpCache(address);
  if (cache?.nonce) return cache.nonce;
  try {
    const saved = Number.parseInt(localStorage.getItem(`xmtp:nonce:${address.toLowerCase()}`) || '1', 10);
    if (Number.isFinite(saved) && saved > 0) {
      return saved;
    }
  } catch {}
  return 1;
}

async function pruneExcessInstallations({ address, signer, cache, env, keepInstallationId, pushStatus }) {
  if (!cache?.inboxId || !signer) return false;
  try {
    const states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
    const state = Array.isArray(states) ? states[0] : null;
    const installations = Array.isArray(state?.installations) ? state.installations : [];
    if (installations.length < 10) {
      return false;
    }
    const sorted = installations
      .map(formatInstallationRecord)
      .filter((inst) => inst.id && inst.id !== keepInstallationId);
    sorted.sort((a, b) => a.timestamp - b.timestamp);
    const maxOtherInstallations = 8; // keep at most 8 other devices so total stays under the limit
    let overflow = sorted.length - maxOtherInstallations;
    if (overflow <= 0 && installations.length > 9) {
      overflow = 1; // still above the limit, drop the oldest fallback
    }
    if (overflow <= 0) return false;
    const targets = sorted.slice(0, overflow);
    if (!targets.length) return false;
    dlog('[app] pruneExcessInstallations', { overflow, targets });
    const nonce = getStableNonce(address);
    const signerWrapper = makeXmtpSigner({ address, signer, nonce });
    const payload = targets
      .map((inst) => inst.bytes || installationIdToBytes(inst.id))
      .filter((value) => value instanceof Uint8Array);
    if (!payload.length) return false;
    await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
    if (pushStatus) {
      pushStatus(`♻️ Revoked ${targets.length} older XMTP installation${targets.length === 1 ? '' : 's'}`);
    }
    return true;
  } catch (err) {
    if (isAccessHandleError(err)) {
      throw err;
    }
    console.error('[app] prune installations failed', err?.message || err, err);
    return false;
  }
}

function isAccessHandleError(err) {
  if (!err) return false;
  const message = String(err?.message || err);
  return message.includes('createSyncAccessHandle');
}

// Curve configuration constants
const CURVE_STYLE_INDEX = {
  static: 0,
  linear: 1,
  exponential: 2
};
const CURVE_STYLE_OPTIONS = [
  { value: 'static', label: 'Static (no change)' },
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential' }
];

const BPS_SCALE = 10_000n;
const DEFAULT_CURVE_STYLE = 'exponential';
const DEFAULT_CURVE_RATE_BPS = 10_094;
const CURVE_PREVIEW_SAMPLE_MEMBERS = [1n, 2n, 3n, 5n, 10n, 20n, 50n, 100n, 250n, 500n, 1000n, 10_000n, 100_000n, 1_000_000n];
const CURVE_PREVIEW_MARKERS = [1n, 10n, 100n, 1000n, 10_000n, 100_000n, 1_000_000n];
const CURVE_PREVIEW_SAMPLE_MEMBERS_BASIC = [1n, 2n, 3n, 5n, 10n, 20n, 50n, 100n, 150n, 200n, 249n];
const CURVE_PREVIEW_MARKERS_BASIC = [1n, 10n, 100n, 249n];
const CURVE_PREVIEW_GRADIENT_ID = 'curve-preview-gradient';
const STABLE_SYMBOL_HINTS = ['USD', 'USDC', 'USDBC', 'USDT', 'DAI'];
const STATUS_ICONS = { idle: '○', pending: '⏳', success: '✅', error: '⚠️' };
const STATUS_DESCRIPTIONS = {
  idle: 'Idle',
  pending: 'In progress…',
  success: 'Completed',
  error: 'Needs attention'
};

const formatOrdinal = (value) => {
  const suffixLookup = { 1: 'st', 2: 'nd', 3: 'rd' };
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return String(value);
  const remainderHundred = normalized % 100;
  if (remainderHundred >= 11 && remainderHundred <= 13) {
    return `${normalized}th`;
  }
  const remainderTen = normalized % 10;
  const suffix = suffixLookup[remainderTen] || 'th';
  return `${normalized}${suffix}`;
};

const parseBigIntInput = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
};

const parseOptionalMaxMembers = (value) => {
  const parsed = parseBigIntInput(value);
  if (parsed === null || parsed === 0n) {
    return null;
  }
  return parsed;
};

const log10BigInt = (value) => {
  if (value === null || value <= 0n) return 0;
  const str = value.toString();
  const digits = str.length;
  const sliceLength = Math.min(15, digits);
  const leading = Number(str.slice(0, sliceLength));
  if (!Number.isFinite(leading) || leading <= 0) {
    return digits - 1;
  }
  return Math.log10(leading) + (digits - sliceLength);
};

const formatScientificNotation = (digits) => {
  const clean = String(digits || '').replace(/^0+/, '');
  if (!clean) return '0';
  if (clean.length <= 3) return clean;
  const mantissa = `${clean[0]}.${clean.slice(1, 4)}`;
  return `${mantissa}e+${clean.length - 1}`;
};

const formatUnitsAmount = (value, decimals) => {
  if (value === null) {
    return null;
  }
  try {
    const formatted = ethers.formatUnits(value, decimals);
    const [wholeRaw, fractionRaw = ''] = formatted.split('.');
    const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
    const trimmedFraction = fractionRaw.replace(/0+$/, '');
    if (whole.length <= 6) {
      const fraction = trimmedFraction.slice(0, 4);
      const suffix = trimmedFraction.length > 4 ? '…' : '';
      const integerPart = whole.length <= 15 && Number.isFinite(Number(whole))
        ? Number(whole).toLocaleString('en-US')
        : whole;
      return `${integerPart}${fraction ? `.${fraction}${suffix}` : ''}`;
    }
    const combinedDigits = (whole + trimmedFraction).replace(/^0+/, '') || '0';
    return formatScientificNotation(combinedDigits);
  } catch {
    return null;
  }
};

const resolveBaseUnitCandidates = (decimals, symbol) => {
  if (!Number.isInteger(decimals)) {
    return [];
  }
  if (decimals === 0) {
    return [
      { label: symbol || 'tokens', decimals: 0 }
    ];
  }
  if (decimals === 18) {
    return [
      { label: 'wei', decimals: 0 },
      { label: 'gwei', decimals: 9 },
      { label: symbol || 'tokens', decimals: 18 }
    ];
  }
  if (decimals === 9) {
    return [
      { label: symbol ? `${symbol} base units` : 'nano units', decimals: 0 },
      { label: symbol || 'tokens', decimals: 9 }
    ];
  }
  if (decimals === 6) {
    return [
      { label: symbol ? `${symbol} base units` : 'micro units', decimals: 0 },
      { label: symbol || 'tokens', decimals: 6 }
    ];
  }
  if (decimals === 3) {
    return [
      { label: symbol ? `${symbol} base units` : 'milli units', decimals: 0 },
      { label: symbol || 'tokens', decimals: 3 }
    ];
  }
  return [
    { label: symbol ? `${symbol} base units` : 'tokens', decimals: 0 },
    { label: symbol || 'tokens', decimals }
  ];
};

const chooseBaseUnitCandidate = (value, candidates) => {
  if (!candidates.length) return null;
  if (value === 0n) {
    return candidates[0];
  }
  const logValue = log10BigInt(value);
  for (const candidate of candidates) {
    const approxExp = logValue - candidate.decimals;
    if (!Number.isFinite(approxExp)) {
      continue;
    }
    if (approxExp >= -2 && approxExp <= 9) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
};

const formatRawUnitsDisplay = (value, decimals, symbol) => {
  if (value === null || value < 0n) {
    return null;
  }
  if (!Number.isInteger(decimals)) {
    const fallback = formatUnitsAmount(value, 0);
    if (!fallback) return null;
    return {
      amount: fallback,
      unit: symbol ? `${symbol} units` : 'tokens'
    };
  }
  const candidates = resolveBaseUnitCandidates(decimals, symbol);
  if (!candidates.length) {
    return null;
  }
  const chosen = chooseBaseUnitCandidate(value, candidates) || candidates[0];
  const display = formatUnitsAmount(value, chosen.decimals);
  if (!display) {
    return null;
  }
  return {
    amount: display,
    unit: chosen.label
  };
};

const resolveEntryFeeUnitLabel = (decimals, symbol) => {
  if (!Number.isInteger(decimals)) {
    return 'tokens';
  }
  const candidates = resolveBaseUnitCandidates(decimals, symbol);
  return candidates[0]?.label ?? 'tokens';
};

const formatTokenAmount = (value, decimals, symbol) => {
  if (!Number.isInteger(decimals)) {
    return null;
  }
  try {
    const formatted = ethers.formatUnits(value, decimals);
    const [wholeRaw, fractionRaw = ''] = formatted.split('.');
    const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
    const trimmedFraction = fractionRaw.replace(/0+$/, '');
    if (whole.length <= 6) {
      const fraction = trimmedFraction.slice(0, 4);
      const suffix = trimmedFraction.length > 4 ? '…' : '';
      const displayFraction = fraction ? `.${fraction}${suffix}` : '';
      const base = `${whole}${displayFraction}`;
      return symbol ? `${base} ${symbol}` : base;
    }
    const combinedDigits = (whole + trimmedFraction).replace(/^0+/, '') || '0';
    const scientific = formatScientificNotation(combinedDigits);
    return symbol ? `${scientific} ${symbol}` : scientific;
  } catch {
    return null;
  }
};

const formatCurvePriceDisplay = (value, decimals, symbol, usdRate) => {
  if (value === null) {
    return { primary: null, secondary: null, usd: null };
  }
  const tokenDisplay = formatTokenAmount(value, decimals, symbol);
  const rawDisplay = formatRawUnitsDisplay(value, decimals, symbol);
  const usdDisplay = formatUsdFromBigInt(value, decimals, usdRate);
  if (tokenDisplay) {
    return {
      primary: tokenDisplay,
      secondary: rawDisplay ? `≈ ${rawDisplay.amount} ${rawDisplay.unit}` : null,
      usd: usdDisplay
    };
  }
  return {
    primary: rawDisplay ? `${rawDisplay.amount} ${rawDisplay.unit}` : null,
    secondary: null,
    usd: usdDisplay
  };
};

const powBpsBigInt = (factorBps, exponent) => {
  if (exponent === 0n) {
    return BPS_SCALE;
  }
  let result = BPS_SCALE;
  let baseFactor = factorBps;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) {
      result = (result * baseFactor) / BPS_SCALE;
    }
    remaining >>= 1n;
    if (remaining > 0n) {
      baseFactor = (baseFactor * baseFactor) / BPS_SCALE;
    }
  }
  return result;
};

const applyCurveSegmentBigInt = (amount, style, rateBps, steps) => {
  if (steps === 0n || style === 'static') {
    return amount;
  }
  if (style === 'linear') {
    const offset = BPS_SCALE + rateBps * steps;
    return (amount * offset) / BPS_SCALE;
  }
  if (style === 'exponential') {
    const factor = powBpsBigInt(rateBps, steps);
    return (amount * factor) / BPS_SCALE;
  }
  return amount;
};

const computePriceForJoin = (baseFee, style, rateBps, memberIndex) => {
  if (memberIndex <= 1n) {
    return baseFee;
  }
  return applyCurveSegmentBigInt(baseFee, style, rateBps, memberIndex - 1n);
};

const formatMultiplier = (baseFee, price) => {
  if (price === null || baseFee === null || baseFee === 0n) return null;
  if (price === baseFee) return 'Same as base price';
  const logPrice = log10BigInt(price);
  const logBase = log10BigInt(baseFee);
  const delta = logPrice - logBase;
  if (!Number.isFinite(delta) || Number.isNaN(delta)) {
    return null;
  }
  if (delta < 3.5) {
    const ratio = Math.pow(10, delta);
    if (!Number.isFinite(ratio)) {
      return `~10^${delta.toFixed(1)}× base`;
    }
    const formatted = ratio >= 100
      ? ratio.toFixed(0)
      : ratio >= 10
        ? ratio.toFixed(1)
        : ratio.toFixed(2);
    return `${formatted.replace(/\.0+$/, '')}× base`;
  }
  return `~10^${delta.toFixed(1)}× base`;
};

const formatUsdAmount = (value) => {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (abs >= 1_000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  if (abs >= 0.01) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
};

const inferUsdRateForToken = (symbol, address) => {
  const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (normalizedSymbol && STABLE_SYMBOL_HINTS.some((hint) => normalizedSymbol.includes(hint))) {
    return 1;
  }
  const normalizedAddress = typeof address === 'string' ? address.trim().toLowerCase() : '';
  if (!normalizedAddress) {
    return null;
  }
  const knownStableAddresses = [
    '0x833589fcd6edb6e08f4c7c90c2b4dfa8f2edb9a3', // Base native USDC
    '0x0fa07e6a80cad0ef4c6bb7c4b8c4fae8207212b8', // USDbC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
    '0x09bc4e874d2f9f97755ce22f579f5dc1d0a3bf8d'  // USDT
  ];
  if (knownStableAddresses.includes(normalizedAddress)) {
    return 1;
  }
  return null;
};

const bigIntToDecimal = (value, decimals) => {
  if (value === null || !Number.isInteger(decimals)) {
    return null;
  }
  try {
    const formatted = ethers.formatUnits(value, decimals);
    const numeric = Number(formatted);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
};

const formatUsdFromBigInt = (value, decimals, usdRate) => {
  if (value === null || usdRate === null) {
    return null;
  }
  const amount = bigIntToDecimal(value, decimals);
  if (amount === null) {
    return null;
  }
  return formatUsdAmount(amount * usdRate);
};

const percentValueToBps = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  let numeric = null;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      numeric = parsed;
    }
  }
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  const clamped = Math.min(numeric, 100);
  return BigInt(Math.round(clamped * 100));
};

const applyPercentBigInt = (value, percentBps) => {
  if (value === null || percentBps === null) {
    return null;
  }
  try {
    return (value * percentBps) / 10000n;
  } catch {
    return null;
  }
};

const formatTokenUsdBreakdown = (value, decimals, symbol, usdRate) => {
  if (value === null) {
    return { token: null, raw: null, usd: null };
  }
  const tokenDisplay = formatTokenAmount(value, decimals, symbol);
  const rawDisplay = formatRawUnitsDisplay(value, decimals, symbol);
  const usdDisplay = formatUsdFromBigInt(value, decimals, usdRate);
  return {
    token: tokenDisplay ?? (rawDisplay ? `${rawDisplay.amount} ${rawDisplay.unit}` : null),
    raw: rawDisplay ? `${rawDisplay.amount} ${rawDisplay.unit}` : null,
    usd: usdDisplay
  };
};

const formatPreviewRangeLabel = (preview) => {
  if (!preview || !preview.ready) {
    return '1 → …';
  }
  const visibleCards = (preview.highlightCards || []).filter((card) => card.withinCap && card.price);
  if (visibleCards.length === 0) {
    return '1 → …';
  }
  const first = visibleCards[0]?.member;
  const last = visibleCards[visibleCards.length - 1]?.member;
  if (first === undefined || last === undefined) {
    return '1 → …';
  }
  try {
    const firstLabel = typeof first === 'bigint' ? first.toString() : String(first ?? '');
    const lastLabel = typeof last === 'bigint' ? last.toString() : String(last ?? '');
    if (!firstLabel || !lastLabel) {
      return '1 → …';
    }
    if (firstLabel === lastLabel) {
      return firstLabel;
    }
    return `${firstLabel} → ${lastLabel}`;
  } catch {
    return '1 → …';
  }
};

function App() {
  // Minimal client-side router (no external deps)
  const { path, query, navigate } = useAppLocation();
  const [walletAddress, setWalletAddress] = useState();
  const walletAddressLower = useMemo(() => normalizeAddressLower(walletAddress), [walletAddress]);
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
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [currentExecutionDelay, setCurrentExecutionDelay] = useState(null);
  const [currentQuorumPercent, setCurrentQuorumPercent] = useState(null);
  const [activeInboxId, setActiveInboxId] = useState('');
  const [xmtpLimitWarning, setXmtpLimitWarning] = useState(null);
  const [activeInstallationId, setActiveInstallationId] = useState('');
  const [installationsOpen, setInstallationsOpen] = useState(false);
  const [installations, setInstallations] = useState([]);
  const [installationsLoading, setInstallationsLoading] = useState(false);
  const [installationsError, setInstallationsError] = useState(null);
  const messageSeenRef = useRef(new Set());
  const [profilesByAddress, setProfilesByAddress] = useState({}); // { [addressLower]: { name, avatar } }
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [mutes, setMutes] = useState([]);
  const [delegates, setDelegates] = useState([]);
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
  const [proposeAction, setProposeAction] = useState('none'); // none | pause | unpause | moveTreasuryToMe | reprice | disband | changePriest | enableDictatorship | disableDictatorship | setMaxMembers
  const [proposeFee, setProposeFee] = useState('');
  const [proposeToken, setProposeToken] = useState('');
  const [proposeAmount, setProposeAmount] = useState('');
  const [proposeReason, setProposeReason] = useState('');
  const [proposeNewPriest, setProposeNewPriest] = useState('');
  const [proposeMaxMembers, setProposeMaxMembers] = useState('');
  const [currentFee, setCurrentFee] = useState(null);
  const [tokenDecimals, setTokenDecimals] = useState(null);
  const [currentBurnPercent, setCurrentBurnPercent] = useState(null);
  const [currentTreasuryPercent, setCurrentTreasuryPercent] = useState(null);
  const [currentMemberPercent, setCurrentMemberPercent] = useState(null);
  const [currentProtocolPercent, setCurrentProtocolPercent] = useState(null);
  const [currentMaxMembers, setCurrentMaxMembers] = useState(null);
  const [currentMemberCount, setCurrentMemberCount] = useState(null);
  const [currentAccessToken, setCurrentAccessToken] = useState(null);
  const [currentTokenSymbol, setCurrentTokenSymbol] = useState(null);
  const [templSummaries, setTemplSummaries] = useState({});
  const [approvalStage, setApprovalStage] = useState('unknown');
  const [approvalError, setApprovalError] = useState(null);
  const [approvalAllowance, setApprovalAllowance] = useState(null);
  const [proposeBurnPercent, setProposeBurnPercent] = useState('');
  const [proposeTreasuryPercent, setProposeTreasuryPercent] = useState('');
  const [proposeMemberPercent, setProposeMemberPercent] = useState('');
  const [isDictatorship, setIsDictatorship] = useState(null);
  const [createSteps, setCreateSteps] = useState({ deploy: 'idle', error: null });
  const [joinSteps, setJoinSteps] = useState({ purchase: 'idle', join: 'idle', error: null });
  const [purchaseStatusNote, setPurchaseStatusNote] = useState(null);
  const [joinStatusNote, setJoinStatusNote] = useState(null);
  const [pendingJoinAddress, setPendingJoinAddress] = useState(null);
  const [templAddress, setTemplAddress] = useState('');
  const templAddressRef = useRef('');
  const updateTemplAddress = useCallback((value) => {
    const next = typeof value === 'string' ? value.trim() : String(value || '').trim();
    dlog('[app] updateTemplAddress', next);
    templAddressRef.current = next;
    setTemplAddress(next);
  }, []);
  const [groupId, setGroupId] = useState('');
  const joinedLoggedRef = useRef(false);
  const lastProfileBroadcastRef = useRef(0);
  const autoDeployTriggeredRef = useRef(false);
  const pathIsChat = path === '/chat';
  const loadInstallationsState = useCallback(async () => {
    if (!walletAddress) {
      setInstallations([]);
      setInstallationsError('Connect a wallet to manage XMTP installations.');
      return;
    }
    const cache = loadXmtpCache(walletAddress);
    if (!cache?.inboxId) {
      setInstallations([]);
      setInstallationsError('No XMTP inbox found for this wallet yet. Join or create a templ first.');
      return;
    }
    setInstallationsLoading(true);
    setInstallationsError(null);
    try {
      const env = resolveXmtpEnv();
      let states;
      try {
        states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
      } catch (err) {
        if (isAccessHandleError(err)) {
          await clearXmtpOpfs();
          states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
        } else {
          console.error('[app] inboxStateFromInboxIds failed', err);
          throw err;
        }
      }
      const state = Array.isArray(states) ? states[0] : null;
      const list = Array.isArray(state?.installations) ? state.installations : [];
      setInstallations(list.map(formatInstallationRecord));
    } catch (err) {
      console.error('[app] loadInstallationsState failed', err?.message || err, err);
      setInstallationsError(err?.message || String(err));
    } finally {
      setInstallationsLoading(false);
    }
  }, [walletAddress]);
  const handleOpenInstallations = useCallback(async () => {
    setInstallationsOpen(true);
    await loadInstallationsState();
  }, [loadInstallationsState]);
  const handleRevokeInstallation = useCallback(async (installationId) => {
    if (!walletAddress || !signer) {
      setInstallationsError('Connect a wallet to revoke installations.');
      return;
    }
    const cache = loadXmtpCache(walletAddress);
    if (!cache?.inboxId) {
      setInstallationsError('No XMTP inbox found for this wallet.');
      return;
    }
    try {
      setInstallationsError(null);
      const env = resolveXmtpEnv();
      const nonce = getStableNonce(walletAddress);
      const signerWrapper = makeXmtpSigner({ address: walletAddress, signer, nonce });
      const target = installations.find((inst) => inst.id === installationId);
      const derivePayload = () => {
        const candidate = target?.bytes || installationIdToBytes(installationId);
        return candidate instanceof Uint8Array ? [candidate] : [];
      };
      try {
        const payload = derivePayload();
        if (!payload.length) {
          throw new Error('Unable to parse installation id for revocation');
        }
        await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
      } catch (err) {
        if (isAccessHandleError(err)) {
          await clearXmtpOpfs();
          const payload = derivePayload();
          if (!payload.length) throw err;
          await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
        } else {
          console.error('[app] revokeInstallations failed', err);
          throw err;
        }
      }
      saveXmtpCache(walletAddress, {
        installationId: cache?.installationId && cache.installationId === installationId ? null : cache?.installationId
      });
      setInstallations((prev) => prev.filter((inst) => inst.id !== installationId));
      pushStatus('✅ Installation revoked');
      await loadInstallationsState();
    } catch (err) {
      console.error('[app] handleRevokeInstallation error', err?.message || err, err);
      setInstallationsError(err?.message || String(err));
    }
  }, [walletAddress, signer, loadInstallationsState, pushStatus, installations]);
  const handleRevokeOtherInstallations = useCallback(async () => {
    if (!walletAddress || !signer) {
      setInstallationsError('Connect a wallet to revoke installations.');
      return;
    }
    const cache = loadXmtpCache(walletAddress);
    if (!cache?.inboxId) {
      setInstallationsError('No XMTP inbox found for this wallet.');
      return;
    }
    try {
      setInstallationsError(null);
      const env = resolveXmtpEnv();
      let states;
      try {
        states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
      } catch (err) {
        if (isAccessHandleError(err)) {
          await clearXmtpOpfs();
          states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
        } else {
          console.error('[app] inboxStateFromInboxIds (bulk revoke) failed', err?.message || err, err);
          throw err;
        }
      }
      const state = Array.isArray(states) ? states[0] : null;
      const targets = (state?.installations || [])
        .map(formatInstallationRecord)
        .filter((inst) => inst.id && inst.id !== activeInstallationId);
      if (!targets.length) {
        setInstallationsError('No other installations to revoke.');
        return;
      }
      dlog('[app] handleRevokeOtherInstallations', { targets });
      const nonce = getStableNonce(walletAddress);
      const signerWrapper = makeXmtpSigner({ address: walletAddress, signer, nonce });
      try {
        const payload = targets
          .map((inst) => inst.bytes || installationIdToBytes(inst.id))
          .filter((value) => value instanceof Uint8Array);
        if (!payload.length) {
          throw new Error('Unable to parse installation ids for revocation');
        }
        await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
      } catch (err) {
        if (isAccessHandleError(err)) {
          await clearXmtpOpfs();
          const payload = targets
            .map((inst) => inst.bytes || installationIdToBytes(inst.id))
            .filter((value) => value instanceof Uint8Array);
          if (!payload.length) throw err;
          await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
        } else {
          console.error('[app] bulk revoke failed', err);
          throw err;
        }
      }
      const revokedIds = targets.map((inst) => inst.id);
      if (revokedIds.includes(cache?.installationId)) {
        saveXmtpCache(walletAddress, { installationId: null });
      }
      setInstallations((prev) => prev.filter((inst) => !revokedIds.includes(inst.id)));
      pushStatus('✅ Other installations revoked');
      await loadInstallationsState();
    } catch (err) {
      console.error('[app] handleRevokeOtherInstallations error', err?.message || err, err);
      setInstallationsError(err?.message || String(err));
    }
  }, [walletAddress, signer, activeInstallationId, loadInstallationsState, pushStatus]);
  useEffect(() => {
    if (!walletAddress || !activeInboxId) return;
    loadInstallationsState();
  }, [walletAddress, activeInboxId, loadInstallationsState]);
  const normalizedGroupId = useMemo(() => (groupId ? String(groupId).toLowerCase() : ''), [groupId]);
  const normalizedTemplAddress = useMemo(() => {
    if (!templAddress) return '';
    try {
      return ethers.getAddress(templAddress).toLowerCase();
    } catch {
      try {
        return templAddress.toLowerCase();
      } catch {
        return '';
      }
    }
  }, [templAddress]);
  const chatStorageKey = useMemo(() => {
    if (normalizedGroupId) return `group:${normalizedGroupId}`;
    if (normalizedTemplAddress) return `templ:${normalizedTemplAddress}`;
    return null;
  }, [normalizedGroupId, normalizedTemplAddress]);
  const resetChatState = useCallback(() => {
    messageSeenRef.current = new Set();
    setMessages([]);
    setProposals([]);
    setProposalsById({});
    setGroup(null);
    setGroupConnected(false);
  }, []);
  const pendingJoinMatches = useMemo(() => {
    if (!pendingJoinAddress || !templAddress) return false;
    try {
      return pendingJoinAddress === templAddress.toLowerCase();
    } catch {
      return false;
    }
  }, [pendingJoinAddress, templAddress]);
  const joinStage = joinSteps.join;
  const chatProvisionState = useMemo(() => {
    if (!pathIsChat || !templAddress || pendingJoinMatches) return null;
    if (!groupId) return 'pending-group';
    if (!groupConnected) return 'syncing-group';
    return null;
  }, [pathIsChat, templAddress, pendingJoinMatches, groupId, groupConnected]);
  const joinRetryCountRef = useRef(0);
  const moderationEnabled = false;
  const zeroAddressLower = ethers.ZeroAddress.toLowerCase();
  const joinMembershipInfo = useMemo(() => {
    if (!templAddress || !ethers.isAddress(templAddress)) {
      return {
        token: null,
        formatted: null,
        raw: null,
        usd: null,
        decimals: null,
        symbol: null,
        required: null,
        isNative: false
      };
    }
    let required = null;
    try {
      if (currentFee) required = BigInt(currentFee);
    } catch {
      required = null;
    }
    const token = currentAccessToken || null;
    const isNative = token ? token.toLowerCase() === zeroAddressLower : false;
    if (!required) {
      return {
        token,
        formatted: null,
        raw: null,
        usd: null,
        decimals: tokenDecimals,
        symbol: currentTokenSymbol || (isNative ? 'ETH' : null),
        required: null,
        isNative
      };
    }
    try {
      const decimals = Number.isInteger(tokenDecimals) ? tokenDecimals : null;
      const symbol = currentTokenSymbol || (isNative ? 'ETH' : null);
      const formatted = decimals !== null
        ? formatTokenAmount(required, decimals, symbol)
        : null;
      const rawUnits = decimals !== null
        ? formatRawUnitsDisplay(required, decimals, symbol)
        : null;
      const raw = rawUnits
        ? `${rawUnits.amount} ${rawUnits.unit}`
        : `${required.toString()} raw units`;
      const usdRate = inferUsdRateForToken(symbol, (token || '').toLowerCase());
      const usd = decimals !== null ? formatUsdFromBigInt(required, decimals, usdRate) : null;
      return {
        token,
        formatted: formatted || null,
        raw,
        usd,
        decimals,
        symbol,
        required,
        isNative
      };
    } catch {
      return {
        token,
        formatted: null,
        raw: `${required.toString()} raw units`,
        usd: null,
        decimals: tokenDecimals,
        symbol: currentTokenSymbol || (isNative ? 'ETH' : null),
        required,
        isNative
      };
    }
  }, [templAddress, currentFee, tokenDecimals, currentTokenSymbol, currentAccessToken, zeroAddressLower]);
  const needsTokenApproval = !!joinMembershipInfo.token && !joinMembershipInfo.isNative;
  const approvalButtonLabel = approvalStage === 'pending'
    ? 'Approving…'
    : approvalStage === 'approved'
      ? 'Approved'
      : `Approve ${joinMembershipInfo.symbol || 'token'}`;
  const approvalButtonDisabled = approvalStage === 'pending'
    || approvalStage === 'checking'
    || approvalStage === 'approved'
    || !walletAddress
    || !templAddress
    || !joinMembershipInfo.required;
  const approvalStatusText = (() => {
    if (!needsTokenApproval) {
      return 'No approval needed for native token entry fees.';
    }
    switch (approvalStage) {
      case 'approved':
        return 'Allowance ready. You can join now.';
      case 'needs':
        return 'Approval required before purchasing access.';
      case 'pending':
        return 'Waiting for approval confirmation…';
      case 'checking':
        return 'Checking token allowance…';
      case 'error':
        return approvalError || 'Unable to read allowance.';
      default:
        return walletAddress ? 'Allowance status unavailable.' : 'Connect your wallet to check allowance.';
    }
  })();
  function formatAllowance(raw, decimals, symbol) {
    try {
      if (!raw) return raw;
      const value = BigInt(raw);
      if (decimals === null || decimals === undefined) {
        return `${value.toString()} raw units`;
      }
      const formatted = formatTokenAmount(value, decimals, symbol);
      return formatted || `${value.toString()} raw units`;
    } catch {
      return raw;
    }
  }
  const baseScanUrl = useCallback((address) => {
    if (!address) return '#';
    try { return `https://basescan.org/address/${ethers.getAddress(address)}`; } catch { return '#'; }
  }, []);
  const formatMembersLabel = useCallback((count, max) => {
    const currentLabel = Number.isFinite(count) ? count.toString() : '…';
    if (!max || max === '0') return currentLabel;
    return `${currentLabel} / ${max}`;
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!chatStorageKey) return;
    messageSeenRef.current = new Set();
    setMessages([]);
    setProposals([]);
    setProposalsById({});
  }, [chatStorageKey, normalizedTemplAddress]);
  useEffect(() => {
    setApprovalStage(needsTokenApproval ? 'checking' : 'approved');
    setApprovalError(null);
    setApprovalAllowance(null);
  }, [templAddress, walletAddress, needsTokenApproval]);
  useEffect(() => {
    if (proposeAction !== 'moveTreasuryToMe') {
      setProposeAmount('');
      setProposeReason('');
    }
    if (proposeAction !== 'moveTreasuryToMe' && proposeAction !== 'disband') {
      setProposeToken('');
    }
  }, [proposeAction]);
  useEffect(() => {
    if (!proposeOpen) {
      setProposeAmount('');
      setProposeReason('');
      setProposeToken('');
    }
  }, [proposeOpen]);
  useEffect(() => {
    setApprovalError(null);
    if (!joinMembershipInfo.token) {
      setApprovalStage('unknown');
      setApprovalAllowance(null);
      return;
    }
    if (joinMembershipInfo.isNative) {
      setApprovalStage('approved');
      setApprovalAllowance(null);
      return;
    }
    if (!walletAddress || !templAddress || !ethers.isAddress(templAddress)) {
      setApprovalStage('unknown');
      setApprovalAllowance(null);
      return;
    }
    if (!joinMembershipInfo.required) {
      setApprovalStage('checking');
      setApprovalAllowance(null);
      return;
    }
    const provider = signer?.provider ?? signer;
    if (!provider) {
      setApprovalStage('error');
      setApprovalError('Connect a wallet to check token allowance');
      return;
    }
    let cancelled = false;
    (async () => {
      setApprovalStage('checking');
      try {
        const allowance = await getTokenAllowance({
          ethers,
          providerOrSigner: provider,
          owner: walletAddress,
          token: joinMembershipInfo.token,
          spender: templAddress
        });
        if (cancelled) return;
        setApprovalAllowance(allowance.toString());
        if (allowance >= joinMembershipInfo.required) {
          setApprovalStage('approved');
        } else {
          setApprovalStage('needs');
        }
      } catch (err) {
        if (cancelled) return;
        setApprovalStage('error');
        setApprovalError(err?.message || 'Failed to read allowance');
        setApprovalAllowance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [signer, walletAddress, templAddress, joinMembershipInfo.token, joinMembershipInfo.required, joinMembershipInfo.isNative]);
  const renderStepStatus = useCallback((label, state, extra) => {
    const icon = STATUS_ICONS[state] || STATUS_ICONS.idle;
    const text = STATUS_DESCRIPTIONS[state] || STATUS_DESCRIPTIONS.idle;
    return `${icon} ${label} — ${extra || text}`;
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('templ:pendingJoin');
      if (saved) {
        setPendingJoinAddress(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (pendingJoinAddress) {
        localStorage.setItem('templ:pendingJoin', pendingJoinAddress);
      } else {
        localStorage.removeItem('templ:pendingJoin');
      }
    } catch {}
  }, [pendingJoinAddress]);

  useEffect(() => {
    const current = templAddress ? templAddress.toLowerCase() : '';
    if (!pendingJoinAddress || !current || pendingJoinAddress !== current) {
      setJoinSteps({ purchase: 'idle', join: 'idle', error: null });
      setPurchaseStatusNote(null);
      setJoinStatusNote(null);
    }
  }, [templAddress, pendingJoinAddress]);

  useEffect(() => {
    if (!pendingJoinMatches) return;
    if (joinStage === 'success' || groupConnected) {
      setPendingJoinAddress(null);
    }
  }, [pendingJoinMatches, joinStage, groupConnected]);

  useEffect(() => {
    if (path !== '/create') {
      setCreateSteps({ deploy: 'idle', error: null });
    }
  }, [path]);
  const messagesRef = useRef(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const oldestNsRef = useRef(null); // bigint
  const creatingXmtpPromiseRef = useRef(null);
  const identityReadyRef = useRef(false);
  const identityReadyPromiseRef = useRef(null);
  const membershipCheckedRef = useRef(new Set());
  
  // muting form
  const [isPriest, setIsPriest] = useState(false);
  const isDelegate = walletAddressLower ? delegates.includes(walletAddressLower) : false;
  const canModerate = isPriest || isDelegate;

  // deployment form
  const [tokenAddress, setTokenAddress] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState(() => FACTORY_CONFIG.protocolFeeRecipient || '');
  const [protocolPercent, setProtocolPercent] = useState(() => {
    const percent = Number(FACTORY_CONFIG.protocolPercent);
    if (!Number.isFinite(percent)) return 10;
    const normalized = percent > 100 ? percent / 100 : percent;
    return Number(normalized.toFixed(2));
  });
  const [entryFee, setEntryFee] = useState('');
  const [burnPercent, setBurnPercent] = useState('30');
  const [treasuryPercent, setTreasuryPercent] = useState('30');
  const [memberPoolPercent, setMemberPoolPercent] = useState('30');
  const [maxMembers, setMaxMembers] = useState('249');
  const [createTokenDecimals, setCreateTokenDecimals] = useState(null);
  const [createTokenSymbol, setCreateTokenSymbol] = useState(null);
  const [joinedTempls, setJoinedTempls] = useState(() => loadJoinedTemplsFromStorage());
  const rememberJoinedTempl = useCallback((address, options = {}) => {
    const normalized = normalizeAddressLower(address);
    if (!normalized) return;
    const walletKey = typeof options?.wallet === 'string'
      ? normalizeAddressLower(options.wallet)
      : walletAddressLower;
    const storageKey = joinedStorageKeyForWallet(walletKey);
    setJoinedTempls((prev) => {
      if (prev.includes(normalized)) {
        return prev;
      }
      const next = [...prev, normalized];
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
          if (storageKey !== JOINED_STORAGE_PREFIX) {
            window.localStorage.setItem(JOINED_STORAGE_PREFIX, JSON.stringify(next));
          }
        } catch {}
      }
      return next;
    });
  }, [walletAddressLower]);

  // curve configuration
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [priestDictatorship, setPriestDictatorship] = useState(false);
  const [curvePrimaryStyle, setCurvePrimaryStyle] = useState('exponential');
  const [curvePrimaryRateBps, setCurvePrimaryRateBps] = useState('10094');
  const [quorumPercentInput, setQuorumPercentInput] = useState('');
  const [executionDelayInput, setExecutionDelayInput] = useState('');
  const [customBurnAddress, setCustomBurnAddress] = useState('');
  const [homeLink, setHomeLink] = useState('');
  useEffect(() => {
    if (!FACTORY_CONFIG.address) {
      setShowAdvanced(true);
    }
    // FACTORY_CONFIG.address is static at module load; run once.
  }, []);
  useEffect(() => {
    if (!showAdvanced) {
      setPriestDictatorship(false);
      setQuorumPercentInput('');
      setExecutionDelayInput('');
      setCustomBurnAddress('');
    }
  }, [showAdvanced]);
  useEffect(() => {
    if (!Number.isInteger(createTokenDecimals)) return;
    const currentFee = typeof entryFee === 'string' ? entryFee.trim() : '';
    if (currentFee) return;
    try {
      const suggested = (10n ** BigInt(createTokenDecimals)).toString();
      setEntryFee(suggested);
    } catch {}
  }, [createTokenDecimals, tokenAddress, entryFee]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const last = window.localStorage.getItem('templ:lastAddress');
      if (last && ethers.isAddress(last)) rememberJoinedTempl(last);
    } catch {}
  }, [rememberJoinedTempl]);
  useEffect(() => {
    membershipCheckedRef.current = new Set();
    const storageKey = joinedStorageKeyForWallet(walletAddressLower);
    const stored = loadJoinedTemplsFromStorage(storageKey);
    setJoinedTempls((prev) => {
      const next = stored;
      if (next.length === prev.length && next.every((addr, idx) => addr === prev[idx])) {
        return prev;
      }
      return next;
    });
  }, [walletAddressLower]);
  useEffect(() => {
    const trimmed = typeof tokenAddress === 'string' ? tokenAddress.trim() : '';
    if (!ethers.isAddress(trimmed)) {
      setCreateTokenDecimals(null);
      setCreateTokenSymbol(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let reader = signer;
        if (!reader) {
          if (typeof window !== 'undefined' && window?.ethereum) {
            try {
              reader = new ethers.BrowserProvider(window.ethereum);
            } catch {
              if (!cancelled) {
                setCreateTokenDecimals(null);
                setCreateTokenSymbol(null);
              }
              return;
            }
          } else {
            if (!cancelled) {
              setCreateTokenDecimals(null);
              setCreateTokenSymbol(null);
            }
            return;
          }
        }
        const tokenContract = new ethers.Contract(
          trimmed,
          ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
          reader
        );
        let decimals = null;
        try {
          const rawDecimals = await tokenContract.decimals();
          const parsedDecimals = Number(rawDecimals);
          decimals = Number.isFinite(parsedDecimals) ? parsedDecimals : null;
        } catch {
          decimals = null;
        }
        let symbol = null;
        try {
          const rawSymbol = await tokenContract.symbol();
          if (typeof rawSymbol === 'string' && rawSymbol.trim().length > 0) {
            symbol = rawSymbol.trim();
          }
        } catch {
          symbol = null;
        }
        if (cancelled) return;
        setCreateTokenDecimals(decimals);
        setCreateTokenSymbol(symbol);
      } catch {
        if (!cancelled) {
          setCreateTokenDecimals(null);
          setCreateTokenSymbol(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenAddress, signer]);

  // telegram binding handled via external operator tooling

  // Governance: all members have 1 vote



  const tokenAddressValid = (() => {
    try {
      return ethers.isAddress(String(tokenAddress || '').trim());
    } catch {
      return false;
    }
  })();
  const joinedTemplSet = useMemo(() => new Set(joinedTempls), [joinedTempls]);
  const alreadyMember = normalizedTemplAddress ? joinedTemplSet.has(normalizedTemplAddress) : false;
  const showApprovalPrompt = needsTokenApproval && !alreadyMember;
  useEffect(() => {
    if (!walletAddress || !walletAddressLower || !signer) return;
    const memberAddress = walletAddress;
    const runner = signer.provider ?? signer;
    if (!runner) return;
    const addressesToCheck = templList
      .map((item) => normalizeAddressLower(item.contract))
      .filter((contractAddress) => contractAddress
        && !joinedTemplSet.has(contractAddress)
        && !membershipCheckedRef.current.has(contractAddress));
    if (addressesToCheck.length === 0) return;
    let cancelled = false;
    addressesToCheck.forEach((addr) => membershipCheckedRef.current.add(addr));
    (async () => {
      const checks = addressesToCheck.map(async (contractAddress) => {
        try {
          const contract = new ethers.Contract(contractAddress, templArtifact.abi, runner);
          let joined = false;
          if (typeof contract.isMember === 'function') {
            joined = await contract.isMember(memberAddress);
          } else if (typeof contract.hasAccess === 'function') {
            joined = await contract.hasAccess(memberAddress);
          }
          if (cancelled || !joined) return;
          rememberJoinedTempl(contractAddress, { wallet: memberAddress });
        } catch (err) {
          dlog('[app] membership probe failed', { contractAddress, error: err?.message || err });
        }
      });
      await Promise.all(checks);
    })();
    return () => {
      cancelled = true;
    };
  }, [templList, walletAddress, walletAddressLower, signer, joinedTemplSet, rememberJoinedTempl]);
  const burnPercentNum = Number.isFinite(Number(burnPercent)) ? Number(burnPercent) : 0;
  const treasuryPercentNum = Number.isFinite(Number(treasuryPercent)) ? Number(treasuryPercent) : 0;
  const memberPoolPercentNum = Number.isFinite(Number(memberPoolPercent)) ? Number(memberPoolPercent) : 0;
  const protocolPercentNum = Number.isFinite(Number(protocolPercent)) ? Number(protocolPercent) : null;
  const formatPercentText = (value) => {
    if (!Number.isFinite(value)) return null;
    const fixed = value.toFixed(2);
    if (fixed.endsWith('.00')) return fixed.slice(0, -3);
    if (fixed.endsWith('0')) return fixed.slice(0, -1);
    return fixed;
  };
  const splitTotal = burnPercentNum + treasuryPercentNum + memberPoolPercentNum + (protocolPercentNum ?? 0);
  const splitBalanced = Number.isFinite(splitTotal) ? Math.abs(splitTotal - 100) < 0.001 : false;
  const splitTotalDisplay = Number.isFinite(splitTotal) ? formatPercentText(splitTotal) : null;
  const protocolPercentDisplay = protocolPercentNum !== null && Number.isFinite(protocolPercentNum)
    ? formatPercentText(protocolPercentNum)
    : null;
  const tokenAddressTrimmed = typeof tokenAddress === 'string' ? tokenAddress.trim() : '';
  const tokenAddressLower = tokenAddressTrimmed ? tokenAddressTrimmed.toLowerCase() : '';
  const entryFeeDisplay = (() => {
    if (!Number.isInteger(createTokenDecimals)) return null;
    const raw = String(entryFee || '').trim();
    if (!/^\d+$/.test(raw) || raw === '') return null;
    try {
      let formatted = ethers.formatUnits(raw, createTokenDecimals);
      if (formatted.includes('.')) {
        formatted = formatted.replace(/\.?0+$/, '');
      }
      return formatted;
    } catch {
      return null;
    }
  })();
  const entryFeeUnitLabel = resolveEntryFeeUnitLabel(createTokenDecimals, createTokenSymbol);
  const entryFeeBigInt = parseBigIntInput(entryFee);
  const entryFeeRawDisplay = entryFeeBigInt === null
    ? null
    : formatRawUnitsDisplay(entryFeeBigInt, createTokenDecimals, createTokenSymbol);
  const usdRateHint = inferUsdRateForToken(createTokenSymbol, tokenAddressLower);
  const entryFeeUsdDisplay = formatUsdFromBigInt(entryFeeBigInt, createTokenDecimals, usdRateHint);
  const activeProtocolPercent = Number.isFinite(currentProtocolPercent) ? currentProtocolPercent : protocolPercentNum;
  const parsedBurnInput = Number.isFinite(Number(proposeBurnPercent)) ? Number(proposeBurnPercent) : 0;
  const parsedTreasuryInput = Number.isFinite(Number(proposeTreasuryPercent)) ? Number(proposeTreasuryPercent) : 0;
  const parsedMemberInput = Number.isFinite(Number(proposeMemberPercent)) ? Number(proposeMemberPercent) : 0;
  const proposeSplitTotal = parsedBurnInput + parsedTreasuryInput + parsedMemberInput + (Number.isFinite(activeProtocolPercent) ? activeProtocolPercent : 0);
  const templCards = useMemo(() => {
    const current = String(templAddress || '').toLowerCase();
    const items = templList.map((item) => {
      const contract = String(item.contract || '').toLowerCase();
      const joined = joinedTemplSet.has(contract) || (current && contract === current);
      const summary = templSummaries[contract];
      const members = summary?.status === 'ready' && summary.memberCount !== undefined
        ? Number(summary.memberCount)
        : null;
      const maxMembers = summary?.status === 'ready' ? summary.maxMembers : null;
      const tokenAddrRaw = summary?.status === 'ready' ? summary.token : null;
      const tokenAddress = tokenAddrRaw ? String(tokenAddrRaw).toLowerCase() : null;
      const tokenSymbol = summary?.status === 'ready'
        ? (summary.symbol || (tokenAddress === zeroAddressLower ? 'ETH' : null))
        : null;
      const entryFeeDisplay = summary?.status === 'ready' ? (summary.formatted || summary.raw || null) : null;
      const entryFeeRaw = summary?.status === 'ready' ? summary.raw : null;
      const entryFeeUsd = summary?.status === 'ready' ? summary.usd : null;
      const decimals = summary?.status === 'ready' ? summary.decimals : null;
      return {
        ...item,
        contract,
        joined,
        memberCount: members,
        maxMembers,
        summary,
        tokenAddress,
        tokenSymbol,
        entryFeeDisplay,
        entryFeeRaw,
        entryFeeUsd,
        decimals
      };
    });
    items.sort((a, b) => {
      if (a.joined && !b.joined) return -1;
      if (!a.joined && b.joined) return 1;
      const aCount = Number.isFinite(a.memberCount) ? a.memberCount : -1;
      const bCount = Number.isFinite(b.memberCount) ? b.memberCount : -1;
      if (aCount !== bCount) return bCount - aCount;
      return a.contract.localeCompare(b.contract);
    });
    return items;
  }, [templList, joinedTemplSet, templAddress, templSummaries, zeroAddressLower]);
  const maxMembersValue = currentMaxMembers === null ? null : String(currentMaxMembers);
  const memberCountValue = currentMemberCount === null ? null : String(currentMemberCount);
  const maxMembersLabel = maxMembersValue === null ? '…' : (maxMembersValue === '0' ? 'Unlimited' : maxMembersValue);
  const memberCountLabel = memberCountValue === null ? '…' : memberCountValue;
  const memberCountWithLimit = maxMembersValue && maxMembersValue !== '0'
    ? `${memberCountLabel} / ${maxMembersValue}`
    : memberCountLabel;
  let limitReached = false;
  try {
    if (maxMembersValue !== null && maxMembersValue !== '0' && memberCountValue !== null) {
      limitReached = BigInt(memberCountValue) >= BigInt(maxMembersValue);
    }
  } catch {}

  // Curve configuration helpers
  const resolveCurveStyleValue = (styleKey) => {
    switch (styleKey) {
      case 'linear':
        return CURVE_STYLE_INDEX.linear;
      case 'exponential':
        return CURVE_STYLE_INDEX.exponential;
      default:
        return CURVE_STYLE_INDEX.static;
    }
  };

  const parseCurveRateBps = (value, styleKey) => {
    const parsed = Number.parseInt(String(value ?? '0'), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    if (styleKey === 'static') {
      return 0;
    }
    return Math.min(parsed, 1_000_000);
  };

  const curveConfig = useMemo(() => {
    if (!showAdvanced) {
      return {
        primary: { style: CURVE_STYLE_INDEX.static, rateBps: 0 }
      };
    }
    return {
      primary: {
        style: resolveCurveStyleValue(curvePrimaryStyle),
        rateBps: parseCurveRateBps(curvePrimaryRateBps, curvePrimaryStyle)
      }
    };
  }, [curvePrimaryRateBps, curvePrimaryStyle, showAdvanced]);

  const curvePreview = useMemo(() => {
    const baseFee = parseBigIntInput(entryFee);
    if (baseFee === null || baseFee <= 0n) {
      return { ready: false, reason: 'entry-fee' };
    }
    const decimals = Number.isInteger(createTokenDecimals) ? Number(createTokenDecimals) : null;
    const symbol = typeof createTokenSymbol === 'string' && createTokenSymbol.trim() ? createTokenSymbol.trim() : null;
    const previewMode = showAdvanced ? 'custom' : 'default';
    const style = previewMode === 'custom' ? curvePrimaryStyle : DEFAULT_CURVE_STYLE;
    let rate = previewMode === 'custom'
      ? BigInt(parseCurveRateBps(curvePrimaryRateBps, curvePrimaryStyle))
      : BigInt(DEFAULT_CURVE_RATE_BPS);
    if (style === 'static') {
      rate = 0n;
    }
    const cap = parseOptionalMaxMembers(maxMembers);
    const markerBase = showAdvanced ? CURVE_PREVIEW_MARKERS : CURVE_PREVIEW_MARKERS_BASIC;
    const sampleBase = showAdvanced ? CURVE_PREVIEW_SAMPLE_MEMBERS : CURVE_PREVIEW_SAMPLE_MEMBERS_BASIC;
    const usdRate = inferUsdRateForToken(symbol, tokenAddressLower);
    const burnPercentBps = percentValueToBps(burnPercent);
    const treasuryPercentBps = percentValueToBps(treasuryPercent);
    const markerStrings = [
      ...markerBase.map((value) => value.toString()),
      ...(cap !== null && cap > 0n ? [cap.toString()] : [])
    ];
    let highlightMarkers = Array.from(new Set(markerStrings)).map((value) => BigInt(value));
    if (!showAdvanced && cap !== null && cap > 0n) {
      highlightMarkers = highlightMarkers.filter((member) => member <= cap);
    }
    highlightMarkers = [...highlightMarkers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const cumulativeFeeByMember = new Map();
    let cumulativeFees = 0n;
    let lastMemberComputed = 0n;
    for (const member of highlightMarkers) {
      if (cap !== null && member > cap) {
        break;
      }
      let current = lastMemberComputed + 1n;
      if (current < 1n) current = 1n;
      while (current <= member) {
        const joinPrice = computePriceForJoin(baseFee, style, rate, current);
        cumulativeFees += joinPrice;
        current += 1n;
      }
      cumulativeFeeByMember.set(member.toString(), cumulativeFees);
      if (member > lastMemberComputed) {
        lastMemberComputed = member;
      }
    }
    const highlightCards = highlightMarkers.map((member) => {
      const withinCap = cap === null || member <= cap;
      const price = withinCap ? computePriceForJoin(baseFee, style, rate, member) : null;
      const cumulativeFee = withinCap ? (cumulativeFeeByMember.get(member.toString()) ?? null) : null;
      const burnTotal = applyPercentBigInt(cumulativeFee, burnPercentBps);
      const treasuryTotal = applyPercentBigInt(cumulativeFee, treasuryPercentBps);
      return {
        key: member.toString(),
        member,
        ordinalLabel: `${formatOrdinal(Number(member))} member${Number(member) === 1 ? '' : 's'}`,
        withinCap,
        price,
        display: formatCurvePriceDisplay(price, decimals, symbol, usdRate),
        multiplier: price !== null ? formatMultiplier(baseFee, price) : null,
        burnTotal: formatTokenUsdBreakdown(burnTotal, decimals, symbol, usdRate),
        treasuryTotal: formatTokenUsdBreakdown(treasuryTotal, decimals, symbol, usdRate)
      };
    });
    const cappedMembers = highlightCards.filter((card) => !card.withinCap);
    let sampleMembers = sampleBase.filter((member) => cap === null || member <= cap);
    if (cap !== null && cap > 0n && !sampleMembers.some((member) => member === cap)) {
      sampleMembers = [...sampleMembers, cap];
    }
    if (sampleMembers.length === 0) {
      sampleMembers = [1n];
    }
    sampleMembers = [...sampleMembers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const chartPointsRaw = sampleMembers.map((member) => {
      const price = computePriceForJoin(baseFee, style, rate, member);
      return {
        member,
        price,
        logMember: Math.log10(Number(member)),
        logPrice: log10BigInt(price)
      };
    });
    const logMembers = chartPointsRaw.map((point) => point.logMember);
    const logPrices = chartPointsRaw.map((point) => point.logPrice);
    const minLogMember = Math.min(...logMembers);
    const maxLogMember = Math.max(...logMembers);
    const minLogPrice = Math.min(...logPrices);
    const maxLogPrice = Math.max(...logPrices);
    const xRange = maxLogMember - minLogMember || 1;
    const yRange = maxLogPrice - minLogPrice || 1;
    const chartWidth = 560;
    const chartHeight = 180;
    const margin = { top: 12, right: 16, bottom: 28, left: 36 };
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;
    const baselineY = chartHeight - margin.bottom;
    const chartPoints = chartPointsRaw.map((point) => {
      const x = xRange === 0
        ? margin.left + innerWidth / 2
        : margin.left + ((point.logMember - minLogMember) / xRange) * innerWidth;
      const y = yRange === 0
        ? baselineY - innerHeight / 2
        : baselineY - ((point.logPrice - minLogPrice) / yRange) * innerHeight;
      return {
        ...point,
        x,
        y,
        axisMember: Number(point.member)
      };
    });
    const linePath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    let areaPath = '';
    if (chartPoints.length >= 2 && linePath) {
      const first = chartPoints[0];
      const last = chartPoints[chartPoints.length - 1];
      areaPath = `${linePath} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
    }
    const axisTicksSet = new Set();
    chartPoints.forEach((point) => {
      axisTicksSet.add(point.axisMember);
    });
    highlightMarkers.forEach((marker) => {
      const numeric = Number(marker);
      const minMember = chartPoints[0]?.axisMember ?? numeric;
      const maxMember = chartPoints[chartPoints.length - 1]?.axisMember ?? numeric;
      if (numeric >= minMember && numeric <= maxMember) {
        axisTicksSet.add(numeric);
      }
    });
    const axisTicks = Array.from(axisTicksSet)
      .sort((a, b) => a - b)
      .map((value) => ({
        value,
        label: value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : String(value)
      }));
    const highlightWithPoints = highlightCards.map((card) => {
      if (!card.withinCap || !card.price) {
        return { ...card, chartPosition: null };
      }
      const point = chartPoints.find((item) => item.member === card.member);
      if (!point) {
        return { ...card, chartPosition: null };
      }
      return {
        ...card,
        chartPosition: { x: point.x, y: point.y }
      };
    });
    const styleOption = CURVE_STYLE_OPTIONS.find((option) => option.value === style);
    const rateNumber = Number(rate);
    let rateDescriptor = null;
    if (style === 'linear') {
      rateDescriptor = `+${(rateNumber / 100).toFixed(rateNumber % 100 === 0 ? 0 : 2)}% per member`;
    } else if (style === 'exponential') {
      const multiplier = rateNumber / 10000;
      const percent = (multiplier - 1) * 100;
      rateDescriptor = `×${multiplier.toFixed(multiplier >= 10 ? 1 : 2)} per member (~${percent.toFixed(2)}%)`;
    } else {
      rateDescriptor = 'Flat price';
    }
    const footnote = cappedMembers.length > 0 && cap
      ? `Max members cap (${cap.toString()}) prevents reaching the ${cappedMembers.map((item) => item.ordinalLabel).join(', ')}.`
      : null;
    const modeLabel = previewMode === 'custom' ? 'Custom curve' : 'Factory default';
    const metaNote = null;
    return {
      ready: true,
      meta: {
        mode: previewMode,
        modeLabel,
        style,
        styleLabel: styleOption?.label ?? style,
        rateDescriptor,
        note: metaNote
      },
      highlightCards: highlightWithPoints,
      chart: {
        width: chartWidth,
        height: chartHeight,
        linePath,
        areaPath,
        highlightPoints: highlightWithPoints
          .map((card) => card.chartPosition)
          .filter(Boolean),
        axisTicks,
        baselineY
      },
      footnote
    };
  }, [
    curvePrimaryRateBps,
    curvePrimaryStyle,
    createTokenDecimals,
    createTokenSymbol,
    entryFee,
    maxMembers,
    showAdvanced,
    burnPercent,
    treasuryPercent,
    tokenAddressLower
  ]);

  // Fetch entry fee and token decimals for display in reprice UI
  useEffect(() => {
    setCurrentFee(null);
    setTokenDecimals(null);
    setCurrentAccessToken(null);
    setCurrentTokenSymbol(null);
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
        let maxMembersRaw = null;
        let memberCountRaw = null;
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
        try { maxMembersRaw = await c.MAX_MEMBERS(); } catch {}
        try {
          memberCountRaw = await c.getMemberCount();
        } catch {
          memberCountRaw = null;
        }
        let dictatorshipState = null;
        try {
          dictatorshipState = await c.priestIsDictator();
        } catch {}
        let dec = null;
        let symbol = null;
        if (tokenAddr && String(tokenAddr).toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
          dec = 18;
          symbol = 'ETH';
        } else if (tokenAddr) {
          try {
            const erc20Meta = new ethers.Contract(tokenAddr, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'], providerOrSigner);
            dec = Number(await erc20Meta.decimals());
            const rawSymbol = await erc20Meta.symbol();
            if (typeof rawSymbol === 'string' && rawSymbol.trim()) {
              symbol = rawSymbol.trim();
            }
          } catch {
            try {
              const erc20Decimals = new ethers.Contract(tokenAddr, ['function decimals() view returns (uint8)'], providerOrSigner);
              dec = Number(await erc20Decimals.decimals());
            } catch {}
          }
        }
        if (!cancelled) {
          const normalizedBurn = Number.isFinite(burnPct) ? Number((burnPct / 100).toFixed(2)) : null;
          const normalizedTreasury = Number.isFinite(treasuryPct) ? Number((treasuryPct / 100).toFixed(2)) : null;
          const normalizedMember = Number.isFinite(memberPct) ? Number((memberPct / 100).toFixed(2)) : null;
          const normalizedProtocol = Number.isFinite(protocolPct) ? Number((protocolPct / 100).toFixed(2)) : null;
          setCurrentFee(fee.toString());
          setTokenDecimals(dec);
          try {
            setCurrentAccessToken(tokenAddr ? ethers.getAddress(tokenAddr) : null);
          } catch {
            setCurrentAccessToken(tokenAddr || null);
          }
          setCurrentTokenSymbol(symbol);
          setCurrentBurnPercent(normalizedBurn);
          setCurrentTreasuryPercent(normalizedTreasury);
          setCurrentMemberPercent(normalizedMember);
          setCurrentProtocolPercent(normalizedProtocol);
          if (dictatorshipState !== null) {
            setIsDictatorship(Boolean(dictatorshipState));
          } else {
            setIsDictatorship(null);
          }
          if (maxMembersRaw !== null && maxMembersRaw !== undefined) {
            try { setCurrentMaxMembers(String(maxMembersRaw)); } catch { setCurrentMaxMembers(null); }
          } else {
            setCurrentMaxMembers(null);
          }
          if (memberCountRaw !== null && memberCountRaw !== undefined) {
            try { setCurrentMemberCount(String(memberCountRaw)); } catch { setCurrentMemberCount(null); }
          } else {
            setCurrentMemberCount(null);
          }
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
    const nextSigner = await provider.getSigner();
    const address = await nextSigner.getAddress();
    setSigner(nextSigner);
    setWalletAddress(address);
    setXmtpLimitWarning(null);
    pushStatus('✅ Wallet connected');

    // Tear down any existing XMTP session before rotating wallets.
    try {
      if (creatingXmtpPromiseRef.current) {
        try {
          const pendingClient = await creatingXmtpPromiseRef.current;
          await pendingClient?.close?.();
        } catch {}
      }
      creatingXmtpPromiseRef.current = null;
      if (xmtp && typeof xmtp.close === 'function') {
        await xmtp.close();
      }
    } catch {}
    identityReadyRef.current = false;
    identityReadyPromiseRef.current = null;
    setXmtp(undefined);
    setActiveInboxId('');
    resetChatState();
    setPendingJoinAddress(null);
    setPurchaseStatusNote(null);
    setJoinStatusNote(null);
    setProfileOpen(false);

    const xmtpEnv = resolveXmtpEnv();
    const cache = loadXmtpCache(address);
    const storageKey = `xmtp:nonce:${address.toLowerCase()}`;
    const uniqueDbPath = `xmtp-${xmtpEnv}-${Date.now()}-${Math.random().toString(36).slice(2)}.db3`;
    const baseOptions = {
      env: xmtpEnv,
      appVersion: 'templ/0.1.0',
      dbOptions: { type: 'opfs', path: uniqueDbPath }
    };

    await clearXmtpOpfs();

    const candidateSet = new Set();
    if (cache?.nonce) candidateSet.add(Number(cache.nonce));
    try {
      const saved = Number.parseInt(localStorage.getItem(storageKey) || '1', 10);
      if (Number.isFinite(saved) && saved > 0) {
        candidateSet.add(saved);
      }
    } catch {}
    for (let i = 1; i <= 12; i++) {
      candidateSet.add(i);
    }
    const candidateNonces = Array.from(candidateSet).filter((value) => Number.isFinite(value) && value > 0);

    async function createClientWithNonce(nonce, disableAutoRegister) {
      const signerWrapper = makeXmtpSigner({ address, signer: nextSigner, nonce });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;
      dlog('[app] Creating XMTP client', { disableAutoRegister, nonce });
      const clientInstance = await Client.create(signerWrapper, options);
      try { localStorage.setItem(storageKey, String(nonce)); } catch {}
      saveXmtpCache(address, {
        nonce,
        inboxId: clientInstance.inboxId,
        installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
      });
      return clientInstance;
    }

    async function createOrResumeXmtp() {
      let clearedOpfs = false;
      const ensureOpfsCleared = async () => {
        if (clearedOpfs) return;
        await clearXmtpOpfs();
        clearedOpfs = true;
      };
      if (cache?.inboxId) {
        try {
          await pruneExcessInstallations({
            address,
            signer: nextSigner,
            cache,
            env: xmtpEnv,
            keepInstallationId: cache?.installationId || '',
            pushStatus
          });
        } catch (err) {
          if (isAccessHandleError(err)) {
            await ensureOpfsCleared();
          }
        }
      }
      let limitEncountered = false;
      for (const nonce of candidateNonces) {
        try {
          return await createClientWithNonce(nonce, true);
        } catch (err) {
          const msg = String(err?.message || err);
          if (isAccessHandleError(err)) {
            await ensureOpfsCleared();
            continue;
          }
          if (msg.includes('already registered 10/10 installations')) {
            limitEncountered = true;
            continue;
          }
          if (msg.toLowerCase().includes('register') || msg.toLowerCase().includes('inbox')) {
            continue;
          }
        }
      }
      if (limitEncountered) {
        const limitError = new Error('XMTP installation limit reached for this wallet. Please revoke older installations or switch wallets.');
        limitError.name = 'XMTP_LIMIT';
        throw limitError;
      }
      try {
        const fallbackNonce = candidateNonces[0] || 1;
        return await createClientWithNonce(fallbackNonce, false);
      } catch (err) {
        const msg = String(err?.message || err);
        if (isAccessHandleError(err)) {
          await ensureOpfsCleared();
          return await createClientWithNonce(candidateNonces[0] || 1, false);
        }
        if (msg.includes('already registered 10/10 installations')) {
          const limitError = new Error('XMTP installation limit reached for this wallet. Please revoke older installations or switch wallets.');
          limitError.name = 'XMTP_LIMIT';
          throw limitError;
        }
        throw err;
      }
    }

    let client;
    try {
      if (creatingXmtpPromiseRef.current) {
        client = await creatingXmtpPromiseRef.current;
      } else {
        const p = (async () => {
          return await createOrResumeXmtp();
        })().finally(() => { creatingXmtpPromiseRef.current = null; });
        creatingXmtpPromiseRef.current = p;
        client = await p;
      }
    } catch (err) {
      creatingXmtpPromiseRef.current = null;
      setXmtp(undefined);
      setActiveInboxId('');
      setActiveInstallationId('');
      const message = String(err?.message || err);
      console.error('[app] XMTP client initialisation failed', err?.message || err, err);
      if (err?.name === 'XMTP_LIMIT' || message.includes('installation limit')) {
        setXmtpLimitWarning(message);
        pushStatus('⚠️ XMTP limit reached. Use a different wallet or revoke old inboxes.');
      } else {
        pushStatus('❌ Failed to initialise XMTP: ' + message);
      }
      return;
    }
    setActiveInboxId(client?.inboxId || '');
    setActiveInstallationId(client?.installationId ? String(client.installationId) : '');
    setXmtp(client);
    setXmtpLimitWarning(null);
    setInstallationsError(null);
    setInstallations([]);
    dlog('[app] XMTP client created', { env: xmtpEnv, inboxId: client.inboxId });
    // Kick off identity readiness check in background so deploy/join can await it later
    try {
      const ensureReady = async () => {
        const onLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
        const env = forcedEnv || (onLocalhost ? 'dev' : null);
        if (!env) {
          identityReadyRef.current = true;
          return true;
        }
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
              const debugMid = `debug:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
              if (messageSeenRef.current.has(`mid:${debugMid}`)) return;
              messageSeenRef.current.add(`mid:${debugMid}`);
              setMessages((m) => [...m, { mid: debugMid, kind: 'text', senderAddress: String(from || '').toLowerCase(), content: String(content || '') }]);
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
        if (!Number.isNaN(bpNum)) {
          const normalized = Number((bpNum / 100).toFixed(2));
          if (Math.abs(normalized - protocolPercent) >= 0.001) {
            setProtocolPercent(normalized);
          }
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
      setCreateSteps({ deploy: 'pending', error: null });
      setJoinSteps({ purchase: 'idle', join: 'idle', error: null });
      pushStatus('🔄 Deploying templ (tx 1/1)');
      console.log('[app] handleDeploy start', {
        signer: !!signer,
        xmtp: !!xmtp,
        tokenAddress,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent,
        protocolPercent,
        factoryAddress,
        maxMembers
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
    const limitInput = String(maxMembers || '').trim();
    if (limitInput && !/^\d+$/.test(limitInput)) {
      alert('Max members must be a non-negative integer');
      return;
    }
    let normalizedMaxMembers = 0n;
    try {
      normalizedMaxMembers = limitInput ? BigInt(limitInput) : 0n;
      if (!showAdvanced && normalizedMaxMembers === 249n) {
        normalizedMaxMembers = 0n;
      }
    } catch {
      alert('Invalid max members value');
      return;
    }
    const splits = [burnPercent, treasuryPercent, memberPoolPercent];
    const percentPattern = /^\d+(\.\d{1,2})?$/;
    if (!splits.every((n) => percentPattern.test(String(n ?? '').trim()))) {
      alert('Percentages must be numeric with up to two decimal places');
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
      if (Math.abs(totalSplit - 100) >= 0.001) {
        alert(`Fee split must sum to 100. Current total: ${Number(totalSplit.toFixed(2))}`);
        return;
      }
    }
    let quorumBps = null;
    if (showAdvanced) {
      const quorumTrim = String(quorumPercentInput || '').trim();
      if (quorumTrim) {
        if (!percentPattern.test(quorumTrim)) {
          alert('Quorum must be numeric with up to two decimal places');
          return;
        }
        const quorumNumeric = Number(quorumTrim);
        if (!Number.isFinite(quorumNumeric) || quorumNumeric < 0 || quorumNumeric > 100) {
          alert('Quorum percent must be between 0 and 100');
          return;
        }
        quorumBps = Math.round(quorumNumeric * 100);
      }
    }
    let executionDelaySecondsValue = null;
    if (showAdvanced) {
      const executionTrim = String(executionDelayInput || '').trim();
      if (executionTrim) {
        if (!/^\d+$/.test(executionTrim)) {
          alert('Execution delay must be a non-negative integer (seconds)');
          return;
        }
        const parsedDelay = Number(executionTrim);
        if (!Number.isFinite(parsedDelay) || parsedDelay < 0) {
          alert('Execution delay must be a non-negative integer (seconds)');
          return;
        }
        executionDelaySecondsValue = parsedDelay;
      }
    }
    let burnAddressValue = null;
    if (showAdvanced) {
      const burnTrim = String(customBurnAddress || '').trim();
      if (burnTrim) {
        if (!ethers.isAddress(burnTrim)) {
          alert('Burn address must be a valid address');
          return;
        }
        burnAddressValue = burnTrim;
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
        factoryAddress,
        maxMembers: normalizedMaxMembers.toString(),
        priestDictatorship,
        quorumBps,
        executionDelaySecondsValue,
        burnAddressValue
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
        quorumPercent: quorumBps ?? undefined,
        executionDelaySeconds: executionDelaySecondsValue ?? undefined,
        burnAddress: burnAddressValue ?? undefined,
        priestIsDictator: showAdvanced ? priestDictatorship : false,
        maxMembers: normalizedMaxMembers,
        factoryAddress: trimmedFactory,
        factoryArtifact: templFactoryArtifact,
        templArtifact,
        curveProvided: showAdvanced,
        curveConfig,
        templHomeLink: homeLink || undefined
      });
      setCreateSteps({ deploy: 'success', error: null });
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
      rememberJoinedTempl(result.contractAddress);
      setTemplList((prev) => {
        const key = String(result.contractAddress || '').toLowerCase();
        if (!key) return prev;
        if (prev.some((t) => String(t.contract || '').toLowerCase() === key)) return prev;
        return [{ contract: key, priest: walletAddress ? walletAddress.toLowerCase() : null }, ...prev];
      });
      updateTemplAddress(result.contractAddress);
      setGroup(result.group);
      setGroupId(result.groupId);
      pushStatus('✅ Templ deployed');
      if (result.groupId) pushStatus('✅ Group created');
      if (result.contractAddress) {
        const lower = String(result.contractAddress).toLowerCase();
        setPendingJoinAddress(lower);
        setJoinSteps({ purchase: 'idle', join: 'idle', error: null });
        pushStatus('ℹ️ Next step: Purchase & join to activate chat');
      }
      try {
        localStorage.setItem('templ:lastAddress', result.contractAddress);
        if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
      } catch {}
      navigate(`/chat?address=${result.contractAddress}`);
    } catch (err) {
      setCreateSteps({ deploy: 'error', error: err?.message || 'Deploy failed' });
      console.error('[app] deploy failed', err);
      alert(err.message);
    }
  }, [
    signer,
    xmtp,
    tokenAddress,
    entryFee,
    burnPercent,
    treasuryPercent,
    memberPoolPercent,
    protocolPercent,
    factoryAddress,
    walletAddress,
    updateTemplAddress,
    pushStatus,
    navigate,
    maxMembers,
    rememberJoinedTempl,
    setTemplList,
    priestDictatorship,
    quorumPercentInput,
    executionDelayInput,
    customBurnAddress,
    showAdvanced,
    curveConfig,
    homeLink
  ]);

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
      const percentPattern = /^\d+(\.\d{1,2})?$/;
      const splitsValid = [burnPercent, treasuryPercent, memberPoolPercent].every((n) => percentPattern.test(String(n ?? '').trim()));
      const limitValid = !maxMembers || /^\d+$/.test(maxMembers);
      const protocolValue = Number(protocolPercent);
      const sumValid = !Number.isFinite(protocolValue)
        ? true
        : Math.abs((Number(burnPercent) + Number(treasuryPercent) + Number(memberPoolPercent) + protocolValue) - 100) < 0.001;
      const trimmedFactory = factoryAddress.trim();
      if (trimmedFactory && ethers.isAddress(trimmedFactory) && ethers.isAddress(tokenAddress) && /^\d+$/.test(entryFee) && splitsValid && sumValid && limitValid) {
        autoDeployTriggeredRef.current = true;
        // Fire and forget; UI will reflect status
        handleDeploy();
      }
    } catch {}
  }, [path, signer, factoryAddress, tokenAddress, entryFee, burnPercent, treasuryPercent, memberPoolPercent, protocolPercent, maxMembers, handleDeploy]);

  const handlePurchaseAndJoin = useCallback(async () => {
    dlog('[app] handlePurchaseAndJoin invoked', {
      signerReady: !!signer,
      xmtpReady: !!xmtp,
      refAddress: templAddressRef.current,
      stateAddress: templAddress
    });
    if (!signer || !xmtp) return;
    const requiresApproval = joinMembershipInfo.token && !joinMembershipInfo.isNative;
    if (requiresApproval && approvalStage !== 'approved') {
      setJoinStatusNote('Awaiting token approval');
      pushStatus('⚠️ Approve the membership token before joining.');
      return;
    }
    const rawAddress = templAddressRef.current || templAddress;
    const trimmedAddress = typeof rawAddress === 'string' ? rawAddress.trim() : '';
    if (!trimmedAddress || !ethers.isAddress(trimmedAddress)) {
      return alert('Invalid contract address');
    }
    updateTemplAddress(trimmedAddress);
    try {
      const lower = trimmedAddress.toLowerCase();
      setPendingJoinAddress(lower);
      setGroupConnected(false);
      setJoinSteps({ purchase: 'pending', join: 'idle', error: null });
      joinRetryCountRef.current = 0;
      setPurchaseStatusNote('Waiting for purchase transaction confirmation');
      setJoinStatusNote(null);
      // Ensure browser identity is registered before joining
      try {
        if (identityReadyPromiseRef.current) {
          await identityReadyPromiseRef.current;
        } else if (xmtp?.inboxId) {
        const onLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
        const env = forcedEnv || (onLocalhost ? 'dev' : null);
        if (!env) {
          identityReadyRef.current = true;
        } else {
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
        }
      } catch {}
      if (!identityReadyRef.current) {
        identityReadyRef.current = true;
      }
      dlog('[app] starting purchaseAndJoin', { inboxId: xmtp?.inboxId, address: walletAddress, templAddress });
      let memberAddress = walletAddress;
      if (!memberAddress) {
        try { memberAddress = await signer.getAddress(); } catch {}
      }
      let lastStage = null;
      const result = await purchaseAndJoin({
        ethers,
        xmtp,
        signer,
        walletAddress: memberAddress,
        templAddress: trimmedAddress,
        templArtifact,
        autoApprove: false,
        onProgress: (stage) => {
          if (stage !== 'join:submission:retry' && lastStage === stage) return;
          switch (stage) {
            case 'purchase:start':
              setJoinSteps((prev) => ({ ...prev, purchase: 'pending', join: prev.join === 'success' ? prev.join : 'idle', error: null }));
              setPurchaseStatusNote('Confirm the purchase transaction in your wallet');
              pushStatus('🔄 Join step 1/2: purchasing access');
              break;
            case 'purchase:complete':
              setJoinSteps((prev) => ({ ...prev, purchase: 'success' }));
              setPurchaseStatusNote('Purchase transaction confirmed');
              pushStatus('✅ Access purchased');
              break;
            case 'purchase:skipped':
              setJoinSteps((prev) => ({ ...prev, purchase: 'success' }));
              setPurchaseStatusNote('Access already purchased for this wallet');
              pushStatus('ℹ️ Access already purchased');
              break;
            case 'join:signature:start':
              setJoinSteps((prev) => ({ ...prev, join: 'pending', error: null }));
              setJoinStatusNote('Sign the join request in your wallet');
              pushStatus('🔄 Join step 2/2: signing join request');
              break;
            case 'join:signature:complete':
              setJoinStatusNote('Signature captured; submitting to backend');
              pushStatus('✅ Signature captured');
              break;
            case 'join:submission:start':
              joinRetryCountRef.current = 0;
              setJoinSteps((prev) => ({ ...prev, join: 'pending', error: null }));
              setJoinStatusNote('Submitting join request to templ backend');
              pushStatus('🔄 Submitting join request to templ backend');
              break;
            case 'join:submission:waiting':
              setJoinSteps((prev) => ({ ...prev, join: 'pending', error: null }));
              setJoinStatusNote('Waiting for XMTP identity to register');
              pushStatus('⏳ Join request queued; waiting for XMTP identity to register');
              break;
            case 'join:submission:complete':
              setJoinStatusNote('Join accepted; discovering XMTP conversation');
              pushStatus('🔄 Waiting for XMTP group to connect');
              break;
            case 'join:submission:retry': {
              joinRetryCountRef.current += 1;
              const attempt = joinRetryCountRef.current;
              setJoinSteps((prev) => ({ ...prev, join: 'pending', error: null }));
              setJoinStatusNote(`Retry ${attempt}: XMTP still provisioning identity`);
              pushStatus(`⏳ XMTP still provisioning identity (retry ${attempt})`);
              break;
            }
            case 'join:complete':
              setJoinSteps({ purchase: 'success', join: 'success', error: null });
              setJoinStatusNote('Chat access granted');
              pushStatus('✅ Joined templ');
              break;
            default:
              break;
          }
          lastStage = stage;
        }
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
        setPendingJoinAddress(null);
        try {
          localStorage.setItem('templ:lastAddress', trimmedAddress);
          if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
        } catch {}
        rememberJoinedTempl(trimmedAddress);
        setTemplList((prev) => {
          const key = String(trimmedAddress || '').toLowerCase();
          if (!key) return prev;
          if (prev.some((t) => String(t.contract || '').toLowerCase() === key)) return prev;
          return [{ contract: key, priest: null }, ...prev];
        });
        navigate(`/chat?address=${trimmedAddress}`);
      }
    } catch (err) {
      const rawMessage = err?.message || 'Join failed';
      const revertMatch = /require\(false\)/i.test(rawMessage) || /CALL_EXCEPTION/i.test(rawMessage);
      const message = revertMatch
        ? 'Purchase reverted on-chain. Check token balance, allowances, and member limit.'
        : rawMessage;
      const wasPurchasePending = joinSteps.purchase === 'pending';
      setJoinSteps({
        purchase: wasPurchasePending ? 'error' : joinSteps.purchase,
        join: 'error',
        error: message
      });
      if (wasPurchasePending) {
        setPurchaseStatusNote(message);
      }
      setJoinStatusNote(message);
      if (/rejected/i.test(rawMessage)) {
        pushStatus('⚠️ Join incomplete: signature declined. Complete from chat when ready.');
      } else {
        pushStatus(`⚠️ Join failed: ${message}`);
      }
      console.error('Join failed', err);
    }
  }, [signer, xmtp, templAddress, updateTemplAddress, walletAddress, pushStatus, navigate, rememberJoinedTempl, setTemplList, joinSteps, joinMembershipInfo.isNative, joinMembershipInfo.token, approvalStage]);

  const handleApproveToken = useCallback(async () => {
    if (joinMembershipInfo.isNative) {
      setApprovalStage('approved');
      return;
    }
    if (!signer || !templAddress) {
      pushStatus('⚠️ Connect your wallet before approving.');
      return;
    }
    if (!joinMembershipInfo.token || !joinMembershipInfo.required) {
      pushStatus('⚠️ Membership cost still loading.');
      return;
    }
    try {
      const tokenAddress = ethers.getAddress(joinMembershipInfo.token);
      const erc20 = new ethers.Contract(tokenAddress, ['function approve(address spender, uint256 value) returns (bool)'], signer);
      setApprovalError(null);
      setApprovalStage('pending');
      pushStatus('🔄 Approving membership token');
      const tx = await erc20.approve(templAddress, joinMembershipInfo.required);
      await tx.wait();
      pushStatus('✅ Token approved');
      setApprovalStage('approved');
      setApprovalAllowance(joinMembershipInfo.required.toString());
    } catch (err) {
      const message = err?.message || 'Approval failed';
      setApprovalStage('error');
      setApprovalError(message);
      pushStatus(`⚠️ Approval failed: ${message}`);
    }
  }, [joinMembershipInfo.isNative, joinMembershipInfo.token, joinMembershipInfo.required, signer, templAddress, pushStatus]);

  // Passive discovery: if a groupId is known (e.g., after deploy) try to
  // discover the conversation without requiring an explicit join.
  useEffect(() => {
    if (!pathIsChat) return;
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
  }, [pathIsChat, xmtp, group, groupConnected, pushStatus]);

  // As soon as we have a groupId, surface a visible success status
  useEffect(() => {
    if (groupId && !joinedLoggedRef.current) {
      // Avoid implying the group stream is ready; discovery can lag.
      pushStatus('✅ Group ID received; discovering conversation');
      joinedLoggedRef.current = true;
    }
  }, [groupId, pushStatus]);

  useEffect(() => {
    if (!pathIsChat || !group || !xmtp) return;
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
          const prevIds = new Set(prev.map((m) => m.mid).filter(Boolean));
          const additions = [];
          for (const item of transformed) {
            const key = messageIdentityKey(item);
            if (item?.mid && prevIds.has(item.mid)) continue;
            if (key && messageSeenRef.current.has(key)) continue;
            if (key) messageSeenRef.current.add(key);
            additions.push(item);
          }
          if (!additions.length && !metaUpdates.length) {
            return prev;
          }
          let basePrev;
          if (additions.length) {
            const additionTextKeys = new Set(
              additions
                .filter((item) => item?.kind === 'text')
                .map((item) => {
                  const sender = (item?.senderAddress || '').toLowerCase();
                  return `text:${sender}:${String(item?.content ?? '')}`;
                })
            );
            basePrev = additionTextKeys.size
              ? prev.filter((item) => {
                if (!item?.localEcho || item.kind !== 'text') return true;
                const sender = (item?.senderAddress || '').toLowerCase();
                const key = `text:${sender}:${String(item?.content ?? '')}`;
                return !additionTextKeys.has(key);
              })
              : prev.slice();
          } else {
            basePrev = prev.slice();
          }
          let next = additions.length ? [...additions, ...basePrev] : basePrev;
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
          if (typeof raw === 'string' && raw.length === 0) {
            continue;
          }
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
              const newMessage = { mid: msg.id, kind: 'proposal', senderAddress: from, proposalId: id, title, description };
              const key = messageIdentityKey(newMessage);
              if (key && messageSeenRef.current.has(key)) return m;
              if (key) messageSeenRef.current.add(key);
              return [...m, newMessage];
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
              const key = `mid:${msg.id}`;
              if (messageSeenRef.current.has(key)) return m;
              const content = parsed.type === 'templ-created'
                ? 'Templ created'
                : parsed.address
                  ? `${shorten(parsed.address)} joined`
                  : 'Member joined';
              messageSeenRef.current.add(key);
              return [...m, { mid: msg.id, kind: 'system', senderAddress: from, content }];
            });
            continue;
          }
          setMessages((m) => {
            const key = `mid:${msg.id}`;
            if (messageSeenRef.current.has(key)) return m;
            const idx = m.findIndex((it) => it.localEcho && it.kind === 'text' && it.content === raw && ((it.senderAddress || '').toLowerCase() === from || !it.senderAddress));
            if (idx !== -1) {
              const copy = m.slice();
              copy[idx] = { mid: msg.id, kind: 'text', senderAddress: from, content: raw };
              messageSeenRef.current.add(key);
              return copy;
            }
            messageSeenRef.current.add(key);
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
  }, [pathIsChat, group, xmtp, mutes, pushStatus]);

  // When we know the `groupId`, keep trying to resolve the group locally until found.
  useEffect(() => {
    if (!pathIsChat) return;
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
  }, [pathIsChat, xmtp, groupId, group, templAddress, pushStatus]);

  useEffect(() => {
    if (!pathIsChat || !templAddress || !signer) return;
    const provider = signer.provider;
    const runner = provider ?? signer;
    const supportsLiveSubscriptions = runner && !(runner instanceof ethers.BrowserProvider);
    let stopWatching = () => {};
    if (supportsLiveSubscriptions) {
      stopWatching = watchProposals({
        ethers,
        provider: runner,
        templAddress,
        templArtifact,
        onProposal: (p) => {
        setProposals((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          return [...prev, { ...p, yes: 0, no: 0 }];
        });
        setProposalsById((map) => {
          const existing = map[p.id] || {};
          const derivedTitle = (() => {
            const eventTitle = typeof p.title === 'string' && p.title.trim().length ? p.title : '';
            if (existing.title && existing.title !== `Proposal #${p.id}`) return existing.title;
            return eventTitle || existing.title || `Proposal #${p.id}`;
          })();
          const derivedDescription = (() => {
            if (existing.description && existing.description.length) return existing.description;
            if (typeof p.description === 'string') return p.description;
            return existing.description || '';
          })();
          return {
            ...map,
            [p.id]: {
              ...existing,
              id: p.id,
              proposer: existing.proposer || normalizeAddressLower(p.proposer) || '',
              title: derivedTitle,
              description: derivedDescription,
              yes: existing.yes ?? 0,
              no: existing.no ?? 0,
              endTime: Number.isFinite(p.endTime) ? Number(p.endTime) : existing.endTime ?? null
            }
          };
        });
        setMessages((m) => {
          let found = false;
          const updated = m.map((it) => {
            if (it.kind === 'proposal' && Number(it.proposalId) === p.id) {
              found = true;
              const next = { ...it };
              if (typeof p.title === 'string' && p.title.trim().length) {
                next.title = p.title;
              }
              if (typeof p.description === 'string') {
                next.description = p.description;
              }
              if (p.proposer) {
                const normalizedProposer = normalizeAddressLower(p.proposer);
                next.senderAddress = normalizedProposer || next.senderAddress;
              }
              return next;
            }
            return it;
          });
          if (found) return updated;
          const newMessage = {
            mid: `proposal:${p.id}`,
            kind: 'proposal',
            senderAddress: normalizeAddressLower(p.proposer) || '',
            proposalId: p.id,
            title: (typeof p.title === 'string' && p.title.trim().length) ? p.title : `Proposal #${p.id}`,
            description: typeof p.description === 'string' ? p.description : ''
          };
          const key = messageIdentityKey(newMessage);
          if (key && messageSeenRef.current.has(key)) return updated;
          if (key) messageSeenRef.current.add(key);
          return [
            ...updated,
            newMessage
          ];
        });
      },
      onVote: (v) => {
        setProposals((prev) => prev.map((p) => p.id === v.id ? { ...p, [v.support ? 'yes' : 'no']: (p[v.support ? 'yes' : 'no'] || 0) + 1 } : p));
        setProposalsById((map) => ({ ...map, [v.id]: { ...(map[v.id] || { id: v.id, yes:0, no:0 }), yes: (map[v.id]?.yes || 0) + (v.support ? 1 : 0), no: (map[v.id]?.no || 0) + (!v.support ? 1 : 0) } }));
      }
      });
    }
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
            const endTime = Number(p.endTime ?? p[3] ?? 0);
            const executed = Boolean(p.executed ?? p[4]);
            const passed = Boolean(p.passed ?? p[5]);
            const proposer = p.proposer ?? p[0] ?? '';
            const chainTitle = (() => {
              const raw = p.title ?? p[6];
              return typeof raw === 'string' && raw.trim().length ? raw : `Proposal #${i}`;
            })();
            const chainDescription = (() => {
              const raw = p.description ?? p[7];
              return typeof raw === 'string' ? raw : '';
            })();
            let snapshotData = [null, null, null, null, null, null];
            try {
              snapshotData = await contract.getProposalSnapshots(i);
            } catch {/* snapshot data optional */}
            const [
              eligiblePreRaw,
              eligiblePostRaw,
              preSnapshotBlockRaw,
              quorumSnapshotBlockRaw,
              createdAtRaw,
              quorumReachedAtRaw
            ] = snapshotData;
            const title = chainTitle;
            if (cancelled) return;
            setProposalsById((map) => {
              const existing = map[i] || { id: i };
              const mergedTitle = existing.title && existing.title !== `Proposal #${i}`
                ? existing.title
                : (existing.title || title);
              const mergedDescription = existing.description && existing.description.length
                ? existing.description
                : chainDescription;
              return {
                ...map,
                [i]: {
                  ...existing,
                  id: i,
                  proposer: existing.proposer || normalizeAddressLower(proposer) || '',
                  title: mergedTitle,
                  description: mergedDescription,
                  yes,
                  no,
                  endTime,
                  executed,
                  passed,
                  quorumReachedAt: toNumeric(quorumReachedAtRaw),
                  createdAt: toNumeric(createdAtRaw),
                  eligibleVotersPreQuorum: toNumeric(eligiblePreRaw),
                  eligibleVotersPostQuorum: toNumeric(eligiblePostRaw),
                  preQuorumSnapshotBlock: toNumeric(preSnapshotBlockRaw),
                  quorumSnapshotBlock: toNumeric(quorumSnapshotBlockRaw)
                }
              };
            });
            setProposals((prev) => prev.map((it) => it.id === i ? { ...it, yes, no } : it));
            // Ensure a poll bubble exists in chat
            setMessages((m) => {
              if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === i)) return m;
              const newMessage = {
                mid: `proposal:${i}`,
                kind: 'proposal',
                senderAddress: normalizeAddressLower(proposer) || '',
                proposalId: i,
                title,
                description: chainDescription
              };
              const key = messageIdentityKey(newMessage);
              if (key && messageSeenRef.current.has(key)) return m;
              if (key) messageSeenRef.current.add(key);
              return [
                ...m,
                newMessage
              ];
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
        const [p, maxRaw, execDelayRaw, quorumRaw] = await Promise.all([
          contract.paused(),
          contract.MAX_MEMBERS(),
          contract.executionDelayAfterQuorum(),
          contract.quorumPercent()
        ]);
        let countRaw = null;
        try {
          countRaw = await contract.getMemberCount();
        } catch {
          countRaw = null;
        }
        if (!cancelled) {
          setPaused(Boolean(p));
          try { setCurrentMaxMembers(String(maxRaw)); } catch { setCurrentMaxMembers(null); }
          if (countRaw !== null && countRaw !== undefined) {
            try { setCurrentMemberCount(String(countRaw)); } catch { setCurrentMemberCount(null); }
          } else {
            setCurrentMemberCount(null);
          }
          try {
            const numeric = Number(execDelayRaw);
            setCurrentExecutionDelay(Number.isFinite(numeric) ? numeric : null);
          } catch {
            setCurrentExecutionDelay(null);
          }
          try {
            const numeric = Number(quorumRaw);
            setCurrentQuorumPercent(Number.isFinite(numeric) ? numeric : null);
          } catch {
            setCurrentQuorumPercent(null);
          }
        }
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
  }, [templAddress, signer, pathIsChat]);

  useEffect(() => {
    if (!moderationEnabled || !pathIsChat || !templAddress) return;
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
  }, [templAddress, moderationEnabled, pathIsChat]);

  useEffect(() => {
    if (!moderationEnabled || !pathIsChat || !templAddress) return;
    let cancelled = false;
    const loadDelegates = async () => {
      try {
        const list = await fetchDelegates({ contractAddress: templAddress });
        if (!cancelled) {
          const normalized = list
            .map((addr) => {
              try { return addr?.toLowerCase?.() ?? ''; } catch { return ''; }
            })
            .filter(Boolean);
          setDelegates(Array.from(new Set(normalized)));
        }
      } catch {
        if (!cancelled) {
          // keep previous delegates on transient failures
        }
      }
    };
    loadDelegates();
    const id = setInterval(loadDelegates, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [templAddress, moderationEnabled, pathIsChat]);


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
  useEffect(() => {
    if (path !== '/chat') return;
    const addr = String(query.get('address') || '').trim();
    if (addr && addr !== templAddress) {
      updateTemplAddress(addr);
      return;
    }
    if (!addr && !templAddress) {
      try {
        const last = localStorage.getItem('templ:lastAddress');
        if (last && ethers.isAddress(last)) updateTemplAddress(last);
      } catch {}
    }
  }, [path, query, templAddress, updateTemplAddress]);

  // Fetch treasury and claimable stats when context is ready
  useEffect(() => {
    if (!pathIsChat) return;
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
  }, [signer, templAddress, walletAddress, proposals, groupConnected, pathIsChat]);

  // Persist and restore chat state (messages + proposals) per chat context
  useEffect(() => {
    if (!chatStorageKey) return;
    const suffix = chatStorageKey.includes(':') ? chatStorageKey.split(':').slice(1).join(':') : chatStorageKey;
    const messageKeys = [`templ:messages:${chatStorageKey}`];
    if (suffix) messageKeys.push(`templ:messages:${suffix}`);
    if (normalizedTemplAddress) messageKeys.push(`templ:messages:${normalizedTemplAddress}`);
    for (const key of messageKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        const restored = [];
        for (const entry of arr) {
          if (!entry) continue;
          const msgKey = messageIdentityKey(entry);
          if (msgKey && messageSeenRef.current.has(msgKey)) {
            continue;
          }
          if (msgKey) messageSeenRef.current.add(msgKey);
          restored.push(entry);
        }
        if (restored.length) {
          setMessages(restored);
        }
        break;
      } catch {/* ignore parse errors */}
    }
    const proposalKeys = [`templ:proposals:${chatStorageKey}`];
    if (suffix) proposalKeys.push(`templ:proposals:${suffix}`);
    if (normalizedTemplAddress) proposalKeys.push(`templ:proposals:${normalizedTemplAddress}`);
    for (const key of proposalKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const map = JSON.parse(raw);
        if (map && typeof map === 'object') {
          setProposalsById(map);
          break;
        }
      } catch {/* ignore */}
    }
  }, [chatStorageKey, normalizedTemplAddress]);

  useEffect(() => {
    if (!chatStorageKey) return;
    try {
      const toSave = messages
        .filter((msg) => !msg?.localEcho)
        .slice(-200);
      localStorage.setItem(`templ:messages:${chatStorageKey}`, JSON.stringify(toSave));
    } catch {/* ignore */}
  }, [messages, chatStorageKey]);

  useEffect(() => {
    if (!chatStorageKey) return;
    try {
      localStorage.setItem(`templ:proposals:${chatStorageKey}`, JSON.stringify(proposalsById));
    } catch {/* ignore */}
  }, [proposalsById, chatStorageKey]);

  useEffect(() => {
    const reader = signer?.provider ?? signer ?? (window?.ethereum ? new ethers.BrowserProvider(window.ethereum) : null);
    if (!templList.length || !reader) {
      return;
    }
    let cancelled = false;
    const tasks = [];
    templList.forEach((item) => {
      const raw = String(item.contract || '').trim();
      if (!raw) return;
      let checksum;
      try {
        checksum = ethers.getAddress(raw);
      } catch {
        return;
      }
      const key = checksum.toLowerCase();
      const existing = templSummaries[key];
      if (existing && (existing.status === 'ready' || existing.status === 'loading')) {
        return;
      }
      tasks.push({ key, checksum });
    });
    tasks.forEach(({ key, checksum }) => {
      setTemplSummaries((prev) => ({ ...prev, [key]: { status: 'loading', contract: checksum } }));
      (async () => {
        try {
          const contract = new ethers.Contract(checksum, templArtifact.abi, reader);
          let tokenAddr;
          let entryFee;
          let totalMembers = null;
          let maxMembersRaw = null;
          try {
            const cfg = await contract.getConfig();
            tokenAddr = cfg[0];
            entryFee = BigInt(cfg[1] ?? 0n);
          } catch {
            tokenAddr = await contract.accessToken();
            entryFee = BigInt(await contract.entryFee());
          }
          try {
            const count = await contract.getMemberCount();
            totalMembers = Number(count);
          } catch {
            totalMembers = null;
          }
          try {
            maxMembersRaw = await contract.MAX_MEMBERS();
          } catch {}
          let symbol = null;
          let decimals = null;
          const tokenLower = tokenAddr ? String(tokenAddr).toLowerCase() : null;
          if (tokenLower === zeroAddressLower) {
            symbol = 'ETH';
            decimals = 18;
          } else if (tokenAddr) {
            const erc20Meta = new ethers.Contract(
              tokenAddr,
              ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
              reader
            );
            try {
              const rawSymbol = await erc20Meta.symbol();
              if (typeof rawSymbol === 'string' && rawSymbol.trim()) symbol = rawSymbol.trim();
            } catch {}
            try {
              decimals = Number(await erc20Meta.decimals());
            } catch {}
          }
          const formatted = decimals !== null ? formatTokenAmount(entryFee, decimals, symbol) : null;
          const rawUnits = decimals !== null ? formatRawUnitsDisplay(entryFee, decimals, symbol) : null;
          const rawLabel = rawUnits ? `${rawUnits.amount} ${rawUnits.unit}` : `${entryFee.toString()} raw units`;
          const usdRate = inferUsdRateForToken(symbol, (tokenAddr || '').toLowerCase());
          const usd = decimals !== null ? formatUsdFromBigInt(entryFee, decimals, usdRate) : null;
          if (cancelled) return;
          setTemplSummaries((prev) => ({
            ...prev,
            [key]: {
              status: 'ready',
              contract: checksum,
              token: tokenAddr,
              symbol,
              formatted: formatted || rawLabel,
              raw: rawLabel,
              usd,
              decimals,
              required: entryFee,
              memberCount: Number.isFinite(totalMembers) ? totalMembers : null,
              maxMembers: (() => {
                if (maxMembersRaw === null || maxMembersRaw === undefined) return null;
                try {
                  return BigInt(maxMembersRaw).toString();
                } catch {
                  try { return String(maxMembersRaw); } catch { return null; }
                }
              })()
            }
          }));
        } catch (err) {
          if (cancelled) return;
          setTemplSummaries((prev) => ({
            ...prev,
            [key]: {
              status: 'error',
              contract: checksum,
              error: err?.message || 'Failed to load token info'
            }
          }));
        }
      })();
    });
    return () => { cancelled = true; };
  }, [templList, signer, templSummaries, zeroAddressLower]);


  async function disconnectWallet() {
    try {
      if (creatingXmtpPromiseRef.current) {
        try {
          const pendingClient = await creatingXmtpPromiseRef.current;
          await pendingClient?.close?.();
        } catch {}
        creatingXmtpPromiseRef.current = null;
      }
      if (xmtp && typeof xmtp.close === 'function') {
        await xmtp.close();
      }
    } catch {}
    identityReadyRef.current = false;
    identityReadyPromiseRef.current = null;
    setXmtp(undefined);
    setActiveInboxId('');
    setActiveInstallationId('');
    setInstallations([]);
    setInstallationsError(null);
    setXmtpLimitWarning(null);
    setSigner(undefined);
    setWalletAddress('');
    resetChatState();
    setPendingJoinAddress(null);
    setPurchaseStatusNote(null);
    setJoinStatusNote(null);
    setProfileOpen(false);
    setInstallationsOpen(false);
    pushStatus('👋 Wallet disconnected');
  }


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
      let senderAddress = walletAddress;
      if (!senderAddress && signer?.getAddress) {
        try { senderAddress = await signer.getAddress(); } catch {}
      }
      const normalizedSender = senderAddress ? senderAddress.toLowerCase() : '';
      const localNonce = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Local echo to ensure immediate UI feedback; mark with localEcho so the stream can replace it
      setMessages((m) => {
        const exists = m.some((item) => item.localEcho && item.content === body && ((item.senderAddress || '').toLowerCase() === normalizedSender || !item.senderAddress));
        if (exists) return m;
        return [
          ...m,
          {
            kind: 'text',
            senderAddress: normalizedSender || senderAddress || '',
            content: body,
            localEcho: true,
            localNonce
          }
        ];
      });
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

  useEffect(() => {
    try {
      // expose readiness for e2e harness
      if (import.meta?.env?.VITE_E2E_DEBUG === '1' && typeof window !== 'undefined') {
        window.__templReady = {
          signerReady: Boolean(signer),
          xmtpReady: Boolean(xmtp),
          walletAddress: walletAddress || null
        };
      }
    } catch {}
  }, [signer, xmtp, walletAddress]);

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

  async function handleMuteMember(target) {
    if (!templAddress || !signer || !walletAddress) return;
    let targetAddress;
    try {
      targetAddress = ethers.getAddress(target);
    } catch {
      alert('Mute failed: invalid address');
      return;
    }
    if (targetAddress.toLowerCase() === walletAddressLower) {
      alert('You cannot mute yourself');
      return;
    }
    try {
      await muteMember({
        signer,
        contractAddress: templAddress,
        moderatorAddress: walletAddress,
        targetAddress
      });
      const lower = targetAddress.toLowerCase();
      setMutes((prev) => Array.from(new Set([...(prev || []), lower])));
      setMessages((prev) => prev.filter((item) => {
        try {
          const sender = (item?.senderAddress || '').toLowerCase();
          return sender !== lower;
        } catch {
          return true;
        }
      }));
      pushStatus('✅ Member muted');
    } catch (err) {
      const msg = err?.message || String(err || 'mute failed');
      alert('Mute failed: ' + msg);
    }
  }

  async function handleDelegateMember(target) {
    if (!templAddress || !signer || !walletAddress || !isPriest) return;
    let delegateAddress;
    try {
      delegateAddress = ethers.getAddress(target);
    } catch {
      alert('Delegate failed: invalid address');
      return;
    }
    if (delegateAddress.toLowerCase() === walletAddressLower) {
      alert('You already have moderation rights');
      return;
    }
    try {
      const delegated = await delegateMute({
        signer,
        contractAddress: templAddress,
        priestAddress: walletAddress,
        delegateAddress
      });
      if (delegated) {
        const lower = delegateAddress.toLowerCase();
        setDelegates((prev) => Array.from(new Set([...(prev || []), lower])));
        try {
          const refreshed = await fetchDelegates({ contractAddress: templAddress });
          const normalized = refreshed
            .map((entry) => {
              try { return entry?.toLowerCase?.() ?? ''; } catch { return ''; }
            })
            .filter(Boolean);
          if (normalized.length) {
            setDelegates(Array.from(new Set(normalized)));
          }
        } catch {}
        pushStatus('✅ Delegate granted');
      }
    } catch (err) {
      const msg = err?.message || String(err || 'delegate failed');
      alert('Delegate failed: ' + msg);
    }
  }

  // moderation actions surface inline in chat when the viewer has rights

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
        window.__templSetAutoDeploy = (flag) => {
          autoDeployTriggeredRef.current = Boolean(flag);
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
          <div className="text-lg font-semibold text-black/80">Templ</div>
          <div className="flex items-center gap-2">
            {walletAddress && (
              <>
                <span className="hidden sm:inline text-xs font-mono text-black/70">{shorten(walletAddress)}</span>
                <button className="px-3 py-1 rounded border border-black/20" onClick={() => setProfileOpen(true)}>Profile</button>
                <button className="px-3 py-1 rounded border border-black/20" onClick={disconnectWallet}>Disconnect</button>
              </>
            )}
            {!walletAddress && (
              <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={connectWallet}>Connect Wallet</button>
            )}
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
        {path === '/templs' && (
          <div data-testid="templ-list" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Templs</h2>
              {walletAddress && (
                <button
                  className="px-3 py-1 rounded border border-black/20 text-xs"
                  onClick={handleOpenInstallations}
                >
                  Manage XMTP Slots
                </button>
              )}
            </div>
            {templCards.length === 0 && <p>No templs yet</p>}
            {templCards.map((t) => {
              const isJoined = Boolean(t.joined);
              const contractLower = String(t.contract).toLowerCase();
              const templHref = baseScanUrl(t.contract);
              const tokenZero = t.tokenAddress === zeroAddressLower;
              const tokenHref = t.tokenAddress && !tokenZero ? baseScanUrl(t.tokenAddress) : null;
              const tokenShort = t.tokenAddress ? shorten(t.tokenAddress) : 'Loading…';
              const tokenDisplay = !t.tokenAddress
                ? 'Loading…'
                : tokenZero
                  ? `${t.tokenSymbol || 'ETH'} (native)`
                  : t.tokenSymbol
                    ? `${t.tokenSymbol} • ${tokenShort}`
                    : tokenShort;
              const feeDisplay = t.entryFeeDisplay || t.entryFeeRaw || '…';
              const feeUsd = t.entryFeeUsd || null;
              const memberLabel = Number.isFinite(t.memberCount) ? t.memberCount.toLocaleString() : '…';
              let maxLabel = 'Unlimited';
              if (t.maxMembers && t.maxMembers !== '0') {
                const parsed = Number(t.maxMembers);
                maxLabel = Number.isFinite(parsed) ? parsed.toLocaleString() : t.maxMembers;
              }
              const showMax = t.maxMembers && t.maxMembers !== '0';
              const action = isJoined
                ? () => navigate(`/chat?address=${contractLower}`)
                : () => navigate(`/join?address=${contractLower}`);

              return (
                <div
                  key={t.contract}
                  className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border border-black/10 rounded px-3 py-3"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={templHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm underline underline-offset-4 break-all"
                      >
                        {shorten(t.contract)}
                      </a>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 border border-black/20 rounded"
                        onClick={() => copyToClipboard(t.contract)}
                      >
                        Copy
                      </button>
                      {isJoined && <span className="text-xs font-semibold uppercase tracking-wide text-primary">Joined</span>}
                    </div>
                    <div className="text-xs text-black/70">
                      Access token: {tokenHref ? (
                        <a
                          href={tokenHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4"
                        >
                          {tokenDisplay}
                        </a>
                      ) : (
                        <span className="font-medium">{tokenDisplay}</span>
                      )}
                    </div>
                    <div className="text-xs text-black/70">
                      Join fee: <span className="font-medium">{feeDisplay}</span>{feeUsd ? <span className="text-black/50"> • {feeUsd}</span> : null}
                    </div>
                    <div className="text-xs text-black/70">
                      Members: <span className="font-medium">{memberLabel}</span>{showMax ? <span className="text-black/50"> / {maxLabel}</span> : null}
                    </div>
                  </div>
                  <div className="flex gap-2 sm:flex-col sm:items-end">
                    <button
                      className="px-3 py-1 rounded bg-primary text-black font-semibold w-full sm:w-auto"
                      onClick={action}
                    >
                      {isJoined ? 'Chat' : 'Join'}
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="pt-2">
              <button className="px-4 py-2 rounded bg-primary text-black font-semibold" onClick={() => navigate('/create')}>Create Templ</button>
            </div>
          </div>
        )}

        {path === '/create' && (
          <div className="forms space-y-3">
            <div className="deploy space-y-3">
              <h2 className="text-xl font-semibold">Create Templ</h2>
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">Access token address</label>
                <input
                  className="w-full border border-black/20 rounded px-3 py-2"
                  placeholder="Token address"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                />
                {Number.isInteger(createTokenDecimals) && (
                  <p className="text-xs text-black/60 mt-1">
                    Detected token decimals: {createTokenDecimals}
                    {createTokenSymbol ? ` • Symbol ${createTokenSymbol}` : ''}
                  </p>
                )}
                {!Number.isInteger(createTokenDecimals) && tokenAddressValid && (
                  <p className="text-xs text-black/60 mt-1">
                    Unable to detect token decimals. Connect a wallet or confirm the token exposes decimals().
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-black/70 mb-1">Entry fee ({entryFeeUnitLabel})</label>
                <input
                  className="w-full border border-black/20 rounded px-3 py-2"
                  placeholder="Entry fee"
                  value={entryFee}
                  onChange={(e) => setEntryFee(e.target.value)}
                />
                {entryFeeDisplay !== null && (
                  <p className="text-xs text-black/60 mt-1">
                    Entry fee: {entryFeeDisplay}
                    {createTokenSymbol ? ` ${createTokenSymbol}` : ''}
                    {entryFeeRawDisplay ? ` • ${entryFeeRawDisplay.amount} ${entryFeeRawDisplay.unit}` : ''}
                    {entryFeeUsdDisplay ? ` • ${entryFeeUsdDisplay}` : ''}
                    {Number.isInteger(createTokenDecimals) ? ` (decimals ${createTokenDecimals})` : ''}
                  </p>
                )}
              </div>
              {showAdvanced && (
                <div className="space-y-4">
                  <div className="hidden">
                    <label className="block text-sm font-medium text-black/70 mb-1">TemplFactory address</label>
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder="Factory address"
                      value={factoryAddress}
                      readOnly={Boolean(FACTORY_CONFIG.address)}
                      onChange={(e) => setFactoryAddress(e.target.value)}
                    />
                  </div>
                  <div className="hidden grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium text-black/70 mb-1">Protocol fee recipient (fixed)</label>
                      <input className="w-full border border-black/20 rounded px-3 py-2" value={protocolFeeRecipient || 'fetching…'} readOnly />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black/70 mb-1">Protocol percent</label>
                      <input
                        className="w-full border border-black/20 rounded px-3 py-2"
                        value={protocolPercentDisplay ?? 'fetching…'}
                        readOnly
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black/70 mb-1">Max members (default 249 keeps XMTP chat inside the 250 participant limit; set 0 for unlimited)</label>
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder="Optional"
                      value={maxMembers}
                      onChange={(e) => setMaxMembers(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black/70 mb-1">Fee split (%)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-black/60 block mb-1" htmlFor="burn-percent-input">Burn</label>
                        <input
                          id="burn-percent-input"
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder={String(burnPercent ?? '').trim() === '' ? 'Burn' : ''}
                          value={burnPercent}
                          onChange={(e) => setBurnPercent(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-black/60 block mb-1" htmlFor="treasury-percent-input">Treasury</label>
                        <input
                          id="treasury-percent-input"
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder={String(treasuryPercent ?? '').trim() === '' ? 'Treasury' : ''}
                          value={treasuryPercent}
                          onChange={(e) => setTreasuryPercent(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-black/60 block mb-1" htmlFor="member-percent-input">Member pool</label>
                        <input
                          id="member-percent-input"
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder={String(memberPoolPercent ?? '').trim() === '' ? 'Member pool' : ''}
                          value={memberPoolPercent}
                          onChange={(e) => setMemberPoolPercent(e.target.value)}
                        />
                      </div>
                    </div>
                    {protocolPercentDisplay !== null && (
                      <div className={`text-xs mt-1 ${splitBalanced ? 'text-black/60' : 'text-red-600'}`}>
                        Fee split total: {splitTotalDisplay ?? '…'}/100 (includes protocol {protocolPercentDisplay})
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-black/20 p-3 bg-white/80">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-medium text-black/90">Governance mode</h3>
                      <p className="text-xs text-black/60">
                        Choose whether governance actions require member voting or can be executed immediately by the priest.
                      </p>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-black/80">
                        <input
                          type="radio"
                          name="governance-mode"
                          className="h-4 w-4"
                          checked={!priestDictatorship}
                          onChange={() => setPriestDictatorship(false)}
                        />
                        Member democracy (default)
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-black/80">
                        <input
                          type="radio"
                          name="governance-mode"
                          className="h-4 w-4"
                          checked={priestDictatorship}
                          onChange={() => setPriestDictatorship(true)}
                        />
                        Priest dictatorship
                      </label>
                    </div>
                    <p className="text-xs text-black/60 mt-2">
                      {priestDictatorship
                        ? 'Priest dictatorship lets the priest execute governance changes instantly, and only the priest can return the templ to democracy.'
                        : 'Member democracy routes actions through the proposal and voting flow before execution.'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-black/20 p-3 bg-white/80">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-medium text-black/90">Governance thresholds</h3>
                      <p className="text-xs text-black/60">
                        Override quorum, execution delay, or burn address. Leave blank to inherit factory defaults.
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-black/70 mb-1">Quorum percent</label>
                        <input
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder="Default 33"
                          value={quorumPercentInput}
                          onChange={(e) => setQuorumPercentInput(e.target.value)}
                        />
                        <p className="text-xs text-black/60 mt-1">Enter percent (e.g. 33.00).</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-black/70 mb-1">Execution delay (sec)</label>
                        <input
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder="Default 604800"
                          value={executionDelayInput}
                          onChange={(e) => setExecutionDelayInput(e.target.value)}
                        />
                        <p className="text-xs text-black/60 mt-1">Seconds between quorum and execution.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-black/70 mb-1">Burn address</label>
                        <input
                          className="w-full border border-black/20 rounded px-3 py-2"
                          placeholder="0x0000...dEaD"
                          value={customBurnAddress}
                          onChange={(e) => setCustomBurnAddress(e.target.value)}
                        />
                        <p className="text-xs text-black/60 mt-1">Defaults to the dead address.</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black/70 mb-1">
                      Templ home link
                    </label>
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      value={homeLink}
                      onChange={(e) => setHomeLink(e.target.value)}
                      placeholder="https://t.me/your-group"
                    />
                    <p className="text-xs text-black/60 mt-1">
                      Optional, but helps members discover your public group from templ.fun once the templ is live.
                    </p>
                  </div>
                  {createSteps.deploy !== 'idle' && (
                    <div className="rounded-lg border border-black/20 bg-white/80 p-3 text-xs text-black/70">
                      <div>{renderStepStatus('Deploy templ (tx)', createSteps.deploy, createSteps.deploy === 'error' ? createSteps.error : undefined)}</div>
                      {createSteps.deploy === 'success' && pendingJoinAddress && (
                        (() => {
                          const state = pendingJoinMatches ? (joinSteps.join === 'idle' ? 'pending' : joinSteps.join) : 'pending';
                          const note = state === 'error'
                            ? joinSteps.error || 'Join failed'
                            : state === 'success'
                              ? 'All set'
                              : 'Complete purchase & join to access chat';
                          return <div className="mt-1">{renderStepStatus('Join templ (next step)', state, note)}</div>;
                        })()
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-black/20 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-black/90">Pricing curve</h3>
                    <p className="text-xs text-black/60">
                      {showAdvanced
                        ? 'Adjust how the entry fee scales as membership grows.'
                        : 'Factory default applies a +0.94% exponential increase per paid join.'}
                    </p>
                    {!showAdvanced && (
                      <p className="text-xs text-black/60 mt-1">
                        Switch to advanced options to customize the curve.
                      </p>
                    )}
                  </div>
                  {showAdvanced && (
                    <button
                      type="button"
                      className="text-xs font-medium text-black/50 underline underline-offset-4"
                      onClick={() => {
                        setCurvePrimaryStyle(DEFAULT_CURVE_STYLE);
                        setCurvePrimaryRateBps(String(DEFAULT_CURVE_RATE_BPS));
                      }}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                {showAdvanced && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-black/70 mb-1">
                        Primary style
                      </label>
                      <select
                        className="w-full border border-black/20 rounded px-3 py-2"
                        value={curvePrimaryStyle}
                        onChange={(event) => {
                          const next = event.target.value;
                          setCurvePrimaryStyle(next);
                          if (next === 'static') {
                            setCurvePrimaryRateBps('0');
                          } else if (curvePrimaryRateBps === '0') {
                            setCurvePrimaryRateBps(next === 'exponential' ? String(DEFAULT_CURVE_RATE_BPS) : '500');
                          }
                        }}
                      >
                        {CURVE_STYLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black/70 mb-1">
                        Primary rate (basis points)
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="w-full border border-black/20 rounded px-3 py-2"
                        value={curvePrimaryRateBps}
                        onChange={(event) => {
                          setCurvePrimaryRateBps(event.target.value);
                        }}
                        disabled={curvePrimaryStyle === 'static'}
                      />
                      <p className="text-xs text-black/60 mt-1">
                        Example: 10094 ~0.94% increase per join.
                      </p>
                    </div>
                  </div>
                )}
                <div className="mt-6">
                  <div className="rounded-lg border border-black/10 p-4" style={{ background: 'rgba(0, 0, 0, 0.03)' }}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-black/50">{curvePreview.meta?.modeLabel ?? 'Curve preview'}</div>
                        <div className="text-sm font-semibold text-black/80">
                          {curvePreview.meta?.styleLabel ?? 'Pricing curve'}
                        </div>
                        {curvePreview.meta?.rateDescriptor && (
                          <div className="text-xs text-black/60">{curvePreview.meta.rateDescriptor}</div>
                        )}
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-black/80" style={{ background: 'rgba(229, 255, 90, 0.2)' }}>
                        <span>Join Fee Projection</span>
                        <span className="font-semibold text-black/70">{formatPreviewRangeLabel(curvePreview)}</span>
                      </div>
                    </div>
                    {curvePreview.ready ? (
                      <>
                        <div className="relative mt-4 h-40 w-full">
                          <svg
                            viewBox={`0 0 ${curvePreview.chart.width} ${curvePreview.chart.height}`}
                            role="img"
                            aria-label="Entry fee curve preview"
                            className="h-full w-full"
                          >
                            <defs>
                              <linearGradient id={CURVE_PREVIEW_GRADIENT_ID} x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#ffd600" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#ffd600" stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            {curvePreview.chart.areaPath && (
                              <path
                                d={curvePreview.chart.areaPath}
                                fill={`url(#${CURVE_PREVIEW_GRADIENT_ID})`}
                                stroke="none"
                              />
                            )}
                            {curvePreview.chart.linePath && (
                              <path
                                d={curvePreview.chart.linePath}
                                fill="none"
                                stroke="#f2a900"
                                strokeWidth="2"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                              />
                            )}
                            {curvePreview.chart.highlightPoints.map((point, index) => (
                              <g key={`highlight-${index}`}>
                                <circle cx={point.x} cy={point.y} r="5" fill="#111827" fillOpacity="0.15" />
                                <circle cx={point.x} cy={point.y} r="3" fill="#f2a900" />
                              </g>
                            ))}
                          </svg>
                          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-between px-3 text-[10px] font-medium uppercase tracking-wide text-black/40">
                            {curvePreview.chart.axisTicks.map((tick) => (
                              <span key={`axis-${tick.value}`}>{tick.label}</span>
                            ))}
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {curvePreview.highlightCards.map((card) => (
                            <div
                              key={card.key}
                              className="rounded-md border border-black/10 px-3 py-2 shadow-sm"
                              style={{ background: 'rgba(255, 255, 255, 0.85)' }}
                            >
                              <div className="text-xs uppercase tracking-wide text-black/50">{card.ordinalLabel}</div>
                              {card.withinCap && card.display?.primary ? (
                                <>
                                  <div className="text-sm font-semibold text-black/90 mt-1">{card.display.primary}</div>
                                  {card.display.usd && (
                                    <div className="text-xs text-black/60">{card.display.usd}</div>
                                  )}
                                  {card.display.secondary && (
                                    <div className="text-xs text-black/60">{card.display.secondary}</div>
                                  )}
                                  {card.multiplier && (
                                    <div className="text-xs text-black/60 mt-1">{card.multiplier}</div>
                                  )}
                                  <div className="mt-3 space-y-1 text-xs text-black/70">
                                    <div>
                                      <span className="font-semibold text-black/80">Total burn</span>{' '}
                                      {card.burnTotal?.token ?? card.burnTotal?.raw ?? '—'}
                                      {card.burnTotal?.usd ? ` • ${card.burnTotal.usd}` : ''}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-black/80">Total treasury</span>{' '}
                                      {card.treasuryTotal?.token ?? card.treasuryTotal?.raw ?? '—'}
                                      {card.treasuryTotal?.usd ? ` • ${card.treasuryTotal.usd}` : ''}
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="text-sm text-black/60 mt-1">Capped by max members</div>
                              )}
                            </div>
                          ))}
                        </div>
                        {(curvePreview.meta?.note || curvePreview.footnote) && (
                          <p className="mt-3 text-xs text-black/60">
                            {curvePreview.meta?.note ?? ''}
                            {curvePreview.meta?.note && curvePreview.footnote ? ' ' : ''}
                            {curvePreview.footnote ?? ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-4 text-sm text-black/60">
                        Set a base entry fee to preview how the curve evolves.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handleDeploy}>Deploy</button>
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-black/20 text-sm"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                >
                  {showAdvanced ? 'Hide advanced' : 'Advanced options'}
                </button>
              </div>
            </div>
          </div>
        )}

        {path === '/join' && (
          <div className="join space-y-3">
            <h2 className="text-xl font-semibold">Join Existing Templ</h2>
            <p className="text-sm text-black/70">
              You were invited to join this templ! Pay the tithe once to unlock its private chat, follow live proposals, and vote on treasury actions.
            </p>
            <div className="rounded border border-black/20 bg-white/80 p-3 text-xs text-black/70 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-black/90">Membership cost</div>
                  <p className="mt-1 text-xs text-black/60">
                    Pay the entry fee once to become a member, then sign a message so templ.fun can invite you into the XMTP group chat.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-black/80">Templ contract</span>
                  <div className="flex items-center gap-2">
                    <a className="font-mono text-[11px] underline underline-offset-4" href={baseScanUrl(templAddress)} target="_blank" rel="noreferrer">
                      {templAddress ? shorten(templAddress) : '…'}
                    </a>
                    {templAddress && (
                      <button type="button" className="px-2 py-1 text-[11px] rounded border border-black/20" onClick={() => copyToClipboard(templAddress)}>
                        Copy
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-black/80">Token</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px]">
                      {joinMembershipInfo.token ? shorten(joinMembershipInfo.token) : '…'}
                    </span>
                    {joinMembershipInfo.token && (
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded border border-black/20"
                        onClick={() => copyToClipboard(joinMembershipInfo.token)}
                      >
                        Copy
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-black/80">Entry fee</span>
                  <span className="text-black/80">
                    {joinMembershipInfo.formatted || joinMembershipInfo.raw || 'Loading…'}
                  </span>
                </div>
                {joinMembershipInfo.usd && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-black/80">Approx. USD</span>
                    <span>{joinMembershipInfo.usd}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-black/80">Decimals</span>
                  <span>{Number.isInteger(joinMembershipInfo.decimals) ? joinMembershipInfo.decimals : 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-black/80">Members</span>
                  <span>{memberCountWithLimit}</span>
                </div>
              </div>
            </div>
            <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Contract address" value={templAddress} onChange={(e) => updateTemplAddress(e.target.value)} />
            {showApprovalPrompt && (
              <div className="rounded border border-black/20 bg-white/80 p-3 text-xs text-black/70 space-y-1">
                <p className={`text-xs ${approvalStage === 'approved' ? 'text-green-700' : approvalStage === 'error' ? 'text-red-600' : 'text-black/60'}`}>
                  {approvalStatusText}
                </p>
                {approvalAllowance !== null && joinMembershipInfo.required && (
                  <p className="text-[11px] text-black/50">
                    Allowance: {formatAllowance(approvalAllowance, joinMembershipInfo.decimals, joinMembershipInfo.symbol)} • Required: {formatAllowance(joinMembershipInfo.required.toString(), joinMembershipInfo.decimals, joinMembershipInfo.symbol)}
                  </p>
                )}
              </div>
            )}
            {alreadyMember && (
              <div className="rounded border border-black/20 bg-white/80 p-3 text-xs text-black/70">
                You already have access to this templ. Use the chat to coordinate with members.
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {showApprovalPrompt && (
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-black/20 text-sm font-semibold w-full sm:w-auto"
                  onClick={handleApproveToken}
                  disabled={approvalButtonDisabled}
                >
                  {approvalButtonLabel}
                </button>
              )}
              {!alreadyMember && (
                <button
                  className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto"
                  onClick={handlePurchaseAndJoin}
                  disabled={joinSteps.purchase === 'pending' || joinSteps.join === 'pending' || (needsTokenApproval && approvalStage !== 'approved')}
                >
                  Purchase & Join
                </button>
              )}
              {alreadyMember && (
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-black/20 text-sm font-semibold w-full sm:w-auto"
                  onClick={() => navigate(`/chat?address=${templAddress}`)}
                >
                  Go to Chat
                </button>
              )}
            </div>
            <p className="text-xs text-black/60">
              After the on-chain join confirms, the templ backend may take up to a minute to provision the XMTP group. The status panel below updates automatically once the chat is ready.
            </p>
            {(joinSteps.purchase !== 'idle' || joinSteps.join !== 'idle') && pendingJoinMatches && (
              <div className="mt-2 rounded border border-black/10 bg-white/70 p-3 text-xs text-black/70">
                <div>{renderStepStatus('Purchase access (tx)', joinSteps.purchase, joinSteps.purchase === 'error' ? joinSteps.error : purchaseStatusNote || undefined)}</div>
                <div>{renderStepStatus('Join & sync', joinSteps.join, joinSteps.join === 'error' ? joinSteps.error : joinStatusNote || undefined)}</div>
              </div>
            )}
            {/* Optional list if no prefill */}
              {(!templAddress || templAddress.trim() === '') && (
                <div className="space-y-2">
                  {templCards.map((card) => {
                    const summary = card.summary;
                    if (!summary || summary.status === 'loading') {
                      return (
                        <div key={card.contract} className="flex flex-col gap-2 rounded border border-black/10 bg-white/70 p-3 text-xs text-black/60">
                          Loading templ metadata…
                        </div>
                      );
                    }
                    if (summary.status === 'error') {
                      return (
                        <div key={card.contract} className="flex flex-col gap-2 rounded border border-black/10 bg-white/70 p-3 text-xs text-red-600">
                          {summary.error || 'Failed to load templ metadata'}
                        </div>
                      );
                    }
                    const alreadyJoined = card.joined;
                    const tokenLabel = summary.symbol || (summary.token ? shorten(summary.token) : 'Unknown token');
                    const membersLabel = formatMembersLabel(summary.memberCount, summary.maxMembers);
                    return (
                      <div key={card.contract} className="flex flex-col gap-2 rounded border border-black/10 bg-white/70 p-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-black/90">Templ</span>
                            <a className="text-xs font-mono underline underline-offset-4" href={baseScanUrl(card.contract)} target="_blank" rel="noreferrer">
                              {shorten(card.contract)}
                            </a>
                            <button type="button" className="text-[11px] underline" onClick={() => copyToClipboard(card.contract)}>Copy</button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-black/90">Token</span>
                            {summary.token ? (
                              <>
                                <a className="text-xs font-mono underline underline-offset-4" href={baseScanUrl(summary.token)} target="_blank" rel="noreferrer">
                                  {shorten(summary.token)}
                                </a>
                                <span className="text-xs text-black/60">{tokenLabel}</span>
                              </>
                            ) : (
                              <span className="text-xs text-black/60">Unknown</span>
                            )}
                          </div>
                          <div className="text-xs text-black/60">Entry fee: {summary.formatted || summary.raw}</div>
                          {summary.usd && <div className="text-xs text-black/60">≈ {summary.usd}</div>}
                          <div className="text-xs text-black/60">Members: {membersLabel}</div>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <button className="px-3 py-1 rounded border border-black/20 w-full sm:w-auto" onClick={() => navigate(`/join?address=${card.contract}`)}>
                            {alreadyJoined ? 'Review Join Flow' : 'Join'}
                          </button>
                          <button className="px-3 py-1 rounded border border-black/20 w-full sm:w-auto" onClick={() => navigate(`/chat?address=${card.contract}`)}>
                            {alreadyJoined ? 'Go to Chat' : 'Open Chat'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        {path === '/chat' && (
          templAddress ? (
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
            {pendingJoinMatches && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-black/80">
              <div className="font-semibold">Join not completed yet</div>
              <p className="mt-1">Finish the join flow to unlock chat features.</p>
              <div className="mt-2 text-xs text-black/70">
                  <div>{renderStepStatus('Purchase access (tx)', joinSteps.purchase, joinSteps.purchase === 'error' ? joinSteps.error : purchaseStatusNote || undefined)}</div>
                  <div>{renderStepStatus('Join & sync', joinSteps.join, joinSteps.join === 'error' ? joinSteps.error : joinStatusNote || undefined)}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-1 rounded border border-black/20 text-xs font-semibold"
                    onClick={handlePurchaseAndJoin}
                    disabled={joinSteps.purchase === 'pending' || joinSteps.join === 'pending'}
                  >
                    Complete join
                  </button>
                </div>
              </div>
            )}

            {chatProvisionState && (
              <div className="mb-3 rounded border border-sky-300 bg-sky-50 p-3 text-sm text-black/80">
                <div className="font-semibold">
                  {chatProvisionState === 'pending-group' ? 'Chat setup pending' : 'Chat provisioning in progress'}
                </div>
                <p className="mt-1 text-xs text-black/70">
                  {chatProvisionState === 'pending-group'
                    ? 'Templ backend is finalizing the XMTP group. Check back shortly; chat unlocks as soon as the group is ready.'
                    : 'XMTP is still syncing this conversation. Messages will appear as soon as the group becomes available.'}
                </p>
              </div>
            )}

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
                  <div className="text-sm">Members: {memberCountWithLimit}</div>
                  <div className="text-sm text-black/70">Member limit: {maxMembersLabel}</div>
                  {limitReached && (
                    <div className="text-xs text-red-600" data-testid="member-limit-reached">Member limit reached — contract paused until the limit is raised or removed.</div>
                  )}
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
                      {/* Telegram Binding Section */}
                      <div className="mt-4 pt-4 border-t border-black/10 space-y-2">
                        <h4 className="text-sm font-medium">Telegram Integration</h4>
                        <p className="text-xs text-black/60">
                          Rotate Telegram bindings with the operator CLI so signatures stay verified. See
                          <span> </span>
                          <button
                            type="button"
                            className="underline text-black/70"
                            onClick={() => {
                              pushStatus('📚 Open docs/FRONTEND.md#telegram-integration for binding steps.');
                            }}
                          >
                            docs/FRONTEND.md
                          </button>
                          <span> for step-by-step commands.</span>
                        </p>
                        <p className="text-xs text-black/60">
                          Once a binding code is generated, share it with your Telegram bot to complete the rotation.
                        </p>
                      </div>

                      {/* Home Link Management */}
                      <div className="mt-4 pt-4 border-t border-black/10">
                        <h4 className="text-sm font-medium mb-2">Home Link</h4>
                        <div className="space-y-2">
                          <div className="text-sm text-black/60">
                            Set a home link to help members discover your public group
                          </div>
                          <div className="flex gap-2">
                            <input
                              className="flex-1 border border-black/20 rounded px-3 py-2 text-sm"
                              placeholder="https://t.me/your-group"
                              value={homeLink}
                              onChange={(e) => setHomeLink(e.target.value)}
                            />
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={async () => {
                                try {
                                  if (!homeLink.trim()) {
                                    pushStatus('❌ Please enter a valid home link');
                                    return;
                                  }
                                  // Here you would typically call an API to update the home link
                                  // For now, we'll just show a success message
                                  pushStatus('✅ Home link updated (mock implementation)');
                                } catch {
                                  pushStatus('❌ Failed to update home link');
                                }
                              }}
                            >
                              Update
                            </button>
                          </div>
                        </div>
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
                const endTimeSec = Number.isFinite(poll.endTime) ? poll.endTime : null;
                const executed = Boolean(poll.executed);
                const passed = Boolean(poll.passed);
                const quorumReachedAt = Number.isFinite(poll.quorumReachedAt) ? poll.quorumReachedAt : null;
                const executionDelay = Number.isFinite(currentExecutionDelay) ? currentExecutionDelay : null;
                const unlockAt = (() => {
                  if (quorumReachedAt !== null) {
                    if (endTimeSec !== null && endTimeSec >= quorumReachedAt) return endTimeSec;
                    if (executionDelay !== null) return quorumReachedAt + executionDelay;
                  }
                  return endTimeSec;
                })();
                const votingCountdown = endTimeSec !== null ? Math.ceil(endTimeSec - nowSeconds) : null;
                const unlockCountdown = unlockAt !== null ? Math.ceil(unlockAt - nowSeconds) : null;
                let statusLine = '';
                if (executed) {
                  statusLine = 'Executed on-chain';
                } else if (quorumReachedAt !== null) {
                  if (passed) {
                    statusLine = 'Post-quorum · Execution ready';
                  } else if (unlockCountdown !== null && unlockCountdown > 0) {
                    statusLine = `Post-quorum · Timelock unlocks in ${formatDurationShort(unlockCountdown)}`;
                  } else {
                    statusLine = 'Post-quorum · Execution ready';
                  }
                } else if (votingCountdown !== null && votingCountdown > 0) {
                  statusLine = `Pre-quorum · Voting closes in ${formatDurationShort(votingCountdown)}`;
                } else if (votingCountdown !== null) {
                  statusLine = 'Pre-quorum · Voting window ended';
                } else {
                  statusLine = 'Pre-quorum';
                }
                if (!executed && passed && !statusLine.includes('Execution ready')) {
                  statusLine = statusLine.includes('Post-quorum') ? 'Post-quorum · Execution ready' : 'Execution ready';
                }
                const eligiblePre = Number.isFinite(poll.eligibleVotersPreQuorum) ? poll.eligibleVotersPreQuorum : null;
                const eligiblePost = Number.isFinite(poll.eligibleVotersPostQuorum) ? poll.eligibleVotersPostQuorum : null;
                const quorumPieces = [];
                if (Number.isFinite(currentQuorumPercent)) {
                  quorumPieces.push(`${currentQuorumPercent}% quorum target`);
                }
                if (eligiblePre !== null) {
                  const eligibleLabel = eligiblePost !== null && eligiblePost !== eligiblePre
                    ? `Eligible voters: ${eligiblePre} → ${eligiblePost}`
                    : `Eligible voters: ${eligiblePre}`;
                  quorumPieces.push(eligibleLabel);
                }
                if (quorumReachedAt !== null) {
                  const rel = formatRelativeTimeFromSeconds(quorumReachedAt, nowSeconds);
                  if (rel) quorumPieces.push(`Quorum reached ${rel}`);
                }
                if (quorumReachedAt !== null && executionDelay !== null) {
                  quorumPieces.push(`Timelock ${formatDurationShort(executionDelay)}`);
                }
                const quorumLine = quorumPieces.filter(Boolean).join(' · ');

                return (
                  <div key={i} className="chat-item chat-item--poll">
                    <div className="chat-poll">
                      <div className="chat-poll__title">{m.title || `Proposal #${pid}`}</div>
                      {poll.description && (
                        <div className="chat-poll__description" data-testid={`proposal-description-${pid}`}>{poll.description}</div>
                      )}
                      {statusLine && (
                        <div className="text-xs text-black/60 mt-2">{statusLine}</div>
                      )}
                      {quorumLine && (
                        <div className="text-xs text-black/50 mt-1">{quorumLine}</div>
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
                          <button
                            className="btn btn-primary"
                            onClick={() => handleExecuteProposal(pid)}
                            disabled={!passed || executed}
                          >Execute</button>
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
              if (!mine && addr && mutes.includes(addr)) {
                return null;
              }
              const prof = profilesByAddress[addr] || {};
              const display = (mine ? (profileName || 'You') : (prof.name || shorten(m.senderAddress)));
              const isDelegated = delegates.includes(addr);
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
                    {canModerate && !mine && addr && (
                      <div
                        className="chat-moderation"
                        data-testid="moderation-controls"
                        data-address={addr}
                        data-delegated={isDelegated ? 'true' : 'false'}
                      >
                        {isPriest && !isDelegated && (
                          <button
                            className="btn btn-xs"
                            data-testid="delegate-button"
                            onClick={() => handleDelegateMember(addr)}
                          >Delegate</button>
                        )}
                        <button
                          className="btn btn-xs btn-outline"
                          data-testid="mute-button"
                          data-address={addr}
                          disabled={mutes.includes(addr)}
                          onClick={() => handleMuteMember(addr)}
                        >{mutes.includes(addr) ? 'Muted' : 'Mute'}</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            <div className="chat-composer flex gap-2">
              <input className="flex-1 border border-black/20 rounded px-3 py-2" data-testid="chat-input" placeholder="Type a message" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} />
              <button
                className="px-3 py-2 rounded bg-primary text-black font-semibold"
                data-testid="chat-send"
                onClick={handleSend}
                disabled={(!group && !groupId) || (pendingJoinMatches && joinSteps.join !== 'success')}
              >
                Send
              </button>
            </div>
          </div>
          ) : (
            <div className="space-y-3 border border-black/10 rounded p-4">
              <h2 className="text-lg font-semibold">Select a templ</h2>
              <p className="text-sm text-black/60">
                Visit the list tab and choose a templ you have joined to open its chat.
              </p>
              <button className="px-3 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={() => navigate('/templs')}>
                Back to List
              </button>
            </div>
          )
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
              <div className="mb-3 border border-black/10 rounded px-3 py-2 text-xs text-black/70">
                <div className="font-semibold text-black/80">XMTP Status</div>
              <div className="mt-1">
                {xmtpLimitWarning ? (
                  <span className="text-red-600">{xmtpLimitWarning}</span>
                ) : xmtp ? (
                  <span>
                    Connected{activeInboxId ? <span> • Inbox {shorten(activeInboxId)}</span> : null}
                  </span>
                ) : (
                  <span>Not connected</span>
                )}
              </div>
              <div className="mt-1 text-black/60">
                One XMTP inbox supports every templ you join. Wallets can maintain up to 10 active installations across all devices—revoke older installs to stay below the cap.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={handleOpenInstallations}
                >
                  Manage XMTP Installations
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={handleRevokeOtherInstallations}
                  disabled={!walletAddress || installationsLoading}
                >
                  Revoke Other Devices
                </button>
              </div>
            </div>
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

      {/* XMTP Installations Modal */}
      {installationsOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setInstallationsOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <div className="modal__title">XMTP Installations</div>
              <button className="modal__close" onClick={() => setInstallationsOpen(false)}>×</button>
            </div>
            <div className="modal__body space-y-3 text-sm">
              <p className="text-xs text-black/60">
                XMTP wallets can keep up to 10 active installations. Revoke older installations to free space for new devices.
              </p>
              {installationsLoading ? (
                <div className="text-xs text-black/60">Loading installations…</div>
              ) : installationsError ? (
                <div className="text-xs text-red-600">{installationsError}</div>
              ) : (
                <div className="space-y-2">
                  {installations.length === 0 && (
                    <div className="text-xs text-black/60">No installations found for this wallet.</div>
                  )}
                  {installations.map((inst) => {
                    const isActive = inst.id === activeInstallationId;
                    let relative = null;
                    if (inst.timestamp) {
                      const seconds = Math.floor(inst.timestamp / 1_000_000_000);
                      relative = formatRelativeTimeFromSeconds(seconds, nowSeconds);
                    }
                    return (
                      <div key={inst.id} className="flex items-center justify-between gap-3 border border-black/10 rounded px-3 py-2">
                        <div>
                          <div className="text-xs font-mono break-all">{inst.id}</div>
                          {relative && <div className="text-[11px] text-black/60">Last activity {relative}</div>}
                        </div>
                        {isActive ? (
                          <span className="text-xs text-black/50 uppercase tracking-wide">Active</span>
                        ) : (
                          <button className="btn btn-xs" onClick={() => handleRevokeInstallation(inst.id)}>Revoke</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setInstallationsOpen(false)}>Close</button>
              <div className="flex gap-2">
                <button className="btn" onClick={loadInstallationsState} disabled={installationsLoading}>Refresh</button>
                <button
                  className="btn btn-primary"
                  onClick={handleRevokeOtherInstallations}
                  disabled={installationsLoading || installations.length <= 1}
                >
                  Revoke Others
                </button>
              </div>
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
              <div className="flex flex-wrap gap-2 mb-2">
                <button className={`btn ${proposeAction==='pause'?'btn-primary':''}`} onClick={() => setProposeAction('pause')}>Pause DAO</button>
                <button className={`btn ${proposeAction==='unpause'?'btn-primary':''}`} onClick={() => setProposeAction('unpause')}>Unpause DAO</button>
                <button className={`btn ${proposeAction==='moveTreasuryToMe'?'btn-primary':''}`} onClick={() => setProposeAction('moveTreasuryToMe')}>Move Treasury To Me</button>
                <button className={`btn ${proposeAction==='disband'?'btn-primary':''}`} onClick={() => setProposeAction('disband')}>Disband Treasury</button>
                <button className={`btn ${proposeAction==='reprice'?'btn-primary':''}`} onClick={() => setProposeAction('reprice')}>Reprice Entry Fee</button>
                <button className={`btn ${proposeAction==='setMaxMembers'?'btn-primary':''}`} onClick={() => setProposeAction('setMaxMembers')}>Set Member Limit</button>
                <button className={`btn ${proposeAction==='rebalance'?'btn-primary':''}`} onClick={() => setProposeAction('rebalance')}>Adjust Fee Split</button>
                <button className={`btn ${proposeAction==='changePriest'?'btn-primary':''}`} onClick={() => setProposeAction('changePriest')}>Change Priest</button>
                <button
                  className={`btn ${proposeAction==='enableDictatorship'?'btn-primary':''}`}
                  onClick={() => setProposeAction('enableDictatorship')}
                  disabled={isDictatorship === true}
                  title={isDictatorship === true ? 'Already in priest dictatorship mode' : 'Enable priest dictatorship'}
                >Enable Dictatorship</button>
                <button
                  className={`btn ${proposeAction==='disableDictatorship'?'btn-primary':''}`}
                  onClick={() => setProposeAction('disableDictatorship')}
                  disabled={isDictatorship === false}
                  title={isDictatorship === false ? 'Already in member democracy mode' : 'Enable member democracy'}
                >Enable Democracy</button>
                {/* <button className={`btn ${proposeAction==='none'?'btn-primary':''}`} onClick={() => setProposeAction('none')}>Custom/None</button> */}
              </div>
              <div className="text-xs text-black/60 mb-2">
                Governance mode: {isDictatorship === null ? 'Loading...' : isDictatorship ? 'Priest dictatorship (no standard proposals allowed)' : 'Member democracy (full proposal flow)'}
              </div>
              {(proposeAction === 'enableDictatorship' || proposeAction === 'disableDictatorship') && (
                <div className="text-xs text-black/80 mb-2">
                  {proposeAction === 'enableDictatorship'
                    ? 'Enabling dictatorship lets the priest execute governance actions instantly; only the priest can later return to democracy.'
                    : 'Disabling dictatorship restores proposal-based governance and once again requires member voting.'}
                </div>
              )}
              <div className="text-xs text-black/60">Tip: Pause/Unpause, Move Treasury, and Set Member Limit encode the call data automatically. Reprice expects a new fee in raw token amounts. Adjust Fee Split collects the burn/treasury/member percentages (protocol share stays at the contract’s configured value).</div>
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
              {proposeAction === 'setMaxMembers' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder={maxMembersLabel === '…' ? 'New member limit' : `Current ${memberCountWithLimit}`}
                      value={proposeMaxMembers}
                      onChange={(e) => setProposeMaxMembers(e.target.value)}
                    />
                  </div>
                  <div className="text-xs text-black/60">Current members: {memberCountWithLimit}. Enter 0 to remove the limit; values below the current member count will be rejected on-chain.</div>
                </div>
              )}
              {proposeAction === 'moveTreasuryToMe' && (
                <div className="text-xs text-black/80 mt-1 flex flex-col gap-2">
                  <div className="flex gap-2 items-center">
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder="Token address or ETH (defaults to entry token)"
                      value={proposeToken}
                      onChange={(e) => setProposeToken(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder="Amount to withdraw (raw units, blank = max)"
                      value={proposeAmount}
                      onChange={(e) => setProposeAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      className="w-full border border-black/20 rounded px-3 py-2"
                      placeholder="Reason (optional)"
                      value={proposeReason}
                      onChange={(e) => setProposeReason(e.target.value)}
                    />
                  </div>
                  <div className="text-xs text-black/60">
                    Amount is interpreted as raw token units. For the entry token, subtracts the member pool before calculating “blank = max”.
                  </div>
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
                  let callData = null;
                  let actionKey = null;
                  let actionParams = {};
                  const metaTitle = proposeTitle || 'Untitled';
                  const metaDescription = (proposeDesc || '').trim();

                  if (proposeAction === 'pause' || proposeAction === 'unpause') {
                    actionKey = 'setPaused';
                    actionParams = { paused: proposeAction === 'pause' };
                    if (!proposeTitle) setProposeTitle(proposeAction === 'pause' ? 'Pause DAO' : 'Resume DAO');
                    if (!proposeDesc) setProposeDesc(proposeAction === 'pause' ? 'Pause all joins and proposal execution.' : 'Resume normal operations for joins and governance.');
                  } else if (proposeAction === 'moveTreasuryToMe') {
                    try {
                      const me = await signer.getAddress();
                      const templ = new ethers.Contract(templAddress, templArtifact.abi, signer);
                      const tokenInput = proposeToken.trim();
                      let tokenAddr;
                      if (!tokenInput) {
                        tokenAddr = await templ.accessToken();
                      } else if (tokenInput.toLowerCase() === 'eth') {
                        tokenAddr = ethers.ZeroAddress;
                      } else {
                        if (!ethers.isAddress(tokenInput)) {
                          throw new Error('Invalid treasury token address');
                        }
                        tokenAddr = ethers.getAddress(tokenInput);
                      }
                      const amountInput = proposeAmount.trim();
                      let amount = 0n;
                      if (amountInput) {
                        try {
                          amount = BigInt(amountInput);
                        } catch {
                          throw new Error('Invalid withdrawal amount');
                        }
                        if (amount < 0n) {
                          throw new Error('Withdrawal amount must be non-negative');
                        }
                      } else {
                        const provider = signer.provider;
                        if (!provider) {
                          throw new Error('Unable to read balances (no provider)');
                        }
                        if (tokenAddr === ethers.ZeroAddress) {
                          amount = BigInt(await provider.getBalance(templAddress));
                        } else {
                          const erc20 = new ethers.Contract(tokenAddr, ['function balanceOf(address) view returns (uint256)'], signer);
                          const bal = BigInt(await erc20.balanceOf(templAddress));
                          const accessToken = (await templ.accessToken()).toLowerCase();
                          if (tokenAddr.toLowerCase() === accessToken) {
                            const pool = BigInt(await templ.memberPoolBalance());
                            amount = bal > pool ? (bal - pool) : 0n;
                          } else {
                            amount = bal;
                          }
                        }
                      }
                      const reason = proposeReason.trim() || 'Treasury withdrawal';
                      actionKey = 'withdrawTreasury';
                      actionParams = { token: tokenAddr, recipient: me, amount, reason };
                      if (!proposeTitle) setProposeTitle('Move Treasury to me');
                      if (!proposeDesc) setProposeDesc(reason);
                    } catch (e) {
                      alert(e?.message || 'Failed to prepare treasury withdrawal');
                      return;
                    }
                  } else if (proposeAction === 'reprice') {
                    try {
                      const newFee = BigInt(String(proposeFee || '0'));
                      actionKey = 'updateConfig';
                      actionParams = {
                        newEntryFee: newFee,
                        updateFeeSplit: false,
                        newBurnPercent: 0,
                        newTreasuryPercent: 0,
                        newMemberPoolPercent: 0
                      };
                      if (!proposeTitle) setProposeTitle('Reprice Entry Fee');
                      if (!proposeDesc) setProposeDesc(`Set new entry fee to ${String(newFee)}`);
                    } catch (e) {
                      alert(e?.message || 'Invalid entry fee');
                      return;
                    }
                  } else if (proposeAction === 'setMaxMembers') {
                    try {
                      const trimmed = String(proposeMaxMembers || '').trim();
                      if (trimmed && !/^\d+$/.test(trimmed)) throw new Error('Member limit must be a non-negative integer');
                      const target = trimmed ? BigInt(trimmed) : 0n;
                      if (memberCountValue !== null && target > 0n && BigInt(memberCountValue) > target) {
                        throw new Error('Limit must be at least the current member count');
                      }
                      actionKey = 'setMaxMembers';
                      actionParams = { newMaxMembers: target };
                      if (!proposeTitle) setProposeTitle('Set Member Limit');
                      if (!proposeDesc) {
                        setProposeDesc(target === 0n ? 'Remove the member limit' : `Set max members to ${target.toString()}`);
                      }
                    } catch (e) {
                      alert(e?.message || 'Invalid member limit');
                      return;
                    }
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
                      actionKey = 'updateConfig';
                      actionParams = {
                        newEntryFee: 0n,
                        updateFeeSplit: true,
                        newBurnPercent: burnValue,
                        newTreasuryPercent: treasuryValue,
                        newMemberPoolPercent: memberValue
                      };
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
                      actionKey = 'disbandTreasury';
                      actionParams = { token: tokenAddr };
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
                      actionKey = 'changePriest';
                      actionParams = { newPriest: addr };
                      if (!proposeTitle) setProposeTitle('Change Priest');
                      if (!proposeDesc) setProposeDesc(`Set new priest to ${addr}`);
                    } catch (e) {
                      alert(e?.message || 'Invalid address');
                      return;
                    }
                  } else if (proposeAction === 'enableDictatorship' || proposeAction === 'disableDictatorship') {
                    const enable = proposeAction === 'enableDictatorship';
                    actionKey = 'setDictatorship';
                    actionParams = { enable };
                    if (!proposeTitle) setProposeTitle(enable ? 'Enable Dictatorship' : 'Return to Democracy');
                    if (!proposeDesc) {
                      setProposeDesc(enable
                        ? 'Enable priest dictatorship so governance actions execute instantly (only the priest can later return to democracy).'
                        : 'Disable priest dictatorship to restore member voting.');
                    }
                  }

                  let proposalId = null;
                  if (actionKey) {
                    const result = await proposeVote({
                      ethers,
                      signer,
                      templAddress,
                      templArtifact,
                      action: actionKey,
                      params: actionParams,
                      title: metaTitle,
                      description: metaDescription
                    });
                    proposalId = result?.proposalId ?? null;
                  } else if (callData) {
                    const result = await proposeVote({
                      ethers,
                      signer,
                      templAddress,
                      templArtifact,
                      callData,
                      title: metaTitle,
                      description: metaDescription
                    });
                    proposalId = result?.proposalId ?? null;
                  } else {
                    alert('Unsupported proposal type');
                    return;
                  }
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
                  setProposeAmount('');
                  setProposeReason('');
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
function toNumeric(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  const asString = (() => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && value !== null) {
      try {
        const str = value.toString?.();
        return typeof str === 'string' ? str.trim() : '';
      } catch {
        return '';
      }
    }
    return '';
  })();
  if (!asString) return null;
  const parsed = Number(asString);
  if (Number.isFinite(parsed)) return parsed;
  try {
    const num = Number(BigInt(asString));
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

function messageIdentityKey(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.mid !== undefined && message.mid !== null) {
    try { return `mid:${String(message.mid)}`; } catch { return null; }
  }
  if (message.localNonce) {
    try { return `local:${String(message.localNonce)}`; } catch { return null; }
  }
  if (message.kind === 'proposal' && message.proposalId !== undefined) {
    try { return `proposal:${String(message.proposalId)}`; } catch { return null; }
  }
  if (message.kind === 'system' && message.content) {
    const sender = message.senderAddress ? String(message.senderAddress).toLowerCase() : '';
    return `system:${sender}:${String(message.content)}`;
  }
  if (message.kind === 'text' && message.content && message.senderAddress) {
    return `text:${String(message.senderAddress).toLowerCase()}:${String(message.content)}`;
  }
  return null;
}

function formatTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDurationShort(seconds) {
  if (!Number.isFinite(seconds)) return '…';
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return '0s';
  const units = [
    { label: 'd', value: 86400 },
    { label: 'h', value: 3600 },
    { label: 'm', value: 60 },
    { label: 's', value: 1 }
  ];
  const parts = [];
  let remainder = total;
  for (const unit of units) {
    if (remainder < unit.value) continue;
    const count = Math.floor(remainder / unit.value);
    remainder -= count * unit.value;
    parts.push(`${count}${unit.label}`);
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return '0s';
  return parts.join(' ');
}

function formatRelativeTimeFromSeconds(timestamp, nowSeconds) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowSeconds)) return '';
  const diff = Math.floor(nowSeconds - timestamp);
  if (Math.abs(diff) < 1) return 'just now';
  const label = formatDurationShort(Math.abs(diff));
  return diff >= 0 ? `${label} ago` : `in ${label}`;
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
