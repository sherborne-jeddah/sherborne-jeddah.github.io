// Public app configuration. The publishable (anon) key is meant to be shipped in the browser;
// access is enforced by sign-in and Row Level Security in the database.
// NEVER put the secret / service_role key or the database password here.
window.CCA_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR-PUBLISHABLE-KEY",
  APP_VERSION: "1.1.0",
};
