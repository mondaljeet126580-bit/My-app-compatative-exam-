import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "https://mtitrkspgoqaqdeiluud.supabase.co";
function getServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed).find(Boolean);
      if (first) return first;
    } catch { /* explicit error below */ }
  }
  throw new Error("Supabase server secret is unavailable");
}
const admin = createClient(PROJECT_URL, getServiceKey(), { auth: { autoRefreshToken: false, persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-chat-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const textToBase64Url = (value: string) => bytesToBase64Url(new TextEncoder().encode(value));
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};
let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;
let cachedSigningKey: CryptoKey | null = null;
let cachedAccount: ServiceAccount | null = null;

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ServiceAccount;
    if (!value.project_id || !value.client_email || !value.private_key) return null;
    return value;
  } catch {
    return null;
  }
}

async function getSigningKey(account: ServiceAccount): Promise<CryptoKey> {
  if (cachedSigningKey && cachedAccount?.client_email === account.client_email && cachedAccount?.private_key === account.private_key) {
    return cachedSigningKey;
  }
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  cachedSigningKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedAccount = account;
  return cachedSigningKey;
}

async function getFcmAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = [
    textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    textToBase64Url(JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })),
  ].join(".");
  const signingKey = await getSigningKey(account);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(unsigned)));
  const assertion = unsigned + "." + bytesToBase64Url(signature);
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new Error("Google OAuth token exchange failed: " + clean(result.error_description || result.error || response.statusText, 300));
  }
  cachedAccessToken = String(result.access_token);
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in || 3600)) * 1000;
  return cachedAccessToken;
}

async function authenticateUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!jwt) return { user: null, error: "Sign in to ChatLink first." };
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return { user: null, error: "ChatLink session is invalid or expired." };
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,is_banned").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile) return { user: null, error: "ChatLink profile was not found." };
  if (profile.is_banned) return { user: null, error: "This account is not allowed to register push notifications." };
  return { user: data.user, error: null };
}

async function verifyWebhookSecret(req: Request): Promise<boolean> {
  const supplied = req.headers.get("x-chat-push-secret") || "";
  if (!supplied) return false;
  const { data, error } = await admin.from("chat_push_secrets").select("secret_hash").eq("id", 1).maybeSingle();
  if (error || !data?.secret_hash) return false;
  const computed = await sha256Hex(supplied);
  return constantTimeEqual(computed, String(data.secret_hash));
}

