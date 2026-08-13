-- NCAA's box score feed usually reports position as a short code (GK/FWD/MID/DEF)
-- but occasionally spells it out (GOALKEEPER/FORWARD/MIDFIELDER/DEFENDER) for the
-- same game type. Every ingestion path now normalizes on write (see
-- normalizePosition() in src/lib/server/ncaa-api.ts and its edge-function
-- counterpart in nightly-reconcile), but that only stops new bad values from
-- landing -- it doesn't touch rows already written before the fix, particularly
-- for finals that won't be reconciled again. This is a one-time cleanup of the
-- rows already in the table (94 as of 2026-08-13, mostly FORWARD/MIDFIELDER/
-- DEFENDER/GOALKEEPER, confirmed by a full distribution query before writing this).
update player_seasons
set position = case position
  when 'GOALKEEPER' then 'GK'
  when 'FORWARD'     then 'FWD'
  when 'MIDFIELDER'  then 'MID'
  when 'DEFENDER'    then 'DEF'
  else position
end
where position in ('GOALKEEPER', 'FORWARD', 'MIDFIELDER', 'DEFENDER');
