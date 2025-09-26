import { sanitizeLink } from '../../shared/linkSanitizer.js';
import { logger as defaultLogger } from './logger.js';

/**
 * @typedef {import('pino').Logger} Logger
 */

/**
 * @typedef {Object} TelegramNotifierOptions
 * @property {string} [botToken]
 * @property {string} [linkBaseUrl]
 * @property {Logger} [logger]
 */

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

function formatHomeLinkLine(value) {
  const { href, text } = sanitizeLink(value);
  if (!text) return '';
  if (href) {
    return `<b>Home:</b> <a href="${escapeAttribute(href)}">${escapeHtml(text)}</a>`;
  }
  return `<b>Home:</b> ${escapeHtml(text)}`;
}

/**
 * @param {{ botToken?: string | null, chatId?: string | null, text: string, disablePreview?: boolean, logger?: Logger }} params
 */
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
    /** @type {any} */
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

/**
 * @param {TelegramNotifierOptions} [opts]
 */
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
    async notifyAccessPurchased({ chatId, contractAddress, memberAddress, purchaseId, treasuryBalance, memberPoolBalance, timestamp, homeLink }) {
      await send(chatId, [
        '<b>New member joined</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Member:', memberAddress),
        purchaseId != null ? `<b>Purchase ID:</b> ${escapeHtml(String(purchaseId))}` : '',
        formatTimestamp(timestamp),
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool:', memberPoolBalance),
        templLink(`/templs/join?address=${encodeURIComponent(String(contractAddress || ''))}`, 'Join this templ'),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim member rewards'),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyProposalCreated({ chatId, contractAddress, proposer, proposalId, endTime, title, description, homeLink }) {
      const titleLine = title ? `<b>${escapeHtml(title)}</b>` : '<b>Proposal created</b>';
      const descriptionLine = description ? escapeHtml(description) : '';
      await send(chatId, [
        titleLine,
        formatAddress('Templ:', contractAddress),
        formatAddress('Proposer:', proposer),
        proposalId != null ? `<b>Proposal ID:</b> ${escapeHtml(String(proposalId))}` : '',
        endTime ? formatTimestamp(endTime) : '',
        descriptionLine,
        templLink(
          `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
          'Review & vote'
        ),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyProposalQuorumReached({ chatId, contractAddress, proposalId, title, description, quorumReachedAt, homeLink }) {
      await send(chatId, [
        '<b>Quorum reached</b>',
        title ? `<b>${escapeHtml(title)}</b>` : '',
        description ? escapeHtml(description) : '',
        formatTimestamp(quorumReachedAt),
        templLink(
          `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
          'Cast or adjust your vote'
        ),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyVoteCast({ chatId, contractAddress, voter, proposalId, support, title, homeLink }) {
      const supportLabel = support === true || String(support).toLowerCase() === 'true' ? 'YES' : 'NO';
      await send(chatId, [
        '<b>Vote recorded</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Voter:', voter),
        proposalId != null ? `<b>Proposal ID:</b> ${escapeHtml(String(proposalId))}` : '',
        title ? `<b>Title:</b> ${escapeHtml(title)}` : '',
        `<b>Choice:</b> ${escapeHtml(supportLabel)}`,
        templLink(
          `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
          'Review proposal'
        ),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyProposalVotingClosed({ chatId, contractAddress, proposalId, title, description, endedAt, canExecute, homeLink }) {
      const statusLine = canExecute ? '<b>Status:</b> Ready for execution ✅' : '<b>Status:</b> Not executable ❌';
      await send(chatId, [
        '<b>Voting window ended</b>',
        title ? `<b>${escapeHtml(title)}</b>` : '',
        description ? escapeHtml(description) : '',
        formatTimestamp(endedAt),
        statusLine,
        templLink(
          `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
          canExecute ? 'Execute or review results' : 'Review results'
        ),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyPriestChanged({ chatId, contractAddress, oldPriest, newPriest, homeLink }) {
      await send(chatId, [
        '<b>Priest updated</b>',
        formatAddress('Templ:', contractAddress),
        formatAddress('Old priest:', oldPriest),
        formatAddress('New priest:', newPriest),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyDailyDigest({ chatId, contractAddress, treasuryBalance, memberPoolBalance, homeLink }) {
      await send(chatId, [
        '<b>gm templ crew!</b>',
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool (unclaimed):', memberPoolBalance),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim your share'),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Open templ overview'),
        formatHomeLinkLine(homeLink)
      ]);
    },
    async notifyTemplHomeLinkUpdated({ chatId, contractAddress, previousLink, newLink }) {
      const previousLine = previousLink ? formatHomeLinkLine(previousLink).replace('<b>Home:</b>', '<b>Previous:</b>') : '';
      const newLine = formatHomeLinkLine(newLink).replace('<b>Home:</b>', '<b>New:</b>');
      await send(chatId, [
        '<b>Templ home link updated</b>',
        formatAddress('Templ:', contractAddress),
        previousLine,
        newLine
      ]);
    },
    async notifyBindingComplete({ chatId, contractAddress, homeLink }) {
      await send(chatId, [
        '<b>Telegram bridge active</b>',
        formatAddress('Templ:', contractAddress),
        formatHomeLinkLine(homeLink),
        templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Open templ overview')
      ]);
    },
    /**
     * @param {{ offset?: number, timeout?: number }} [opts]
     */
    async fetchUpdates({ offset, timeout = 10 } = {}) {
      if (!token) return { updates: [], nextOffset: offset ?? 0 };
      const params = new URLSearchParams();
      if (offset) params.set('offset', String(offset));
      params.set('timeout', String(timeout));
      const url = `${TELEGRAM_API_BASE}/bot${token}/getUpdates?${params.toString()}`;
      try {
        const response = await fetch(url);
        /** @type {any} */
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.ok === false) {
          const errMsg = data?.description || response.statusText || 'getUpdates failed';
          logger?.warn?.({ err: errMsg, status: response.status }, 'telegram:getUpdates failed');
          return { updates: [], nextOffset: offset ?? 0 };
        }
        const updates = Array.isArray(data?.result) ? data.result : [];
        let nextOffset = offset ?? 0;
        if (updates.length) {
          const lastId = updates[updates.length - 1]?.update_id;
          if (typeof lastId === 'number') {
            nextOffset = lastId + 1;
          }
        }
        return { updates, nextOffset };
      } catch (err) {
        logger?.warn?.({ err: err?.message || err }, 'telegram:getUpdates error');
        return { updates: [], nextOffset: offset ?? 0 };
      }
    }
  };
}
