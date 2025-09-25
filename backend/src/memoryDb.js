class MemoryStatement {
  constructor({ run, all, get }) {
    this._run = run;
    this._all = all;
    this._get = get;
  }

  run(...args) {
    return this._run?.(...args);
  }

  all() {
    return this._all?.() ?? [];
  }

  get(...args) {
    return this._get?.(...args);
  }
}

export function createMemoryDatabase() {
  const groups = new Map();
  const pendingBindings = new Map();
  const signatures = new Map();

  return {
    exec() {
      return this;
    },

    prepare(sql) {
      if (sql.startsWith('INSERT OR REPLACE INTO groups')) {
        return new MemoryStatement({
          run: (contract, groupId, priest, homeLink) => {
            const key = String(contract).toLowerCase();
            groups.set(key, {
              contract: key,
              groupId: groupId ?? null,
              priest: priest ? String(priest).toLowerCase() : null,
              homeLink: homeLink ?? null
            });
            return { changes: 1 };
          }
        });
      }

      if (sql.startsWith('INSERT OR REPLACE INTO pending_bindings')) {
        return new MemoryStatement({
          run: (contract, bindCode, createdAt) => {
            const key = String(contract).toLowerCase();
            pendingBindings.set(key, {
              contract: key,
              bindCode,
              createdAt: Number(createdAt) || Date.now()
            });
            return { changes: 1 };
          }
        });
      }

      if (sql.startsWith('DELETE FROM pending_bindings')) {
        return new MemoryStatement({
          run: (contract) => {
            pendingBindings.delete(String(contract).toLowerCase());
            return { changes: 1 };
          }
        });
      }

      if (sql.startsWith('SELECT contract, bindCode FROM pending_bindings')) {
        return new MemoryStatement({
          all: () => Array.from(pendingBindings.values()).map((row) => ({
            contract: row.contract,
            bindCode: row.bindCode
          }))
        });
      }

      if (sql.startsWith('SELECT contract, groupId, priest, homeLink FROM groups ORDER BY contract')) {
        return new MemoryStatement({
          all: () => Array.from(groups.values())
            .sort((a, b) => (a.contract > b.contract ? 1 : a.contract < b.contract ? -1 : 0))
            .map((row) => ({
              contract: row.contract,
              groupId: row.groupId,
              priest: row.priest,
              homeLink: row.homeLink
            }))
        });
      }

      if (sql.startsWith('SELECT contract, groupId, priest, homeLink FROM groups')) {
        return new MemoryStatement({
          all: () => Array.from(groups.values()).map((row) => ({
            contract: row.contract,
            groupId: row.groupId,
            priest: row.priest,
            homeLink: row.homeLink
          }))
        });
      }

      if (sql.startsWith('INSERT OR IGNORE INTO signatures')) {
        return new MemoryStatement({
          run: (sig, usedAt) => {
            const key = String(sig);
            if (signatures.has(key)) return { changes: 0 };
            signatures.set(key, Number(usedAt) || Date.now());
            return { changes: 1 };
          }
        });
      }

      if (sql.startsWith('SELECT 1 FROM signatures WHERE sig = ?')) {
        return new MemoryStatement({
          get: (sig) => (signatures.has(String(sig)) ? { 1: 1 } : undefined)
        });
      }

      if (sql.startsWith('DELETE FROM signatures WHERE usedAt < ?')) {
        return new MemoryStatement({
          run: (threshold) => {
            const cutoff = Number(threshold) || 0;
            for (const [key, ts] of signatures.entries()) {
              if (ts < cutoff) signatures.delete(key);
            }
            return { changes: 1 };
          }
        });
      }

      throw new Error(`Unhandled SQL in memory database: ${sql}`);
    },

    close() {}
  };
}

export default createMemoryDatabase;
