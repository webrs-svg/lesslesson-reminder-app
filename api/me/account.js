import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const getSupabaseAdmin = () => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase server environment variables are missing.')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' })
  }

  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return json(res, 401, { error: 'Missing bearer token.' })
    }

    const supabaseAdmin = getSupabaseAdmin()
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return json(res, 401, { error: 'Invalid session.' })
    }

    const fullName = String(req.body?.full_name ?? '').trim()
    const email = String(req.body?.email ?? '').trim()
    const password = String(req.body?.password ?? '').trim()

    if (!fullName) {
      return json(res, 400, { error: 'Full name is required.' })
    }

    if (!email || !email.includes('@')) {
      return json(res, 400, { error: 'A valid email address is required.' })
    }

    if (password && password.length < 8) {
      return json(res, 400, { error: 'Password must be at least 8 characters.' })
    }

    // Update auth user (email/password/name).
    const updateAuthPayload = {
      email,
      user_metadata: { full_name: fullName },
    }
    if (password) {
      updateAuthPayload.password = password
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.id, updateAuthPayload)
    if (authError) {
      return json(res, 400, { error: authError.message })
    }

    // Keep the profiles row in sync so admins always see the latest details.
    const { error: profileError } = await supabaseAdmin.from('profiles').update({ full_name: fullName, email }).eq('id', user.id)
    if (profileError) {
      return json(res, 400, { error: profileError.message })
    }

    return json(res, 200, { data: { id: user.id, full_name: fullName, email } })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Unexpected server error.' })
  }
}

