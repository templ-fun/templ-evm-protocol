// @ts-check

const DEFAULT_SIGNATURE_RETENTION_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * @typedef {{
 *   telegramChatId: string | null,
 *   bindingCode: string | null,
 *   priest?: string | null
 * }} BindingRecord
 */

/**
 * @typedef {{
 *   contract: string,
 *   telegramChatId: string | null,
 *   bindingCode: string | null,
 *   priest?: string | null
 * }} BindingRow
 */

/**
 * @typedef {{
 *   persistBinding(contract: string, record: BindingRecord): Promise<void> | void,
 *   listBindings(): Promise<BindingRow[]>,
 *   findBinding(contract: string): Promise<BindingRow | null>,
 *   signatureStore: {
 *     consume(signature: string, timestamp?: number): Promise<boolean>,
 *     prune(now?: number): Promise<void> | void
 *   },
 *   acquireLeadership?: (owner: string, ttlMs: number, now?: number) => Promise<boolean>,
 *   refreshLeadership?: (owner: string, ttlMs: number, now?: number) => Promise<boolean>,
 *   releaseLeadership?: (owner: string) => Promise<void>,
 *   getLeadershipState?: () => Promise<{ owner: string | null, expiresAt: number }>,
 *   dispose(): Promise<void> | void
 * }} PersistenceAdapter
 */

/**
 * Normalise a contract address/string key.
 * @param {string | null | undefined} value
 */
function normaliseKey(value) {
  return value ? String(value).toLowerCase() : '';
}

/**
 * @param {{ sqlitePath: string, retentionMs?: number }} opts
 * @returns {Promise<PersistenceAdapter>}
 */
