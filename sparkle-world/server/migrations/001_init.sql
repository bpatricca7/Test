-- Sparkle World accounts v1 (docs/ACCOUNTS.md §3). Expand-only; never edit after release.

create table families (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,                  -- the parent's; trimmed, NFC, lower-case
  created_at          timestamptz not null default now(),
  email_verified_at   timestamptz,                    -- first successful sign-in
  last_seen_at        timestamptz,                    -- bumped at most once a day (retention)
  notice_version      int,                            -- direct notice version agreed to
  consent_at          timestamptz,                    -- tier 1: email plus (§11.4)
  verified_at         timestamptz,                    -- tier 2: verified consent
  verified_method     text,                           -- 'card' | 'form' | 'call' | 'video'
  stripe_customer_id  text,
  trial_used          boolean not null default false,
  comp_until          timestamptz,                    -- free pass (admin CLI)
  country             text,                           -- billing country from Checkout
  lapsed_at           timestamptz,                    -- entitlement ended (retention clock)
  purge_after         timestamptz,                    -- kid data deleted after this
  kid_data_purged_at  timestamptz,
  flags               jsonb not null default '{}'::jsonb,  -- {dispute, warned30, warned7, refund_due, ...}
  constraint families_email_key unique (email),
  constraint families_customer_key unique (stripe_customer_id),
  constraint families_email_norm check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  constraint families_verified_method check (verified_method in ('card','form','call','video')),
  constraint families_country check (country ~ '^[A-Z]{2}$')
);
create index families_purge_idx on families (purge_after) where purge_after is not null;

create table players (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  nickname      text not null check (char_length(nickname) between 1 and 12),  -- src/net/names.js
  color         smallint not null default 0 check (color between 0 and 7),
  sort          smallint not null default 0,
  portrait      bytea check (portrait is null or octet_length(portrait) <= 32768),  -- PNG head
  portrait_rev  int not null default 0,
  friends_on    boolean not null default false,
  walkie_on     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint walkie_needs_friends check (not walkie_on or friends_on)
);
create index players_family_idx on players (family_id);
create unique index players_nickname_idx on players (family_id, lower(nickname));

create table player_profiles (
  player_id          uuid primary key references players(id) on delete cascade,
  rev                bigint not null,
  client_updated_at  bigint not null,     -- profile.updatedAt (epoch ms)
  body               bytea not null,      -- gzip(profile JSON)
  size               int not null,        -- uncompressed bytes
  updated_at         timestamptz not null default now()
);

create table worlds (
  player_id          uuid not null references players(id) on delete cascade,
  world_id           text not null check (world_id ~ '^[A-Za-z0-9_.~-]{1,72}$'),  -- incl. .before/.undo/~fork
  rev                bigint not null,
  client_updated_at  bigint not null,     -- save.updatedAt
  meta               jsonb not null,      -- metaOf(save) without the thumbnail
  thumb              bytea,               -- the JPEG (≤ 72 KB)
  body               bytea,               -- gzip(save JSON incl. thumbnail); null = tombstone
  size               int not null default 0,   -- uncompressed bytes
  stored             int not null default 0,   -- octet_length(body), for quotas
  deleted_at         timestamptz,         -- tombstone: other devices learn about the delete
  updated_at         timestamptz not null default now(),
  primary key (player_id, world_id)
);

create table sessions (
  id_hash          bytea primary key,     -- sha256(cookie token); the token itself is never stored
  family_id        uuid not null references families(id) on delete cascade,
  kind             text not null check (kind in ('parent','device')),
  label            text check (char_length(label) <= 40),   -- "iPad · Safari" or the parent's name for it
  lock_player      uuid references players(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  idle_expires_at  timestamptz not null,
  elevated_until   timestamptz,           -- email check (or sign-in) + 15 min
  elevated_at      timestamptz,
  revoked_at       timestamptz
);
create index sessions_family_idx on sessions (family_id);
create index sessions_expiry_idx on sessions (expires_at);

create table gone_sessions (             -- sessions of deleted families: devices learn "family_gone"
  id_hash  bytea primary key,
  gone_at  timestamptz not null default now()
);

create table login_attempts (
  id_hash       bytea primary key,        -- sha256(attempt id); the id is in the __Host-sw_login cookie
  purpose       text not null check (purpose in ('signin','check')),
  email         text not null,
  email_key     bytea not null,           -- HMAC(k_email, email): rate counting
  family_id     uuid references families(id) on delete cascade,   -- 'check' only
  session_hash  bytea,                    -- 'check': the session to elevate
  link_hash     bytea unique,             -- sha256(link token); 'signin' only
  code_mac      bytea not null,           -- HMAC(k_code, attempt id || code)
  next          text,                     -- validated return path (§4.3)
  tries         smallint not null default 0,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);
create index login_attempts_email_idx on login_attempts (email_key, created_at);
create index login_attempts_expiry_idx on login_attempts (expires_at);

create table pair_codes (
  code_mac     bytea primary key,         -- HMAC(k_pair, normalized code)
  family_id    uuid not null references families(id) on delete cascade,
  label        text check (char_length(label) <= 40),
  lock_player  uuid references players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);

create table subscriptions (               -- mirror of Stripe; a family may have several over time
  id                    text primary key,  -- sub_…
  family_id             uuid not null references families(id) on delete cascade,
  customer_id           text not null,
  status                text not null,     -- Stripe's value, verbatim
  price_id              text,
  started_at            timestamptz,       -- subscription.created
  trial_end             timestamptz,
  current_period_end    timestamptz,       -- items.data[0].current_period_end (dahlia)
  cancel_at_period_end  boolean not null default false,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  first_failed_at       timestamptz,       -- first time seen past_due (grace starts)
  latest_paid_at        timestamptz,
  synced_at             timestamptz not null,   -- when we read it from Stripe (monotonic guard)
  updated_at            timestamptz not null default now()
);
create index subscriptions_family_idx on subscriptions (family_id);

create table stripe_events (
  id            text primary key,          -- evt_…
  type          text not null,
  created       bigint not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create table outbox (
  id          bigserial primary key,
  family_id   uuid references families(id) on delete cascade,
  to_email    text not null,
  template    text not null,
  data        jsonb not null default '{}'::jsonb,   -- scrubbed to {} once sent (codes, links)
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  tries       smallint not null default 0,
  last_error  text,                         -- error name only
  created_at  timestamptz not null default now()
);
create index outbox_due_idx on outbox (send_after) where sent_at is null;

create table audit_log (                   -- consent and parent actions; never personal data (§11.9)
  id         bigserial primary key,
  family_id  uuid not null,                -- no foreign key: kept 3 years after the family
  player_id  uuid,
  at         timestamptz not null default now(),
  actor      text not null check (actor in ('parent','system','stripe','admin')),
  action     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index audit_family_idx on audit_log (family_id, at);

create table deleted_families (
  family_id           uuid primary key,
  deleted_at          timestamptz not null default now(),
  stripe_customer_id  text,                -- until the Stripe customer is deleted too
  stripe_done_at      timestamptz
);
