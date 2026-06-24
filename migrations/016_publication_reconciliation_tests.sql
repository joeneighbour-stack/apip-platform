-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — analyst_publications reconciliation test suite
-- ============================================================================
-- Run: select * from run_publication_reconciliation_tests();
-- ============================================================================

create or replace function run_publication_reconciliation_tests()
returns setof text language plpgsql as $$
declare
  v_results text[] := '{}';
  v_analyst_id uuid;
  v_market_id uuid;
  v_batch_id uuid;
  v_overridden_trade_id uuid;

  v_result1 text;
  v_result2 text;
  v_result3 text;
  v_result4 text;
  v_dup_result text;

  v_pub_id_overridden uuid;
  v_rate record;
begin
  v_results := array_append(v_results, (select plan(8)));

  insert into analysts (display_name) values ('Test Publication Analyst') returning analyst_id into v_analyst_id;
  insert into markets (symbol, asset_class) values ('TEST_PUB_' || gen_random_uuid()::text, 'FX') returning market_id into v_market_id;
  insert into import_batches (source_system, target_table, batch_type, triggered_by_type, triggered_by_id, status)
    select 'MANUAL_BACKFILL', 'actual_trades', 'HISTORICAL_BACKFILL', 'SYSTEM', service_principal_id, 'SUCCESS'
    from service_principals where name = 'ACUITY_PERFORMANCE_IMPORTER'
    returning import_batch_id into v_batch_id;

  -- ------------------------------------------------------------------
  -- Test 1: webhook says triggered=true -> WEBHOOK_TRUE, no lookup needed
  -- ------------------------------------------------------------------
  select upsert_analyst_publication(
    'ACUITY_PERFORMANCE_API', 'pub-test-001', v_analyst_id, v_market_id, '2026-01-05'::timestamptz,
    'BUY', 1.10, 1.05, 1.20, true, null, '{"test":1}'::jsonb
  ) into v_result1;

  v_results := array_append(v_results, (select is(
    v_result1, 'WEBHOOK_TRUE', 'upsert_analyst_publication: triggered=true yields WEBHOOK_TRUE'
  )));

  -- ------------------------------------------------------------------
  -- Test 2: webhook says triggered=false, no actual_trades match exists
  -- -> WEBHOOK_FALSE_CONFIRMED
  -- ------------------------------------------------------------------
  select upsert_analyst_publication(
    'ACUITY_PERFORMANCE_API', 'pub-test-002', v_analyst_id, v_market_id, '2026-01-06'::timestamptz,
    'SELL', 1.10, 1.15, 1.00, false, null, '{"test":2}'::jsonb
  ) into v_result2;

  v_results := array_append(v_results, (select is(
    v_result2, 'WEBHOOK_FALSE_CONFIRMED', 'upsert_analyst_publication: triggered=false with no match stays WEBHOOK_FALSE_CONFIRMED'
  )));

  -- ------------------------------------------------------------------
  -- Test 3: webhook says triggered=false, but a matching actual_trades row
  -- exists on the same (date, market_id) -> WEBHOOK_FALSE_OVERRIDDEN
  -- ------------------------------------------------------------------
  insert into actual_trades (source_system, source_record_id, historical_backfill, import_batch_id,
      published_at, analyst_id, market_id, direction, entry, stop, target, triggered, raw_payload)
    values ('MANUAL_BACKFILL', 'corrected-trade-001', true, v_batch_id,
            '2026-01-07'::timestamptz, v_analyst_id, v_market_id, 'BUY', 1.10, 1.05, 1.20, true, '{}'::jsonb)
    returning trade_id into v_overridden_trade_id;

  select upsert_analyst_publication(
    'ACUITY_PERFORMANCE_API', 'pub-test-003', v_analyst_id, v_market_id, '2026-01-07'::timestamptz,
    'BUY', 1.10, 1.05, 1.20, false, null, '{"test":3}'::jsonb
  ) into v_result3;

  v_results := array_append(v_results, (select is(
    v_result3, 'WEBHOOK_FALSE_OVERRIDDEN', 'upsert_analyst_publication: triggered=false but actual_trades match exists -> OVERRIDDEN'
  )));

  select publication_id into v_pub_id_overridden from analyst_publications where source_record_id = 'pub-test-003';

  v_results := array_append(v_results, (select is(
    (select effective_triggered from analyst_publications where publication_id = v_pub_id_overridden),
    true,
    'WEBHOOK_FALSE_OVERRIDDEN: effective_triggered is true despite original_triggered=false'
  )));

  v_results := array_append(v_results, (select is(
    (select matched_trade_id from analyst_publications where publication_id = v_pub_id_overridden),
    v_overridden_trade_id,
    'WEBHOOK_FALSE_OVERRIDDEN: matched_trade_id correctly links to the actual_trades row'
  )));

  -- ------------------------------------------------------------------
  -- Test 4: two actual_trades rows on the same (date, market_id) ->
  -- AMBIGUOUS_MULTIPLE_MATCHES, not a guess at which one is right
  -- ------------------------------------------------------------------
  insert into actual_trades (source_system, source_record_id, historical_backfill, import_batch_id,
      published_at, analyst_id, market_id, direction, entry, stop, target, triggered, raw_payload)
    values ('MANUAL_BACKFILL', 'corrected-trade-002', true, v_batch_id,
            '2026-01-08'::timestamptz, v_analyst_id, v_market_id, 'BUY', 1.10, 1.05, 1.20, true, '{}'::jsonb);
  insert into actual_trades (source_system, source_record_id, historical_backfill, import_batch_id,
      published_at, analyst_id, market_id, direction, entry, stop, target, triggered, raw_payload)
    values ('MANUAL_BACKFILL', 'corrected-trade-003', true, v_batch_id,
            '2026-01-08'::timestamptz, v_analyst_id, v_market_id, 'SELL', 1.10, 1.15, 1.00, true, '{}'::jsonb);

  select upsert_analyst_publication(
    'ACUITY_PERFORMANCE_API', 'pub-test-004', v_analyst_id, v_market_id, '2026-01-08'::timestamptz,
    'BUY', 1.10, 1.05, 1.20, false, null, '{"test":4}'::jsonb
  ) into v_result4;

  v_results := array_append(v_results, (select is(
    v_result4, 'AMBIGUOUS_MULTIPLE_MATCHES', 'upsert_analyst_publication: 2 same-day matches yields AMBIGUOUS_MULTIPLE_MATCHES, not a guess'
  )));

  -- ------------------------------------------------------------------
  -- Test 5: duplicate source_record_id is a no-op
  -- ------------------------------------------------------------------
  select upsert_analyst_publication(
    'ACUITY_PERFORMANCE_API', 'pub-test-001', v_analyst_id, v_market_id, '2026-01-05'::timestamptz,
    'BUY', 1.10, 1.05, 1.20, true, null, '{"test":1}'::jsonb
  ) into v_dup_result;

  v_results := array_append(v_results, (select is(
    v_dup_result, 'DUPLICATE', 'upsert_analyst_publication: re-calling with the same source_record_id returns DUPLICATE'
  )));

  -- ------------------------------------------------------------------
  -- Test 6: get_triggered_rate reads effective_triggered, not original.
  -- 4 publications total (tests 1-4); effective_triggered true for tests
  -- 1 and 3 only (test 2 stays false, test 4 is ambiguous -> false).
  -- Expected: total_published=4, total_triggered=2, rate=0.5
  -- ------------------------------------------------------------------
  select * into v_rate from get_triggered_rate(v_analyst_id, '2026-01-01', '2026-01-31');

  v_results := array_append(v_results, (select is(
    v_rate.triggered_rate, 0.5::numeric,
    'get_triggered_rate: 2 of 4 effective_triggered = 0.5, reading effective not original'
  )));

  -- ------------------------------------------------------------------
  -- Cleanup
  -- ------------------------------------------------------------------
  delete from notifications where related_table = 'analyst_publications' and related_id = 'pub-test-004';
  delete from analyst_publications where analyst_id = v_analyst_id;
  delete from actual_trades where analyst_id = v_analyst_id;
  delete from import_batches where import_batch_id = v_batch_id;
  delete from analysts where analyst_id = v_analyst_id;
  delete from markets where market_id = v_market_id;

  v_results := array_append(v_results, (select * from finish()));

  return query select unnest(v_results);
end;
$$;

select * from run_publication_reconciliation_tests();
