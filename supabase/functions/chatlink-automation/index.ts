import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: corsHeaders })
const url = Deno.env.get('SUPABASE_URL')!
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      if (parsed.default) return parsed.default
      const first = Object.values(parsed).find(Boolean)
      if (first) return first
    } catch { /* use explicit error below */ }
  }
  throw new Error('Supabase server secret is unavailable')
}
const admin = createClient(url, secretKey(), { auth: { autoRefreshToken: false, persistSession: false } })
const allowedScopes = ['profile:read', 'chats:read', 'messages:send'] as const
type ApiScope = typeof allowedScopes[number]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const normalize = (v: unknown) => String(v ?? '').trim()
const getBearer = (req: Request) => {
  const value = req.headers.get('authorization') || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}
function randomKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return 'cl_auto_' + encoded
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('')
}
async function sessionUser(req: Request) {
  const jwt = getBearer(req)
  if (!jwt || jwt.startsWith('cl_auto_')) return { user: null, error: 'Sign in to ChatLink before managing automation keys.' }
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) return { user: null, error: 'Your ChatLink session expired. Please sign in again.' }
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,is_banned').eq('id', data.user.id).maybeSingle()
  if (profileError || !profile) return { user: null, error: 'ChatLink profile was not found.' }
  if (profile.is_banned) return { user: null, error: 'This account is not allowed to manage API keys.' }
  return { user: data.user, error: null }
}
async function manageKeys(req: Request, action: string, body: Record<string, unknown>) {
  const auth = await sessionUser(req)
  if (!auth.user) return json({ error: auth.error }, 401)
  const ownerId = auth.user.id
  if (action === 'list_keys') {
    const { data, error } = await admin.from('chatlink_api_keys')
      .select('id,name,key_prefix,scopes,created_at,last_used_at,revoked_at')
      .eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(20)
    if (error) return json({ error: 'Could not load API keys.' }, 500)
    return json({ ok: true, keys: data || [] })
  }
  if (action === 'revoke_key') {
    const keyId = normalize(body.key_id)
    if (!uuidPattern.test(keyId)) return json({ error: 'A valid key_id is required.' }, 400)
    const { data, error } = await admin.from('chatlink_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId).eq('owner_id', ownerId).is('revoked_at', null)
      .select('id').maybeSingle()
    if (error) return json({ error: 'Could not revoke this API key.' }, 500)
    if (!data) return json({ error: 'Active API key not found.' }, 404)
    return json({ ok: true, revoked: true })
  }
  if (action === 'create_key') {
    const { count, error: countError } = await admin.from('chatlink_api_keys')
      .select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).is('revoked_at', null)
    if (countError) return json({ error: 'Could not check current API keys.' }, 500)
    if ((count ?? 0) >= 10) return json({ error: 'You can keep at most 10 active automation keys. Revoke an old key first.' }, 409)
    const name = normalize(body.name).slice(0, 60) || 'ChatLink automation'
    const requested = Array.isArray(body.scopes) ? body.scopes.map(normalize) : ['profile:read', 'chats:read']
    const scopes = [...new Set(requested)].filter((s): s is ApiScope => (allowedScopes as readonly string[]).includes(s))
    if (!scopes.length) return json({ error: 'Choose at least one API permission.' }, 400)
    const token = randomKey()
    const keyHash = await sha256(token)
    const { data, error } = await admin.from('chatlink_api_keys').insert({
      owner_id: ownerId,
      key_hash: keyHash,
      key_prefix: token.slice(0, 16),
      name,
      scopes,
    }).select('id,name,key_prefix,scopes,created_at').single()
    if (error) return json({ error: 'Could not create automation API key.' }, 500)
    return json({ ok: true, key: { ...data, token, warning: 'Copy this key now. The full token is shown only once.' } }, 201)
  }
  return json({ error: 'Unknown key-management action.' }, 400)
}
async function authenticateAutomation(req: Request) {
  const token = getBearer(req)
  if (!token.startsWith('cl_auto_')) return { key: null, error: 'Use Authorization: Bearer YOUR_CHATLINK_AUTOMATION_KEY.' }
  const hash = await sha256(token)
  const { data: key, error } = await admin.from('chatlink_api_keys')
    .select('id,owner_id,name,scopes,revoked_at,request_window_started_at,request_count')
    .eq('key_hash', hash).maybeSingle()
  if (error || !key || key.revoked_at) return { key: null, error: 'Invalid or revoked automation key.' }
  const now = new Date()
  const windowTime = key.request_window_started_at ? new Date(key.request_window_started_at).getTime() : 0
  const resetWindow = !windowTime || now.getTime() - windowTime >= 60_000
  const count = Number(key.request_count || 0)
  if (!resetWindow && count >= 60) return { key: null, error: 'Rate limit reached: 60 requests per minute per key.' , rateLimited: true }
  const nextCount = resetWindow ? 1 : count + 1
  let update = admin.from('chatlink_api_keys').update({
    last_used_at: now.toISOString(),
    request_window_started_at: resetWindow ? now.toISOString() : key.request_window_started_at,
    request_count: nextCount,
  }).eq('id', key.id).eq('request_count', count).is('revoked_at', null)
  if (!resetWindow) update = update.gte('request_window_started_at', new Date(now.getTime() - 60_000).toISOString()).lt('request_count', 60)
  const { data: updated, error: updateError } = await update.select('id').maybeSingle()
  if (updateError || !updated) return { key: null, error: 'Rate limit or concurrent request conflict. Retry shortly.', rateLimited: true }
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('id,is_banned').eq('id', key.owner_id).maybeSingle()
  if (profileError || !profile) return { key: null, error: 'ChatLink profile was not found.' }
  if (profile.is_banned) return { key: null, error: 'This account is banned.' }
  return { key, error: null }
}
function requireScope(key: { scopes: string[] }, scope: ApiScope) {
  return key.scopes.includes(scope)
}
async function listOwnChats(ownerId: string) {
  const { data: memberships, error: memberError } = await admin.from('conversation_members')
    .select('conversation_id,last_read_at,joined_at').eq('user_id', ownerId)
    .order('joined_at', { ascending: false }).limit(100)
  if (memberError) throw new Error('Could not load chat memberships.')
  const memberRows = memberships || []
  const ids = [...new Set(memberRows.map(m => m.conversation_id))]
  if (!ids.length) return []
  const [conversationsResult, allMembersResult, messagesResult] = await Promise.all([
    admin.from('conversations').select('id,is_group,is_direct,title,created_at').in('id', ids).order('created_at', { ascending: false }),
    admin.from('conversation_members').select('conversation_id,user_id,last_read_at').in('conversation_id', ids),
    admin.from('messages').select('id,conversation_id,sender_id,body,created_at,deleted_at,delete_for_everyone,image_path').in('conversation_id', ids).order('created_at', { ascending: false }).limit(1500),
  ])
  if (conversationsResult.error || allMembersResult.error || messagesResult.error) throw new Error('Could not load chat data.')
  const conversations = conversationsResult.data || []
  const allMembers = allMembersResult.data || []
  const messages = messagesResult.data || []
  const profileIds = [...new Set(allMembers.map(m => m.user_id))]
  let profiles: Array<Record<string, unknown>> = []
  if (profileIds.length) {
    const { data, error } = await admin.from('profiles').select('id,display_name,username,avatar_url,is_online').in('id', profileIds)
    if (error) throw new Error('Could not load participant profiles.')
    profiles = (data || []) as Array<Record<string, unknown>>
  }
  const profileMap = new Map(profiles.map(p => [String(p.id), p]))
  const myMembership = new Map(memberRows.map(m => [m.conversation_id, m]))
  const participants = new Map<string, Array<Record<string, unknown>>>()
  for (const m of allMembers) {
    const p = profileMap.get(m.user_id)
    if (!p) continue
    const list = participants.get(m.conversation_id) || []
    list.push({ id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, is_online: p.is_online })
    participants.set(m.conversation_id, list)
  }
  const lastMessages = new Map<string, Record<string, unknown>>()
  const unreadCounts = new Map<string, number>()
  for (const m of messages) {
    const conversationId = String(m.conversation_id)
    if (!lastMessages.has(conversationId)) {
      lastMessages.set(conversationId, {
        id: m.id, sender_id: m.sender_id, body: m.delete_for_everyone ? '' : m.body,
        created_at: m.created_at, deleted: Boolean(m.delete_for_everyone), has_image: Boolean(m.image_path),
      })
    }
    const mine = myMembership.get(conversationId)
    if (m.sender_id !== ownerId && (!mine?.last_read_at || new Date(String(m.created_at)).getTime() > new Date(String(mine.last_read_at)).getTime())) {
      unreadCounts.set(conversationId, (unreadCounts.get(conversationId) || 0) + 1)
    }
  }
  return conversations.map(c => {
    const others = (participants.get(c.id) || []).filter(p => p.id !== ownerId)
    return {
      conversation_id: c.id,
      is_group: c.is_group,
      is_direct: c.is_direct,
      title: c.title,
      participants: participants.get(c.id) || [],
      peer: others[0] || null,
      last_message: lastMessages.get(c.id) || null,
      unread_count: unreadCounts.get(c.id) || 0,
      created_at: c.created_at,
    }
  })
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Use GET or POST.' }, 405)
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try { body = await req.json() as Record<string, unknown> } catch { return json({ error: 'Request body must be valid JSON.' }, 400) }
  }
  const reqUrl = new URL(req.url)
  const action = normalize(reqUrl.searchParams.get('action') || body.action).toLowerCase()
  if (!action) return json({ error: 'Provide an action: profile, chats or send_message.' }, 400)
  try {
    if (['create_key', 'list_keys', 'revoke_key'].includes(action)) return await manageKeys(req, action, body)
    const auth = await authenticateAutomation(req)
    if (!auth.key) return json({ error: auth.error }, auth.rateLimited ? 429 : 401)
    const key = auth.key
    if (action === 'profile') {
      if (!requireScope(key, 'profile:read')) return json({ error: 'This API key does not have profile:read permission.' }, 403)
      const { data, error } = await admin.from('profiles')
        .select('id,username,display_name,avatar_url,about,created_at,last_seen,is_online')
        .eq('id', key.owner_id).maybeSingle()
      if (error || !data) return json({ error: 'Could not read your profile.' }, 500)
      return json({ ok: true, data })
    }
    if (action === 'chats') {
      if (!requireScope(key, 'chats:read')) return json({ error: 'This API key does not have chats:read permission.' }, 403)
      const chats = await listOwnChats(key.owner_id)
      return json({ ok: true, count: chats.length, data: chats })
    }
    if (action === 'send_message') {
      if (req.method !== 'POST') return json({ error: 'send_message requires POST.' }, 405)
      if (!requireScope(key, 'messages:send')) return json({ error: 'This API key does not have messages:send permission.' }, 403)
      const conversationId = normalize(body.conversation_id)
      const message = normalize(body.message)
      if (!uuidPattern.test(conversationId)) return json({ error: 'A valid conversation_id is required.' }, 400)
      if (!message || message.length > 4000) return json({ error: 'Message must contain 1–4000 characters.' }, 400)
      const { data: membership, error: membershipError } = await admin.from('conversation_members')
        .select('conversation_id').eq('conversation_id', conversationId).eq('user_id', key.owner_id).maybeSingle()
      if (membershipError || !membership) return json({ error: 'You can only send messages to a chat you belong to.' }, 403)
      const { data, error } = await admin.from('messages').insert({
        conversation_id: conversationId,
        sender_id: key.owner_id,
        body: message,
        delete_for_everyone: false,
      }).select('id,conversation_id,sender_id,body,created_at').single()
      if (error || !data) return json({ error: 'Could not send this message.' }, 500)
      return json({ ok: true, message: data }, 201)
    }
    return json({ error: 'Unknown action. Use profile, chats or send_message.' }, 400)
  } catch (e) {
    console.error('chatlink automation error', e)
    return json({ error: e instanceof Error ? e.message : 'Automation API error.' }, 500)
  }
})
