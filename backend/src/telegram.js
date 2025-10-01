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
const MARKDOWN_SPECIAL_CHARS = new Set(['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '=', '|', '{', '}', '.', '!', '\\', '-']);

function escapeMarkdownLinkUrl(url) {
  if (url === null || url === undefined) return '';
  return String(url)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  let output = '';
  for (const ch of String(text)) {
    output += MARKDOWN_SPECIAL_CHARS.has(ch) ? `\\${ch}` : ch;
  }
  return output;
}

function formatBold(text) {
  const escaped = escapeMarkdown(text);
  return `*${escaped}*`;
}

function formatCode(text) {
  const escaped = escapeMarkdown(String(text).replace(/`/g, '\\`'));
  return `\`${escaped}\``;
}

function formatLink(label, url) {
  if (!url) return escapeMarkdown(label);
  const cleanUrl = escapeMarkdownLinkUrl(url);
  return `[${escapeMarkdown(label)}](${cleanUrl})`;
}

function normaliseInline(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normaliseMultiline(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function formatAddress(label, address) {
  const normalised = normaliseInline(address);
  if (!normalised) return '';
  return `${formatBold(label)} ${formatCode(normalised.toLowerCase())}`;
}

function formatTimestamp(seconds) {
  if (!seconds || Number.isNaN(Number(seconds))) {
    return '';
  }
  try {
    const ts = Number(seconds);
    const date = ts > 10_000 ? new Date(ts * 1000) : new Date(ts);
    return `${formatBold('When:')} ${escapeMarkdown(date.toISOString())}`;
  } catch {
    return '';
  }
}

function formatAmount(label, value) {
  if (value === undefined || value === null) return '';
  try {
    const asBigInt = BigInt(value);
    return `${formatBold(label)} ${formatCode(asBigInt.toString())}`;
  } catch {
    return `${formatBold(label)} ${escapeMarkdown(normaliseInline(value))}`;
  }
}

function formatPercent(label, value) {
  if (value === undefined || value === null) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return `${formatBold(label)} ${escapeMarkdown(String(value))}`;
  const percent = num / 100;
  const formatted = Number.isInteger(percent) ? `${percent}` : percent.toFixed(2);
  return `${formatBold(label)} ${escapeMarkdown(`${formatted}%`)}`;
}

function formatBooleanStatus(label, state, trueLabel, falseLabel) {
  const message = state ? trueLabel : falseLabel;
  return `${formatBold(label)} ${escapeMarkdown(message)}`;
}

function formatDescriptionBlock(description) {
  const text = normaliseMultiline(description);
  if (!text) return [];
  const lines = text.split('\n').map((line) => line.trimEnd());
  return ['', formatBold('Description:'), ...lines.map((line) => `• ${escapeMarkdown(line)}`)];
}

function formatHomeLinkLines(value) {
  const { href, text } = sanitizeLink(value);
  const trimmedText = normaliseInline(text);
  if (href) {
    if (trimmedText && trimmedText !== href) {
      return [`${formatBold('Home:')} ${formatLink(trimmedText, href)}`];
    }
    return [`${formatBold('Home:')} ${formatLink(href, href)}`];
  }
  if (trimmedText) {
    return [`${formatBold('Home:')} ${escapeMarkdown(trimmedText)}`];
  }
  return [];
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
  body.set('parse_mode', 'MarkdownV2');
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

function flattenLines(lines) {
  const output = [];
  for (const line of lines) {
    if (Array.isArray(line)) {
      output.push(...flattenLines(line));
      continue;
    }
    if (line === null || line === undefined) continue;
    output.push(String(line));
  }
  return output;
}

function buildLinksBlock(...linkGroups) {
  const lines = [];
  for (const group of linkGroups) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const entry of group) {
        if (entry) lines.push(entry);
      }
    } else if (group) {
      lines.push(group);
    }
  }
  if (!lines.length) return [];
  return ['', ...lines];
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
    const text = flattenLines(lines).join('\n').trim();
    if (!text) return;
    await postTelegramMessage({ botToken: token, chatId: target, text, logger });
  }

  function templLink(path, label) {
    if (!baseUrl) return '';
    const base = baseUrl.replace(/\/$/, '');
    const url = `${base}${path}`;
    return formatLink(label, url);
  }

  return {
    isEnabled: Boolean(token),
    async notifyMemberJoined({ chatId, contractAddress, payerAddress, memberAddress, joinId, treasuryBalance, memberPoolBalance, timestamp, homeLink }) {
      await send(chatId, [
        formatBold('New member joined'),
        formatAddress('Templ:', contractAddress),
        payerAddress && memberAddress && payerAddress.toLowerCase() !== memberAddress.toLowerCase()
          ? formatAddress('Paid by:', payerAddress)
          : null,
        formatAddress('Member:', memberAddress),
        joinId != null ? `${formatBold('Join ID:')} ${escapeMarkdown(normaliseInline(joinId))}` : '',
        formatTimestamp(timestamp),
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool:', memberPoolBalance),
        buildLinksBlock(
          templLink(`/templs/join?address=${encodeURIComponent(String(contractAddress || ''))}`, 'Join this templ'),
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim member rewards'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyProposalCreated({ chatId, contractAddress, proposer, proposalId, endTime, title, description, homeLink }) {
      const header = title ? `${formatBold('Proposal:')} ${escapeMarkdown(normaliseInline(title))}` : formatBold('Proposal created');
      await send(chatId, [
        header,
        formatAddress('Templ:', contractAddress),
        formatAddress('Proposer:', proposer),
        proposalId != null ? `${formatBold('Proposal ID:')} ${escapeMarkdown(normaliseInline(proposalId))}` : '',
        endTime ? formatTimestamp(endTime) : '',
        formatDescriptionBlock(description),
        buildLinksBlock(
          templLink(
            `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
            'Review & vote'
          ),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyProposalQuorumReached({ chatId, contractAddress, proposalId, title, description, quorumReachedAt, homeLink }) {
      await send(chatId, [
        formatBold('Quorum reached'),
        title ? `${formatBold('Proposal:')} ${escapeMarkdown(normaliseInline(title))}` : '',
        formatDescriptionBlock(description),
        formatTimestamp(quorumReachedAt),
        buildLinksBlock(
          templLink(
            `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
            'Cast or adjust your vote'
          ),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyVoteCast({ chatId, contractAddress, voter, proposalId, support, title, homeLink }) {
      const supportLabel = support === true || String(support).toLowerCase() === 'true'
        ? formatBold('YES')
        : formatBold('NO');
      await send(chatId, [
        formatBold('Vote recorded'),
        formatAddress('Templ:', contractAddress),
        formatAddress('Voter:', voter),
        proposalId != null ? `${formatBold('Proposal ID:')} ${escapeMarkdown(normaliseInline(proposalId))}` : '',
        title ? `${formatBold('Title:')} ${escapeMarkdown(normaliseInline(title))}` : '',
        `${formatBold('Choice:')} ${supportLabel}`,
        buildLinksBlock(
          templLink(
            `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
            'Review proposal'
          ),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyProposalVotingClosed({ chatId, contractAddress, proposalId, title, description, endedAt, canExecute, homeLink }) {
      const statusLine = canExecute
        ? `${formatBold('Status:')} ${escapeMarkdown('Ready for execution ✅')}`
        : `${formatBold('Status:')} ${escapeMarkdown('Not executable ❌')}`;
      await send(chatId, [
        formatBold('Voting window ended'),
        title ? `${formatBold('Proposal:')} ${escapeMarkdown(normaliseInline(title))}` : '',
        formatDescriptionBlock(description),
        formatTimestamp(endedAt),
        statusLine,
        buildLinksBlock(
          templLink(
            `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
            canExecute ? 'Execute or review results' : 'Review results'
          ),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyPriestChanged({ chatId, contractAddress, oldPriest, newPriest, homeLink }) {
      await send(chatId, [
        formatBold('Priest updated'),
        formatAddress('Templ:', contractAddress),
        formatAddress('Old priest:', oldPriest),
        formatAddress('New priest:', newPriest),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyDailyDigest({ chatId, contractAddress, treasuryBalance, memberPoolBalance, homeLink }) {
      await send(chatId, [
        formatBold('gm templ crew!'),
        escapeMarkdown('templ treasury check-in: top up the vault and claim your share.'),
        formatAmount('Treasury balance:', treasuryBalance),
        formatAmount('Member pool (unclaimed):', memberPoolBalance),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim your share'),
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Open templ overview'),
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/new`, 'Propose a treasury move'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyTemplHomeLinkUpdated({ chatId, contractAddress, previousLink, newLink }) {
      const previousLines = formatHomeLinkLines(previousLink).map((line) => line.replace(formatBold('Home:'), formatBold('Previous:')));
      const newLines = formatHomeLinkLines(newLink).map((line) => line.replace(formatBold('Home:'), formatBold('New:')));
      await send(chatId, [
        formatBold('Templ home link updated'),
        formatAddress('Templ:', contractAddress),
        previousLines,
        newLines,
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(newLink)
        )
      ]);
    },
    async notifyBindingComplete({ chatId, contractAddress, homeLink }) {
      await send(chatId, [
        formatBold('Telegram bridge active'),
        formatAddress('Templ:', contractAddress),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Open templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyProposalExecuted({ chatId, contractAddress, proposalId, success, returnData, title, description, homeLink }) {
      const statusLine = success
        ? formatBooleanStatus('Status:', true, 'Execution succeeded ✅', 'Execution failed ❌')
        : formatBooleanStatus('Status:', false, 'Execution succeeded ✅', 'Execution failed ❌');
      await send(chatId, [
        formatBold('Proposal executed'),
        title ? `${formatBold('Proposal:')} ${escapeMarkdown(normaliseInline(title))}` : '',
        formatAddress('Templ:', contractAddress),
        proposalId != null ? `${formatBold('Proposal ID:')} ${escapeMarkdown(normaliseInline(proposalId))}` : '',
        statusLine,
        returnData ? `${formatBold('Return data:')} ${formatCode(String(returnData))}` : '',
        formatDescriptionBlock(description),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          templLink(
            `/templs/${encodeURIComponent(String(contractAddress || ''))}/proposals/${encodeURIComponent(String(proposalId || ''))}/vote`,
            'Review outcome'
          ),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyMemberRewardsClaimed({ chatId, contractAddress, member, amount, timestamp, homeLink }) {
      await send(chatId, [
        formatBold('Member rewards claimed'),
        formatAddress('Templ:', contractAddress),
        formatAddress('Member:', member),
        formatAmount('Amount:', amount),
        formatTimestamp(timestamp),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim your rewards'),
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyExternalRewardClaimed({ chatId, contractAddress, member, token, amount, homeLink }) {
      await send(chatId, [
        formatBold('External reward claimed'),
        formatAddress('Templ:', contractAddress),
        formatAddress('Member:', member),
        token ? `${formatBold('Token:')} ${formatCode(String(token))}` : '',
        formatAmount('Amount:', amount),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/claim`, 'Claim rewards'),
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyJoinPauseUpdated({ chatId, contractAddress, paused, homeLink }) {
      await send(chatId, [
        paused ? formatBold('Templ paused ⏸️') : formatBold('Templ resumed ▶️'),
        formatAddress('Templ:', contractAddress),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyConfigUpdated({
      chatId,
      contractAddress,
      token,
      entryFee,
      burnPercent,
      treasuryPercent,
      memberPoolPercent,
      protocolPercent,
      homeLink
    }) {
      await send(chatId, [
        formatBold('Templ configuration updated'),
        formatAddress('Templ:', contractAddress),
        token ? `${formatBold('Access token:')} ${formatCode(String(token))}` : '',
        formatAmount('Entry fee:', entryFee),
        formatPercent('Burn split:', burnPercent),
        formatPercent('Treasury split:', treasuryPercent),
        formatPercent('Member pool split:', memberPoolPercent),
        formatPercent('Protocol split:', protocolPercent),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyTreasuryAction({ chatId, contractAddress, proposalId, token, recipient, amount, description, homeLink }) {
      await send(chatId, [
        formatBold('Treasury action executed'),
        formatAddress('Templ:', contractAddress),
        proposalId != null ? `${formatBold('Proposal ID:')} ${escapeMarkdown(normaliseInline(proposalId))}` : '',
        token ? `${formatBold('Token:')} ${formatCode(String(token))}` : '',
        recipient ? `${formatBold('Recipient:')} ${formatCode(String(recipient))}` : '',
        formatAmount('Amount:', amount),
        description ? `${formatBold('Details:')} ${escapeMarkdown(normaliseInline(description))}` : '',
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyTreasuryDisbanded({ chatId, contractAddress, proposalId, token, amount, perMember, remainder, homeLink }) {
      await send(chatId, [
        formatBold('Treasury disbanded'),
        formatAddress('Templ:', contractAddress),
        proposalId != null ? `${formatBold('Proposal ID:')} ${escapeMarkdown(normaliseInline(proposalId))}` : '',
        token ? `${formatBold('Token:')} ${formatCode(String(token))}` : '',
        formatAmount('Total distributed:', amount),
        formatAmount('Per member:', perMember),
        formatAmount('Remainder:', remainder),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Review distribution'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyDictatorshipModeChanged({ chatId, contractAddress, enabled, homeLink }) {
      await send(chatId, [
        enabled ? formatBold('Dictatorship enabled ⚠️') : formatBold('Dictatorship disabled ✅'),
        formatAddress('Templ:', contractAddress),
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}`, 'Templ overview'),
          formatHomeLinkLines(homeLink)
        )
      ]);
    },
    async notifyMaxMembersUpdated({ chatId, contractAddress, maxMembers, homeLink }) {
      await send(chatId, [
        formatBold('Max members updated'),
        formatAddress('Templ:', contractAddress),
        maxMembers != null
          ? `${formatBold('New limit:')} ${escapeMarkdown(normaliseInline(maxMembers === '0' ? 'Unlimited' : maxMembers))}`
          : '',
        buildLinksBlock(
          templLink(`/templs/${encodeURIComponent(String(contractAddress || ''))}/join`, 'Invite members'),
          formatHomeLinkLines(homeLink)
        )
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
