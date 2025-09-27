// @ts-check

const DEFAULT_SIGNATURE_RETENTION_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * @typedef {{
 *   bind(...values: Array<string | number | null | undefined>): D1Statement;
 *   first<T = any>(): Promise<T | null>;
 *   run(): Promise<{ success?: boolean | undefined, meta?: { changes?: number | null | undefined } | undefined }>;
 *   all<T = any>(): Promise<{ results: Array<T> }>;
 * }} D1Statement
 */

/**
 * @typedef {{
 *   prepare(statement: string): D1Statement;
 *   exec(statement: string): Promise<unknown>;
 * }} D1Database
 */

/**
 * Normalise a contract address/string key.
 * @param {string | null | undefined} value
 */
function normaliseKey(value) {
  return value ? String(value).toLowerCase() : '';
}

/**
 * Create a persistence layer backed by Cloudflare D1.
 * @param {object} opts
 * @param {D1Database} opts.d1
 * @param {number} [opts.retentionMs]
 */
export async function createD1Persistence({ d1, retentionMs = DEFAULT_SIGNATURE_RETENTION_MS }) {
  if (!d1 || typeof d1.prepare !== 'function') {
    throw new Error('createD1Persistence requires a Cloudflare D1 binding');
  }

  await d1.exec(
    'CREATE TABLE IF NOT EXISTS templ_bindings (contract TEXT PRIMARY KEY, telegramChatId TEXT UNIQUE, priest TEXT, bindingCode TEXT)'
  );
  await d1.exec(
    'CREATE TABLE IF NOT EXISTS used_signatures (signature TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL)'
  );

  const insertBinding = d1.prepare(
    'INSERT INTO templ_bindings (contract, telegramChatId, priest, bindingCode) VALUES (?1, ?2, ?3, ?4) ' +
      'ON CONFLICT(contract) DO UPDATE SET telegramChatId = excluded.telegramChatId, priest = excluded.priest, bindingCode = excluded.bindingCode'
  );
  const listBindingsStmt = d1.prepare(
    'SELECT contract, telegramChatId, priest, bindingCode FROM templ_bindings ORDER BY contract'
  );
  const findBindingStmt = d1.prepare(
    'SELECT contract, telegramChatId, priest, bindingCode FROM templ_bindings WHERE contract = ?1'
  );
  const countBindingsStmt = d1.prepare('SELECT COUNT(1) AS count FROM templ_bindings');
  const selectLegacyTableStmt = d1.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='groups'"
  );
  const selectLegacyRowsStmt = d1.prepare(
    'SELECT groupId, contract FROM groups WHERE groupId IS NOT NULL AND contract IS NOT NULL'
  );
  const pruneSignaturesStmt = d1.prepare('DELETE FROM used_signatures WHERE expiresAt <= ?1');
  const insertSignatureStmt = d1.prepare(
    'INSERT INTO used_signatures (signature, expiresAt) VALUES (?1, ?2) ON CONFLICT(signature) DO NOTHING'
  );

  try {
    const legacy = await selectLegacyTableStmt.first();
    if (legacy) {
      const countRow = await countBindingsStmt.first();
      const existing = Number(countRow?.count ?? 0);
      if (!existing) {
        const legacyRows = await selectLegacyRowsStmt.all();
        /** @type {Array<{ contract?: string | null | undefined, groupId?: string | number | null | undefined }>} */
        const rows = Array.isArray(legacyRows?.results) ? legacyRows.results : [];
        for (const row of rows) {
          const contractKey = normaliseKey(row?.contract);
          if (!contractKey) continue;
          const chatId = row?.groupId != null ? String(row.groupId) : null;
          await insertBinding.bind(contractKey, chatId, null, null).run();
        }
      }
      await d1.exec('DROP TABLE IF EXISTS groups');
    }
    await d1.exec('DROP TABLE IF EXISTS pending_bindings');
    await d1.exec('DROP TABLE IF EXISTS signatures');
  } catch (err) {
    void err; // ignore migration failures on D1
  }

  async function persistBinding(contract, record) {
    const key = normaliseKey(contract);
    if (!key) return;
    const chatId = record?.telegramChatId != null ? String(record.telegramChatId) : null;
    const priest = record?.priest ? normaliseKey(record.priest) : null;
    const bindingCode = record?.bindingCode != null ? String(record.bindingCode) : null;
    await insertBinding.bind(key, chatId, priest, bindingCode).run();
  }

  async function listBindings() {
    try {
      const { results = [] } =
        /** @type {{ results?: Array<{ contract?: string | null, telegramChatId?: string | number | null, priest?: string | null, bindingCode?: string | number | null }> }} */
        (await listBindingsStmt.all());
      return results.map((row) => ({
        contract: normaliseKey(row?.contract),
        telegramChatId: row?.telegramChatId != null ? String(row.telegramChatId) : null,
        priest: row?.priest != null ? normaliseKey(row.priest) : null,
        bindingCode: row?.bindingCode != null ? String(row.bindingCode) : null
      }));
    } catch {
      return [];
    }
  }

  async function findBinding(contract) {
    const key = normaliseKey(contract);
    if (!key) return null;
    try {
      const row =
        /** @type {{ contract?: string | null, telegramChatId?: string | number | null, priest?: string | null, bindingCode?: string | number | null } | null} */
        (await findBindingStmt.bind(key).first());
      if (!row) return null;
      return {
        contract: key,
        telegramChatId: row?.telegramChatId != null ? String(row.telegramChatId) : null,
        priest: row?.priest != null ? normaliseKey(row.priest) : null,
        bindingCode: row?.bindingCode != null ? String(row.bindingCode) : null
      };
    } catch {
      return null;
    }
  }

  async function prune(now = Date.now()) {
    await pruneSignaturesStmt.bind(now).run();
  }

  const signatureStore = {
    async consume(signature, timestamp = Date.now()) {
      if (!signature) return false;
      await prune(timestamp);
      const expiry = timestamp + retentionMs;
      const result = await insertSignatureStmt.bind(String(signature), expiry).run();
      const changes = Number(result?.meta?.changes ?? 0);
      return changes > 0;
    },
    prune
  };

  return {
    persistBinding,
    listBindings,
    findBinding,
    signatureStore,
    async dispose() {}
  };
}

