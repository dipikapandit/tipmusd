-- FROZEN. TipMUSD schema. Idempotent (runs on every boot under an advisory lock). Postgres 15+ / PGlite.
-- The chain is the source of truth for payments; rows here are verified metadata, never proof by themselves.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL UNIQUE CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-use, expiring sign-in nonces. purpose: 'sign_in' | 'wallet_change' (proof of a NEW payout wallet).
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce        TEXT PRIMARY KEY,
  address      TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'sign_in' CHECK (purpose IN ('sign_in', 'wallet_change')),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_nonces_expires ON auth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL
);

-- One profile per user. username is stored lowercase; matching is case-insensitive by construction.
-- recipient_wallet is unique so an incoming transfer maps to exactly one creator.
CREATE TABLE IF NOT EXISTS creator_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  username                 TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])$'),
  display_name             TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio                      TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280),
  avatar_preset            TEXT,                       -- e.g. 'sunset' (generated) when no upload
  avatar_etag              TEXT,                       -- set when an uploaded avatar exists (creator_avatars)
  social_links             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- SocialLink[]
  recipient_wallet         TEXT NOT NULL UNIQUE CHECK (recipient_wallet ~ '^0x[0-9a-f]{40}$'),
  suggested_amounts        JSONB NOT NULL DEFAULT '["1","5","10","25"]'::jsonb, -- decimal strings
  default_amount           TEXT NOT NULL DEFAULT '5',
  thank_you_message        TEXT NOT NULL DEFAULT '' CHECK (char_length(thank_you_message) <= 280),
  accent                   TEXT NOT NULL DEFAULT 'orange',
  public_activity_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  anonymous_tips_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  messages_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  username_changed_at      TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_avatars (
  creator_id    UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes         BYTEA NOT NULL,
  etag          TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retired usernames redirect to the creator and can't be claimed by anyone else (anti-impersonation).
CREATE TABLE IF NOT EXISTS username_aliases (
  username    TEXT PRIMARY KEY,
  creator_id  UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  retired_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every payout wallet a creator has used (current one has to_time NULL). Historical tips keep their own
-- recipient_address; this lets the indexer attribute transfers to past wallets during the overlap window.
CREATE TABLE IF NOT EXISTS creator_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  from_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_time     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS creator_wallets_wallet ON creator_wallets (wallet);

-- The default link is /{username} (no row needed). Rows here are optional campaign links /{username}?c={slug}.
CREATE TABLE IF NOT EXISTS tip_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id     UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  campaign_name  TEXT NOT NULL CHECK (char_length(campaign_name) BETWEEN 1 AND 60),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creator_id, slug)
);

