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

function buildLinks(contract) {
  const baseUrl = typeof process.env.APP_BASE_URL === 'string' && process.env.APP_BASE_URL.trim().length
    ? process.env.APP_BASE_URL.trim().replace(/\/$/, '')
    : null;
  if (!baseUrl) return {};
  return {
    templ: `${baseUrl}/templs/${contract}`,
    proposals: `${baseUrl}/templs/${contract}/proposals`,
    vote: `${baseUrl}/templs/${contract}/proposals`,
    join: `${baseUrl}/templs/join?address=${contract}`,
    claim: `${baseUrl}/templs/${contract}/claim`
  };
}

export async function joinTempl(body, context) {
  const { contractAddress, memberAddress } = body;
  const { hasPurchased, templs, logger } = context;

  const contract = normaliseAddress(contractAddress, 'contractAddress');
  const member = normaliseAddress(memberAddress, 'memberAddress');

  const record = templs.get(contract);
  if (!record) {
    throw templError('Templ not registered', 404);
  }
  if (!hasPurchased || typeof hasPurchased !== 'function') {
    throw templError('Membership verification unavailable', 500);
  }

  let purchased;
  try {
    purchased = await hasPurchased(contract, member);
  } catch (err) {
    logger?.warn?.({ err: err?.message || err, contract, member }, 'hasPurchased check failed');
    throw templError('Unable to verify membership', 502);
  }
  if (!purchased) {
    throw templError('Membership not found', 403);
  }

  try {
    if (!record.memberSet) record.memberSet = new Set();
    record.memberSet.add(member);
  } catch {/* ignore */}

  logger?.info?.({ contract, member }, 'Member verified for templ');

  return {
    member: {
      address: member,
      hasAccess: true
    },
    templ: {
      contract,
      telegramChatId: record.telegramChatId ?? null,
      priest: record.priest ?? null
    },
    links: buildLinks(contract)
  };
}
