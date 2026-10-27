// Public settings for cloud sync and reminders. These values are safe to publish:
// the Supabase "anon" key only works together with the database's row-level security rules,
// and a VAPID public key is meant to be shared. Leave them empty to run the app without the cloud.
export const CLOUD = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  vapidPublicKey: "",
};
