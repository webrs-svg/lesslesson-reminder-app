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

const assertAdmin = async (req) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    throw new Error('Missing bearer token.')
  }

  const adminClient = getSupabaseAdmin()
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(token)

  if (userError || !user) {
    throw new Error('The session could not be verified.')
  }

  const { data: profile, error: profileError } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
  if (profileError || profile?.role !== 'admin') {
    throw new Error('Only admin users can manage school accounts.')
  }

  return adminClient
}

const createUser = async (supabaseAdmin, payload) => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { full_name: payload.full_name },
  })

  if (error || !data.user) {
    throw new Error(error?.message || 'User creation failed.')
  }

  const profilePayload = {
    id: data.user.id,
    email: payload.email,
    full_name: payload.full_name,
    role: payload.role,
    class_name: payload.role === 'student' ? payload.class_name || '' : '',
    speciality: payload.role === 'student' ? '' : payload.speciality || '',
    push_enabled: false,
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(profilePayload)
  if (profileError) {
    throw new Error(profileError.message)
  }

  return profilePayload
}

const updateUser = async (supabaseAdmin, payload) => {
  const updateAuthPayload = {
    email: payload.email,
    user_metadata: { full_name: payload.full_name },
  }

  if (payload.password) {
    updateAuthPayload.password = payload.password
  }

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(payload.id, updateAuthPayload)
  if (authError) {
    throw new Error(authError.message)
  }

  const profilePayload = {
    id: payload.id,
    email: payload.email,
    full_name: payload.full_name,
    role: payload.role,
    class_name: payload.role === 'student' ? payload.class_name || '' : '',
    speciality: payload.role === 'student' ? '' : payload.speciality || '',
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').update(profilePayload).eq('id', payload.id)
  if (profileError) {
    throw new Error(profileError.message)
  }

  return profilePayload
}

const deleteUser = async (supabaseAdmin, payload) => {
  if (!payload?.id) {
    throw new Error('Missing user id.')
  }

  const { count, error: lessonError } = await supabaseAdmin
    .from('lessons')
    .select('id', { head: true, count: 'exact' })
    .or(`student_id.eq.${payload.id},teacher_id.eq.${payload.id}`)

  if (lessonError) {
    throw new Error(lessonError.message)
  }

  const linkedLessonCount = count ?? 0

  if (linkedLessonCount > 0 && !payload.force) {
    throw new Error('You cannot delete a user who is linked to lessons.')
  }

  if (linkedLessonCount > 0 && payload.force) {
    const { error: deleteLessonsError } = await supabaseAdmin
      .from('lessons')
      .delete()
      .or(`student_id.eq.${payload.id},teacher_id.eq.${payload.id}`)

    if (deleteLessonsError) {
      throw new Error(deleteLessonsError.message)
    }
  }

  // Ensure the profile row is removed (and lessons cascade from it) even if auth deletion does not cascade as expected.
  const { error: profileDeleteError } = await supabaseAdmin.from('profiles').delete().eq('id', payload.id)
  if (profileDeleteError) {
    throw new Error(profileDeleteError.message)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(payload.id)
  if (error) {
    throw new Error(error.message)
  }

  return { id: payload.id }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' })
  }

  try {
    const supabaseAdmin = await assertAdmin(req)
    const { action, payload } = req.body || {}

    if (action === 'create') {
      const created = await createUser(supabaseAdmin, payload)
      return json(res, 200, { data: created })
    }

    if (action === 'update') {
      const updated = await updateUser(supabaseAdmin, payload)
      return json(res, 200, { data: updated })
    }

    if (action === 'delete') {
      const deleted = await deleteUser(supabaseAdmin, payload)
      return json(res, 200, { data: deleted })
    }

    return json(res, 400, { error: 'Unknown action.' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Unexpected server error.' })
  }
}
