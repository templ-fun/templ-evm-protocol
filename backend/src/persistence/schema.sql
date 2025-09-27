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
