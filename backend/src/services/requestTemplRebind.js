import { randomBytes } from 'crypto';
import { ensurePriestMatchesOnChain, ensureTemplFromFactory } from './contractValidation.js';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
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

function ensureRecordLoaded(contract, context) {
  const { templs, findBinding } = context;
  let record = templs.get(contract);
  if (record) return record;
  const persisted = typeof findBinding === 'function' ? findBinding(contract) : null;
  if (!persisted) {
    return null;
  }
  record = {
    telegramChatId: persisted.telegramChatId ?? null,
    priest: persisted.priest ? String(persisted.priest).toLowerCase() : null,
    templHomeLink: '',
    proposalsMeta: new Map(),
    lastDigestAt: Date.now(),
    bindingCode: persisted.bindingCode ? String(persisted.bindingCode) : null,
    contractAddress: contract
  };
  templs.set(contract, record);
  return record;
}

export async function requestTemplRebind(body, context) {
  const { templs, persist, provider, logger } = context;
  const contract = normaliseAddress(body.contractAddress, 'contractAddress');
  const priest = normaliseAddress(body.priestAddress, 'priestAddress');

  const record = ensureRecordLoaded(contract, context);
  if (!record) {
    throw templError('Templ not registered', 404);
  }

  const trustedFactory = process.env.TRUSTED_FACTORY_ADDRESS?.trim();
  if (trustedFactory) {
    await ensureTemplFromFactory({ provider, contractAddress: contract, factoryAddress: trustedFactory });
  }

  const currentPriest = record.priest ? String(record.priest).toLowerCase() : null;
  if (!currentPriest || currentPriest !== priest) {
    if (!provider) {
      throw templError('Unable to verify priest without provider', 500);
    }
    await ensurePriestMatchesOnChain({ provider, contractAddress: contract, priestAddress: priest });
    record.priest = priest;
  }

  let bindingCode = record.bindingCode;
  if (!bindingCode) {
    bindingCode = randomBytes(16).toString('hex');
  }

  record.bindingCode = bindingCode;
  record.telegramChatId = null;
  record.contractAddress = contract;

  templs.set(contract, record);
  persist?.(contract, record);
  logger?.info?.({ contract, priest }, 'Telegram rebind requested');

  return {
    contract,
    bindingCode,
    telegramChatId: null,
    priest
  };
}
