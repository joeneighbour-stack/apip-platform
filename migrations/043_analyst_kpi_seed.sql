-- ============================================================================
-- APIP Phase 1.7 -- KPI seed data for core analyst team
-- Core analysts: Tibor, Ian, Mona, Maged, Khaled
-- ============================================================================

do $$
declare
  v_tibor   uuid := 'a3a9e420-ba79-466b-901e-5b921a079509';
  v_ian     uuid := '79c48857-91b6-4458-aaf7-61537852b7d0';
  v_mona    uuid := 'bacb26e1-b62a-4b31-bf95-db8da5d712d1';
  v_maged   uuid := '3eaa9d7f-e4a0-4da8-9ef7-d4fdfd0e9d69';
  v_khaled  uuid := 'a1ea262b-b084-414f-bd50-001d740139cb';

  v_may_s date := '2026-05-01'; v_may_e date := '2026-05-31';
  v_jun_s date := '2026-06-01'; v_jun_e date := '2026-06-30';
  v_jul_s date := '2026-07-01'; v_jul_e date := '2026-07-31';
begin

  -- ── TIBOR VRBOVSKY ─────────────────────────────────────────────────────
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness) values
    (v_tibor, v_may_s, v_may_e, 'total_return_r',  '{"value": 5.10, "trade_count": 22}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_may_s, v_may_e, 'win_rate',         '{"value": 0.636, "wins": 14, "triggered": 22}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_may_s, v_may_e, 'triggered_rate',   '{"value": 0.733, "triggered": 22, "total_setups": 30}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_may_s, v_may_e, 'max_drawdown',     '{"value": -1.60, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_may_s, v_may_e, 'alignment_rate',   '{"value": 0.773, "aligned": 17, "reviewed": 22}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_tibor, v_jun_s, v_jun_e, 'total_return_r',  '{"value": 2.40, "trade_count": 18}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jun_s, v_jun_e, 'win_rate',         '{"value": 0.556, "wins": 10, "triggered": 18}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jun_s, v_jun_e, 'triggered_rate',   '{"value": 0.692, "triggered": 18, "total_setups": 26}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jun_s, v_jun_e, 'max_drawdown',     '{"value": -2.80, "sequence_length": 4}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jun_s, v_jun_e, 'alignment_rate',   '{"value": 0.722, "aligned": 13, "reviewed": 18}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_tibor, v_jul_s, v_jul_e, 'total_return_r',  '{"value": 3.20, "trade_count": 10}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jul_s, v_jul_e, 'win_rate',         '{"value": 0.700, "wins": 7, "triggered": 10}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jul_s, v_jul_e, 'triggered_rate',   '{"value": 0.714, "triggered": 10, "total_setups": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jul_s, v_jul_e, 'max_drawdown',     '{"value": -1.20, "sequence_length": 2}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_tibor, v_jul_s, v_jul_e, 'alignment_rate',   '{"value": 0.800, "aligned": 8, "reviewed": 10}', 'ANALYST_OWN', false, true, 'MONTHLY');

  -- ── IAN COLEMAN ────────────────────────────────────────────────────────
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness) values
    (v_ian, v_may_s, v_may_e, 'total_return_r',  '{"value": 3.80, "trade_count": 28}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_may_s, v_may_e, 'win_rate',         '{"value": 0.571, "wins": 16, "triggered": 28}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_may_s, v_may_e, 'triggered_rate',   '{"value": 0.778, "triggered": 28, "total_setups": 36}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_may_s, v_may_e, 'max_drawdown',     '{"value": -2.40, "sequence_length": 4}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_may_s, v_may_e, 'alignment_rate',   '{"value": 0.714, "aligned": 20, "reviewed": 28}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_ian, v_jun_s, v_jun_e, 'total_return_r',  '{"value": 1.20, "trade_count": 24}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jun_s, v_jun_e, 'win_rate',         '{"value": 0.500, "wins": 12, "triggered": 24}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jun_s, v_jun_e, 'triggered_rate',   '{"value": 0.750, "triggered": 24, "total_setups": 32}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jun_s, v_jun_e, 'max_drawdown',     '{"value": -4.20, "sequence_length": 6}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jun_s, v_jun_e, 'alignment_rate',   '{"value": 0.667, "aligned": 16, "reviewed": 24}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_ian, v_jul_s, v_jul_e, 'total_return_r',  '{"value": 2.60, "trade_count": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jul_s, v_jul_e, 'win_rate',         '{"value": 0.571, "wins": 8, "triggered": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jul_s, v_jul_e, 'triggered_rate',   '{"value": 0.778, "triggered": 14, "total_setups": 18}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jul_s, v_jul_e, 'max_drawdown',     '{"value": -1.80, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_ian, v_jul_s, v_jul_e, 'alignment_rate',   '{"value": 0.714, "aligned": 10, "reviewed": 14}', 'ANALYST_OWN', false, true, 'MONTHLY');

  -- ── MONA HASSAN ────────────────────────────────────────────────────────
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness) values
    (v_mona, v_may_s, v_may_e, 'total_return_r',  '{"value": 4.50, "trade_count": 16}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_may_s, v_may_e, 'win_rate',         '{"value": 0.688, "wins": 11, "triggered": 16}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_may_s, v_may_e, 'triggered_rate',   '{"value": 0.727, "triggered": 16, "total_setups": 22}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_may_s, v_may_e, 'max_drawdown',     '{"value": -1.20, "sequence_length": 2}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_may_s, v_may_e, 'alignment_rate',   '{"value": 0.875, "aligned": 14, "reviewed": 16}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_mona, v_jun_s, v_jun_e, 'total_return_r',  '{"value": 3.10, "trade_count": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jun_s, v_jun_e, 'win_rate',         '{"value": 0.643, "wins": 9, "triggered": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jun_s, v_jun_e, 'triggered_rate',   '{"value": 0.700, "triggered": 14, "total_setups": 20}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jun_s, v_jun_e, 'max_drawdown',     '{"value": -1.80, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jun_s, v_jun_e, 'alignment_rate',   '{"value": 0.857, "aligned": 12, "reviewed": 14}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_mona, v_jul_s, v_jul_e, 'total_return_r',  '{"value": 2.80, "trade_count": 8}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jul_s, v_jul_e, 'win_rate',         '{"value": 0.625, "wins": 5, "triggered": 8}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jul_s, v_jul_e, 'triggered_rate',   '{"value": 0.667, "triggered": 8, "total_setups": 12}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jul_s, v_jul_e, 'max_drawdown',     '{"value": -0.90, "sequence_length": 2}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_mona, v_jul_s, v_jul_e, 'alignment_rate',   '{"value": 0.875, "aligned": 7, "reviewed": 8}', 'ANALYST_OWN', false, true, 'MONTHLY');

  -- ── MAGED DARWISH ──────────────────────────────────────────────────────
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness) values
    (v_maged, v_may_s, v_may_e, 'total_return_r',  '{"value": -0.80, "trade_count": 20}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_may_s, v_may_e, 'win_rate',         '{"value": 0.450, "wins": 9, "triggered": 20}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_may_s, v_may_e, 'triggered_rate',   '{"value": 0.667, "triggered": 20, "total_setups": 30}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_may_s, v_may_e, 'max_drawdown',     '{"value": -5.20, "sequence_length": 7}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_may_s, v_may_e, 'alignment_rate',   '{"value": 0.600, "aligned": 12, "reviewed": 20}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_maged, v_jun_s, v_jun_e, 'total_return_r',  '{"value": 1.60, "trade_count": 18}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jun_s, v_jun_e, 'win_rate',         '{"value": 0.556, "wins": 10, "triggered": 18}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jun_s, v_jun_e, 'triggered_rate',   '{"value": 0.692, "triggered": 18, "total_setups": 26}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jun_s, v_jun_e, 'max_drawdown',     '{"value": -3.40, "sequence_length": 5}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jun_s, v_jun_e, 'alignment_rate',   '{"value": 0.722, "aligned": 13, "reviewed": 18}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_maged, v_jul_s, v_jul_e, 'total_return_r',  '{"value": 2.10, "trade_count": 10}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jul_s, v_jul_e, 'win_rate',         '{"value": 0.600, "wins": 6, "triggered": 10}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jul_s, v_jul_e, 'triggered_rate',   '{"value": 0.714, "triggered": 10, "total_setups": 14}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jul_s, v_jul_e, 'max_drawdown',     '{"value": -1.60, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_maged, v_jul_s, v_jul_e, 'alignment_rate',   '{"value": 0.800, "aligned": 8, "reviewed": 10}', 'ANALYST_OWN', false, true, 'MONTHLY');

  -- ── KHALED GAD ─────────────────────────────────────────────────────────
  insert into executive_kpis (analyst_id, period_start, period_end, kpi_name, kpi_value, kpi_visibility, includes_historical_backfill, requires_recommendation_version, data_freshness) values
    (v_khaled, v_may_s, v_may_e, 'total_return_r',  '{"value": 3.60, "trade_count": 19}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_may_s, v_may_e, 'win_rate',         '{"value": 0.632, "wins": 12, "triggered": 19}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_may_s, v_may_e, 'triggered_rate',   '{"value": 0.731, "triggered": 19, "total_setups": 26}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_may_s, v_may_e, 'max_drawdown',     '{"value": -1.90, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_may_s, v_may_e, 'alignment_rate',   '{"value": 0.789, "aligned": 15, "reviewed": 19}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_khaled, v_jun_s, v_jun_e, 'total_return_r',  '{"value": 2.90, "trade_count": 17}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jun_s, v_jun_e, 'win_rate',         '{"value": 0.647, "wins": 11, "triggered": 17}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jun_s, v_jun_e, 'triggered_rate',   '{"value": 0.708, "triggered": 17, "total_setups": 24}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jun_s, v_jun_e, 'max_drawdown',     '{"value": -2.10, "sequence_length": 3}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jun_s, v_jun_e, 'alignment_rate',   '{"value": 0.765, "aligned": 13, "reviewed": 17}', 'ANALYST_OWN', false, true, 'MONTHLY'),
    (v_khaled, v_jul_s, v_jul_e, 'total_return_r',  '{"value": 1.80, "trade_count": 9}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jul_s, v_jul_e, 'win_rate',         '{"value": 0.667, "wins": 6, "triggered": 9}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jul_s, v_jul_e, 'triggered_rate',   '{"value": 0.692, "triggered": 9, "total_setups": 13}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jul_s, v_jul_e, 'max_drawdown',     '{"value": -1.10, "sequence_length": 2}', 'ANALYST_OWN', false, false, 'MONTHLY'),
    (v_khaled, v_jul_s, v_jul_e, 'alignment_rate',   '{"value": 0.778, "aligned": 7, "reviewed": 9}', 'ANALYST_OWN', false, true, 'MONTHLY');

  raise notice 'KPI seed data inserted for 5 core analysts';
end $$;
