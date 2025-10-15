import { randomBytes } from 'crypto';
import { ethers, getAddress } from 'ethers';
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
  let checksum;
  try {
    checksum = getAddress(value);
  } catch {
    throw templError(`Invalid ${field}`, 400);
  }
  return checksum.toLowerCase();
}

function normaliseChatId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) {
    return null;
  }
  if (!/^(-?[1-9]\d*)$/.test(trimmed)) {
    throw templError('Invalid telegramChatId', 400);
  }
  return trimmed;
}

function normaliseInboxId(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export async function registerTempl(body, context) {
  const { contractAddress, priestAddress } = body;
  const { provider, logger, templs, persist, watchContract, findBinding, skipFactoryValidation, ensureGroup } = context;

  const contract = normaliseAddress(contractAddress, 'contractAddress');
  const priest = normaliseAddress(priestAddress, 'priestAddress');
  const telegramChatId = normaliseChatId(body.telegramChatId ?? body.chatId);
  const creatorInboxId = normaliseInboxId(body.creatorInboxId);
  const providedGroupId = typeof body.groupId === 'string' && body.groupId.trim() ? String(body.groupId).trim() : null;
  logger?.info?.({ contract, priest, telegramChatId, groupId: providedGroupId }, 'Register templ request received');

  if (shouldVerifyContracts()) {
    await ensureContractDeployed({ provider, contractAddress: contract, chainId: Number(body?.chainId) });
    await ensurePriestMatchesOnChain({ provider, contractAddress: contract, priestAddress: priest });
  }

  const trustedFactory = process.env.TRUSTED_FACTORY_ADDRESS?.trim();
  if (trustedFactory && !skipFactoryValidation) {
    await ensureTemplFromFactory({ provider, contractAddress: contract, factoryAddress: trustedFactory });
  }

  let existing = templs.get(contract);
  if (existing) {
    if (typeof existing.groupId === 'undefined') existing.groupId = null;
    if (typeof existing.group === 'undefined') existing.group = null;
  } else {
    const persisted = typeof findBinding === 'function' ? await findBinding(contract) : null;
    existing = {
      telegramChatId: null,
      priest,
      proposalsMeta: new Map(),
      lastDigestAt: 0,
      templHomeLink: '',
      bindingCode: persisted?.bindingCode ?? null,
      groupId: persisted?.groupId ?? null,
      group: null,
      creatorInboxId: null
    };
    if (persisted?.telegramChatId) {
      existing.telegramChatId = String(persisted.telegramChatId);
    }
    if (persisted?.priest) {
      existing.priest = String(persisted.priest).toLowerCase();
    }
    if (persisted?.groupId) {
      existing.groupId = String(persisted.groupId);
    }
  }
  if (!existing.proposalsMeta) existing.proposalsMeta = new Map();
  if (typeof existing.lastDigestAt !== 'number' || !Number.isFinite(existing.lastDigestAt) || existing.lastDigestAt < 0) {
    existing.lastDigestAt = 0;
  }
  existing.priest = priest;
  existing.telegramChatId = telegramChatId ?? existing.telegramChatId ?? null;
  existing.groupId = providedGroupId ?? existing.groupId ?? null;
  existing.creatorInboxId = creatorInboxId ?? existing.creatorInboxId ?? null;
  existing.contractAddress = contract;
  let resolvedHomeLink = existing.templHomeLink || '';
  if (provider) {
    try {
      const reader = new ethers.Contract(contract, ['function templHomeLink() view returns (string)'], provider);
      const onchainLink = await reader.templHomeLink();
      if (typeof onchainLink === 'string') {
        resolvedHomeLink = onchainLink;
      }
    } catch (err) {
      logger?.warn?.({ err, contract }, 'templHomeLink() unavailable during registration');
    }
  }
  existing.templHomeLink = resolvedHomeLink;

  if (typeof ensureGroup === 'function') {
    try {
      const group = await ensureGroup(existing);
      if (group?.id) {
        existing.groupId = String(group.id);
        existing.group = group;
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract }, 'ensureGroup failed during registration');
    }
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
  await persist(contract, existing);
  if (typeof watchContract === 'function') {
    await watchContract(contract, existing);
  }

  return {
    templ: {
      contract,
      priest,
      telegramChatId: existing.telegramChatId,
      templHomeLink: resolvedHomeLink,
      groupId: existing.groupId || null
    },
    bindingCode
  };
}
