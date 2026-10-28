import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGINS = new Set([
  "https://mondaljeet126580-bit.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "null"
]);
const clean = (v: unknown, max = 240) => typeof v === "string" ? v.trim().slice(0, max) : "";
const norm = (v: unknown, max = 240) => clean(v, max).toLowerCase();
const deletedMessage = "এই ChatLink অ্যাকাউন্টটি অ্যাডমিন মুছে দিয়েছেন। অন্য অ্যাকাউন্ট দিয়ে লগইন করুন অথবা নতুন অ্যাকাউন্ট তৈরি করুন।";
const bannedMessage = "এই ChatLink অ্যাকাউন্টটি অ্যাডমিন ব্যান করেছেন। অ্যাডমিন ব্যান তুলে দিলে আবার এই অ্যাকাউন্ট ব্যবহার করতে পারবেন।";

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function out(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
const hasGoogle = (user: any) => {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  return identities.some((i: any) => i?.provider === "google") || providers.includes("google") || user?.app_metadata?.provider === "google";
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return out({ status: "error", message: "শুধু POST request গ্রহণ করা হয়।" }, 405, origin);
  if (!URL || !ANON || !SERVICE) return out({ status: "error", message: "Account Auth-এর server configuration অসম্পূর্ণ।" }, 500, origin);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicAuth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

  async function tombstoneByEmail(email: string) {
    if (!email) return null;
    const { data, error } = await admin.from("account_tombstones")
      .select("id,original_user_id,username,display_name,email_norm,deletion_reason,deleted_at")
      .eq("email_norm", norm(email, 320)).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function tombstoneByUsername(username: string) {
    if (!username) return null;
    const { data, error } = await admin.from("account_tombstones")
      .select("id,original_user_id,username,display_name,email_norm,deletion_reason,deleted_at")
      .eq("username_norm", norm(username, 30)).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function accountState(user: any) {
    const tombstone = await tombstoneByEmail(user?.email ?? "");
    if (tombstone) {
      // A Google sign-in after an admin deletion can cause Auth to create a fresh
      // user ID for the same email. Remove its profile so RLS defaults to denied.
      if (tombstone.original_user_id !== user.id) {
        const { error: profileDeleteError } = await admin.from("profiles").delete().eq("id", user.id);
        if (profileDeleteError) console.error("deleted-account profile cleanup", profileDeleteError.message);
      }
      return { status: "deleted", message: deletedMessage, reason: tombstone.deletion_reason ?? null };
    }
    const { data: profile, error } = await admin.from("profiles")
      .select("id,username,display_name,is_banned,ban_reason,banned_at,password_login_enabled")
      .eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (profile?.is_banned) return { status: "banned", message: bannedMessage, reason: profile.ban_reason ?? null, profile };
    return { status: "ok", profile: profile ?? null, googleLinked: hasGoogle(user) };
  }
  async function requireUser(req: Request) {
    const header = req.headers.get("Authorization") ?? "";
    const jwt = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!jwt) return { user: null, error: "লগইন সেশন পাওয়া যায়নি।", deletedState: null };
    const { data, error } = await publicAuth.auth.getUser(jwt);
    if (error || !data.user) {
      // If an administrator removed the auth user while this browser still held a
      // previously valid JWT, use its subject only to look up a tombstone. No access
      // is granted from this unverified claim; it can only display a deletion banner.
      let subject = "";
      try {
        const payloadPart = jwt.split(".")[1];
        if (payloadPart) {
          const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
          const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
          subject = typeof decoded.sub === "string" ? decoded.sub : "";
        }
      } catch {}
      if (/^[0-9a-f-]{36}$/i.test(subject)) {
        const { data: tombstone, error: tombstoneError } = await admin.from("account_tombstones")
          .select("id,deletion_reason").eq("original_user_id", subject).maybeSingle();
        if (tombstoneError) throw tombstoneError;
        if (tombstone) return { user: null, error: null, deletedState: { status: "deleted", message: deletedMessage, reason: tombstone.deletion_reason ?? null } };
      }
      return { user: null, error: "লগইন সেশন বৈধ নয়। আবার লগইন করুন।", deletedState: null };
    }
    return { user: data.user, error: null, deletedState: null };
  }

  try {
    const input = await req.json().catch(() => ({}));
    const action = clean(input.action, 40);

    if (action === "login") {
      const identifier = clean(input.identifier ?? input.username, 120);
      const password = typeof input.password === "string" ? input.password : "";
      if (!identifier || !password) return out({ status: "invalid_credentials", message: "Username/নাম এবং password লিখুন।" }, 400, origin);
      if (/[%,*()]/.test(identifier)) return out({ status: "invalid_credentials", message: "Username বা নামটি সঠিক নয়।" }, 400, origin);

      let { data: profile, error: profileError } = await admin.from("profiles")
        .select("id,username,display_name,is_banned,ban_reason,banned_at,password_login_enabled")
        .eq("username", identifier.toLowerCase()).maybeSingle();
      if (profileError) throw profileError;

      if (!profile) {
        const { data: byName, error: byNameError } = await admin.from("profiles")
          .select("id,username,display_name,is_banned,ban_reason,banned_at,password_login_enabled")
          .ilike("display_name", identifier).limit(2);
        if (byNameError) throw byNameError;
        if ((byName ?? []).length > 1) {
          return out({ status: "ambiguous_name", message: "এই নাম একাধিক ইউজার ব্যবহার করছেন। Username দিয়ে লগইন করুন।" }, 200, origin);
        }
        profile = (byName ?? [])[0] ?? null;
      }

      if (!profile) {
        const tombstone = await tombstoneByUsername(identifier);
        if (tombstone) return out({ status: "deleted", message: deletedMessage, reason: tombstone.deletion_reason ?? null }, 200, origin);
        // Display name can be used only when it uniquely identifies one old tombstone.
        const { data: deletedNames, error: deletedNamesError } = await admin.from("account_tombstones")
          .select("id,deletion_reason").ilike("display_name", identifier).limit(2);
        if (deletedNamesError) throw deletedNamesError;
        if ((deletedNames ?? []).length === 1) return out({ status: "deleted", message: deletedMessage, reason: deletedNames[0].deletion_reason ?? null }, 200, origin);
        return out({ status: "invalid_credentials", message: "Username/নাম অথবা password ভুল।" }, 200, origin);
      }

      if (!profile.password_login_enabled) {
        return out({ status: "google_required", message: "এই অ্যাকাউন্টে এখনও password সেট করা হয়নি। Google দিয়ে লগইন করে account setup সম্পূর্ণ করুন।" }, 200, origin);
      }
      const { data: authData, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
      if (authUserError || !authData.user?.email) return out({ status: "invalid_credentials", message: "Username/নাম অথবা password ভুল।" }, 200, origin);

      const { data: loginData, error: loginError } = await publicAuth.auth.signInWithPassword({
        email: authData.user.email,
        password
      });
      if (loginError || !loginData.session || !loginData.user) {
        return out({ status: "invalid_credentials", message: "Username/নাম অথবা password ভুল।" }, 200, origin);
      }

      // Recheck the moderation state after password verification. Do not give out a
      // session to a user banned during the login attempt.
      const state = await accountState(loginData.user);
      if (state.status !== "ok") {
        await publicAuth.auth.signOut({ scope: "local" });
        return out(state, 200, origin);
      }
      const s = loginData.session;
      return out({
        status: "ok",
        session: {
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at,
          expires_in: s.expires_in,
          token_type: s.token_type
        }
      }, 200, origin);
    }

    if (action === "status" || action === "setup") {
      const { user, error: userError, deletedState } = await requireUser(req);
      if (deletedState) return out(deletedState, 200, origin);
      if (userError || !user) return out({ status: "unauthenticated", message: userError }, 401, origin);

      const state = await accountState(user);
      if (state.status !== "ok") return out(state, 200, origin);
      if (action === "status") return out(state, 200, origin);

      if (!hasGoogle(user)) {
        return out({ status: "google_required", message: "প্রথমে Google দিয়ে লগইন বা Connect Google account করুন।" }, 200, origin);
      }
      if (!user.email || !user.email_confirmed_at) {
        return out({ status: "google_required", message: "ভেরিফাই করা Google account দরকার।" }, 200, origin);
      }

      const displayName = clean(input.displayName, 40);
      const username = norm(input.username, 30);
      const password = typeof input.password === "string" ? input.password : "";
      if (displayName.length < 1) return out({ status: "validation_error", field: "displayName", message: "নিজের নাম লিখুন।" }, 200, origin);
      if (!/^[a-z0-9_]{3,30}$/.test(username)) return out({ status: "validation_error", field: "username", message: "Username ৩–৩০ অক্ষর হবে; শুধু a-z, 0-9 ও underscore ব্যবহার করুন।" }, 200, origin);
      if (password.length < 8 || password.length > 72) return out({ status: "validation_error", field: "password", message: "Password কমপক্ষে ৮ এবং সর্বোচ্চ ৭২ অক্ষর হতে হবে।" }, 200, origin);

      const reserved = await tombstoneByUsername(username);
      if (reserved) return out({ status: "username_taken", message: "এই username-টি আগে মুছে ফেলা অ্যাকাউন্টে ছিল। অন্য username বেছে নিন।" }, 200, origin);
      const { data: taken, error: takenError } = await admin.from("profiles")
        .select("id").eq("username", username).neq("id", user.id).maybeSingle();
      if (takenError) throw takenError;
      if (taken) return out({ status: "username_taken", message: "এই username ইতিমধ্যে ব্যবহার হচ্ছে। অন্য username বেছে নিন।" }, 200, origin);

      const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password });
      if (passwordError) return out({ status: "setup_error", message: "Password save করা যায়নি। আবার চেষ্টা করুন।" }, 400, origin);

      const { data: saved, error: saveError } = await admin.from("profiles").upsert({
        id: user.id,
        display_name: displayName,
        username,
        password_login_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" }).select("id,username,display_name,is_banned,ban_reason,banned_at,password_login_enabled").single();
      if (saveError) throw saveError;
      if (saved.is_banned) return out({ status: "banned", message: bannedMessage, reason: saved.ban_reason ?? null }, 200, origin);

      // Updating a password with the service role may leave the browser holding
      // an old session/refresh token. Sign in again immediately and return a fresh
      // session for this same Auth user so the client can continue loading chats.
      const { data: refreshedLogin, error: refreshedLoginError } = await publicAuth.auth.signInWithPassword({
        email: user.email,
        password
      });
      if (refreshedLoginError || !refreshedLogin.session || refreshedLogin.user?.id !== user.id) {
        console.error("setup session renewal failed", refreshedLoginError?.message ?? "no session or user ID mismatch");
        return out({
          status: "session_refresh_required",
          message: "Password ও profile save হয়েছে, কিন্তু session refresh হয়নি। Existing user হিসেবে username এবং নতুন password দিয়ে একবার লগইন করুন।",
          profile: saved
        }, 200, origin);
      }

      const fresh = refreshedLogin.session;
      return out({
        status: "ok",
        profile: saved,
        googleLinked: true,
        session: {
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token,
          expires_at: fresh.expires_at,
          expires_in: fresh.expires_in,
          token_type: fresh.token_type
        }
      }, 200, origin);
    }

    return out({ status: "error", message: "অজানা account-auth action।" }, 400, origin);
  } catch (error) {
    console.error("chatlink-account-auth", error);
    return out({ status: "error", message: "Account Auth-এ সমস্যা হয়েছে। আবার চেষ্টা করুন।" }, 500, origin);
  }
});
