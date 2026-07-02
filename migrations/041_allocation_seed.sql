-- ============================================================================
-- APIP Phase 1.7 -- coverage_allocation seed data
-- Creates allocations for today so Management Workspace shows real content.
-- Uses the two existing seeded opportunities (EURUSD + GBPUSD) and adds
-- four more opportunities across different analysts and markets.
-- ============================================================================

do $$
declare
  v_team_id     uuid := '82995540-4fcc-4e27-bc05-59316b75fb69';

  -- Analysts from the real analysts table
  v_joe         uuid := 'b4fedea6-efde-4f22-8d39-2f9e2e119a73'; -- Joe Neighbour
  v_ian         uuid := '79c48857-91b6-4458-aaf7-61537852b7d0'; -- Ian Coleman
  v_tibor       uuid := 'a3a9e420-ba79-466b-901e-5b921a079509'; -- Tibor Vrbovsky
  v_mona        uuid := 'bacb26e1-b62a-4b31-bf95-db8da5d712d1'; -- Mona Hassan

  -- Existing seeded opportunities
  v_opp_eurusd  uuid := 'aaaaaaaa-0001-0001-0001-000000000001';
  v_opp_gbpusd  uuid := 'aaaaaaaa-0002-0001-0001-000000000002';

  -- New opportunity IDs
  v_opp_gold    uuid := 'aaaaaaaa-0003-0001-0001-000000000003';
  v_opp_dax     uuid := 'aaaaaaaa-0004-0001-0001-000000000004';
  v_opp_usdjpy  uuid := 'aaaaaaaa-0005-0001-0001-000000000005';
  v_opp_sp500   uuid := 'aaaaaaaa-0006-0001-0001-000000000006';

  -- New recommendation version IDs
  v_rv_gold     uuid := 'bbbbbbbb-0003-0001-0001-000000000003';
  v_rv_dax      uuid := 'bbbbbbbb-0004-0001-0001-000000000004';
  v_rv_usdjpy   uuid := 'bbbbbbbb-0005-0001-0001-000000000005';
  v_rv_sp500    uuid := 'bbbbbbbb-0006-0001-0001-000000000006';

  -- App user ID for the test manager (system allocation)
  v_system_user uuid := (select app_user_id from app_users where auth_user_id = 'e49b3979-b0e1-460d-b150-7ce67f256577' limit 1);

  v_gold_id     uuid;
  v_dax_id      uuid;
  v_usdjpy_id   uuid;
  v_sp500_id    uuid;

  v_params      jsonb := '{"atr_period":14,"stale_atr_threshold":0.25,"zone_count":4}';

