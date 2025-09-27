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
