export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      actual_trades: {
        Row: {
          analyst_id: string
          closed_at: string | null
          direction: Database["public"]["Enums"]["direction_type"]
          entry: number
          entry_zone: Database["public"]["Enums"]["atr_zone"] | null
          entry_zone_source: string | null
          expiry: string | null
          historical_backfill: boolean
          import_batch_id: string
          imported_at: string
          market_id: string
          opportunity_id: string | null
          published_at: string
          raw_payload: Json
          recommendation_version_id: string | null
          result_r: number | null
          session: Database["public"]["Enums"]["session_type"] | null
          source_record_id: string
          source_system: Database["public"]["Enums"]["source_system"]
          stop: number | null
          target: number | null
          trade_id: string
          triggered: boolean
        }
        Insert: {
          analyst_id: string
          closed_at?: string | null
          direction: Database["public"]["Enums"]["direction_type"]
          entry: number
          entry_zone?: Database["public"]["Enums"]["atr_zone"] | null
          entry_zone_source?: string | null
          expiry?: string | null
          historical_backfill?: boolean
          import_batch_id: string
          imported_at?: string
          market_id: string
          opportunity_id?: string | null
          published_at: string
          raw_payload: Json
          recommendation_version_id?: string | null
          result_r?: number | null
          session?: Database["public"]["Enums"]["session_type"] | null
          source_record_id: string
          source_system: Database["public"]["Enums"]["source_system"]
          stop?: number | null
          target?: number | null
          trade_id?: string
          triggered?: boolean
        }
        Update: {
          analyst_id?: string
          closed_at?: string | null
          direction?: Database["public"]["Enums"]["direction_type"]
          entry?: number
          entry_zone?: Database["public"]["Enums"]["atr_zone"] | null
          entry_zone_source?: string | null
          expiry?: string | null
          historical_backfill?: boolean
          import_batch_id?: string
          imported_at?: string
          market_id?: string
          opportunity_id?: string | null
          published_at?: string
          raw_payload?: Json
          recommendation_version_id?: string | null
          result_r?: number | null
          session?: Database["public"]["Enums"]["session_type"] | null
          source_record_id?: string
          source_system?: Database["public"]["Enums"]["source_system"]
          stop?: number | null
          target?: number | null
          trade_id?: string
          triggered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "actual_trades_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "actual_trades_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["import_batch_id"]
          },
          {
            foreignKeyName: "actual_trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
          {
            foreignKeyName: "actual_trades_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "actual_trades_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "actual_trades_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
        ]
      }
      allocation_decision_log: {
        Row: {
          allocation_decision_id: string
          allocation_id: string
          availability_score: number | null
          candidate_analyst_id: string
          created_at: string
          final_score: number
          market_fit_score: number | null
          opportunity_id: string
          reason_summary: string
          regime_fit_score: number | null
          workload_score: number | null
        }
        Insert: {
          allocation_decision_id?: string
          allocation_id: string
          availability_score?: number | null
          candidate_analyst_id: string
          created_at?: string
          final_score: number
          market_fit_score?: number | null
          opportunity_id: string
          reason_summary: string
          regime_fit_score?: number | null
          workload_score?: number | null
        }
        Update: {
          allocation_decision_id?: string
          allocation_id?: string
          availability_score?: number | null
          candidate_analyst_id?: string
          created_at?: string
          final_score?: number
          market_fit_score?: number | null
          opportunity_id?: string
          reason_summary?: string
          regime_fit_score?: number | null
          workload_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_decision_log_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "coverage_allocation"
            referencedColumns: ["allocation_id"]
          },
          {
            foreignKeyName: "allocation_decision_log_candidate_analyst_id_fkey"
            columns: ["candidate_analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "allocation_decision_log_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      analyst_availability: {
        Row: {
          analyst_id: string
          approved_at: string | null
          approved_by: string | null
          availability_id: string
          available: boolean
          created_at: string
          date: string
          reason: string | null
          requested_by: string | null
          session: Database["public"]["Enums"]["session_type"] | null
          status: string
          workload_cap: number | null
        }
        Insert: {
          analyst_id: string
          approved_at?: string | null
          approved_by?: string | null
          availability_id?: string
          available?: boolean
          created_at?: string
          date: string
          reason?: string | null
          requested_by?: string | null
          session?: Database["public"]["Enums"]["session_type"] | null
          status?: string
          workload_cap?: number | null
        }
        Update: {
          analyst_id?: string
          approved_at?: string | null
          approved_by?: string | null
          availability_id?: string
          available?: boolean
          created_at?: string
          date?: string
          reason?: string | null
          requested_by?: string | null
          session?: Database["public"]["Enums"]["session_type"] | null
          status?: string
          workload_cap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_availability_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
        ]
      }
      analyst_external_codes: {
        Row: {
          analyst_external_code_id: string
          analyst_id: string
          created_at: string
          external_code: string
          source_system: Database["public"]["Enums"]["source_system"]
        }
        Insert: {
          analyst_external_code_id?: string
          analyst_id: string
          created_at?: string
          external_code: string
          source_system?: Database["public"]["Enums"]["source_system"]
        }
        Update: {
          analyst_external_code_id?: string
          analyst_id?: string
          created_at?: string
          external_code?: string
          source_system?: Database["public"]["Enums"]["source_system"]
        }
        Relationships: [
          {
            foreignKeyName: "analyst_external_codes_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
        ]
      }
      analyst_profiles: {
        Row: {
          analyst_id: string
          direction: Database["public"]["Enums"]["direction_type"] | null
          generated_at: string
          includes_historical_backfill: boolean
          market_id: string | null
          profile_data: Json
          profile_id: string
          profile_source_window_end: string | null
          profile_source_window_start: string | null
          requires_recommendation_version: boolean
          zone: Database["public"]["Enums"]["atr_zone"] | null
        }
        Insert: {
          analyst_id: string
          direction?: Database["public"]["Enums"]["direction_type"] | null
          generated_at?: string
          includes_historical_backfill?: boolean
          market_id?: string | null
          profile_data: Json
          profile_id?: string
          profile_source_window_end?: string | null
          profile_source_window_start?: string | null
          requires_recommendation_version?: boolean
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Update: {
          analyst_id?: string
          direction?: Database["public"]["Enums"]["direction_type"] | null
          generated_at?: string
          includes_historical_backfill?: boolean
          market_id?: string | null
          profile_data?: Json
          profile_id?: string
          profile_source_window_end?: string | null
          profile_source_window_start?: string | null
          requires_recommendation_version?: boolean
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_profiles_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "analyst_profiles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      analyst_publications: {
        Row: {
          analyst_id: string
          direction: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered: boolean
          entry: number | null
          import_batch_id: string | null
          imported_at: string
          market_id: string
          matched_trade_id: string | null
          original_triggered: boolean
          overridden_at: string | null
          overridden_by_user_id: string | null
          override_reason: string | null
          publication_id: string
          published_at: string
          raw_payload: Json
          reconciliation_status: Database["public"]["Enums"]["reconciliation_status"]
          source_record_id: string
          source_system: Database["public"]["Enums"]["source_system"]
          stop: number | null
          target: number | null
        }
        Insert: {
          analyst_id: string
          direction?: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered: boolean
          entry?: number | null
          import_batch_id?: string | null
          imported_at?: string
          market_id: string
          matched_trade_id?: string | null
          original_triggered: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          publication_id?: string
          published_at: string
          raw_payload: Json
          reconciliation_status: Database["public"]["Enums"]["reconciliation_status"]
          source_record_id: string
          source_system?: Database["public"]["Enums"]["source_system"]
          stop?: number | null
          target?: number | null
        }
        Update: {
          analyst_id?: string
          direction?: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered?: boolean
          entry?: number | null
          import_batch_id?: string | null
          imported_at?: string
          market_id?: string
          matched_trade_id?: string | null
          original_triggered?: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          publication_id?: string
          published_at?: string
          raw_payload?: Json
          reconciliation_status?: Database["public"]["Enums"]["reconciliation_status"]
          source_record_id?: string
          source_system?: Database["public"]["Enums"]["source_system"]
          stop?: number | null
          target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_publications_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "analyst_publications_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["import_batch_id"]
          },
          {
            foreignKeyName: "analyst_publications_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
          {
            foreignKeyName: "analyst_publications_matched_trade_id_fkey"
            columns: ["matched_trade_id"]
            isOneToOne: false
            referencedRelation: "actual_trades"
            referencedColumns: ["trade_id"]
          },
          {
            foreignKeyName: "analyst_publications_overridden_by_user_id_fkey"
            columns: ["overridden_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
        ]
      }
      analysts: {
        Row: {
          active: boolean
          analyst_id: string
          app_user_id: string | null
          created_at: string
          display_name: string
          sessions: Database["public"]["Enums"]["session_type"][]
          updated_at: string
        }
        Insert: {
          active?: boolean
          analyst_id?: string
          app_user_id?: string | null
          created_at?: string
          display_name: string
          sessions?: Database["public"]["Enums"]["session_type"][]
          updated_at?: string
        }
        Update: {
          active?: boolean
          analyst_id?: string
          app_user_id?: string | null
          created_at?: string
          display_name?: string
          sessions?: Database["public"]["Enums"]["session_type"][]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysts_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
        ]
      }
      api_quota_alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["quota_alert_type"]
          api_quota_alert_id: string
          created_at: string
          notification_id: string | null
          observed_value: number | null
          provider: string
          severity: Database["public"]["Enums"]["quota_alert_severity"]
          threshold_value: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["quota_alert_type"]
          api_quota_alert_id?: string
          created_at?: string
          notification_id?: string | null
          observed_value?: number | null
          provider: string
          severity: Database["public"]["Enums"]["quota_alert_severity"]
          threshold_value?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["quota_alert_type"]
          api_quota_alert_id?: string
          created_at?: string
          notification_id?: string | null
          observed_value?: number | null
          provider?: string
          severity?: Database["public"]["Enums"]["quota_alert_severity"]
          threshold_value?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_quota_alerts_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["notification_id"]
          },
        ]
      }
      api_usage_logs: {
        Row: {
          api_usage_id: string
          endpoint: string | null
          error_summary: string | null
          estimated_cost: number | null
          latency_ms: number | null
          provider: string
          rate_limit_remaining: number | null
          related_engine_run_id: string | null
          request_count: number
          status: Database["public"]["Enums"]["api_usage_status"]
          tokens_input: number | null
          tokens_output: number | null
          used_at: string
        }
        Insert: {
          api_usage_id?: string
          endpoint?: string | null
          error_summary?: string | null
          estimated_cost?: number | null
          latency_ms?: number | null
          provider: string
          rate_limit_remaining?: number | null
          related_engine_run_id?: string | null
          request_count?: number
          status: Database["public"]["Enums"]["api_usage_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          used_at?: string
        }
        Update: {
          api_usage_id?: string
          endpoint?: string | null
          error_summary?: string | null
          estimated_cost?: number | null
          latency_ms?: number | null
          provider?: string
          rate_limit_remaining?: number | null
          related_engine_run_id?: string | null
          request_count?: number
          status?: Database["public"]["Enums"]["api_usage_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_logs_related_engine_run_id_fkey"
            columns: ["related_engine_run_id"]
            isOneToOne: false
            referencedRelation: "engine_runs"
            referencedColumns: ["engine_run_id"]
          },
        ]
      }
      app_users: {
        Row: {
          active: boolean
          analyst_id: string | null
          app_user_id: string
          auth_user_id: string
          created_at: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          analyst_id?: string | null
          app_user_id?: string
          auth_user_id: string
          created_at?: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          analyst_id?: string | null
          app_user_id?: string
          auth_user_id?: string
          created_at?: string
          display_name?: string
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_app_users_analyst"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_value: Json | null
          audit_event_id: string
          before_value: Json | null
          created_at: string
          record_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_value?: Json | null
          audit_event_id?: string
          before_value?: Json | null
          created_at?: string
          record_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_value?: Json | null
          audit_event_id?: string
          before_value?: Json | null
          created_at?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      automation_readiness_metrics: {
        Row: {
          actual_avg_r: number
          analyst_id: string | null
          automation_metric_id: string
          automation_readiness_index: number
          framework_advantage_r: number
          generated_at: string
          market_id: string | null
          opportunity_accuracy: number | null
          period_end: string
          period_start: string
          shadow_avg_r: number
          trigger_accuracy: number | null
        }
        Insert: {
          actual_avg_r: number
          analyst_id?: string | null
          automation_metric_id?: string
          automation_readiness_index: number
          framework_advantage_r: number
          generated_at?: string
          market_id?: string | null
          opportunity_accuracy?: number | null
          period_end: string
          period_start: string
          shadow_avg_r: number
          trigger_accuracy?: number | null
        }
        Update: {
          actual_avg_r?: number
          analyst_id?: string | null
          automation_metric_id?: string
          automation_readiness_index?: number
          framework_advantage_r?: number
          generated_at?: string
          market_id?: string | null
          opportunity_accuracy?: number | null
          period_end?: string
          period_start?: string
          shadow_avg_r?: number
          trigger_accuracy?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_readiness_metrics_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "automation_readiness_metrics_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      claude_generation_logs: {
        Row: {
          claude_generation_id: string
          created_at: string
          error_message: string | null
          fallback_template_id: string | null
          input_hash: string | null
          latency_ms: number | null
          lint_status: Database["public"]["Enums"]["lint_status"]
          output_hash: string | null
          prompt_template_id: string | null
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          recommendation_version_id: string | null
          related_id: string | null
          related_table: string | null
          review_id: string | null
          success: boolean
          used_fallback: boolean
        }
        Insert: {
          claude_generation_id?: string
          created_at?: string
          error_message?: string | null
          fallback_template_id?: string | null
          input_hash?: string | null
          latency_ms?: number | null
          lint_status?: Database["public"]["Enums"]["lint_status"]
          output_hash?: string | null
          prompt_template_id?: string | null
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          recommendation_version_id?: string | null
          related_id?: string | null
          related_table?: string | null
          review_id?: string | null
          success: boolean
          used_fallback?: boolean
        }
        Update: {
          claude_generation_id?: string
          created_at?: string
          error_message?: string | null
          fallback_template_id?: string | null
          input_hash?: string | null
          latency_ms?: number | null
          lint_status?: Database["public"]["Enums"]["lint_status"]
          output_hash?: string | null
          prompt_template_id?: string | null
          prompt_type?: Database["public"]["Enums"]["prompt_type"]
          recommendation_version_id?: string | null
          related_id?: string | null
          related_table?: string | null
          review_id?: string | null
          success?: boolean
          used_fallback?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "claude_generation_logs_fallback_template_id_fkey"
            columns: ["fallback_template_id"]
            isOneToOne: false
            referencedRelation: "fallback_templates"
            referencedColumns: ["fallback_template_id"]
          },
          {
            foreignKeyName: "claude_generation_logs_prompt_template_id_fkey"
            columns: ["prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_templates"
            referencedColumns: ["prompt_template_id"]
          },
          {
            foreignKeyName: "claude_generation_logs_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "claude_generation_logs_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "claude_generation_logs_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "coaching_reviews"
            referencedColumns: ["review_id"]
          },
        ]
      }
      coaching_recommendations: {
        Row: {
          active_recommendation_version_id: string
          analyst_id: string
          coaching_note: string
          entry_range_high: number
          entry_range_low: number
          expected_r: number
          opportunity_id: string
          recommendation_id: string
          risk_range: string
          shown_at: string
          target_range: string
          trigger_probability: number
        }
        Insert: {
          active_recommendation_version_id: string
          analyst_id: string
          coaching_note: string
          entry_range_high: number
          entry_range_low: number
          expected_r: number
          opportunity_id: string
          recommendation_id?: string
          risk_range: string
          shown_at?: string
          target_range: string
          trigger_probability: number
        }
        Update: {
          active_recommendation_version_id?: string
          analyst_id?: string
          coaching_note?: string
          entry_range_high?: number
          entry_range_low?: number
          expected_r?: number
          opportunity_id?: string
          recommendation_id?: string
          risk_range?: string
          shown_at?: string
          target_range?: string
          trigger_probability?: number
        }
        Relationships: [
          {
            foreignKeyName: "coaching_recommendations_active_recommendation_version_id_fkey"
            columns: ["active_recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "coaching_recommendations_active_recommendation_version_id_fkey"
            columns: ["active_recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "coaching_recommendations_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "coaching_recommendations_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      coaching_reviews: {
        Row: {
          acknowledged_at: string | null
          alignment_score: number
          analyst_facing_review: string
          created_at: string
          direction_alignment: Database["public"]["Enums"]["direction_alignment"]
          entry_alignment: Database["public"]["Enums"]["alignment_level"]
          improvement_opportunity_r: number
          recommendation_version_id: string
          review_id: string
          review_status: Database["public"]["Enums"]["review_status"]
          risk_alignment: Database["public"]["Enums"]["alignment_level"]
          target_alignment: Database["public"]["Enums"]["alignment_level"]
          trade_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          alignment_score: number
          analyst_facing_review: string
          created_at?: string
          direction_alignment: Database["public"]["Enums"]["direction_alignment"]
          entry_alignment: Database["public"]["Enums"]["alignment_level"]
          improvement_opportunity_r: number
          recommendation_version_id: string
          review_id?: string
          review_status?: Database["public"]["Enums"]["review_status"]
          risk_alignment: Database["public"]["Enums"]["alignment_level"]
          target_alignment: Database["public"]["Enums"]["alignment_level"]
          trade_id: string
        }
        Update: {
          acknowledged_at?: string | null
          alignment_score?: number
          analyst_facing_review?: string
          created_at?: string
          direction_alignment?: Database["public"]["Enums"]["direction_alignment"]
          entry_alignment?: Database["public"]["Enums"]["alignment_level"]
          improvement_opportunity_r?: number
          recommendation_version_id?: string
          review_id?: string
          review_status?: Database["public"]["Enums"]["review_status"]
          risk_alignment?: Database["public"]["Enums"]["alignment_level"]
          target_alignment?: Database["public"]["Enums"]["alignment_level"]
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_reviews_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "coaching_reviews_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "coaching_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "actual_trades"
            referencedColumns: ["trade_id"]
          },
        ]
      }
      coverage_allocation: {
        Row: {
          allocation_id: string
          allocation_score: number | null
          allocation_status: Database["public"]["Enums"]["allocation_status"]
          assigned_analyst_id: string
          assigned_at: string
          assigned_by_id: string
          assigned_by_type: Database["public"]["Enums"]["assigned_by_type"]
          created_at: string
          eligible_analysts: Json
          lock_version: number
          opportunity_id: string
          override_reason: string | null
          reason_summary: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          allocation_id?: string
          allocation_score?: number | null
          allocation_status?: Database["public"]["Enums"]["allocation_status"]
          assigned_analyst_id: string
          assigned_at?: string
          assigned_by_id: string
          assigned_by_type: Database["public"]["Enums"]["assigned_by_type"]
          created_at?: string
          eligible_analysts: Json
          lock_version?: number
          opportunity_id: string
          override_reason?: string | null
          reason_summary?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          allocation_id?: string
          allocation_score?: number | null
          allocation_status?: Database["public"]["Enums"]["allocation_status"]
          assigned_analyst_id?: string
          assigned_at?: string
          assigned_by_id?: string
          assigned_by_type?: Database["public"]["Enums"]["assigned_by_type"]
          created_at?: string
          eligible_analysts?: Json
          lock_version?: number
          opportunity_id?: string
          override_reason?: string | null
          reason_summary?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_allocation_assigned_analyst_id_fkey"
            columns: ["assigned_analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "coverage_allocation_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "coverage_allocation_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      daily_coverage_plan: {
        Row: {
          analyst_id: string
          created_at: string
          date: string
          market_id: string
          plan_id: string
          session: string
        }
        Insert: {
          analyst_id: string
          created_at?: string
          date: string
          market_id: string
          plan_id?: string
          session: string
        }
        Update: {
          analyst_id?: string
          created_at?: string
          date?: string
          market_id?: string
          plan_id?: string
          session?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_coverage_plan_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "daily_coverage_plan_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      economic_calendar_events: {
        Row: {
          actual: string | null
          country: string | null
          currency: string | null
          event_id: string
          event_name: string
          event_time_uk: string
          forecast: string | null
          impact: Database["public"]["Enums"]["event_impact"]
          import_batch_id: string | null
          imported_at: string | null
          last_updated_at: string
          previous: string | null
          raw_payload: Json | null
          revision_number: number
          source_event_id: string | null
          source_record_id: string
          source_system: Database["public"]["Enums"]["source_system"]
        }
        Insert: {
          actual?: string | null
          country?: string | null
          currency?: string | null
          event_id?: string
          event_name: string
          event_time_uk: string
          forecast?: string | null
          impact: Database["public"]["Enums"]["event_impact"]
          import_batch_id?: string | null
          imported_at?: string | null
          last_updated_at?: string
          previous?: string | null
          raw_payload?: Json | null
          revision_number?: number
          source_event_id?: string | null
          source_record_id: string
          source_system?: Database["public"]["Enums"]["source_system"]
        }
        Update: {
          actual?: string | null
          country?: string | null
          currency?: string | null
          event_id?: string
          event_name?: string
          event_time_uk?: string
          forecast?: string | null
          impact?: Database["public"]["Enums"]["event_impact"]
          import_batch_id?: string | null
          imported_at?: string | null
          last_updated_at?: string
          previous?: string | null
          raw_payload?: Json | null
          revision_number?: number
          source_event_id?: string | null
          source_record_id?: string
          source_system?: Database["public"]["Enums"]["source_system"]
        }
        Relationships: [
          {
            foreignKeyName: "economic_calendar_events_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["import_batch_id"]
          },
        ]
      }
      economic_event_revisions: {
        Row: {
          actual: string | null
          captured_at: string
          event_id: string
          event_revision_id: string
          forecast: string | null
          previous: string | null
          raw_payload: Json | null
          revision_number: number
        }
        Insert: {
          actual?: string | null
          captured_at?: string
          event_id: string
          event_revision_id?: string
          forecast?: string | null
          previous?: string | null
          raw_payload?: Json | null
          revision_number: number
        }
        Update: {
          actual?: string | null
          captured_at?: string
          event_id?: string
          event_revision_id?: string
          forecast?: string | null
          previous?: string | null
          raw_payload?: Json | null
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "economic_event_revisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "economic_calendar_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      engine_run_step_dependencies: {
        Row: {
          dependency_id: string
          dependency_type: Database["public"]["Enums"]["dependency_type"]
          depends_on_step_id: string
          engine_run_step_id: string
        }
        Insert: {
          dependency_id?: string
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          depends_on_step_id: string
          engine_run_step_id: string
        }
        Update: {
          dependency_id?: string
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          depends_on_step_id?: string
          engine_run_step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_run_step_dependencies_depends_on_step_id_fkey"
            columns: ["depends_on_step_id"]
            isOneToOne: false
            referencedRelation: "engine_run_steps"
            referencedColumns: ["engine_run_step_id"]
          },
          {
            foreignKeyName: "engine_run_step_dependencies_engine_run_step_id_fkey"
            columns: ["engine_run_step_id"]
            isOneToOne: false
            referencedRelation: "engine_run_steps"
            referencedColumns: ["engine_run_step_id"]
          },
        ]
      }
      engine_run_steps: {
        Row: {
          engine_run_id: string
          engine_run_step_id: string
          error_detail: string | null
          finished_at: string | null
          max_expected_duration_seconds: number | null
          output_summary: Json | null
          retry_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["engine_step_status"]
          step_name: string
        }
        Insert: {
          engine_run_id: string
          engine_run_step_id?: string
          error_detail?: string | null
          finished_at?: string | null
          max_expected_duration_seconds?: number | null
          output_summary?: Json | null
          retry_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["engine_step_status"]
          step_name: string
        }
        Update: {
          engine_run_id?: string
          engine_run_step_id?: string
          error_detail?: string | null
          finished_at?: string | null
          max_expected_duration_seconds?: number | null
          output_summary?: Json | null
          retry_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["engine_step_status"]
          step_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_run_steps_engine_run_id_fkey"
            columns: ["engine_run_id"]
            isOneToOne: false
            referencedRelation: "engine_runs"
            referencedColumns: ["engine_run_id"]
          },
        ]
      }
      engine_runs: {
        Row: {
          engine_run_id: string
          error_summary: string | null
          finished_at: string | null
          idempotency_key: string
          run_type: string
          session: Database["public"]["Enums"]["session_type"] | null
          started_at: string
          status: Database["public"]["Enums"]["engine_run_status"]
          triggered_by_id: string
          triggered_by_type: Database["public"]["Enums"]["actor_type"]
          window_end: string
          window_start: string
        }
        Insert: {
          engine_run_id?: string
          error_summary?: string | null
          finished_at?: string | null
          idempotency_key: string
          run_type: string
          session?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["engine_run_status"]
          triggered_by_id: string
          triggered_by_type: Database["public"]["Enums"]["actor_type"]
          window_end: string
          window_start: string
        }
        Update: {
          engine_run_id?: string
          error_summary?: string | null
          finished_at?: string | null
          idempotency_key?: string
          run_type?: string
          session?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["engine_run_status"]
          triggered_by_id?: string
          triggered_by_type?: Database["public"]["Enums"]["actor_type"]
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      engine_validation_runs: {
        Row: {
          drift_detail: Json | null
          equivalence_status: string
          parameter_snapshot_hash: string
          production_engine_version: string
          recommendation_hash: string
          recommendation_version_id: string
          research_engine_version: string
          research_recommendation_hash: string | null
          resolution_type: string | null
          validated_at: string
          validation_run_id: string
        }
        Insert: {
          drift_detail?: Json | null
          equivalence_status: string
          parameter_snapshot_hash: string
          production_engine_version: string
          recommendation_hash: string
          recommendation_version_id: string
          research_engine_version: string
          research_recommendation_hash?: string | null
          resolution_type?: string | null
          validated_at?: string
          validation_run_id?: string
        }
        Update: {
          drift_detail?: Json | null
          equivalence_status?: string
          parameter_snapshot_hash?: string
          production_engine_version?: string
          recommendation_hash?: string
          recommendation_version_id?: string
          research_engine_version?: string
          research_recommendation_hash?: string | null
          resolution_type?: string | null
          validated_at?: string
          validation_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_validation_runs_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "engine_validation_runs_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
        ]
      }
      executive_kpis: {
        Row: {
          analyst_id: string | null
          data_freshness: Database["public"]["Enums"]["kpi_freshness"]
          generated_at: string
          includes_historical_backfill: boolean
          kpi_id: string
          kpi_name: string
          kpi_value: Json
          kpi_visibility: Database["public"]["Enums"]["kpi_visibility"]
          period_end: string
          period_start: string
          requires_recommendation_version: boolean
          team_id: string | null
        }
        Insert: {
          analyst_id?: string | null
          data_freshness: Database["public"]["Enums"]["kpi_freshness"]
          generated_at?: string
          includes_historical_backfill?: boolean
          kpi_id?: string
          kpi_name: string
          kpi_value: Json
          kpi_visibility: Database["public"]["Enums"]["kpi_visibility"]
          period_end: string
          period_start: string
          requires_recommendation_version?: boolean
          team_id?: string | null
        }
        Update: {
          analyst_id?: string | null
          data_freshness?: Database["public"]["Enums"]["kpi_freshness"]
          generated_at?: string
          includes_historical_backfill?: boolean
          kpi_id?: string
          kpi_name?: string
          kpi_value?: Json
          kpi_visibility?: Database["public"]["Enums"]["kpi_visibility"]
          period_end?: string
          period_start?: string
          requires_recommendation_version?: boolean
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executive_kpis_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "executive_kpis_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      fallback_templates: {
        Row: {
          active: boolean
          fallback_template_id: string
          fallback_type: Database["public"]["Enums"]["fallback_type"]
          template_body: string
        }
        Insert: {
          active?: boolean
          fallback_template_id?: string
          fallback_type: Database["public"]["Enums"]["fallback_type"]
          template_body: string
        }
        Update: {
          active?: boolean
          fallback_template_id?: string
          fallback_type?: Database["public"]["Enums"]["fallback_type"]
          template_body?: string
        }
        Relationships: []
      }
      golden_set_scenarios: {
        Row: {
          active: boolean
          approved_at: string | null
          approved_by: string | null
          created_by: string
          expected_constraints: Json
          golden_scenario_id: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          scenario_name: string
          structured_input: Json
        }
        Insert: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_by: string
          expected_constraints: Json
          golden_scenario_id?: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          scenario_name: string
          structured_input: Json
        }
        Update: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_by?: string
          expected_constraints?: Json
          golden_scenario_id?: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"]
          scenario_name?: string
          structured_input?: Json
        }
        Relationships: [
          {
            foreignKeyName: "golden_set_scenarios_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
          {
            foreignKeyName: "golden_set_scenarios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
        ]
      }
      import_batches: {
        Row: {
          batch_type: Database["public"]["Enums"]["import_batch_type"]
          checksum_or_summary: Json | null
          created_at: string
          date_range_end: string | null
          date_range_start: string | null
          duplicate_rows: number
          error_rows: number
          finished_at: string | null
          import_batch_id: string
          source_system: Database["public"]["Enums"]["source_system"]
          started_at: string
          status: Database["public"]["Enums"]["import_batch_status"]
          success_rows: number
          target_table: string
          total_rows: number
          triggered_by_id: string
          triggered_by_type: Database["public"]["Enums"]["actor_type"]
        }
        Insert: {
          batch_type: Database["public"]["Enums"]["import_batch_type"]
          checksum_or_summary?: Json | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          duplicate_rows?: number
          error_rows?: number
          finished_at?: string | null
          import_batch_id?: string
          source_system: Database["public"]["Enums"]["source_system"]
          started_at?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          success_rows?: number
          target_table: string
          total_rows?: number
          triggered_by_id: string
          triggered_by_type: Database["public"]["Enums"]["actor_type"]
        }
        Update: {
          batch_type?: Database["public"]["Enums"]["import_batch_type"]
          checksum_or_summary?: Json | null
          created_at?: string
          date_range_end?: string | null
          date_range_start?: string | null
          duplicate_rows?: number
          error_rows?: number
          finished_at?: string | null
          import_batch_id?: string
          source_system?: Database["public"]["Enums"]["source_system"]
          started_at?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          success_rows?: number
          target_table?: string
          total_rows?: number
          triggered_by_id?: string
          triggered_by_type?: Database["public"]["Enums"]["actor_type"]
        }
        Relationships: []
      }
      import_errors: {
        Row: {
          created_at: string
          error_detail: string
          error_type: Database["public"]["Enums"]["import_error_type"]
          import_batch_id: string
          import_error_id: string
          raw_payload: Json
          resolved: boolean
          resolved_at: string | null
          source_record_id: string | null
        }
        Insert: {
          created_at?: string
          error_detail: string
          error_type: Database["public"]["Enums"]["import_error_type"]
          import_batch_id: string
          import_error_id?: string
          raw_payload: Json
          resolved?: boolean
          resolved_at?: string | null
          source_record_id?: string | null
        }
        Update: {
          created_at?: string
          error_detail?: string
          error_type?: Database["public"]["Enums"]["import_error_type"]
          import_batch_id?: string
          import_error_id?: string
          raw_payload?: Json
          resolved?: boolean
          resolved_at?: string | null
          source_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["import_batch_id"]
          },
        ]
      }
      market_event_risk: {
        Row: {
          analyst_warning: string | null
          event_id: string
          event_risk_status: Database["public"]["Enums"]["event_risk_status"]
          market_event_risk_id: string
          market_id: string
          risk_score: number | null
          risk_window_end: string
          risk_window_start: string
        }
        Insert: {
          analyst_warning?: string | null
          event_id: string
          event_risk_status?: Database["public"]["Enums"]["event_risk_status"]
          market_event_risk_id?: string
          market_id: string
          risk_score?: number | null
          risk_window_end: string
          risk_window_start: string
        }
        Update: {
          analyst_warning?: string | null
          event_id?: string
          event_risk_status?: Database["public"]["Enums"]["event_risk_status"]
          market_event_risk_id?: string
          market_id?: string
          risk_score?: number | null
          risk_window_end?: string
          risk_window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_event_risk_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "economic_calendar_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "market_event_risk_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      market_regime_state: {
        Row: {
          captured_at: string
          derived_from: Json | null
          market_id: string
          market_regime_state_id: string
          regime_confidence:
            | Database["public"]["Enums"]["regime_confidence"]
            | null
          regime_tags: Json | null
          session: Database["public"]["Enums"]["session_type"] | null
          trend_state: Database["public"]["Enums"]["trend_state"] | null
          volatility_state:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Insert: {
          captured_at?: string
          derived_from?: Json | null
          market_id: string
          market_regime_state_id?: string
          regime_confidence?:
            | Database["public"]["Enums"]["regime_confidence"]
            | null
          regime_tags?: Json | null
          session?: Database["public"]["Enums"]["session_type"] | null
          trend_state?: Database["public"]["Enums"]["trend_state"] | null
          volatility_state?:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Update: {
          captured_at?: string
          derived_from?: Json | null
          market_id?: string
          market_regime_state_id?: string
          regime_confidence?:
            | Database["public"]["Enums"]["regime_confidence"]
            | null
          regime_tags?: Json | null
          session?: Database["public"]["Enums"]["session_type"] | null
          trend_state?: Database["public"]["Enums"]["trend_state"] | null
          volatility_state?:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "market_regime_state_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      market_state_daily: {
        Row: {
          atr14: number | null
          close: number | null
          date: string
          high: number | null
          import_batch_id: string | null
          imported_at: string | null
          low: number | null
          market_id: string
          market_state_id: string
          open: number | null
          raw_payload: Json | null
          source_record_id: string | null
          source_system: Database["public"]["Enums"]["source_system"]
          zone: Database["public"]["Enums"]["atr_zone"] | null
        }
        Insert: {
          atr14?: number | null
          close?: number | null
          date: string
          high?: number | null
          import_batch_id?: string | null
          imported_at?: string | null
          low?: number | null
          market_id: string
          market_state_id?: string
          open?: number | null
          raw_payload?: Json | null
          source_record_id?: string | null
          source_system?: Database["public"]["Enums"]["source_system"]
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Update: {
          atr14?: number | null
          close?: number | null
          date?: string
          high?: number | null
          import_batch_id?: string | null
          imported_at?: string | null
          low?: number | null
          market_id?: string
          market_state_id?: string
          open?: number | null
          raw_payload?: Json | null
          source_record_id?: string | null
          source_system?: Database["public"]["Enums"]["source_system"]
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "market_state_daily_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["import_batch_id"]
          },
          {
            foreignKeyName: "market_state_daily_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      market_state_intraday: {
        Row: {
          captured_at: string
          current_price: number
          current_zone: Database["public"]["Enums"]["atr_zone"]
          intraday_range_atr: number | null
          market_id: string
          market_state_intraday_id: string
          session: Database["public"]["Enums"]["session_type"]
          session_high: number | null
          session_low: number | null
          volatility_state:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Insert: {
          captured_at?: string
          current_price: number
          current_zone: Database["public"]["Enums"]["atr_zone"]
          intraday_range_atr?: number | null
          market_id: string
          market_state_intraday_id?: string
          session: Database["public"]["Enums"]["session_type"]
          session_high?: number | null
          session_low?: number | null
          volatility_state?:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Update: {
          captured_at?: string
          current_price?: number
          current_zone?: Database["public"]["Enums"]["atr_zone"]
          intraday_range_atr?: number | null
          market_id?: string
          market_state_intraday_id?: string
          session?: Database["public"]["Enums"]["session_type"]
          session_high?: number | null
          session_low?: number | null
          volatility_state?:
            | Database["public"]["Enums"]["volatility_state"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "market_state_intraday_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      market_symbol_aliases: {
        Row: {
          alias_symbol: string
          created_at: string
          market_id: string
          market_symbol_alias_id: string
          source_system: Database["public"]["Enums"]["source_system"]
        }
        Insert: {
          alias_symbol: string
          created_at?: string
          market_id: string
          market_symbol_alias_id?: string
          source_system: Database["public"]["Enums"]["source_system"]
        }
        Update: {
          alias_symbol?: string
          created_at?: string
          market_id?: string
          market_symbol_alias_id?: string
          source_system?: Database["public"]["Enums"]["source_system"]
        }
        Relationships: [
          {
            foreignKeyName: "market_symbol_aliases_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      markets: {
        Row: {
          active: boolean
          asset_class: string
          created_at: string
          display_precision: number | null
          excluded: boolean
          finnhub_symbol: string | null
          market_id: string
          price_data_notes: string | null
          price_data_provider: string | null
          price_data_symbol: string | null
          session: Database["public"]["Enums"]["session_type"] | null
          symbol: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          asset_class: string
          created_at?: string
          display_precision?: number | null
          excluded?: boolean
          finnhub_symbol?: string | null
          market_id?: string
          price_data_notes?: string | null
          price_data_provider?: string | null
          price_data_symbol?: string | null
          session?: Database["public"]["Enums"]["session_type"] | null
          symbol: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          asset_class?: string
          created_at?: string
          display_precision?: number | null
          excluded?: boolean
          finnhub_symbol?: string | null
          market_id?: string
          price_data_notes?: string | null
          price_data_provider?: string | null
          price_data_symbol?: string | null
          session?: Database["public"]["Enums"]["session_type"] | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      model_parameters: {
        Row: {
          active: boolean
          changed_by_id: string
          changed_by_type: Database["public"]["Enums"]["actor_type"]
          effective_from: string
          effective_to: string | null
          parameter_group: string
          parameter_id: string
          parameter_name: string
          parameter_value: Json
        }
        Insert: {
          active?: boolean
          changed_by_id: string
          changed_by_type: Database["public"]["Enums"]["actor_type"]
          effective_from?: string
          effective_to?: string | null
          parameter_group: string
          parameter_id?: string
          parameter_name: string
          parameter_value: Json
        }
        Update: {
          active?: boolean
          changed_by_id?: string
          changed_by_type?: Database["public"]["Enums"]["actor_type"]
          effective_from?: string
          effective_to?: string | null
          parameter_group?: string
          parameter_id?: string
          parameter_name?: string
          parameter_value?: Json
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          escalated_at: string | null
          escalation_target_role: Database["public"]["Enums"]["app_role"] | null
          escalation_target_team_id: string | null
          message: string
          notification_id: string
          notification_status: Database["public"]["Enums"]["notification_status"]
          notification_type: Database["public"]["Enums"]["notification_type"]
          recipient_role: Database["public"]["Enums"]["app_role"] | null
          recipient_user_id: string | null
          related_id: string | null
          related_table: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          sla_due_at: string | null
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          escalated_at?: string | null
          escalation_target_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          escalation_target_team_id?: string | null
          message: string
          notification_id?: string
          notification_status?: Database["public"]["Enums"]["notification_status"]
          notification_type: Database["public"]["Enums"]["notification_type"]
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          recipient_user_id?: string | null
          related_id?: string | null
          related_table?: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          sla_due_at?: string | null
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          escalated_at?: string | null
          escalation_target_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          escalation_target_team_id?: string | null
          message?: string
          notification_id?: string
          notification_status?: Database["public"]["Enums"]["notification_status"]
          notification_type?: Database["public"]["Enums"]["notification_type"]
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          recipient_user_id?: string | null
          related_id?: string | null
          related_table?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          sla_due_at?: string | null
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_escalation_target_team_id_fkey"
            columns: ["escalation_target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
          {
            foreignKeyName: "notifications_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      opportunities: {
        Row: {
          analyst_action: Database["public"]["Enums"]["analyst_action"] | null
          assigned_analyst_id: string | null
          created_at: string
          current_zone: Database["public"]["Enums"]["atr_zone"]
          date: string
          direction: Database["public"]["Enums"]["direction_type"]
          expected_r: number
          market_id: string
          opportunity_id: string
          opportunity_lifecycle_status: Database["public"]["Enums"]["opportunity_lifecycle_status"]
          preferred_entry_zone: Database["public"]["Enums"]["atr_zone"]
          publication_window_end_uk: string
          publication_window_start_uk: string
          session: Database["public"]["Enums"]["session_type"]
          trigger_probability: number
          updated_at: string
          version: number
        }
        Insert: {
          analyst_action?: Database["public"]["Enums"]["analyst_action"] | null
          assigned_analyst_id?: string | null
          created_at?: string
          current_zone: Database["public"]["Enums"]["atr_zone"]
          date: string
          direction: Database["public"]["Enums"]["direction_type"]
          expected_r: number
          market_id: string
          opportunity_id?: string
          opportunity_lifecycle_status?: Database["public"]["Enums"]["opportunity_lifecycle_status"]
          preferred_entry_zone: Database["public"]["Enums"]["atr_zone"]
          publication_window_end_uk: string
          publication_window_start_uk: string
          session: Database["public"]["Enums"]["session_type"]
          trigger_probability: number
          updated_at?: string
          version?: number
        }
        Update: {
          analyst_action?: Database["public"]["Enums"]["analyst_action"] | null
          assigned_analyst_id?: string | null
          created_at?: string
          current_zone?: Database["public"]["Enums"]["atr_zone"]
          date?: string
          direction?: Database["public"]["Enums"]["direction_type"]
          expected_r?: number
          market_id?: string
          opportunity_id?: string
          opportunity_lifecycle_status?: Database["public"]["Enums"]["opportunity_lifecycle_status"]
          preferred_entry_zone?: Database["public"]["Enums"]["atr_zone"]
          publication_window_end_uk?: string
          publication_window_start_uk?: string
          session?: Database["public"]["Enums"]["session_type"]
          trigger_probability?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_analyst_id_fkey"
            columns: ["assigned_analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "opportunities_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      post_trade_reviews: {
        Row: {
          alignment_score: number
          analyst_facing_review: string
          created_at: string
          direction_alignment: string
          entry_alignment: string
          market: string
          recommendation_version_id: string | null
          review_id: string
          review_status: string
          session: string
          stop_alignment: string
          target_alignment: string
          trade_id: string
        }
        Insert: {
          alignment_score: number
          analyst_facing_review: string
          created_at?: string
          direction_alignment: string
          entry_alignment: string
          market: string
          recommendation_version_id?: string | null
          review_id?: string
          review_status?: string
          session: string
          stop_alignment: string
          target_alignment: string
          trade_id: string
        }
        Update: {
          alignment_score?: number
          analyst_facing_review?: string
          created_at?: string
          direction_alignment?: string
          entry_alignment?: string
          market?: string
          recommendation_version_id?: string | null
          review_id?: string
          review_status?: string
          session?: string
          stop_alignment?: string
          target_alignment?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_trade_reviews_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "post_trade_reviews_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "post_trade_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "actual_trades"
            referencedColumns: ["trade_id"]
          },
        ]
      }
      prompt_regression_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_for_activation: boolean
          failure_summary: string | null
          prompt_regression_run_id: string
          prompt_template_id: string
          run_finished_at: string | null
          run_started_at: string
          scenarios_failed: number
          scenarios_passed: number
          scenarios_tested: number
          status: Database["public"]["Enums"]["regression_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_for_activation?: boolean
          failure_summary?: string | null
          prompt_regression_run_id?: string
          prompt_template_id: string
          run_finished_at?: string | null
          run_started_at?: string
          scenarios_failed?: number
          scenarios_passed?: number
          scenarios_tested?: number
          status?: Database["public"]["Enums"]["regression_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_for_activation?: boolean
          failure_summary?: string | null
          prompt_regression_run_id?: string
          prompt_template_id?: string
          run_finished_at?: string | null
          run_started_at?: string
          scenarios_failed?: number
          scenarios_passed?: number
          scenarios_tested?: number
          status?: Database["public"]["Enums"]["regression_status"]
        }
        Relationships: [
          {
            foreignKeyName: "prompt_regression_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
          {
            foreignKeyName: "prompt_regression_runs_prompt_template_id_fkey"
            columns: ["prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_templates"
            referencedColumns: ["prompt_template_id"]
          },
        ]
      }
      prompt_templates: {
        Row: {
          active: boolean
          approved_at: string | null
          approved_by: string | null
          latest_regression_run_id: string | null
          prompt_template_id: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          requires_regression_pass: boolean
          template_body: string
          version: number
        }
        Insert: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          latest_regression_run_id?: string | null
          prompt_template_id?: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          requires_regression_pass?: boolean
          template_body: string
          version: number
        }
        Update: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          latest_regression_run_id?: string | null
          prompt_template_id?: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"]
          requires_regression_pass?: boolean
          template_body?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_prompt_templates_latest_run"
            columns: ["latest_regression_run_id"]
            isOneToOne: false
            referencedRelation: "prompt_regression_runs"
            referencedColumns: ["prompt_regression_run_id"]
          },
          {
            foreignKeyName: "prompt_templates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
        ]
      }
      recommendation_versions: {
        Row: {
          atr_move_since_generation: number | null
          entry_range_high: number
          entry_range_low: number
          event_risk_status:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at: string
          is_active: boolean
          opportunity_id: string
          parameter_snapshot: Json
          parameter_snapshot_hash: string | null
          price_at_generation: number
          recommendation_validity_status: Database["public"]["Enums"]["recommendation_validity_status"]
          recommendation_version_id: string
          regime_tags: Json | null
          requires_refresh: boolean
          risk_range: string
          shown_at: string | null
          target_range: string
          version_number: number
          volatility_warning: string | null
          zone_at_generation: Database["public"]["Enums"]["atr_zone"]
        }
        Insert: {
          atr_move_since_generation?: number | null
          entry_range_high: number
          entry_range_low: number
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at?: string
          is_active?: boolean
          opportunity_id: string
          parameter_snapshot: Json
          parameter_snapshot_hash?: string | null
          price_at_generation: number
          recommendation_validity_status?: Database["public"]["Enums"]["recommendation_validity_status"]
          recommendation_version_id?: string
          regime_tags?: Json | null
          requires_refresh?: boolean
          risk_range: string
          shown_at?: string | null
          target_range: string
          version_number: number
          volatility_warning?: string | null
          zone_at_generation: Database["public"]["Enums"]["atr_zone"]
        }
        Update: {
          atr_move_since_generation?: number | null
          entry_range_high?: number
          entry_range_low?: number
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at?: string
          is_active?: boolean
          opportunity_id?: string
          parameter_snapshot?: Json
          parameter_snapshot_hash?: string | null
          price_at_generation?: number
          recommendation_validity_status?: Database["public"]["Enums"]["recommendation_validity_status"]
          recommendation_version_id?: string
          regime_tags?: Json | null
          requires_refresh?: boolean
          risk_range?: string
          shown_at?: string | null
          target_range?: string
          version_number?: number
          volatility_warning?: string | null
          zone_at_generation?: Database["public"]["Enums"]["atr_zone"]
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_versions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      service_principals: {
        Row: {
          active: boolean
          credential_mode: Database["public"]["Enums"]["credential_mode"]
          name: string
          purpose: string
          service_principal_id: string
        }
        Insert: {
          active?: boolean
          credential_mode: Database["public"]["Enums"]["credential_mode"]
          name: string
          purpose: string
          service_principal_id?: string
        }
        Update: {
          active?: boolean
          credential_mode?: Database["public"]["Enums"]["credential_mode"]
          name?: string
          purpose?: string
          service_principal_id?: string
        }
        Relationships: []
      }
      session_configuration: {
        Row: {
          active: boolean
          engine_run_time_uk: string
          expiry_rule: string
          publication_window_end_uk: string
          publication_window_start_uk: string
          session: Database["public"]["Enums"]["session_type"]
          session_config_id: string
        }
        Insert: {
          active?: boolean
          engine_run_time_uk: string
          expiry_rule: string
          publication_window_end_uk: string
          publication_window_start_uk: string
          session: Database["public"]["Enums"]["session_type"]
          session_config_id?: string
        }
        Update: {
          active?: boolean
          engine_run_time_uk?: string
          expiry_rule?: string
          publication_window_end_uk?: string
          publication_window_start_uk?: string
          session?: Database["public"]["Enums"]["session_type"]
          session_config_id?: string
        }
        Relationships: []
      }
      shadow_trade_outcomes: {
        Row: {
          closed_at: string | null
          created_at: string
          exit_bar_timestamp: string | null
          exit_price: number | null
          exit_reason: string | null
          monitor_run_id: string | null
          outcome_timestamp: string | null
          raw_price_evidence: Json | null
          result_r: number | null
          shadow_outcome_id: string
          shadow_trade_id: string
          trade_outcome_status: Database["public"]["Enums"]["trade_outcome_status"]
          trigger_bar_timestamp: string | null
          trigger_source: string | null
          triggered_at: string | null
          triggered_price: number | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          exit_bar_timestamp?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          monitor_run_id?: string | null
          outcome_timestamp?: string | null
          raw_price_evidence?: Json | null
          result_r?: number | null
          shadow_outcome_id?: string
          shadow_trade_id: string
          trade_outcome_status?: Database["public"]["Enums"]["trade_outcome_status"]
          trigger_bar_timestamp?: string | null
          trigger_source?: string | null
          triggered_at?: string | null
          triggered_price?: number | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          exit_bar_timestamp?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          monitor_run_id?: string | null
          outcome_timestamp?: string | null
          raw_price_evidence?: Json | null
          result_r?: number | null
          shadow_outcome_id?: string
          shadow_trade_id?: string
          trade_outcome_status?: Database["public"]["Enums"]["trade_outcome_status"]
          trigger_bar_timestamp?: string | null
          trigger_source?: string | null
          triggered_at?: string | null
          triggered_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shadow_trade_outcomes_shadow_trade_id_fkey"
            columns: ["shadow_trade_id"]
            isOneToOne: false
            referencedRelation: "shadow_trades"
            referencedColumns: ["shadow_trade_id"]
          },
        ]
      }
      shadow_trades: {
        Row: {
          confidence_label: Database["public"]["Enums"]["confidence_label"] | null
          created_at: string
          direction: string | null
          entry: number
          entry_mode: string | null
          expires_at: string | null
          generated_at: string
          generated_price: number | null
          opportunity_id: string
          price_provider: string | null
          price_resolution: string | null
          recommendation_version_id: string
          rr: number
          session: string | null
          shadow_trade_id: string
          stop: number
          target: number
          template_source: string
          trade_outcome_status: Database["public"]["Enums"]["trade_outcome_status"]
          visible_to_analyst: boolean
        }
        Insert: {
          confidence_label?: Database["public"]["Enums"]["confidence_label"] | null
          created_at?: string
          direction?: string | null
          entry: number
          entry_mode?: string | null
          expires_at?: string | null
          generated_at?: string
          generated_price?: number | null
          opportunity_id: string
          price_provider?: string | null
          price_resolution?: string | null
          recommendation_version_id: string
          rr: number
          session?: string | null
          shadow_trade_id?: string
          stop: number
          target: number
          template_source: string
          trade_outcome_status?: Database["public"]["Enums"]["trade_outcome_status"]
          visible_to_analyst?: boolean
        }
        Update: {
          confidence_label?: Database["public"]["Enums"]["confidence_label"] | null
          created_at?: string
          direction?: string | null
          entry?: number
          entry_mode?: string | null
          expires_at?: string | null
          generated_at?: string
          generated_price?: number | null
          opportunity_id?: string
          price_provider?: string | null
          price_resolution?: string | null
          recommendation_version_id?: string
          rr?: number
          session?: string | null
          shadow_trade_id?: string
          stop?: number
          target?: number
          template_source?: string
          trade_outcome_status?: Database["public"]["Enums"]["trade_outcome_status"]
          visible_to_analyst?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shadow_trades_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
          {
            foreignKeyName: "shadow_trades_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions"
            referencedColumns: ["recommendation_version_id"]
          },
          {
            foreignKeyName: "shadow_trades_recommendation_version_id_fkey"
            columns: ["recommendation_version_id"]
            isOneToOne: false
            referencedRelation: "recommendation_versions_analyst_view"
            referencedColumns: ["recommendation_version_id"]
          },
        ]
      }
      team_managers: {
        Row: {
          active: boolean
          can_override_allocation: boolean
          can_view_coaching_reviews: boolean
          manager_user_id: string
          receives_escalations: boolean
          team_id: string
          team_manager_id: string
        }
        Insert: {
          active?: boolean
          can_override_allocation?: boolean
          can_view_coaching_reviews?: boolean
          manager_user_id: string
          receives_escalations?: boolean
          team_id: string
          team_manager_id?: string
        }
        Update: {
          active?: boolean
          can_override_allocation?: boolean
          can_view_coaching_reviews?: boolean
          manager_user_id?: string
          receives_escalations?: boolean
          team_id?: string
          team_manager_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_managers_manager_user_id_fkey"
            columns: ["manager_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
          {
            foreignKeyName: "team_managers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      team_members: {
        Row: {
          active: boolean
          analyst_id: string | null
          app_user_id: string
          effective_from: string
          effective_to: string | null
          membership_role: Database["public"]["Enums"]["membership_role"]
          team_id: string
          team_member_id: string
        }
        Insert: {
          active?: boolean
          analyst_id?: string | null
          app_user_id: string
          effective_from?: string
          effective_to?: string | null
          membership_role?: Database["public"]["Enums"]["membership_role"]
          team_id: string
          team_member_id?: string
        }
        Update: {
          active?: boolean
          analyst_id?: string | null
          app_user_id?: string
          effective_from?: string
          effective_to?: string | null
          membership_role?: Database["public"]["Enums"]["membership_role"]
          team_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_team_members_analyst"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "team_members_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      teams: {
        Row: {
          active: boolean
          created_at: string
          team_id: string
          team_name: string
          team_type: Database["public"]["Enums"]["team_type"] | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          team_id?: string
          team_name: string
          team_type?: Database["public"]["Enums"]["team_type"] | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          team_id?: string
          team_name?: string
          team_type?: Database["public"]["Enums"]["team_type"] | null
          updated_at?: string
        }
        Relationships: []
      }
      template_profiles: {
        Row: {
          direction: Database["public"]["Enums"]["direction_type"] | null
          generated_at: string
          market_id: string | null
          sample_size: number
          strength_score: number | null
          template_data: Json | null
          template_id: string
          zone: Database["public"]["Enums"]["atr_zone"] | null
        }
        Insert: {
          direction?: Database["public"]["Enums"]["direction_type"] | null
          generated_at?: string
          market_id?: string | null
          sample_size: number
          strength_score?: number | null
          template_data?: Json | null
          template_id?: string
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Update: {
          direction?: Database["public"]["Enums"]["direction_type"] | null
          generated_at?: string
          market_id?: string | null
          sample_size?: number
          strength_score?: number | null
          template_data?: Json | null
          template_id?: string
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "template_profiles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      trade_disputes: {
        Row: {
          admin_note: string | null
          analyst_note: string | null
          created_at: string
          dispute_id: string
          dispute_type: Database["public"]["Enums"]["dispute_type"]
          original_values: Json
          override_values: Json | null
          raised_by_analyst_id: string
          resolved_at: string | null
          resolved_by_id: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          trade_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          analyst_note?: string | null
          created_at?: string
          dispute_id?: string
          dispute_type: Database["public"]["Enums"]["dispute_type"]
          original_values: Json
          override_values?: Json | null
          raised_by_analyst_id: string
          resolved_at?: string | null
          resolved_by_id?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          trade_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          analyst_note?: string | null
          created_at?: string
          dispute_id?: string
          dispute_type?: Database["public"]["Enums"]["dispute_type"]
          original_values?: Json
          override_values?: Json | null
          raised_by_analyst_id?: string
          resolved_at?: string | null
          resolved_by_id?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          trade_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_disputes_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "actual_trades"
            referencedColumns: ["trade_id"]
          },
          {
            foreignKeyName: "trade_disputes_raised_by_analyst_id_fkey"
            columns: ["raised_by_analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "trade_disputes_resolved_by_id_fkey"
            columns: ["resolved_by_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["app_user_id"]
          },
        ]
      }
      trigger_probability_profiles: {
        Row: {
          generated_at: string
          market_id: string | null
          sample_size: number
          session: Database["public"]["Enums"]["session_type"] | null
          trigger_probability: number
          trigger_profile_id: string
          zone: Database["public"]["Enums"]["atr_zone"] | null
        }
        Insert: {
          generated_at?: string
          market_id?: string | null
          sample_size: number
          session?: Database["public"]["Enums"]["session_type"] | null
          trigger_probability: number
          trigger_profile_id?: string
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Update: {
          generated_at?: string
          market_id?: string | null
          sample_size?: number
          session?: Database["public"]["Enums"]["session_type"] | null
          trigger_probability?: number
          trigger_profile_id?: string
          zone?: Database["public"]["Enums"]["atr_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "trigger_probability_profiles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
    }
    Views: {
      market_event_risk_analyst_view: {
        Row: {
          analyst_warning: string | null
          event_id: string | null
          event_risk_status:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          market_event_risk_id: string | null
          market_id: string | null
          risk_window_end: string | null
          risk_window_start: string | null
        }
        Insert: {
          analyst_warning?: string | null
          event_id?: string | null
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          market_event_risk_id?: string | null
          market_id?: string | null
          risk_window_end?: string | null
          risk_window_start?: string | null
        }
        Update: {
          analyst_warning?: string | null
          event_id?: string | null
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          market_event_risk_id?: string | null
          market_id?: string | null
          risk_window_end?: string | null
          risk_window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_event_risk_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "economic_calendar_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "market_event_risk_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      publications_needing_review: {
        Row: {
          analyst_id: string | null
          direction: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered: boolean | null
          entry: number | null
          market_id: string | null
          original_triggered: boolean | null
          publication_id: string | null
          published_at: string | null
          reconciliation_status:
            | Database["public"]["Enums"]["reconciliation_status"]
            | null
          source_record_id: string | null
          stop: number | null
          target: number | null
        }
        Insert: {
          analyst_id?: string | null
          direction?: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered?: boolean | null
          entry?: number | null
          market_id?: string | null
          original_triggered?: boolean | null
          publication_id?: string | null
          published_at?: string | null
          reconciliation_status?:
            | Database["public"]["Enums"]["reconciliation_status"]
            | null
          source_record_id?: string | null
          stop?: number | null
          target?: number | null
        }
        Update: {
          analyst_id?: string | null
          direction?: Database["public"]["Enums"]["direction_type"] | null
          effective_triggered?: boolean | null
          entry?: number | null
          market_id?: string | null
          original_triggered?: boolean | null
          publication_id?: string | null
          published_at?: string | null
          reconciliation_status?:
            | Database["public"]["Enums"]["reconciliation_status"]
            | null
          source_record_id?: string | null
          stop?: number | null
          target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_publications_analyst_id_fkey"
            columns: ["analyst_id"]
            isOneToOne: false
            referencedRelation: "analysts"
            referencedColumns: ["analyst_id"]
          },
          {
            foreignKeyName: "analyst_publications_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["market_id"]
          },
        ]
      }
      recommendation_versions_analyst_view: {
        Row: {
          entry_range_high: number | null
          entry_range_low: number | null
          event_risk_status:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at: string | null
          is_active: boolean | null
          opportunity_id: string | null
          recommendation_validity_status:
            | Database["public"]["Enums"]["recommendation_validity_status"]
            | null
          recommendation_version_id: string | null
          requires_refresh: boolean | null
          risk_range: string | null
          shown_at: string | null
          target_range: string | null
          version_number: number | null
        }
        Insert: {
          entry_range_high?: number | null
          entry_range_low?: number | null
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at?: string | null
          is_active?: boolean | null
          opportunity_id?: string | null
          recommendation_validity_status?:
            | Database["public"]["Enums"]["recommendation_validity_status"]
            | null
          recommendation_version_id?: string | null
          requires_refresh?: boolean | null
          risk_range?: string | null
          shown_at?: string | null
          target_range?: string | null
          version_number?: number | null
        }
        Update: {
          entry_range_high?: number | null
          entry_range_low?: number | null
          event_risk_status?:
            | Database["public"]["Enums"]["event_risk_status"]
            | null
          generated_at?: string | null
          is_active?: boolean | null
          opportunity_id?: string | null
          recommendation_validity_status?:
            | Database["public"]["Enums"]["recommendation_validity_status"]
            | null
          recommendation_version_id?: string | null
          requires_refresh?: boolean | null
          risk_range?: string | null
          shown_at?: string | null
          target_range?: string | null
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_versions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      shadow_performance_executive_summary: {
        Row: {
          avg_shadow_r: number | null
          period: string | null
          shadow_trade_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_historical_entry_zone: {
        Args: {
          p_entry_zone: Database["public"]["Enums"]["atr_zone"]
          p_trade_id: string
        }
        Returns: undefined
      }
      build_idempotency_key: {
        Args: {
          p_run_type: string
          p_session: Database["public"]["Enums"]["session_type"]
          p_window_end: string
          p_window_start: string
        }
        Returns: string
      }
      complete_step: {
        Args: { p_output_summary?: Json; p_step_id: string }
        Returns: undefined
      }
      current_analyst_id: { Args: never; Returns: string }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_app_user_id: { Args: never; Returns: string }
      fail_step: {
        Args: { p_error_detail: string; p_step_id: string }
        Returns: undefined
      }
      finalize_import_batch: {
        Args: { p_import_batch_id: string; p_total_rows: number }
        Returns: undefined
      }
      finalize_run_if_complete: {
        Args: { p_engine_run_id: string }
        Returns: undefined
      }
      get_or_create_engine_run: {
        Args: {
          p_run_type: string
          p_session: Database["public"]["Enums"]["session_type"]
          p_triggered_by_id: string
          p_triggered_by_type: Database["public"]["Enums"]["actor_type"]
          p_window_end: string
          p_window_start: string
        }
        Returns: {
          out_engine_run_id: string
          was_created: boolean
        }[]
      }
      get_ready_steps: {
        Args: { p_engine_run_id: string }
        Returns: {
          engine_run_id: string
          engine_run_step_id: string
          error_detail: string | null
          finished_at: string | null
          max_expected_duration_seconds: number | null
          output_summary: Json | null
          retry_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["engine_step_status"]
          step_name: string
        }[]
        SetofOptions: {
          from: "*"
          to: "engine_run_steps"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_triggered_rate: {
        Args: { p_analyst_id: string; p_from: string; p_to: string }
        Returns: {
          total_published: number
          total_triggered: number
          triggered_rate: number
        }[]
      }
      manages_analyst: { Args: { target_analyst_id: string }; Returns: boolean }
      manages_team: { Args: { target_team_id: string }; Returns: boolean }
      override_publication_triggered: {
        Args: {
          p_matched_trade_id?: string
          p_new_effective_triggered: boolean
          p_override_reason: string
          p_publication_id: string
        }
        Returns: undefined
      }
      record_import_duplicate: {
        Args: { p_import_batch_id: string }
        Returns: undefined
      }
      record_import_error: {
        Args: {
          p_error_detail: string
          p_error_type: Database["public"]["Enums"]["import_error_type"]
          p_import_batch_id: string
          p_raw_payload: Json
          p_source_record_id: string
        }
        Returns: undefined
      }
      record_import_success: {
        Args: { p_import_batch_id: string }
        Returns: undefined
      }
      run_phase_1_3_tests: { Args: never; Returns: string[] }
      run_phase_1_4_backfill_constraint_test: { Args: never; Returns: string[] }
      run_phase_1_4_tests: { Args: never; Returns: string[] }
      run_publication_override_tests: { Args: never; Returns: string[] }
      run_publication_reconciliation_tests: { Args: never; Returns: string[] }
      start_import_batch: {
        Args: {
          p_batch_type: Database["public"]["Enums"]["import_batch_type"]
          p_date_range_end?: string
          p_date_range_start?: string
          p_source_system: Database["public"]["Enums"]["source_system"]
          p_target_table: string
          p_triggered_by_id: string
          p_triggered_by_type: Database["public"]["Enums"]["actor_type"]
        }
        Returns: string
      }
      start_step: { Args: { p_step_id: string }; Returns: undefined }
      step_is_ready: { Args: { p_step_id: string }; Returns: boolean }
      test_impersonate: { Args: { p_app_user_id: string }; Returns: undefined }
      upsert_actual_trade: {
        Args: {
          p_analyst_id: string
          p_closed_at: string
          p_direction: Database["public"]["Enums"]["direction_type"]
          p_entry: number
          p_expiry: string
          p_historical_backfill: boolean
          p_import_batch_id: string
          p_market_id: string
          p_opportunity_id: string
          p_published_at: string
          p_raw_payload: Json
          p_recommendation_version_id: string
          p_result_r: number
          p_session: Database["public"]["Enums"]["session_type"]
          p_source_record_id: string
          p_source_system: Database["public"]["Enums"]["source_system"]
          p_stop: number
          p_target: number
          p_triggered: boolean
        }
        Returns: string
      }
      upsert_analyst_publication: {
        Args: {
          p_analyst_id: string
          p_direction: Database["public"]["Enums"]["direction_type"]
          p_entry: number
          p_import_batch_id: string
          p_market_id: string
          p_original_triggered: boolean
          p_published_at: string
          p_raw_payload: Json
          p_source_record_id: string
          p_source_system: Database["public"]["Enums"]["source_system"]
          p_stop: number
          p_target: number
        }
        Returns: string
      }
      upsert_economic_calendar_event: {
        Args: {
          p_actual: string
          p_country: string
          p_currency: string
          p_event_name: string
          p_event_time_uk: string
          p_forecast: string
          p_impact: Database["public"]["Enums"]["event_impact"]
          p_import_batch_id: string
          p_previous: string
          p_raw_payload: Json
          p_source_event_id: string
          p_source_record_id: string
          p_source_system: Database["public"]["Enums"]["source_system"]
        }
        Returns: string
      }
      upsert_market_state_daily: {
        Args: {
          p_atr14: number
          p_close: number
          p_date: string
          p_high: number
          p_import_batch_id: string
          p_low: number
          p_market_id: string
          p_open: number
          p_raw_payload: Json
          p_source_record_id: string
          p_source_system: Database["public"]["Enums"]["source_system"]
          p_zone: Database["public"]["Enums"]["atr_zone"]
        }
        Returns: string
      }
      watchdog_sweep_timed_out_steps: { Args: never; Returns: number }
    }
    Enums: {
      actor_type: "USER" | "SYSTEM"
      alignment_level: "HIGH" | "MODERATE" | "LOW"
      allocation_status:
        | "RECOMMENDED"
        | "ASSIGNED"
        | "OVERRIDDEN"
        | "UNASSIGNED"
        | "CANCELLED"
      analyst_action: "ENTER_NOW" | "WAIT_FOR_PREFERRED_ZONE" | "REVIEW_ONLY"
      api_usage_status: "SUCCESS" | "FAILED" | "RATE_LIMITED" | "TIMEOUT"
      app_role: "ANALYST" | "MANAGER" | "EXECUTIVE" | "ADMIN" | "RESEARCH"
      assigned_by_type: "SYSTEM" | "USER"
      atr_zone:
        | "TOO_DEEP"
        | "ZONE_1"
        | "ZONE_2"
        | "ZONE_3"
        | "ZONE_4"
        | "TOO_HIGH"
      audit_action:
        | "CREATE"
        | "UPDATE"
        | "DELETE"
        | "OVERRIDE"
        | "APPROVE"
        | "REGENERATE"
        | "RUN_ENGINE"
      confidence_label: "LOW" | "MEDIUM" | "HIGH"
      credential_mode:
        | "SERVICE_ROLE_SHARED"
        | "PER_PRINCIPAL_TOKEN"
        | "EXTERNAL_WORKER_SECRET"
      dependency_type: "REQUIRED" | "OPTIONAL" | "SOFT_BLOCKING"
      direction_alignment: "ALIGNED" | "PARTIAL" | "DIFFERENT"
      direction_type: "BUY" | "SELL"
      dispute_status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED"
      dispute_type:
        | "MISSED_TRIGGER"
        | "WRONG_ENTRY"
        | "WRONG_OUTCOME"
        | "OTHER"
      engine_run_status:
        | "QUEUED"
        | "RUNNING"
        | "SUCCESS"
        | "PARTIAL_SUCCESS"
        | "FAILED"
        | "CANCELLED"
        | "TIMED_OUT"
      engine_step_status:
        | "QUEUED"
        | "RUNNING"
        | "SUCCESS"
        | "FAILED"
        | "SKIPPED"
        | "RETRYING"
        | "TIMED_OUT"
      event_impact: "LOW" | "MEDIUM" | "HIGH"
      event_risk_status:
        | "NONE"
        | "WATCH"
        | "HIGH_RISK"
        | "EVENT_ACTIVE"
        | "POST_EVENT_VOLATILITY"
      fallback_type: "COACHING_NOTE" | "REVIEW_NOTE" | "WARNING_NOTE"
      import_batch_status:
        | "QUEUED"
        | "RUNNING"
        | "SUCCESS"
        | "PARTIAL_SUCCESS"
        | "FAILED"
      import_batch_type: "HISTORICAL_BACKFILL" | "INCREMENTAL_API_SYNC"
      import_error_type:
        | "VALIDATION_FAILED"
        | "DUPLICATE"
        | "SCHEMA_MISMATCH"
        | "MISSING_REQUIRED_FIELD"
        | "PROVIDER_ERROR"
      kpi_freshness: "INTRADAY" | "DAILY" | "WEEKLY" | "MONTHLY"
      kpi_visibility: "EXECUTIVE" | "MANAGER" | "ANALYST_OWN" | "RESEARCH"
      lint_status: "PASSED" | "FAILED" | "NOT_RUN"
      membership_role: "MEMBER" | "LEAD" | "OBSERVER"
      notification_severity: "INFO" | "WARNING" | "CRITICAL" | "SYSTEM_FAILURE"
      notification_status:
        | "OPEN"
        | "ACKNOWLEDGED"
        | "RESOLVED"
        | "DISMISSED"
        | "ESCALATED"
      notification_type:
        | "STALE_RECOMMENDATION"
        | "IMPORT_FAILURE"
        | "ENGINE_FAILURE"
        | "ALLOCATION_CONFLICT"
        | "CLAUDE_FAILURE"
        | "API_QUOTA_WARNING"
        | "RECALCULATION_FAILED"
        | "OTHER"
      opportunity_lifecycle_status:
        | "DRAFT"
        | "GENERATED"
        | "ASSIGNED"
        | "SHOWN"
        | "ACTIVE"
        | "CLOSED"
        | "CANCELLED"
      prompt_type:
        | "ANALYST_COACHING"
        | "POST_TRADE_REVIEW"
        | "MANAGER_SUMMARY"
        | "RESEARCH_COMMENTARY"
      quota_alert_severity: "INFO" | "WARNING" | "CRITICAL"
      quota_alert_type:
        | "COST_THRESHOLD"
        | "RATE_LIMIT_LOW"
        | "RATE_LIMITED"
        | "USAGE_SPIKE"
      recommendation_validity_status:
        | "VALID"
        | "CAUTION_VOLATILITY"
        | "STALE_PRICE"
        | "ZONE_CHANGED"
        | "ENTRY_ALREADY_PASSED"
        | "DO_NOT_USE_RECALCULATE"
        | "RECALCULATING"
        | "ARCHIVED"
      reconciliation_status:
        | "WEBHOOK_TRUE"
        | "WEBHOOK_FALSE_CONFIRMED"
        | "WEBHOOK_FALSE_OVERRIDDEN"
        | "AMBIGUOUS_MULTIPLE_MATCHES"
        | "MANUAL_OVERRIDE_TRIGGERED"
        | "MANUAL_OVERRIDE_UNTRIGGERED"
      regime_confidence: "LOW" | "MEDIUM" | "HIGH"
      regression_status: "RUNNING" | "PASSED" | "FAILED" | "PARTIAL"
      review_status:
        | "PENDING"
        | "GENERATED"
        | "ACKNOWLEDGED"
        | "MANAGER_REVIEWED"
        | "CLOSED"
      session_type: "EUROPEAN" | "US" | "APAC" | "CRYPTO"
      source_system:
        | "FINNHUB"
        | "ACUITY_CALENDAR_API"
        | "ACUITY_PERFORMANCE_API"
        | "MANUAL_BACKFILL"
        | "CLAUDE"
      team_type: "APIP" | "RESEARCH" | "MANAGEMENT" | "OTHER"
      trade_outcome_status:
        | "NOT_TRIGGERED"
        | "TRIGGERED"
        | "TARGET_HIT"
        | "STOP_HIT"
        | "EXPIRY"
        | "CANCELLED"
        | "AMBIGUOUS"
        | "CANCELLED_BEFORE_TRIGGER"
        | "CLOSED_PROFIT"
        | "CLOSED_LOSS"
      trend_state: "TRENDING_UP" | "TRENDING_DOWN" | "MIXED" | "RANGE"
      volatility_state: "LOW_VOL" | "NORMAL_VOL" | "HIGH_VOL" | "EXTREME_VOL"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      actor_type: ["USER", "SYSTEM"],
      alignment_level: ["HIGH", "MODERATE", "LOW"],
      allocation_status: [
        "RECOMMENDED",
        "ASSIGNED",
        "OVERRIDDEN",
        "UNASSIGNED",
        "CANCELLED",
      ],
      analyst_action: ["ENTER_NOW", "WAIT_FOR_PREFERRED_ZONE", "REVIEW_ONLY"],
      api_usage_status: ["SUCCESS", "FAILED", "RATE_LIMITED", "TIMEOUT"],
      app_role: ["ANALYST", "MANAGER", "EXECUTIVE", "ADMIN", "RESEARCH"],
      assigned_by_type: ["SYSTEM", "USER"],
      atr_zone: [
        "TOO_DEEP",
        "ZONE_1",
        "ZONE_2",
        "ZONE_3",
        "ZONE_4",
        "TOO_HIGH",
      ],
      audit_action: [
        "CREATE",
        "UPDATE",
        "DELETE",
        "OVERRIDE",
        "APPROVE",
        "REGENERATE",
        "RUN_ENGINE",
      ],
      confidence_label: ["LOW", "MEDIUM", "HIGH"],
      credential_mode: [
        "SERVICE_ROLE_SHARED",
        "PER_PRINCIPAL_TOKEN",
        "EXTERNAL_WORKER_SECRET",
      ],
      dependency_type: ["REQUIRED", "OPTIONAL", "SOFT_BLOCKING"],
      direction_alignment: ["ALIGNED", "PARTIAL", "DIFFERENT"],
      direction_type: ["BUY", "SELL"],
      dispute_status: ["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"],
      dispute_type: [
        "MISSED_TRIGGER",
        "WRONG_ENTRY",
        "WRONG_OUTCOME",
        "OTHER",
      ],
      engine_run_status: [
        "QUEUED",
        "RUNNING",
        "SUCCESS",
        "PARTIAL_SUCCESS",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
      ],
      engine_step_status: [
        "QUEUED",
        "RUNNING",
        "SUCCESS",
        "FAILED",
        "SKIPPED",
        "RETRYING",
        "TIMED_OUT",
      ],
      event_impact: ["LOW", "MEDIUM", "HIGH"],
      event_risk_status: [
        "NONE",
        "WATCH",
        "HIGH_RISK",
        "EVENT_ACTIVE",
        "POST_EVENT_VOLATILITY",
      ],
      fallback_type: ["COACHING_NOTE", "REVIEW_NOTE", "WARNING_NOTE"],
      import_batch_status: [
        "QUEUED",
        "RUNNING",
        "SUCCESS",
        "PARTIAL_SUCCESS",
        "FAILED",
      ],
      import_batch_type: ["HISTORICAL_BACKFILL", "INCREMENTAL_API_SYNC"],
      import_error_type: [
        "VALIDATION_FAILED",
        "DUPLICATE",
        "SCHEMA_MISMATCH",
        "MISSING_REQUIRED_FIELD",
        "PROVIDER_ERROR",
      ],
      kpi_freshness: ["INTRADAY", "DAILY", "WEEKLY", "MONTHLY"],
      kpi_visibility: ["EXECUTIVE", "MANAGER", "ANALYST_OWN", "RESEARCH"],
      lint_status: ["PASSED", "FAILED", "NOT_RUN"],
      membership_role: ["MEMBER", "LEAD", "OBSERVER"],
      notification_severity: ["INFO", "WARNING", "CRITICAL", "SYSTEM_FAILURE"],
      notification_status: [
        "OPEN",
        "ACKNOWLEDGED",
        "RESOLVED",
        "DISMISSED",
        "ESCALATED",
      ],
      notification_type: [
        "STALE_RECOMMENDATION",
        "IMPORT_FAILURE",
        "ENGINE_FAILURE",
        "ALLOCATION_CONFLICT",
        "CLAUDE_FAILURE",
        "API_QUOTA_WARNING",
        "RECALCULATION_FAILED",
        "OTHER",
      ],
      opportunity_lifecycle_status: [
        "DRAFT",
        "GENERATED",
        "ASSIGNED",
        "SHOWN",
        "ACTIVE",
        "CLOSED",
        "CANCELLED",
      ],
      prompt_type: [
        "ANALYST_COACHING",
        "POST_TRADE_REVIEW",
        "MANAGER_SUMMARY",
        "RESEARCH_COMMENTARY",
      ],
      quota_alert_severity: ["INFO", "WARNING", "CRITICAL"],
      quota_alert_type: [
        "COST_THRESHOLD",
        "RATE_LIMIT_LOW",
        "RATE_LIMITED",
        "USAGE_SPIKE",
      ],
      recommendation_validity_status: [
        "VALID",
        "CAUTION_VOLATILITY",
        "STALE_PRICE",
        "ZONE_CHANGED",
        "ENTRY_ALREADY_PASSED",
        "DO_NOT_USE_RECALCULATE",
        "RECALCULATING",
        "ARCHIVED",
      ],
      reconciliation_status: [
        "WEBHOOK_TRUE",
        "WEBHOOK_FALSE_CONFIRMED",
        "WEBHOOK_FALSE_OVERRIDDEN",
        "AMBIGUOUS_MULTIPLE_MATCHES",
        "MANUAL_OVERRIDE_TRIGGERED",
        "MANUAL_OVERRIDE_UNTRIGGERED",
      ],
      regime_confidence: ["LOW", "MEDIUM", "HIGH"],
      regression_status: ["RUNNING", "PASSED", "FAILED", "PARTIAL"],
      review_status: [
        "PENDING",
        "GENERATED",
        "ACKNOWLEDGED",
        "MANAGER_REVIEWED",
        "CLOSED",
      ],
      session_type: ["EUROPEAN", "US", "APAC", "CRYPTO"],
      source_system: [
        "FINNHUB",
        "ACUITY_CALENDAR_API",
        "ACUITY_PERFORMANCE_API",
        "MANUAL_BACKFILL",
        "CLAUDE",
      ],
      team_type: ["APIP", "RESEARCH", "MANAGEMENT", "OTHER"],
      trade_outcome_status: [
        "NOT_TRIGGERED",
        "TRIGGERED",
        "TARGET_HIT",
        "STOP_HIT",
        "EXPIRY",
        "CANCELLED",
        "AMBIGUOUS",
        "CANCELLED_BEFORE_TRIGGER",
        "CLOSED_PROFIT",
        "CLOSED_LOSS",
      ],
      trend_state: ["TRENDING_UP", "TRENDING_DOWN", "MIXED", "RANGE"],
      volatility_state: ["LOW_VOL", "NORMAL_VOL", "HIGH_VOL", "EXTREME_VOL"],
    },
  },
} as const