begin
  -- Look up market IDs
  select market_id into v_gold_id from markets where symbol = 'XAUUSD' limit 1;
  select market_id into v_dax_id from markets where symbol in ('GER40', 'DAX', 'DE30') limit 1;
  select market_id into v_usdjpy_id from markets where symbol = 'USDJPY' limit 1;
  select market_id into v_sp500_id from markets where symbol in ('SPX500', 'US500', 'SP500') limit 1;

  -- Fallback to any available markets if specific ones not found
  if v_gold_id is null then select market_id into v_gold_id from markets where asset_class = 'COMMODITY' limit 1; end if;
  if v_dax_id is null then select market_id into v_dax_id from markets where asset_class = 'INDEX' limit 1; end if;
  if v_usdjpy_id is null then select market_id into v_usdjpy_id from markets where symbol like '%JPY%' limit 1; end if;
  if v_sp500_id is null then select market_id into v_sp500_id from markets where asset_class = 'INDEX' and market_id != v_dax_id limit 1; end if;

  -- -------------------------------------------------------------------------
  -- Additional opportunities for today
  -- -------------------------------------------------------------------------

  -- Gold: BUY, ENTER_NOW, Ian Coleman
  if v_gold_id is not null then
    insert into opportunities (
      opportunity_id, date, market_id, session,
      publication_window_start_uk, publication_window_end_uk,
      current_zone, preferred_entry_zone, direction,
      expected_r, trigger_probability,
      opportunity_lifecycle_status, analyst_action,
      assigned_analyst_id
    ) values (
      v_opp_gold, current_date, v_gold_id, 'EUROPEAN',
      '07:00', '09:00', 'ZONE_3', 'ZONE_3', 'BUY',
      1.45, 0.58, 'SHOWN', 'ENTER_NOW', v_ian
    );

    insert into recommendation_versions (
      recommendation_version_id, opportunity_id, version_number,
      generated_at, shown_at, price_at_generation, zone_at_generation,
      recommendation_validity_status, parameter_snapshot, parameter_snapshot_hash,
      requires_refresh, is_active, entry_range_low, entry_range_high,
      risk_range, target_range
    ) values (
      v_rv_gold, v_opp_gold, 1,
      now() - interval '90 minutes', now() - interval '60 minutes',
      1935.50, 'ZONE_3', 'VALID', v_params, 'gold123hash',
      false, true, 1933.00, 1938.00, '1920.00–1925.00', '1960.00–1965.00'
    );
  end if;

  -- DAX: SELL, WAIT_FOR_PREFERRED_ZONE, Tibor Vrbovsky
  if v_dax_id is not null then
    insert into opportunities (
      opportunity_id, date, market_id, session,
      publication_window_start_uk, publication_window_end_uk,
      current_zone, preferred_entry_zone, direction,
      expected_r, trigger_probability,
      opportunity_lifecycle_status, analyst_action,
      assigned_analyst_id
    ) values (
      v_opp_dax, current_date, v_dax_id, 'EUROPEAN',
      '07:00', '09:00', 'ZONE_2', 'ZONE_3', 'SELL',
      1.20, 0.45, 'SHOWN', 'WAIT_FOR_PREFERRED_ZONE', v_tibor
    );

    insert into recommendation_versions (
      recommendation_version_id, opportunity_id, version_number,
      generated_at, shown_at, price_at_generation, zone_at_generation,
      recommendation_validity_status, parameter_snapshot, parameter_snapshot_hash,
      requires_refresh, is_active, entry_range_low, entry_range_high,
      risk_range, target_range
    ) values (
      v_rv_dax, v_opp_dax, 1,
      now() - interval '2 hours', now() - interval '90 minutes',
      18250.0, 'ZONE_2', 'VALID', v_params, 'dax456hash',
      false, true, 18230.0, 18270.0, '18320.0–18360.0', '18050.0–18090.0'
    );
  end if;

  -- USDJPY: BUY, ENTER_NOW, Mona Hassan
  if v_usdjpy_id is not null then
    insert into opportunities (
      opportunity_id, date, market_id, session,
      publication_window_start_uk, publication_window_end_uk,
      current_zone, preferred_entry_zone, direction,
      expected_r, trigger_probability,
      opportunity_lifecycle_status, analyst_action,
      assigned_analyst_id
    ) values (
      v_opp_usdjpy, current_date, v_usdjpy_id, 'EUROPEAN',
      '07:00', '09:00', 'ZONE_2', 'ZONE_2', 'BUY',
      1.60, 0.70, 'SHOWN', 'ENTER_NOW', v_mona
    );

    insert into recommendation_versions (
      recommendation_version_id, opportunity_id, version_number,
      generated_at, shown_at, price_at_generation, zone_at_generation,
      recommendation_validity_status, parameter_snapshot, parameter_snapshot_hash,
      requires_refresh, is_active, entry_range_low, entry_range_high,
      risk_range, target_range
    ) values (
      v_rv_usdjpy, v_opp_usdjpy, 1,
      now() - interval '75 minutes', now() - interval '45 minutes',
      149.500, 'ZONE_2', 'VALID', v_params, 'usdjpy789hash',
      false, true, 149.300, 149.700, '148.500–148.800', '151.000–151.300'
    );
  end if;

  -- SP500: SELL, WAIT_FOR_PREFERRED_ZONE, Ian Coleman (2nd market)
  if v_sp500_id is not null then
    insert into opportunities (
      opportunity_id, date, market_id, session,
      publication_window_start_uk, publication_window_end_uk,
      current_zone, preferred_entry_zone, direction,
      expected_r, trigger_probability,
      opportunity_lifecycle_status, analyst_action,
      assigned_analyst_id
    ) values (
      v_opp_sp500, current_date, v_sp500_id, 'EUROPEAN',
      '07:00', '09:00', 'ZONE_3', 'ZONE_4', 'SELL',
      1.10, 0.40, 'SHOWN', 'WAIT_FOR_PREFERRED_ZONE', v_ian
    );

    insert into recommendation_versions (
      recommendation_version_id, opportunity_id, version_number,
      generated_at, shown_at, price_at_generation, zone_at_generation,
      recommendation_validity_status, parameter_snapshot, parameter_snapshot_hash,
      requires_refresh, is_active, entry_range_low, entry_range_high,
      risk_range, target_range
    ) values (
      v_rv_sp500, v_opp_sp500, 1,
      now() - interval '3 hours', now() - interval '2 hours',
      4820.0, 'ZONE_3', 'VALID', v_params, 'sp500abchash',
      false, true, 4815.0, 4825.0, '4850.0–4860.0', '4760.0–4770.0'
    );
  end if;

  -- -------------------------------------------------------------------------
  -- Coverage allocations for all 6 opportunities
  -- -------------------------------------------------------------------------
  insert into coverage_allocation (
    opportunity_id, assigned_analyst_id, team_id,
    allocation_status, allocation_score, eligible_analysts,
    assigned_by_type, assigned_by_id, reason_summary
  ) values
    -- Joe: EURUSD
    (v_opp_eurusd, v_joe, v_team_id,
     'ASSIGNED', 1.45, jsonb_build_array(v_joe, v_ian, v_tibor),
     'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.'),

    -- Joe: GBPUSD
    (v_opp_gbpusd, v_joe, v_team_id,
     'ASSIGNED', 1.35, jsonb_build_array(v_joe, v_mona),
     'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.');

  -- Gold: Ian
  if v_gold_id is not null then
    insert into coverage_allocation (
      opportunity_id, assigned_analyst_id, team_id,
      allocation_status, allocation_score, eligible_analysts,
      assigned_by_type, assigned_by_id, reason_summary
    ) values (
      v_opp_gold, v_ian, v_team_id,
      'ASSIGNED', 1.32, jsonb_build_array(v_ian, v_tibor, v_mona),
      'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.'
    );
  end if;

  -- DAX: Tibor
  if v_dax_id is not null then
    insert into coverage_allocation (
      opportunity_id, assigned_analyst_id, team_id,
      allocation_status, allocation_score, eligible_analysts,
      assigned_by_type, assigned_by_id, reason_summary
    ) values (
      v_opp_dax, v_tibor, v_team_id,
      'ASSIGNED', 1.18, jsonb_build_array(v_tibor, v_ian),
      'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.'
    );
  end if;

  -- USDJPY: Mona
  if v_usdjpy_id is not null then
    insert into coverage_allocation (
      opportunity_id, assigned_analyst_id, team_id,
      allocation_status, allocation_score, eligible_analysts,
      assigned_by_type, assigned_by_id, reason_summary
    ) values (
      v_opp_usdjpy, v_mona, v_team_id,
      'ASSIGNED', 1.55, jsonb_build_array(v_mona, v_joe),
      'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.'
    );
  end if;

  -- SP500: Ian (2nd)
  if v_sp500_id is not null then
    insert into coverage_allocation (
      opportunity_id, assigned_analyst_id, team_id,
      allocation_status, allocation_score, eligible_analysts,
      assigned_by_type, assigned_by_id, reason_summary
    ) values (
      v_opp_sp500, v_ian, v_team_id,
      'ASSIGNED', 1.08, jsonb_build_array(v_ian, v_tibor, v_mona),
      'SYSTEM', v_system_user, 'Assigned using expected R, profile fit and workload balancing.'
    );
  end if;

  raise notice 'Allocation seed data inserted successfully';
end $$;
