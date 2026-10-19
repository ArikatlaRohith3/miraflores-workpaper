-- Append-only ledger: one row per event; seq (autoincrement) is the canonical order.
CREATE TABLE IF NOT EXISTS events (
  seq  INTEGER PRIMARY KEY AUTOINCREMENT,
  ws   TEXT NOT NULL,
  id   TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (ws, id)
);
CREATE INDEX IF NOT EXISTS events_ws_seq ON events (ws, seq);
-- Reset counter per workspace, so open browsers notice a reset.
CREATE TABLE IF NOT EXISTS workspaces (ws TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
-- Evidence files, chunked.
CREATE TABLE IF NOT EXISTS files (
  ws TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL,
  name TEXT, type TEXT, size INTEGER, data TEXT NOT NULL,
  PRIMARY KEY (ws, id, part)
);
