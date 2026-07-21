export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_analysis_calls: {
        Row: {
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      company_settings: {
        Row: {
          brand_accent_color: string | null;
          brand_color: string | null;
          company_address: string | null;
          company_name: string | null;
          company_phone: string | null;
          email_footer_text: string | null;
          email_notifications: boolean;
          id: string;
          logo_url: string | null;
          push_notifications: boolean;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          brand_accent_color?: string | null;
          brand_color?: string | null;
          company_address?: string | null;
          company_name?: string | null;
          company_phone?: string | null;
          email_footer_text?: string | null;
          email_notifications?: boolean;
          id?: string;
          logo_url?: string | null;
          push_notifications?: boolean;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          brand_accent_color?: string | null;
          brand_color?: string | null;
          company_address?: string | null;
          company_name?: string | null;
          company_phone?: string | null;
          email_footer_text?: string | null;
          email_notifications?: boolean;
          id?: string;
          logo_url?: string | null;
          push_notifications?: boolean;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      invite_codes: {
        Row: {
          code: string;
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          name: string | null;
          role: string;
          subcontractor_id: string | null;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by: string;
          expires_at?: string;
          id?: string;
          name?: string | null;
          role?: string;
          subcontractor_id?: string | null;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          name?: string | null;
          role?: string;
          subcontractor_id?: string | null;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invite_codes_subcontractor_id_fkey";
            columns: ["subcontractor_id"];
            isOneToOne: false;
            referencedRelation: "subcontractors";
            referencedColumns: ["id"];
          },
        ];
      };
      manager_push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "manager_push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          accent_color: string | null;
          avatar_initials: string | null;
          created_at: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          manager_id: string | null;
          role: string;
        };
        Insert: {
          accent_color?: string | null;
          avatar_initials?: string | null;
          created_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          manager_id?: string | null;
          role?: string;
        };
        Update: {
          accent_color?: string | null;
          avatar_initials?: string | null;
          created_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          manager_id?: string | null;
          role?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          subcontractor_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          subcontractor_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          subcontractor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_subcontractor_id_fkey";
            columns: ["subcontractor_id"];
            isOneToOne: false;
            referencedRelation: "subcontractors";
            referencedColumns: ["id"];
          },
        ];
      };
      report_generation_calls: {
        Row: {
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      report_schedules: {
        Row: {
          created_at: string;
          day_of_week: number | null;
          enabled: boolean | null;
          id: string;
          last_run_at: string | null;
          next_run_at: string | null;
          time_utc: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          day_of_week?: number | null;
          enabled?: boolean | null;
          id?: string;
          last_run_at?: string | null;
          next_run_at?: string | null;
          time_utc?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          day_of_week?: number | null;
          enabled?: boolean | null;
          id?: string;
          last_run_at?: string | null;
          next_run_at?: string | null;
          time_utc?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      snag_activity: {
        Row: {
          action: string;
          actor_name: string | null;
          created_at: string | null;
          from_status: string | null;
          id: string;
          snag_id: string;
          to_status: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          actor_name?: string | null;
          created_at?: string | null;
          from_status?: string | null;
          id?: string;
          snag_id: string;
          to_status?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_name?: string | null;
          created_at?: string | null;
          from_status?: string | null;
          id?: string;
          snag_id?: string;
          to_status?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "snag_activity_snag_id_fkey";
            columns: ["snag_id"];
            isOneToOne: false;
            referencedRelation: "snags";
            referencedColumns: ["id"];
          },
        ];
      };
      snag_comments: {
        Row: {
          actor_name: string | null;
          content: string;
          created_at: string | null;
          id: string;
          snag_id: string;
          user_id: string;
        };
        Insert: {
          actor_name?: string | null;
          content: string;
          created_at?: string | null;
          id?: string;
          snag_id: string;
          user_id: string;
        };
        Update: {
          actor_name?: string | null;
          content?: string;
          created_at?: string | null;
          id?: string;
          snag_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "snag_comments_snag_id_fkey";
            columns: ["snag_id"];
            isOneToOne: false;
            referencedRelation: "snags";
            referencedColumns: ["id"];
          },
        ];
      };
      snag_reports: {
        Row: {
          created_at: string;
          email_sent_at: string | null;
          id: string;
          pdf_url: string | null;
          report_period_end: string;
          report_period_start: string;
          sla_compliance_percent: number | null;
          snag_count_fixed: number | null;
          snag_count_in_progress: number | null;
          snag_count_open: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email_sent_at?: string | null;
          id?: string;
          pdf_url?: string | null;
          report_period_end: string;
          report_period_start: string;
          sla_compliance_percent?: number | null;
          snag_count_fixed?: number | null;
          snag_count_in_progress?: number | null;
          snag_count_open?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email_sent_at?: string | null;
          id?: string;
          pdf_url?: string | null;
          report_period_end?: string;
          report_period_start?: string;
          sla_compliance_percent?: number | null;
          snag_count_fixed?: number | null;
          snag_count_in_progress?: number | null;
          snag_count_open?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      snags: {
        Row: {
          category: Database["public"]["Enums"]["snag_category"];
          created_at: string | null;
          deadline_at: string | null;
          description: string;
          description_de: string | null;
          description_en: string | null;
          id: string;
          location: string;
          manager_id: string | null;
          notes: string | null;
          photo_url: string | null;
          priority: Database["public"]["Enums"]["snag_priority"] | null;
          resolution_photo_url: string | null;
          status: Database["public"]["Enums"]["snag_status"] | null;
          subcontractor_id: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          category: Database["public"]["Enums"]["snag_category"];
          created_at?: string | null;
          deadline_at?: string | null;
          description: string;
          description_de?: string | null;
          description_en?: string | null;
          id?: string;
          location: string;
          manager_id?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          priority?: Database["public"]["Enums"]["snag_priority"] | null;
          resolution_photo_url?: string | null;
          status?: Database["public"]["Enums"]["snag_status"] | null;
          subcontractor_id?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["snag_category"];
          created_at?: string | null;
          deadline_at?: string | null;
          description?: string;
          description_de?: string | null;
          description_en?: string | null;
          id?: string;
          location?: string;
          manager_id?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          priority?: Database["public"]["Enums"]["snag_priority"] | null;
          resolution_photo_url?: string | null;
          status?: Database["public"]["Enums"]["snag_status"] | null;
          subcontractor_id?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "snags_subcontractor_id_fkey";
            columns: ["subcontractor_id"];
            isOneToOne: false;
            referencedRelation: "subcontractors";
            referencedColumns: ["id"];
          },
        ];
      };
      subcontractors: {
        Row: {
          accent_color: string | null;
          auth_user_id: string | null;
          created_at: string | null;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          trade: string;
          user_id: string;
        };
        Insert: {
          accent_color?: string | null;
          auth_user_id?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          trade: string;
          user_id: string;
        };
        Update: {
          accent_color?: string | null;
          auth_user_id?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          trade?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string | null;
          current_period_ends_at: string | null;
          id: string;
          plan: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          current_period_ends_at?: string | null;
          id?: string;
          plan?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          current_period_ends_at?: string | null;
          id?: string;
          plan?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      snag_feed: {
        Row: {
          action: string | null;
          actor_name: string | null;
          category: Database["public"]["Enums"]["snag_category"] | null;
          content: string | null;
          created_at: string | null;
          from_status: string | null;
          id: string | null;
          location: string | null;
          snag_id: string | null;
          to_status: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_my_team_theme: { Args: never; Returns: Json };
      redeem_invite_code: { Args: { invite_code: string }; Returns: undefined };
      set_my_accent_color: { Args: { p_color: string }; Returns: Json };
    };
    Enums: {
      snag_category:
        "Structural" | "Electrical" | "Plumbing" | "Finishing" | "Safety";
      snag_priority: "Low" | "Medium" | "High" | "Critical";
      snag_status: "Open" | "Fixed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      snag_category: [
        "Structural",
        "Electrical",
        "Plumbing",
        "Finishing",
        "Safety",
      ],
      snag_priority: ["Low", "Medium", "High", "Critical"],
      snag_status: ["Open", "Fixed"],
    },
  },
} as const;