async function createSQLitePersistence({ sqlitePath, retentionMs = DEFAULT_SIGNATURE_RETENTION_MS }) {
  if (!sqlitePath) {
    throw new Error('createSQLitePersistence requires sqlitePath');
  }
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(sqlitePath);
  try {
    db.pragma('journal_mode = WAL');
  } catch (err) {
    void err;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS templ_bindings (
      contract TEXT PRIMARY KEY,
      telegramChatId TEXT,
      bindingCode TEXT
    );
    CREATE TABLE IF NOT EXISTS used_signatures (
      signature TEXT PRIMARY KEY,
      expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leader_election (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leader_election_expires ON leader_election(expiresAt);
  `);

  const insertBinding = db.prepare(
    'INSERT INTO templ_bindings (contract, telegramChatId, bindingCode) VALUES (?, ?, ?) ' +
      'ON CONFLICT(contract) DO UPDATE SET telegramChatId = excluded.telegramChatId, bindingCode = excluded.bindingCode'
  );
  const listBindingsStmt = db.prepare(
    'SELECT contract, telegramChatId, bindingCode FROM templ_bindings ORDER BY contract'
  );
  const findBindingStmt = db.prepare(
    'SELECT contract, telegramChatId, bindingCode FROM templ_bindings WHERE contract = ?'
  );
  const pruneSignaturesStmt = db.prepare('DELETE FROM used_signatures WHERE expiresAt <= ?');
  const insertSignatureStmt = db.prepare(
    'INSERT INTO used_signatures (signature, expiresAt) VALUES (?, ?) ON CONFLICT(signature) DO NOTHING'
  );
  const upsertLeaderStmt = db.prepare(
    "INSERT INTO leader_election (id, owner, expiresAt) VALUES ('primary', ?, ?) " +
      'ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expiresAt = excluded.expiresAt ' +
      'WHERE leader_election.expiresAt <= ?'
  );
  const refreshLeaderStmt = db.prepare(
    "UPDATE leader_election SET expiresAt = ? WHERE id = 'primary' AND owner = ?"
  );
  const releaseLeaderStmt = db.prepare("DELETE FROM leader_election WHERE id = 'primary' AND owner = ?");
  const readLeaderStmt = db.prepare("SELECT owner, expiresAt FROM leader_election WHERE id = 'primary'");

  const persistBinding = async (contract, record) => {
    const key = contract ? String(contract).toLowerCase() : '';
    if (!key) return;
    const chatId = record?.telegramChatId != null ? String(record.telegramChatId) : null;
    const bindingCode = record?.bindingCode != null ? String(record.bindingCode) : null;
    try {
      insertBinding.run(key, chatId, bindingCode);
    } catch (err) {
      const message = String(err?.message || '');
      if (message.includes('UNIQUE constraint failed: templ_bindings.telegramChatId')) {
        throw new Error(
          'SQLite schema still enforces a unique Telegram chat id. Run the migrations with `npm --prefix backend run migrate -- --db <sqlite path>` before allowing multiple templs per chat.'
        );
      }
      throw err;
    }
  };

  const listBindings = async () => {
    return listBindingsStmt
      .all()
      .map(/** @returns {BindingRow} */ (row) => ({
        contract: String(row.contract || '').toLowerCase(),
        telegramChatId: row.telegramChatId != null ? String(row.telegramChatId) : null,
        bindingCode: row.bindingCode != null ? String(row.bindingCode) : null
      }));
  };

  const findBinding = async (contract) => {
    const key = contract ? String(contract).toLowerCase() : '';
    if (!key) return null;
    const row = findBindingStmt.get(key);
    if (!row) return null;
    return {
      contract: key,
      telegramChatId: row.telegramChatId != null ? String(row.telegramChatId) : null,
      bindingCode: row.bindingCode != null ? String(row.bindingCode) : null
    };
  };

  const prune = async (now = Date.now()) => {
    pruneSignaturesStmt.run(now);
  };

  const signatureStore = {
    async consume(signature, timestamp = Date.now()) {
      if (!signature) return false;
      const key = String(signature).toLowerCase();
      if (!key) return false;
      await prune(timestamp);
      const expiry = timestamp + retentionMs;
      const info = insertSignatureStmt.run(key, expiry);
      return info.changes > 0;
    },
    prune
  };

  const acquireLeadership = async (owner, ttlMs, now = Date.now()) => {
    if (!owner) return false;
    const expiresAt = now + ttlMs;
    const info = upsertLeaderStmt.run(owner, expiresAt, now);
    if (info.changes > 0) {
      return true;
    }
    const row = readLeaderStmt.get();
    return row?.owner === owner;
  };

  const refreshLeadership = async (owner, ttlMs, now = Date.now()) => {
    if (!owner) return false;
    const expiresAt = now + ttlMs;
    const info = refreshLeaderStmt.run(expiresAt, owner);
    return info.changes > 0;
  };

  const releaseLeadership = async (owner) => {
    if (!owner) return;
    releaseLeaderStmt.run(owner);
  };

  const getLeadershipState = async () => {
    const row = readLeaderStmt.get();
    if (!row) return { owner: null, expiresAt: 0 };
    return { owner: row.owner ?? null, expiresAt: Number(row.expiresAt ?? 0) };
  };

  return {
    persistBinding,
    listBindings,
    findBinding,
    signatureStore,
    acquireLeadership,
    refreshLeadership,
    releaseLeadership,
    getLeadershipState,
    async dispose() {
      try {
        db.close();
      } catch (err) {
        void err;
      }
    }
  };
}

/**
 * Create an in-memory persistence layer, primarily for tests and local development.
 * @param {object} [opts]
 * @param {number} [opts.retentionMs]
 */
/**
 * @param {{ retentionMs?: number }} [opts]
 * @returns {PersistenceAdapter}
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
      const key = String(signature).toLowerCase();
      if (!key) return false;
      prune(timestamp);
      if (signatures.has(key)) {
        return false;
      }
      signatures.set(key, timestamp + retentionMs);
      return true;
    },
    prune: (now = Date.now()) => prune(now)
  };

  let leader = { owner: null, expiresAt: 0 };

  async function acquireLeadership(owner, ttlMs, now = Date.now()) {
    if (!owner) return false;
    if (!leader.owner || leader.expiresAt <= now || leader.owner === owner) {
      leader = { owner, expiresAt: now + ttlMs };
      return true;
    }
    return leader.owner === owner;
  }

  async function refreshLeadership(owner, ttlMs, now = Date.now()) {
    if (leader.owner !== owner) return false;
    leader.expiresAt = now + ttlMs;
    return true;
  }

  async function releaseLeadership(owner) {
    if (leader.owner === owner) {
      leader = { owner: null, expiresAt: 0 };
    }
  }

  async function getLeadershipState() {
    return { ...leader };
  }

  return {
    persistBinding: async (contract, record) => {
      persistBinding(contract, record);
    },
    listBindings: async () => listBindings(),
    findBinding: async (contract) => findBinding(contract),
    signatureStore,
    acquireLeadership,
    refreshLeadership,
    releaseLeadership,
    getLeadershipState,
    async dispose() {
      return;
    }
  };
}

/**
 * Resolve the appropriate persistence layer based on the provided options.
 * @param {{ persistence?: PersistenceAdapter, retentionMs?: number, sqlitePath?: string }} [opts]
 * @returns {Promise<PersistenceAdapter>}
 */
export async function createPersistence(opts = {}) {
  const { retentionMs, sqlitePath } = opts ?? {};
  if (sqlitePath) {
    return createSQLitePersistence({ sqlitePath, retentionMs });
  }
  return createMemoryPersistence({ retentionMs });
}

export const __test = { normaliseKey };
