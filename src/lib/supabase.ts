import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqdnZveHh3ZXZ3Z3ppdXhqdmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTI4ODcsImV4cCI6MjEwNjE2ODg4N30.gbB_4BbEckhNlh8EjDd8Z8JiqoknEQzP-Ca0Pi_c4bc';

export const supabase = createClient(supabaseUrl, supabaseKey);
