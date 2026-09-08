PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  couple_names TEXT NOT NULL,
  welcome_message TEXT NOT NULL DEFAULT 'Request a song. Help set the vibe.',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','closed')),
  explicit_allowed INTEGER NOT NULL DEFAULT 0,
  max_track_ms INTEGER NOT NULL DEFAULT 480000,
  guest_request_limit INTEGER NOT NULL DEFAULT 2,
  cashapp_url TEXT,
  cashapp_qr_image_url TEXT,
  spotify_access_token TEXT,
  spotify_refresh_token TEXT,
  spotify_token_expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_hosts (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'couple_dj',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocked_music (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('track','artist')),
  value_normalized TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, kind, value_normalized),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS song_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  guest_token TEXT NOT NULL,
  guest_name TEXT,
  guest_message TEXT,
  track_title TEXT NOT NULL,
  track_artist TEXT NOT NULL,
  track_album TEXT,
  track_artwork_url TEXT,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_track_id TEXT,
  provider_uri TEXT,
  duration_ms INTEGER,
  explicit INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'free' CHECK(tier IN ('free','priority_5','front_10')),
  payment_status TEXT NOT NULL DEFAULT 'not_required' CHECK(payment_status IN ('not_required','pending','paid','failed','refunded')),
  boost_code TEXT UNIQUE,
  review_status TEXT NOT NULL DEFAULT 'approved' CHECK(review_status IN ('approved','deferred','declined')),
  playback_status TEXT NOT NULL DEFAULT 'unplayed' CHECK(playback_status IN ('unplayed','queued','playing','played','skipped')),
  queue_rank INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_event_rank ON song_requests(event_id, review_status, playback_status, queue_rank);
CREATE INDEX IF NOT EXISTS idx_requests_guest ON song_requests(event_id, guest_token, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_boost_code ON song_requests(boost_code);

CREATE TABLE IF NOT EXISTS boost_payments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK(provider IN ('cashapp_direct','square')),
  provider_reference TEXT,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded')),
  confirmation_code TEXT,
  confirmed_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(request_id) REFERENCES song_requests(id) ON DELETE CASCADE,
  FOREIGN KEY(confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_boost_provider_order ON boost_payments(provider, provider_order_id);
CREATE INDEX IF NOT EXISTS idx_boost_status ON boost_payments(event_id, status, provider);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO events (id, slug, couple_names) VALUES
  ('evt_michael_marisa', 'michael-marisa', 'Michael Higdon & Marisa Hager');
