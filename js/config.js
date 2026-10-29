// Public settings for cloud sync and reminders. These values are safe to publish:
// the Supabase publishable key only works together with the database's row-level security rules,
// and a VAPID public key is meant to be shared. Leave them empty to run the app without the cloud.
export const CLOUD = {
  supabaseUrl: "https://vqiuvmasnooljalqqfom.supabase.co",
  supabaseAnonKey: "sb_publishable_zXF1Jho0n1HIEspZRtc6jA_0P4VyKmV",
  vapidPublicKey: "", // push reminders are turned off
};
