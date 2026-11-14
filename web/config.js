// Pagekeeper settings.
// supabaseUrl:     Supabase → Project Settings → Data API → "Project URL" (looks like https://abcd1234.supabase.co)
// supabaseAnonKey: Supabase → Project Settings → API Keys → the PUBLISHABLE key (starts with sb_publishable_)
//                  or, on older projects, the legacy "anon public" key (starts with eyJ).
// NEVER put the secret key (sb_secret_...) or the service_role key here: this file is public.
// The publishable key is safe to share: setup.sql locks every row and file to the signed-in user.
window.PK_CONFIG = {
  supabaseUrl: "https://wbhbyatmdpfgxvhicwkf.supabase.co",
  supabaseAnonKey: "sb_publishable_g7s8bxX5FS978uBoQMp9Jg_Hk_CcvHJ"
};
