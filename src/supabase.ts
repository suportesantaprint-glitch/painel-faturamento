import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.POSTGRES_HOST as string;
const supabaseAnonKey = process.env.POSTGRES_PASSWORD as string;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
