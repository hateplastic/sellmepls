import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { databaseEnv } from "@/lib/env";
export async function sessionDb() {
  const jar = await cookies();
  return createServerClient(
    databaseEnv().NEXT_PUBLIC_SUPABASE_URL,
    databaseEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server Components are read-only; proxy refreshes the session. */
          }
        },
      },
    },
  );
}
export function adminDb() {
  return createClient(
    databaseEnv().NEXT_PUBLIC_SUPABASE_URL,
    databaseEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
