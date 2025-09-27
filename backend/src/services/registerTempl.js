import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { ensureContractDeployed, ensurePriestMatchesOnChain, ensureTemplFromFactory } from './contractValidation.js';

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
  const trimmed = value.trim();
  if (!ethers.isAddress(trimmed)) {
    throw templError(`Invalid ${field}`, 400);
  }
  return trimmed.toLowerCase();
}

function normaliseChatId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export async function registerTempl(body, context) {
  const { contractAddress, priestAddress } = body;
  const { provider, logger, templs, persist, watchContract, findBinding } = context;

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

  const trustedFactory = process.env.TRUSTED_FACTORY_ADDRESS?.trim();
  if (trustedFactory) {
    await ensureTemplFromFactory({ provider, contractAddress: contract, factoryAddress: trustedFactory });
  }

  let existing = templs.get(contract);
  if (!existing) {
    const persisted = typeof findBinding === 'function' ? findBinding(contract) : null;
    existing = {
      telegramChatId: null,
      priest,
      proposalsMeta: new Map(),
      lastDigestAt: Date.now(),
      templHomeLink: '',
      bindingCode: persisted?.bindingCode ?? null
    };
    if (persisted?.telegramChatId) {
      existing.telegramChatId = String(persisted.telegramChatId);
    }
    if (persisted?.priest) {
      existing.priest = String(persisted.priest).toLowerCase();
    }
  }
  if (!existing.proposalsMeta) existing.proposalsMeta = new Map();
  if (typeof existing.lastDigestAt !== 'number') existing.lastDigestAt = Date.now();
  existing.priest = priest;
  existing.telegramChatId = telegramChatId ?? existing.telegramChatId ?? null;
  existing.contractAddress = contract;
  if (requestedHomeLink && requestedHomeLink !== existing.templHomeLink) {
    existing.templHomeLink = requestedHomeLink;
  }

  let bindingCode = existing.bindingCode || null;
  if (!existing.telegramChatId) {
    if (!bindingCode) {
      bindingCode = randomBytes(16).toString('hex');
    }
    existing.bindingCode = bindingCode;
  } else {
    existing.bindingCode = null;
  }

  templs.set(contract, existing);
  persist(contract, existing);
  if (typeof watchContract === 'function') {
    await watchContract(contract, existing);
  }

  return {
    templ: {
      contract,
      priest,
      telegramChatId: existing.telegramChatId,
      templHomeLink: existing.templHomeLink || ''
    },
    bindingCode
  };
}
