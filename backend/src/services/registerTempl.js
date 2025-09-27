import { randomBytes } from 'crypto';
import { ensureContractDeployed, ensurePriestMatchesOnChain } from './contractValidation.js';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function shouldVerifyContracts() {
  return process.env.REQUIRE_CONTRACT_VERIFY === '1' || process.env.NODE_ENV === 'production';
}

function normaliseAddress(value, field) {
  if (!value || typeof value !== 'string') {
    throw templError(`Missing ${field}`, 400);
  }
  const normalised = value.toLowerCase();
  if (!normalised.startsWith('0x') || normalised.length !== 42) {
    throw templError(`Invalid ${field}`, 400);
  }
  return normalised;
}

function normaliseChatId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export async function registerTempl(body, context) {
  const { contractAddress, priestAddress } = body;
  const { provider, logger, templs, persist, watchContract } = context;

  const contract = normaliseAddress(contractAddress, 'contractAddress');
  const priest = normaliseAddress(priestAddress, 'priestAddress');
  const telegramChatId = normaliseChatId(body.telegramChatId ?? body.groupId ?? body.chatId);
  const requestedHomeLink = typeof body.templHomeLink === 'string'
    ? body.templHomeLink
    : (typeof body.homeLink === 'string' ? body.homeLink : '');

  logger?.info?.({ contract, priest, telegramChatId }, 'Register templ request received');

  if (shouldVerifyContracts()) {
    await ensureContractDeployed({ provider, contractAddress: contract, chainId: Number(body?.chainId) });
    await ensurePriestMatchesOnChain({ provider, contractAddress: contract, priestAddress: priest });
  }

  const existing = templs.get(contract) || null;
  const next = existing ? { ...existing } : {
    telegramChatId: null,
    priest,
    proposalsMeta: new Map(),
    lastDigestAt: Date.now(),
    templHomeLink: '',
    bindingCode: null
  };

  next.proposalsMeta = existing?.proposalsMeta instanceof Map ? existing.proposalsMeta : (next.proposalsMeta || new Map());
  next.lastDigestAt = typeof existing?.lastDigestAt === 'number' ? existing.lastDigestAt : (typeof next.lastDigestAt === 'number' ? next.lastDigestAt : Date.now());
  next.priest = priest;
  next.telegramChatId = telegramChatId ?? (existing?.telegramChatId ?? next.telegramChatId ?? null);
  next.contractAddress = contract;
  if (requestedHomeLink && requestedHomeLink !== (existing?.templHomeLink ?? next.templHomeLink ?? '')) {
    next.templHomeLink = requestedHomeLink;
  } else if (typeof next.templHomeLink !== 'string') {
    next.templHomeLink = existing?.templHomeLink ?? '';
  } else if (!next.templHomeLink) {
    next.templHomeLink = existing?.templHomeLink ?? '';
  }

  let bindingCode = existing?.bindingCode ?? next.bindingCode ?? null;
  if (!next.telegramChatId) {
    if (!bindingCode) {
      bindingCode = randomBytes(16).toString('hex');
    }
  } else {
    bindingCode = null;
  }
  next.bindingCode = bindingCode;

  if (typeof persist === 'function') {
    persist(contract, next);
  }

  let stored = next;
  if (existing) {
    Object.assign(existing, next);
    stored = existing;
  }

  templs.set(contract, stored);
  if (typeof watchContract === 'function') {
    watchContract(contract, stored);
  }

  return {
    templ: {
      contract,
      priest,
      telegramChatId: stored.telegramChatId,
      templHomeLink: stored.templHomeLink || ''
    },
    bindingCode
  };
}