-- A tip is an intent (created by the app before signing) or an indexed transfer (source 'indexer').
-- status: created → awaiting_wallet → submitted → pending_confirmation → confirmed | failed | expired.
-- Only `confirmed` counts anywhere (totals, analytics, public activity).
CREATE TABLE IF NOT EXISTS tips (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tip_link_id        UUID REFERENCES tip_links(id) ON DELETE SET NULL,
  source             TEXT NOT NULL CHECK (source IN ('app', 'indexer', 'x402')),
  ref                TEXT UNIQUE CHECK (ref ~ '^[0-9a-f]{32}$'),  -- app intents: 16-byte calldata suffix ref
  status             TEXT NOT NULL CHECK (status IN ('created','awaiting_wallet','submitted','pending_confirmation','confirmed','failed','expired')),
  failure_reason     TEXT,       -- user_rejected | reverted | no_matching_transfer | amount_mismatch | recipient_mismatch | wrong_token | timeout | ...
  chain_id           INTEGER NOT NULL,
  token_address      TEXT NOT NULL,
  recipient_address  TEXT NOT NULL,             -- creator wallet at intent time (or the log's `to`)
  expected_amount_raw NUMERIC(78,0),            -- app intents: what the supporter chose
  amount_raw         NUMERIC(78,0),             -- verified on-chain value (NULL until verified)
  sender_address     TEXT,                      -- verified log `from` (claimed wallet before verification)
  tx_hash            TEXT,
  log_index          INTEGER,
  block_number       BIGINT,
  block_hash         TEXT,
  tx_timestamp       TIMESTAMPTZ,
  supporter_name     TEXT CHECK (supporter_name IS NULL OR char_length(supporter_name) <= 40),
  supporter_message  TEXT CHECK (supporter_message IS NULL OR char_length(supporter_message) <= 280),
  is_anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
  referral_source    TEXT,                      -- validated ?src= (e.g. 'x', 'qr', 'linkedin')
  verify_attempts    INTEGER NOT NULL DEFAULT 0,
  last_checked_at    TIMESTAMPTZ,
  submitted_at       TIMESTAMPTZ,
  verified_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,               -- intent expiry (app only)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One tip per transaction hash (a tx can't be claimed by two intents) and per log.
CREATE UNIQUE INDEX IF NOT EXISTS tips_tx_hash_unique ON tips (chain_id, tx_hash) WHERE tx_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tips_tx_log_unique ON tips (chain_id, tx_hash, log_index) WHERE log_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS tips_creator_status ON tips (creator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tips_pending ON tips (status, last_checked_at) WHERE status IN ('submitted','pending_confirmation');

-- Raw MUSD Transfer logs to creator wallets, idempotent by (tx_hash, log_index).
CREATE TABLE IF NOT EXISTS blockchain_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id          INTEGER NOT NULL,
  transaction_hash  TEXT NOT NULL,
  log_index         INTEGER NOT NULL,
  block_number      BIGINT NOT NULL,
  block_hash        TEXT NOT NULL,
  contract_address  TEXT NOT NULL,
  event_name        TEXT NOT NULL,
  from_address      TEXT NOT NULL,
  to_address        TEXT NOT NULL,
  value_raw         NUMERIC(78,0) NOT NULL,
  tip_id            UUID REFERENCES tips(id) ON DELETE SET NULL,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS blockchain_events_block ON blockchain_events (block_number);

CREATE TABLE IF NOT EXISTS indexer_cursors (
  name          TEXT PRIMARY KEY,
  block_number  BIGINT NOT NULL,
  block_hash    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,             -- tip_received | wallet_changed | username_changed
  title       TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  tip_id      UUID REFERENCES tips(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_tip_unique ON notifications (user_id, type, tip_id) WHERE tip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);

-- Page views etc. visitor_hash = HMAC(daily salt, ip+ua); page_view deduped per visitor per creator per day.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('page_view','qr_view','share_click','wallet_connect','tip_started')),
  source        TEXT,
  visitor_hash  TEXT,
  day           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_dedupe ON analytics_events (creator_id, event_type, visitor_hash, day) WHERE visitor_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_creator ON analytics_events (creator_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (reason IN ('impersonation','scam','spam','offensive','other')),
  details       TEXT CHECK (details IS NULL OR char_length(details) <= 500),
  reporter_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- v2 (2026-11-13): MEZO tips, Bitcoin funding, social
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS accept_mezo BOOLEAN NOT NULL DEFAULT TRUE;
-- Supporter chose to fund this tip from Bitcoin via Mezo: swap BTC→MUSD, draw from an existing loan, or open a loan.
ALTER TABLE tips ADD COLUMN IF NOT EXISTS funding_kind TEXT CHECK (funding_kind IS NULL OR funding_kind IN ('swap_btc','loan_draw','loan_open'));
ALTER TABLE tips ADD COLUMN IF NOT EXISTS funding_tx_hash TEXT;
-- TRUE only after the server checked the funding tx on chain (success, right Mezo contract, sender == tip sender).
ALTER TABLE tips ADD COLUMN IF NOT EXISTS funding_verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS tips_token_status ON tips (token_address, status);
CREATE INDEX IF NOT EXISTS tips_sender_confirmed ON tips (sender_address) WHERE status = 'confirmed';
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN ('page_view','qr_view','share_click','wallet_connect','tip_started','funding_started'));
