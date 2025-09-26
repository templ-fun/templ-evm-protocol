import { randomBytes } from 'crypto';
import { ensurePriestMatchesOnChain } from './contractValidation.js';

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

function ensureRecordLoaded(contract, context) {
  const { templs, database } = context;
  let record = templs.get(contract);
  if (record) return record;
  if (!database?.prepare) return null;
  try {
    const stmt = database.prepare('SELECT contract, groupId, priest, homeLink FROM groups WHERE contract = ?');
    const row = stmt.get(contract);
    if (!row) return null;
    record = {
      telegramChatId: row.groupId || null,
      priest: row.priest ? String(row.priest).toLowerCase() : null,
      templHomeLink: row.homeLink || '',
      proposalsMeta: new Map(),
      lastDigestAt: Date.now(),
      bindingCode: null,
      contractAddress: contract
    };
    templs.set(contract, record);
    return record;
  } catch {
    return null;
  }
}

export async function requestTemplRebind(body, context) {
  const { templs, persist, saveBinding, provider, logger } = context;
  const contract = normaliseAddress(body.contractAddress, 'contractAddress');
  const priest = normaliseAddress(body.priestAddress, 'priestAddress');

  const record = ensureRecordLoaded(contract, context);
  if (!record) {
    throw templError('Templ not registered', 404);
  }

  const currentPriest = record.priest ? String(record.priest).toLowerCase() : null;
  if (currentPriest && currentPriest !== priest) {
    if (provider) {
      await ensurePriestMatchesOnChain({ provider, contractAddress: contract, priestAddress: priest });
      record.priest = priest;
    } else if (shouldVerifyContracts()) {
      throw templError('Unable to verify priest without provider', 500);
    } else {
      throw templError('Priest mismatch', 403);
    }
  } else if (!currentPriest) {
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
  try {
    saveBinding?.(contract, bindingCode);
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err), contract }, 'Failed to persist binding code');
  }

  logger?.info?.({ contract, priest }, 'Telegram rebind requested');

  return {
    contract,
    bindingCode,
    telegramChatId: null,
    priest
  };
}
