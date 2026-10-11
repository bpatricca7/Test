-- Sparkle World accounts v1, second migration (docs/ACCOUNTS.md §3.3). Expand-only; never edit
-- after release.

-- A kid device locked to one child stays locked when that child is deleted. sessions.lock_player
-- is `on delete set null`, so without this flag a device locked to a deleted child would read as
-- "anyone in the family" and see every sibling. `locked` keeps "is this device locked" apart
-- from "to which player": a locked device whose player is gone sees no player at all.
alter table sessions add column locked boolean not null default false;
update sessions set locked = true where lock_player is not null;

-- A world tombstone keeps no world content: the meta (the world's name, biome, size, dates) of
-- worlds deleted before this release is cleared too (saves.mjs clears it on every new delete).
update worlds set meta = '{}'::jsonb where body is null;