async function fcmSend(account: ServiceAccount, deviceToken: string, payload: Record<string, unknown>) {
  const bearer = await getFcmAccessToken(account);
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(account.project_id) + "/messages:send",
    {
      method: "POST",
      headers: { "Authorization": "Bearer " + bearer, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: payload.notification,
          data: payload.data,
          android: {
            priority: "HIGH",
            collapse_key: "chatlink_messages",
            ttl: "2419200s",
            notification: {
              tag: "chatlink-unread",
              notification_count: payload.unreadCount,
            },
          },
        },
      }),
    },
  );
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function updateOutbox(id: number, status: "pending" | "processing" | "sent" | "dead", errorText: string | null = null) {
  const { error } = await admin.from("chat_push_outbox").update({
    status,
    last_error: errorText ? errorText.slice(0, 1000) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

async function dispatchOutbox(outboxId: number) {
  const account = getServiceAccount();
  if (!account) {
    return { ok: false, configured: false, status: 503, error: "FCM_SERVICE_ACCOUNT_JSON secret is not configured in Supabase." };
  }

  const { data: outbox, error: outboxError } = await admin.from("chat_push_outbox")
    .select("id,message_id,recipient_user_id,conversation_id,status,attempts")
    .eq("id", outboxId).maybeSingle();
  if (outboxError) throw outboxError;
  if (!outbox) return { ok: false, status: 404, error: "Push outbox item not found." };
  if (outbox.status === "sent" || outbox.status === "dead") return { ok: true, duplicate: true, status: outbox.status };

  const { data: devices, error: devicesError } = await admin.from("chat_push_devices")
    .select("id,user_id,fcm_token,platform,is_active")
    .eq("user_id", outbox.recipient_user_id).eq("is_active", true);
  if (devicesError) throw devicesError;
  if (!devices?.length) {
    await admin.from("chat_push_outbox").update({
      status: "pending", last_error: "No active FCM token registered for this recipient.",
      updated_at: new Date().toISOString(),
    }).eq("id", outboxId);
    return { ok: true, pending: true, reason: "no_active_device" };
  }

  const { data: claimedRows, error: claimError } = await admin.rpc("chat_push_claim_outbox", { p_outbox_id: outboxId });
  if (claimError) throw claimError;
  const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!claimed) return { ok: true, duplicate: true, reason: "already_processing_or_sent" };

  try {
    const [{ data: unreadCount, error: unreadError }, { data: unreadReceipts, error: receiptError }] = await Promise.all([
      admin.rpc("chat_push_unread_count", { p_user_id: outbox.recipient_user_id }),
      admin.from("message_receipts")
        .select("message_id,created_at,messages!inner(id,conversation_id,sender_id,body,image_path,deleted_at,delete_for_everyone,created_at)")
        .eq("recipient_user_id", outbox.recipient_user_id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (unreadError) throw unreadError;
    if (receiptError) throw receiptError;
    const unread = Math.max(0, Number(unreadCount || 0));
    const receipt = Array.isArray(unreadReceipts) ? unreadReceipts[0] : null;
    const latestMessage = receipt?.messages || null;

    if (!unread || !latestMessage || latestMessage.deleted_at || latestMessage.delete_for_everyone) {
      await updateOutbox(outboxId, "sent");
      return { ok: true, sent: false, reason: "no_unread_message" };
    }

    const { data: senderProfile, error: senderError } = await admin.from("profiles")
      .select("display_name,username").eq("id", latestMessage.sender_id).maybeSingle();
    if (senderError) throw senderError;
    const senderName = clean(senderProfile?.display_name || senderProfile?.username || "New message", 80);
    const preview = latestMessage.image_path ? "📷 Photo" : clean(latestMessage.body || "New message", 150).replace(/\s+/g, " ");
    const title = unread === 1 ? "New Message" : unread + " New Messages";
    const body = unread === 1 ? senderName + ": " + preview : senderName + ": " + unread + " new messages";
    const targetUrl = "https://mondaljeet126580-bit.github.io/My-app-compatative-exam-/?chat=" + encodeURIComponent(String(latestMessage.conversation_id));

    let hasTransientFailure = false;
    let anyDeliverable = false;
    for (const device of devices) {
      const { data: existingDelivery, error: deliveryReadError } = await admin.from("chat_push_deliveries")
        .select("id,status,attempts").eq("outbox_id", outboxId).eq("device_id", device.id).maybeSingle();
      if (deliveryReadError) throw deliveryReadError;
      if (existingDelivery?.status === "sent" || existingDelivery?.status === "dead") continue;

      if (!existingDelivery) {
        const { error: createDeliveryError } = await admin.from("chat_push_deliveries").insert({
          outbox_id: outboxId, device_id: device.id, status: "pending", attempts: 0,
        });
        if (createDeliveryError && !String(createDeliveryError.message || "").includes("duplicate")) throw createDeliveryError;
      }
      await admin.from("chat_push_deliveries").update({
        attempts: Number(existingDelivery?.attempts || 0) + 1,
        status: "pending", last_error: null, updated_at: new Date().toISOString(),
      }).eq("outbox_id", outboxId).eq("device_id", device.id);

      const { response, result } = await fcmSend(account, device.fcm_token, {
        notification: { title, body },
        data: {
          type: "chat_message",
          conversation_id: String(latestMessage.conversation_id),
          message_id: String(latestMessage.id),
          sender_id: String(latestMessage.sender_id),
          unread_count: String(unread),
          click_url: targetUrl,
        },
        unreadCount: unread,
      });
      if (response.ok && result.name) {
        anyDeliverable = true;
        await admin.from("chat_push_deliveries").update({
          status: "sent", fcm_message_id: String(result.name), last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("outbox_id", outboxId).eq("device_id", device.id);
        continue;
      }

      const errorMessage = clean(result?.error?.message || response.statusText || "FCM send failed", 800);
      const errorCode = clean(result?.error?.details?.[0]?.errorCode || "", 80).toUpperCase();
      if (errorCode === "UNREGISTERED" || response.status === 404) {
        await admin.from("chat_push_devices").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
        await admin.from("chat_push_deliveries").update({
          status: "dead", last_error: errorMessage, updated_at: new Date().toISOString(),
        }).eq("outbox_id", outboxId).eq("device_id", device.id);
      } else {
        hasTransientFailure = true;
        await admin.from("chat_push_deliveries").update({
          status: "pending", last_error: errorMessage, updated_at: new Date().toISOString(),
        }).eq("outbox_id", outboxId).eq("device_id", device.id);
      }
    }

    const { data: stillPending, error: pendingError } = await admin.from("chat_push_deliveries")
      .select("id").eq("outbox_id", outboxId).eq("status", "pending").limit(1);
    if (pendingError) throw pendingError;
    if (hasTransientFailure || (stillPending && stillPending.length)) {
      await updateOutbox(outboxId, "pending", "One or more FCM deliveries need a retry.");
      return { ok: false, pending: true, sent_to_any_device: anyDeliverable };
    }
    await updateOutbox(outboxId, "sent");
    return { ok: true, sent_to_any_device: anyDeliverable, unread_count: unread };
  } catch (error) {
    await updateOutbox(outboxId, "pending", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function retryPendingForUser(userId: string, maxItems = 25) {
  const { data, error } = await admin.from("chat_push_outbox")
    .select("id").eq("recipient_user_id", userId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(maxItems);
  if (error) throw error;
  let attempted = 0;
  for (const row of data || []) {
    const result = await dispatchOutbox(Number(row.id));
    if (result.status === 503) return { attempted, configured: false, reason: result.error };
    attempted++;
  }
  return { attempted, configured: !!getServiceAccount() };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST is required." }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; }
  catch { return json({ error: "Request body must be valid JSON." }, 400); }

  const action = clean(body.action, 40).toLowerCase();
  try {
    if (action === "register_token" || action === "unregister_token" || action === "retry_pending") {
      const auth = await authenticateUser(req);
      if (!auth.user) return json({ error: auth.error }, 401);
      const userId = auth.user.id;

      if (action === "register_token") {
        const token = clean(body.token, 4096);
        const deviceId = clean(body.device_id, 160);
        const platform = clean(body.platform || "android", 20);
        if (token.length < 20 || !deviceId) return json({ error: "A valid native FCM token and device_id are required." }, 400);
        if (!["android", "ios", "web"].includes(platform)) return json({ error: "Unsupported token platform." }, 400);

        await admin.from("chat_push_devices").update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId).eq("device_id", deviceId).neq("fcm_token", token);
        const now = new Date().toISOString();
        const { error: saveError } = await admin.from("chat_push_devices").upsert({
          user_id: userId, device_id: deviceId, platform, fcm_token: token,
          is_active: true, last_seen_at: now, updated_at: now,
        }, { onConflict: "fcm_token" });
        if (saveError) throw saveError;
        const pending = await retryPendingForUser(userId, 25);
        return json({
          ok: true, registered: true, push_configured: pending.configured,
          pending_attempted: pending.attempted,
          setup_message: pending.configured ? null : "Push token saved, but FCM_SERVICE_ACCOUNT_JSON still needs to be configured in Supabase Edge Function Secrets.",
        });
      }

      if (action === "unregister_token") {
        const token = clean(body.token, 4096);
        if (!token) return json({ error: "token is required." }, 400);
        const { error } = await admin.from("chat_push_devices").update({
          is_active: false, updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("fcm_token", token);
        if (error) throw error;
        return json({ ok: true, unregistered: true });
      }

      const result = await retryPendingForUser(userId);
      return json({ ok: true, ...result }, result.configured ? 200 : 503);
    }

    const rawSecret = req.headers.get("x-chat-push-secret") || "";
    if (!rawSecret || !(await verifyWebhookSecret(req))) return json({ error: "Unauthorized push webhook." }, 401);

    const outboxId = Number(body.outbox_id);
    if (!Number.isSafeInteger(outboxId) || outboxId <= 0) return json({ error: "A valid outbox_id is required." }, 400);
    const result = await dispatchOutbox(outboxId);
    return json(result, result.status || (result.ok ? 200 : 500));
  } catch (error) {
    console.error("chat-push error", error);
    return json({ error: error instanceof Error ? error.message : "Push notification request failed." }, 500);
  }
});
