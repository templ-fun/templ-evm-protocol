PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
DROP TABLE IF EXISTS templ_bindings__tmp;
CREATE TABLE templ_bindings__tmp (
  contract TEXT PRIMARY KEY,
  telegramChatId TEXT,
  priest TEXT,
  bindingCode TEXT
);
INSERT INTO templ_bindings__tmp (contract, telegramChatId, priest, bindingCode)
SELECT contract, telegramChatId, priest, bindingCode FROM templ_bindings;
DROP TABLE templ_bindings;
ALTER TABLE templ_bindings__tmp RENAME TO templ_bindings;
COMMIT;
PRAGMA foreign_keys=ON;
