PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE templ_bindings__tmp (
  contract TEXT PRIMARY KEY,
  telegramChatId TEXT,
  bindingCode TEXT
);
INSERT INTO templ_bindings__tmp (contract, telegramChatId, bindingCode)
SELECT contract, telegramChatId, bindingCode FROM templ_bindings;
DROP TABLE templ_bindings;
ALTER TABLE templ_bindings__tmp RENAME TO templ_bindings;
COMMIT;
PRAGMA foreign_keys=ON;
