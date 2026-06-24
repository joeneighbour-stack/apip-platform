-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Analyst seed + external code mapping (pre-backfill)
-- ============================================================================
-- Source: Joe's mapping, confirmed in conversation, plus JOL/NOH resolved
-- as data-entry variants of MOH (Mona Hassan) -- 5 and 1 rows respectively
-- in the historical spreadsheet, too small a count to be real distinct
-- analysts and confirmed as such directly.
-- ============================================================================

insert into analysts (display_name) values
  ('Joe Neighbour'),
  ('Steve O''Hare'),
  ('Ian Coleman'),
  ('Mona Hassan'),
  ('Maged Darwish'),
  ('Tibor Vrbovsky'),
  ('Khaled Gad'),
  ('Taf Nyabanga'),
  ('Joe Damian'),
  ('Jamie Packenham-Walsh')
on conflict do nothing;

insert into analyst_external_codes (analyst_id, source_system, external_code)
select a.analyst_id, 'ACUITY_PERFORMANCE_API', codes.code
from analysts a
join (
  values
    ('Joe Neighbour', 'JN'),
    ('Steve O''Hare', 'SO'),
    ('Ian Coleman', 'IC'),
    ('Ian Coleman', 'IAN'),
    ('Mona Hassan', 'MOH'),
    ('Mona Hassan', 'MPH'),
    ('Mona Hassan', 'MOM'),
    ('Mona Hassan', 'MONA'),
    ('Mona Hassan', 'JOL'),  -- confirmed data-entry variant, 5 rows in source file
    ('Mona Hassan', 'NOH'),  -- confirmed data-entry variant, 1 row in source file
    ('Maged Darwish', 'MAG'),
    ('Tibor Vrbovsky', 'TIV'),
    ('Khaled Gad', 'KG'),
    ('Taf Nyabanga', 'TAF'),
    ('Joe Damian', 'JOD'),
    ('Jamie Packenham-Walsh', 'JPW')
) as codes(display_name, code) on codes.display_name = a.display_name
on conflict do nothing;
