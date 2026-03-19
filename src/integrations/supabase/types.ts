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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      processed_reservations: {
        Row: {
          arrival_date: string | null
          city: string | null
          company_name: string | null
          confirmation_number: string
          country: string | null
          created_at: string
          departure_date: string | null
          departure_month: number | null
          departure_year: number | null
          fb_revenue: number | null
          id: string
          lead_time_days: number | null
          property_name: string
          reservation_date: string | null
          room_revenue: number | null
          roomnights: number | null
          sales_channel: string | null
          state: string | null
          total_revenue: number | null
          travel_agent_name: string | null
        }
        Insert: {
          arrival_date?: string | null
          city?: string | null
          company_name?: string | null
          confirmation_number: string
          country?: string | null
          created_at?: string
          departure_date?: string | null
          departure_month?: number | null
          departure_year?: number | null
          fb_revenue?: number | null
          id?: string
          lead_time_days?: number | null
          property_name: string
          reservation_date?: string | null
          room_revenue?: number | null
          roomnights?: number | null
          sales_channel?: string | null
          state?: string | null
          total_revenue?: number | null
          travel_agent_name?: string | null
        }
        Update: {
          arrival_date?: string | null
          city?: string | null
          company_name?: string | null
          confirmation_number?: string
          country?: string | null
          created_at?: string
          departure_date?: string | null
          departure_month?: number | null
          departure_year?: number | null
          fb_revenue?: number | null
          id?: string
          lead_time_days?: number | null
          property_name?: string
          reservation_date?: string | null
          room_revenue?: number | null
          roomnights?: number | null
          sales_channel?: string | null
          state?: string | null
          total_revenue?: number | null
          travel_agent_name?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      raw_reservations: {
        Row: {
          arrival_date: string | null
          arrival_time: string | null
          city: string | null
          company_name: string | null
          confirmation_number: string | null
          country: string | null
          created_at: string
          departure_date: string | null
          departure_time: string | null
          fb_revenue: number | null
          id: string
          number_of_nights: number | null
          property_name: string | null
          rate_code: string | null
          rate_code_description: string | null
          reservation_date: string | null
          reservation_status: string | null
          room_revenue: number | null
          room_type: string | null
          source_name: string | null
          state: string | null
          total_revenue: number | null
          travel_agent_name: string | null
          upload_batch_id: string | null
        }
        Insert: {
          arrival_date?: string | null
          arrival_time?: string | null
          city?: string | null
          company_name?: string | null
          confirmation_number?: string | null
          country?: string | null
          created_at?: string
          departure_date?: string | null
          departure_time?: string | null
          fb_revenue?: number | null
          id?: string
          number_of_nights?: number | null
          property_name?: string | null
          rate_code?: string | null
          rate_code_description?: string | null
          reservation_date?: string | null
          reservation_status?: string | null
          room_revenue?: number | null
          room_type?: string | null
          source_name?: string | null
          state?: string | null
          total_revenue?: number | null
          travel_agent_name?: string | null
          upload_batch_id?: string | null
        }
        Update: {
          arrival_date?: string | null
          arrival_time?: string | null
          city?: string | null
          company_name?: string | null
          confirmation_number?: string | null
          country?: string | null
          created_at?: string
          departure_date?: string | null
          departure_time?: string | null
          fb_revenue?: number | null
          id?: string
          number_of_nights?: number | null
          property_name?: string | null
          rate_code?: string | null
          rate_code_description?: string | null
          reservation_date?: string | null
          reservation_status?: string | null
          room_revenue?: number | null
          room_type?: string | null
          source_name?: string | null
          state?: string | null
          total_revenue?: number | null
          travel_agent_name?: string | null
          upload_batch_id?: string | null
        }
        Relationships: []
      }
      upload_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          file_name: string | null
          id: string
          mode: string | null
          processed_rows: number | null
          status: string | null
          total_rows: number | null
          uploaded_by: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_name?: string | null
          id?: string
          mode?: string | null
          processed_rows?: number | null
          status?: string | null
          total_rows?: number | null
          uploaded_by: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_name?: string | null
          id?: string
          mode?: string | null
          processed_rows?: number | null
          status?: string | null
          total_rows?: number | null
          uploaded_by?: string
        }
        Relationships: []
      }
      user_hotel_permissions: {
        Row: {
          created_at: string
          id: string
          property_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_agent_breakdown: {
        Args: { p_property?: string; p_year?: number }
        Returns: {
          companies: string[]
          reservations: number
          revenue: number
          travel_agent_name: string
        }[]
      }
      get_agent_companies: {
        Args: {
          p_agent: string
          p_current_year?: number
          p_month?: number
          p_previous_year?: number
          p_property?: string
        }
        Returns: {
          absolute_change: number
          adr_current: number
          company_name: string
          pct_change: number
          revenue_current: number
          revenue_previous: number
          roomnights_current: number
        }[]
      }
      get_agent_comparison: {
        Args: {
          p_current_year?: number
          p_month?: number
          p_previous_year?: number
          p_property?: string
        }
        Returns: {
          absolute_change: number
          adr_current: number
          pct_change: number
          revenue_current: number
          revenue_previous: number
          roomnights_current: number
          travel_agent_name: string
        }[]
      }
      get_all_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          hotel_permissions: string[]
          is_active: boolean
          role: string
          user_id: string
        }[]
      }
      get_allowed_properties: { Args: { p_user_id: string }; Returns: string[] }
      get_channel_analytics: {
        Args: { p_property?: string; p_year?: number }
        Returns: {
          reservations: number
          revenue: number
          sales_channel: string
          share_pct: number
        }[]
      }
      get_channel_comparison: {
        Args: {
          p_current_year?: number
          p_month?: number
          p_previous_year?: number
          p_property?: string
        }
        Returns: {
          absolute_change: number
          pct_change: number
          revenue_current: number
          revenue_previous: number
          sales_channel: string
        }[]
      }
      get_channel_drilldown: {
        Args: {
          p_channel: string
          p_current_year?: number
          p_month?: number
          p_previous_year?: number
          p_property?: string
        }
        Returns: {
          absolute_change: number
          adr_current: number
          item_name: string
          pct_change: number
          revenue_current: number
          revenue_previous: number
          roomnights_current: number
        }[]
      }
      get_channel_drilldown_multiyear: {
        Args: { p_channel: string; p_month?: number; p_property?: string }
        Returns: {
          departure_year: number
          item_name: string
          revenue: number
          room_revenue: number
          roomnights: number
        }[]
      }
      get_channel_multiyear: {
        Args: { p_month?: number; p_property?: string }
        Returns: {
          departure_year: number
          revenue: number
          room_revenue: number
          roomnights: number
          sales_channel: string
        }[]
      }
      get_city_analytics: {
        Args: { p_channel?: string; p_property?: string; p_year?: number }
        Returns: {
          city: string
          company_count: number
          reservations: number
          revenue: number
          state: string
          top_companies: string[]
        }[]
      }
      get_company_city_analytics: {
        Args: {
          p_channel?: string
          p_month?: number
          p_property?: string
          p_year?: number
        }
        Returns: {
          city: string
          company_count: number
          revenue: number
          state: string
        }[]
      }
      get_company_city_drilldown: {
        Args: {
          p_channel?: string
          p_city: string
          p_month?: number
          p_property?: string
          p_state?: string
          p_year?: number
        }
        Returns: {
          company_name: string
          reservations: number
          revenue: number
        }[]
      }
      get_company_table: {
        Args: {
          p_channel?: string
          p_current_year?: number
          p_previous_year?: number
          p_property?: string
        }
        Returns: {
          absolute_change: number
          adr_current: number
          company_name: string
          pct_change: number
          revenue_current: number
          revenue_previous: number
          revenue_share: number
          room_revenue_current: number
          roomnights_current: number
        }[]
      }
      get_concentration_metrics: {
        Args: { p_channel?: string; p_property?: string; p_year?: number }
        Returns: {
          top1_share: number
          top3_share: number
          top5_share: number
        }[]
      }
      get_dashboard_kpis:
        | {
            Args: { p_channel?: string; p_property?: string; p_year?: number }
            Returns: {
              adr: number
              avg_lead_time: number
              total_reservations: number
              total_revenue: number
              total_roomnights: number
            }[]
          }
        | {
            Args: {
              p_channel?: string
              p_month?: number
              p_property?: string
              p_year?: number
            }
            Returns: {
              adr: number
              avg_lead_time: number
              total_reservations: number
              total_revenue: number
              total_roomnights: number
            }[]
          }
      get_filter_options: {
        Args: never
        Returns: {
          channels: string[]
          properties: string[]
          years: number[]
        }[]
      }
      get_guest_city_analytics: {
        Args: {
          p_channel?: string
          p_month?: number
          p_property?: string
          p_year?: number
        }
        Returns: {
          city: string
          reservations: number
          revenue: number
          roomnights: number
          state: string
        }[]
      }
      get_guest_city_drilldown: {
        Args: {
          p_channel?: string
          p_city: string
          p_month?: number
          p_property?: string
          p_state?: string
          p_year?: number
        }
        Returns: {
          entity_name: string
          entity_type: string
          revenue: number
          roomnights: number
        }[]
      }
      get_monthly_revenue: {
        Args: { p_channel?: string; p_property?: string; p_year?: number }
        Returns: {
          month: number
          reservations: number
          revenue: number
          year: number
        }[]
      }
      get_particular_debug: {
        Args: { p_month?: number; p_property?: string; p_year?: number }
        Returns: Json
      }
      has_any_users: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      process_reservations: {
        Args: { p_batch_id?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "master_admin" | "editor" | "viewer"
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
      app_role: ["master_admin", "editor", "viewer"],
    },
  },
} as const
