CREATE TABLE IF NOT EXISTS templ_bindings (
  contract TEXT PRIMARY KEY,
  telegramChatId TEXT,
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

CREATE TABLE IF NOT EXISTS miniapp_notifications (
  token TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  appFid INTEGER,
  url TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_miniapp_notifications_fid ON miniapp_notifications(fid);
