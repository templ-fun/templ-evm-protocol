import { logger as defaultLogger } from './logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatAddress(label, address) {
  if (!address) return '';
  return `<b>${escapeHtml(label)}</b> <code>${escapeHtml(String(address).toLowerCase())}</code>`;
}

function formatTimestamp(seconds) {
  if (!seconds || Number.isNaN(Number(seconds))) {
    return '';
  }
  try {
    const ts = Number(seconds);
    const date = ts > 10_000 ? new Date(ts * 1000) : new Date(ts);
    return `<b>When:</b> ${escapeHtml(date.toISOString())}`;
  } catch {
    return '';
  }
}

function buildLink(baseUrl, path, label) {
  if (!baseUrl) return '';
  const base = String(baseUrl).replace(/\/$/, '');
  const full = `${base}${path}`;
  return `<a href="${escapeAttribute(full)}">${escapeHtml(label)}</a>`;
}

function formatAmount(label, value) {
  if (value === undefined || value === null) return '';
  try {
    const asBigInt = BigInt(value);
    return `<b>${escapeHtml(label)}</b> ${escapeHtml(asBigInt.toString())}`;
  } catch {
    return `<b>${escapeHtml(label)}</b> ${escapeHtml(String(value))}`;
  }
}

async function postTelegramMessage({ botToken, chatId, text, disablePreview = true, logger = defaultLogger }) {
  if (!botToken || !chatId || !text) return;
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
  const body = new URLSearchParams();
  body.set('chat_id', String(chatId));
  body.set('text', text);
  body.set('parse_mode', 'HTML');
  if (disablePreview) body.set('disable_web_page_preview', 'true');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const errMsg = result?.description || response.statusText || 'Telegram request failed';
      logger?.warn?.({ chatId, status: response.status, err: errMsg }, 'telegram:sendMessage failed');
    }
  } catch (err) {
    logger?.warn?.({ chatId, err: err?.message || err }, 'telegram:sendMessage error');
  }
}

function normaliseChatId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export function createTelegramNotifier({ botToken, linkBaseUrl, logger = defaultLogger } = {}) {
  const token = typeof botToken === 'string' && botToken.trim().length ? botToken.trim() : null;
  const baseUrl = typeof linkBaseUrl === 'string' && linkBaseUrl.trim().length ? linkBaseUrl.trim() : null;

  async function send(chatId, lines) {
    const target = normaliseChatId(chatId);
    if (!token || !target) return;
    const text = lines.filter(Boolean).join('\n');
    if (!text) return;
    await postTelegramMessage({ botToken: token, chatId: target, text, logger });
  }

  function templLink(path, label) {
    if (!baseUrl) return '';
    return buildLink(baseUrl, path, label);
  }

  return {
    isEnabled: Boolean(token),
    async notifyAccessPurchased({ chatId, contractAddress, memberAddress, purchaseId, treasuryBalance, memberPoolBalance, timestamp }) {
      await send(chatId, [
        '<b>New member joined</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Member:', memberAddress),
        purchaseId != null ? `<b>Purchase ID:</b> ${escapeHtml(String(purchaseId))}` : '',
        formatTimestamp(timestamp),
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool:', memberPoolBalance),
        templLink(`/templs/join?address=${encodeURIComponent(String(contractAddress || ''))}`, 'Join this templ'),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim member rewards')
      ]);
    },
    async notifyProposalCreated({ chatId, contractAddress, proposer, proposalId, endTime, title, description }) {
      const titleLine = title ? `<b>${escapeHtml(title)}</b>` : '<b>Proposal created</b>';
      const descriptionLine = description ? escapeHtml(description) : '';
      await send(chatId, [
        titleLine,
        formatAddress('Templ:', contractAddress),
        formatAddress('Proposer:', proposer),
        proposalId != null ? `<b>Proposal ID:</b> ${escapeHtml(String(proposalId))}` : '',
        endTime ? formatTimestamp(endTime) : '',
        descriptionLine,
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}`, 'Review & vote')
      ]);
    },
    async notifyProposalQuorumReached({ chatId, contractAddress, proposalId, title, description, quorumReachedAt }) {
      await send(chatId, [
        '<b>Quorum reached</b>',
        title ? `<b>${escapeHtml(title)}</b>` : '',
        description ? escapeHtml(description) : '',
        formatTimestamp(quorumReachedAt),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}`, 'Cast or adjust your vote')
      ]);
    },
    async notifyVoteCast({ chatId, contractAddress, voter, proposalId, support, title }) {
      const supportLabel = support === true || String(support).toLowerCase() === 'true' ? 'YES' : 'NO';
      await send(chatId, [
        '<b>Vote recorded</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Voter:', voter),
        proposalId != null ? `<b>Proposal ID:</b> ${escapeHtml(String(proposalId))}` : '',
        title ? `<b>Title:</b> ${escapeHtml(title)}` : '',
        `<b>Choice:</b> ${escapeHtml(supportLabel)}`,
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}`, 'Review proposal')
      ]);
    },
    async notifyProposalVotingClosed({ chatId, contractAddress, proposalId, title, description, endedAt, canExecute }) {
      const statusLine = canExecute ? '<b>Status:</b> Ready for execution ✅' : '<b>Status:</b> Not executable ❌';
      await send(chatId, [
        '<b>Voting window ended</b>',
        title ? `<b>${escapeHtml(title)}</b>` : '',
        description ? escapeHtml(description) : '',
        formatTimestamp(endedAt),
        statusLine,
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}`, canExecute ? 'Execute or review results' : 'Review results')
      ]);
    },
    async notifyPriestChanged({ chatId, contractAddress, oldPriest, newPriest }) {
      await send(chatId, [
        '<b>Priest updated</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Old priest:', oldPriest),
        formatAddress('New priest:', newPriest),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview')
      ]);
    },
    async notifyDailyDigest({ chatId, contractAddress, treasuryBalance, memberPoolBalance }) {
      await send(chatId, [
        '<b>gm templ crew!</b>',
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool (unclaimed):', memberPoolBalance),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim your share'),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Open templ overview')
      ]);
    }
  };
}
