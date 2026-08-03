import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'wingd.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT NOT NULL,
  google_id TEXT UNIQUE,
  apple_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pilot_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER,
  gender TEXT,
  interested_in TEXT,
  bio TEXT,
  location TEXT,
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A wing circle has 2-5 accepted members per pilot; enforced in routes/copilots.js.
CREATE TABLE IF NOT EXISTS copilot_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pilot_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  copilot_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  copilot_email TEXT,
  relationship_label TEXT,
  invite_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swiper_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- like | pass
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(swiper_user_id, target_user_id)
);

-- A one-directional signal of interest, queued for the sender's wing circle to
-- review before the other pilot ever finds out about it.
CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_wings', -- pending_wings | sent | declined_by_wings
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_user_id, to_user_id)
);

-- One vote per wing circle member per interest, with an optional note.
CREATE TABLE IF NOT EXISTS interest_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interest_id INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  copilot_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL, -- approve | reject
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(interest_id, copilot_user_id)
);

-- Created once both directions' interests reach 'sent' — wing review already
-- happened on the way in, so a match is immediately chatable.
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pilot_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pilot_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a_interest_id INTEGER REFERENCES interests(id),
  b_interest_id INTEGER REFERENCES interests(id),
  status TEXT NOT NULL DEFAULT 'matched', -- matched | unmatched
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pilot_a_id, pilot_b_id)
);

-- A pilot's own wing circle discussing one interest (their side only).
CREATE TABLE IF NOT EXISTS copilot_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interest_id INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pilot_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-user "last seen" markers for list-level notification badges.
CREATE TABLE IF NOT EXISTS notification_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matches_seen_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  copilots_seen_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);

-- Per-user, per-room read markers for chat unread counts. room is 'copilot'
-- (room_id = interest id) or 'pilot' (room_id = match id).
CREATE TABLE IF NOT EXISTS chat_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room TEXT NOT NULL, -- copilot | pilot
  room_id INTEGER NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, room, room_id)
);
`);

// Migrate databases created before social login support: add the new
// nullable columns and drop the NOT NULL constraint on password_hash (SQLite
// can't ALTER a column's nullability directly, so the table is rebuilt).
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasGoogleId = userColumns.some((c) => c.name === 'google_id');
const passwordHashRequired = userColumns.some((c) => c.name === 'password_hash' && c.notnull);
if (!hasGoogleId || passwordHashRequired) {
  // Dropping `users` while foreign_keys is ON would cascade-delete every row
  // in tables that reference it (pilot_profiles, matches, ...) per SQLite's
  // documented DROP TABLE behavior, so disable enforcement for the rebuild.
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT NOT NULL,
      google_id TEXT UNIQUE,
      apple_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_migrated (id, email, password_hash, name, created_at)
      SELECT id, email, password_hash, name, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_migrated RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
}

export default db;