/**
 * Create an in-memory persistence layer, primarily for tests and local development.
 * @param {object} [opts]
 * @param {number} [opts.retentionMs]
 */
export function createMemoryPersistence({ retentionMs = DEFAULT_SIGNATURE_RETENTION_MS } = {}) {
  /** @type {Map<string, { telegramChatId: string | null, priest: string | null, bindingCode: string | null }>} */
  const bindings = new Map();
  /** @type {Map<string, number>} */
  const signatures = new Map();

  function persistBinding(contract, record) {
    const key = normaliseKey(contract);
    if (!key) return;
    bindings.set(key, {
      telegramChatId: record?.telegramChatId != null ? String(record.telegramChatId) : null,
      priest: record?.priest ? normaliseKey(record.priest) : null,
      bindingCode: record?.bindingCode != null ? String(record.bindingCode) : null
    });
  }

  function listBindings() {
    return Array.from(bindings.entries()).map(([contract, value]) => ({
      contract,
      telegramChatId: value.telegramChatId,
      priest: value.priest,
      bindingCode: value.bindingCode
    }));
  }

  function findBinding(contract) {
    const key = normaliseKey(contract);
    if (!key) return null;
    const stored = bindings.get(key);
    if (!stored) return null;
    return { contract: key, ...stored };
  }

  function prune(now = Date.now()) {
    for (const [signature, expiry] of signatures.entries()) {
      if (expiry <= now) {
        signatures.delete(signature);
      }
    }
  }

  const signatureStore = {
    async consume(signature, timestamp = Date.now()) {
      if (!signature) return false;
      prune(timestamp);
      if (signatures.has(signature)) {
        return false;
      }
      signatures.set(signature, timestamp + retentionMs);
      return true;
    },
    prune: (now = Date.now()) => prune(now)
  };

  return {
    persistBinding: async (contract, record) => {
      persistBinding(contract, record);
    },
    listBindings: async () => listBindings(),
    findBinding: async (contract) => findBinding(contract),
    signatureStore,
    async dispose() {}
  };
}

/**
 * Resolve the appropriate persistence layer based on the provided options.
 * @param {object} [opts]
 * @param {D1Database} [opts.d1]
 * @param {number} [opts.retentionMs]
 */
export async function createPersistence(opts = {}) {
  const { d1, retentionMs } = opts;
  if (d1) {
    return createD1Persistence({ d1, retentionMs });
  }
  return createMemoryPersistence({ retentionMs });
}

export const __test = { normaliseKey };
