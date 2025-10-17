CREATE TABLE IF NOT EXISTS miniapp_notifications (
  token TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  appFid INTEGER,
  url TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_miniapp_notifications_fid ON miniapp_notifications(fid);
