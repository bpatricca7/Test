-- Sparkle World accounts v1, third migration (docs/ACCOUNTS.md §6.9): free passes from the
-- SW_FREE_PASS Variable. Expand-only; never edit after release.

-- Who set the free pass: null = the admin command (`npm run admin -- comp`), never touched by
-- the Variable; 'config' = SW_FREE_PASS, which ends it at the next start once the address is no
-- longer listed.
alter table families add column comp_source text;
alter table families add constraint families_comp_source check (comp_source in ('config'));

-- Two lists grow by one value each (a check constraint is widened by replacing it in the same
-- statement; every value the old code writes is still allowed, so an old deployment running
-- side by side keeps working):
--   verified_method 'operator': verified consent the operator records for his own family's
--     listed address, after the parent agreed to the notice;
--   audit_log.actor 'config': the records SW_FREE_PASS writes.
alter table families
  drop constraint families_verified_method,
  add constraint families_verified_method check (verified_method in ('card','form','call','video','operator'));
alter table audit_log
  drop constraint audit_log_actor_check,
  add constraint audit_log_actor_check check (actor in ('parent','system','stripe','admin','config'));
