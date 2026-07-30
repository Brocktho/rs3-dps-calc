CREATE TABLE IF NOT EXISTS shared_loadouts (
	code TEXT PRIMARY KEY,
	payload TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
