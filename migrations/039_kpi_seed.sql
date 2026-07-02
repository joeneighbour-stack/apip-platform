-- ============================================================================
-- APIP Phase 1.7 -- executive_kpis seed data for Joe Neighbour
-- 3 months of realistic KPI data so performance charts have real-looking
-- numbers to render during UI development.
-- KPIs per product clarification: Return (sum R), Win Rate, Triggered Rate,
-- Drawdown. Alignment Rate is separate.
-- ============================================================================

do $$
declare
  v_joe uuid := 'b4fedea6-efde-4f22-8d39-2f9e2e119a73';

  -- Month periods
  v_may_start   date := '2026-05-01'; v_may_end   date := '2026-05-31';
  v_jun_start   date := '2026-06-01'; v_jun_end   date := '2026-06-30';
  v_jul_start   date := '2026-07-01'; v_jul_end   date := '2026-07-31';
begin

  -- -------------------------------------------------------------------------
  -- MAY 2026 -- solid month, 18 trades, positive R
  -- -------------------------------------------------------------------------
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness)
  values
    (v_joe, v_may_start, v_may_end, 'total_return_r',    '{"value": 4.20, "trade_count": 18}',                              'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_may_start, v_may_end, 'win_rate',          '{"value": 0.61, "wins": 11, "triggered": 18}',                   'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_may_start, v_may_end, 'triggered_rate',    '{"value": 0.72, "triggered": 18, "total_setups": 25}',           'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_may_start, v_may_end, 'max_drawdown',      '{"value": -1.80, "sequence_length": 3}',                         'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_may_start, v_may_end, 'alignment_rate',    '{"value": 0.78, "aligned": 14, "reviewed": 18}',                 'ANALYST_OWN', false, true,  'MONTHLY');

  -- -------------------------------------------------------------------------
  -- JUNE 2026 -- tougher month, fewer triggers, drawdown crept up
  -- -------------------------------------------------------------------------
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness)
  values
    (v_joe, v_jun_start, v_jun_end, 'total_return_r',    '{"value": 1.85, "trade_count": 14}',                              'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jun_start, v_jun_end, 'win_rate',          '{"value": 0.50, "wins": 7, "triggered": 14}',                    'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jun_start, v_jun_end, 'triggered_rate',    '{"value": 0.58, "triggered": 14, "total_setups": 24}',           'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jun_start, v_jun_end, 'max_drawdown',      '{"value": -3.10, "sequence_length": 5}',                         'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jun_start, v_jun_end, 'alignment_rate',    '{"value": 0.64, "aligned": 9, "reviewed": 14}',                  'ANALYST_OWN', false, true,  'MONTHLY');

  -- -------------------------------------------------------------------------
  -- JULY 2026 -- partial month (current), recovering
  -- -------------------------------------------------------------------------
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness)
  values
    (v_joe, v_jul_start, v_jul_end, 'total_return_r',    '{"value": 2.30, "trade_count": 8}',                               'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jul_start, v_jul_end, 'win_rate',          '{"value": 0.625, "wins": 5, "triggered": 8}',                    'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jul_start, v_jul_end, 'triggered_rate',    '{"value": 0.67, "triggered": 8, "total_setups": 12}',            'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jul_start, v_jul_end, 'max_drawdown',      '{"value": -1.20, "sequence_length": 2}',                         'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_joe, v_jul_start, v_jul_end, 'alignment_rate',    '{"value": 0.75, "aligned": 6, "reviewed": 8}',                   'ANALYST_OWN', false, true,  'MONTHLY');

  raise notice 'KPI seed data inserted for Joe Neighbour (3 months)';
end $$;
