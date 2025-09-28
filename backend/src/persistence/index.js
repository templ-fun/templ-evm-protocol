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
 * @typedef {{
 *   telegramChatId: string | null,
 *   priest: string | null,
 *   bindingCode: string | null
 * }} BindingRecord
 */

/**
 * @typedef {{
 *   contract: string,
 *   telegramChatId: string | null,
 *   priest: string | null,
 *   bindingCode: string | null
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
  await d1.exec(
    'CREATE TABLE IF NOT EXISTS leader_election (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expiresAt INTEGER NOT NULL)'
  );
  await d1.exec(
    'CREATE INDEX IF NOT EXISTS idx_leader_election_expires ON leader_election(expiresAt)'
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
  const upsertLeaderStmt = d1.prepare(
    'INSERT INTO leader_election (id, owner, expiresAt) VALUES ("primary", ?1, ?2) ' +
      'ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expiresAt = excluded.expiresAt ' +
      'WHERE leader_election.expiresAt <= ?3'
  );
  const refreshLeaderStmt = d1.prepare(
    'UPDATE leader_election SET expiresAt = ?2 WHERE id = "primary" AND owner = ?1'
  );
  const releaseLeaderStmt = d1.prepare(
    'DELETE FROM leader_election WHERE id = "primary" AND owner = ?1'
  );
  const readLeaderStmt = d1.prepare(
    'SELECT owner, expiresAt FROM leader_election WHERE id = "primary"'
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

  async function acquireLeadership(owner, ttlMs, now = Date.now()) {
    if (!owner) return false;
    const expiresAt = now + ttlMs;
    const result = await upsertLeaderStmt.bind(owner, expiresAt, now).run();
    const changes = Number(result?.meta?.changes ?? 0);
    if (changes > 0) {
      return true;
    }
    const row = await readLeaderStmt.first();
    return row?.owner === owner;
  }

  async function refreshLeadership(owner, ttlMs, now = Date.now()) {
    if (!owner) return false;
    const expiresAt = now + ttlMs;
    const result = await refreshLeaderStmt.bind(owner, expiresAt).run();
    return Number(result?.meta?.changes ?? 0) > 0;
  }

  async function releaseLeadership(owner) {
    if (!owner) return;
    await releaseLeaderStmt.bind(owner).run();
  }

  async function getLeadershipState() {
    const row = await readLeaderStmt.first();
    if (!row) return { owner: null, expiresAt: 0 };
    return {
      owner: row.owner ?? null,
      expiresAt: Number(row.expiresAt ?? 0)
    };
  }

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
      return;
    }
  };
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
      telegramChatId TEXT UNIQUE,
      priest TEXT,
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
    'INSERT INTO templ_bindings (contract, telegramChatId, priest, bindingCode) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(contract) DO UPDATE SET telegramChatId = excluded.telegramChatId, priest = excluded.priest, bindingCode = excluded.bindingCode'
  );
  const listBindingsStmt = db.prepare(
    'SELECT contract, telegramChatId, priest, bindingCode FROM templ_bindings ORDER BY contract'
  );
  const findBindingStmt = db.prepare(
    'SELECT contract, telegramChatId, priest, bindingCode FROM templ_bindings WHERE contract = ?'
  );
  const pruneSignaturesStmt = db.prepare('DELETE FROM used_signatures WHERE expiresAt <= ?');
  const insertSignatureStmt = db.prepare(
    'INSERT INTO used_signatures (signature, expiresAt) VALUES (?, ?) ON CONFLICT(signature) DO NOTHING'
  );
  const upsertLeaderStmt = db.prepare(
    'INSERT INTO leader_election (id, owner, expiresAt) VALUES ("primary", ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expiresAt = excluded.expiresAt ' +
      'WHERE leader_election.expiresAt <= ?'
  );
  const refreshLeaderStmt = db.prepare(
    'UPDATE leader_election SET expiresAt = ? WHERE id = "primary" AND owner = ?'
  );
  const releaseLeaderStmt = db.prepare('DELETE FROM leader_election WHERE id = "primary" AND owner = ?');
  const readLeaderStmt = db.prepare('SELECT owner, expiresAt FROM leader_election WHERE id = "primary"');

  const persistBinding = async (contract, record) => {
    const key = contract ? String(contract).toLowerCase() : '';
    if (!key) return;
    const chatId = record?.telegramChatId != null ? String(record.telegramChatId) : null;
    const priest = record?.priest ? String(record.priest).toLowerCase() : null;
    const bindingCode = record?.bindingCode != null ? String(record.bindingCode) : null;
    insertBinding.run(key, chatId, priest, bindingCode);
  };

  const listBindings = async () => {
    return listBindingsStmt
      .all()
      .map(/** @returns {BindingRow} */ (row) => ({
        contract: String(row.contract || '').toLowerCase(),
        telegramChatId: row.telegramChatId != null ? String(row.telegramChatId) : null,
        priest: row.priest != null ? String(row.priest).toLowerCase() : null,
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
      priest: row.priest != null ? String(row.priest).toLowerCase() : null,
      bindingCode: row.bindingCode != null ? String(row.bindingCode) : null
    };
  };

  const prune = async (now = Date.now()) => {
    pruneSignaturesStmt.run(now);
  };

  const signatureStore = {
    async consume(signature, timestamp = Date.now()) {
      if (!signature) return false;
      await prune(timestamp);
      const expiry = timestamp + retentionMs;
      const info = insertSignatureStmt.run(String(signature), expiry);
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
      prune(timestamp);
      if (signatures.has(signature)) {
        return false;
      }
      signatures.set(signature, timestamp + retentionMs);
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
 * @param {object} [opts]
 * @param {D1Database} [opts.d1]
 * @param {number} [opts.retentionMs]
 */
/**
 * @param {{ persistence?: PersistenceAdapter, d1?: D1Database, retentionMs?: number, sqlitePath?: string }} [opts]
 * @returns {Promise<PersistenceAdapter>}
 */
export async function createPersistence(opts = {}) {
  const { d1, retentionMs, sqlitePath } = opts;
  if (d1) {
    return createD1Persistence({ d1, retentionMs });
  }
  if (sqlitePath) {
    return createSQLitePersistence({ sqlitePath, retentionMs });
  }
  return createMemoryPersistence({ retentionMs });
}

export const __test = { normaliseKey };
