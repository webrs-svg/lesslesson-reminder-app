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

const assertAuthenticated = async (req) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    throw new Error('Missing bearer token.')
  }

  const supabaseAdmin = getSupabaseAdmin()
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token)

  if (userError || !user) {
    throw new Error('The session could not be verified.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).single()
  if (profileError || !profile) {
    throw new Error('The profile could not be loaded.')
  }

  return { supabaseAdmin, user, profile }
}

const ensureTeacherPermission = (profile, teacherId) => {
  if (profile.role === 'admin') return
  if (profile.role !== 'teacher') {
    throw new Error('Only admin and teachers can manage classes here.')
  }
  if (teacherId !== profile.id) {
    throw new Error('Teachers can only manage their own classes.')
  }
}

const createGroup = async (supabaseAdmin, profile, payload) => {
  const studentIds = Array.from(new Set((payload.student_ids ?? []).filter(Boolean)))
  const teacherId = payload.teacher_id
  ensureTeacherPermission(profile, teacherId)

  if (!payload.subject?.trim()) {
    throw new Error('Subject is required.')
  }
  if (!payload.starts_at) {
    throw new Error('Start time is required.')
  }
  if (!studentIds.length) {
    throw new Error('At least one student is required.')
  }

  const rows = studentIds.map((studentId) => ({
    subject: payload.subject.trim(),
    class_name: payload.class_name ?? '',
    student_id: studentId,
    teacher_id: teacherId,
    starts_at: payload.starts_at,
    duration_minutes: Number(payload.duration_minutes) || 60,
  }))

  const { data, error } = await supabaseAdmin.from('lessons').insert(rows).select('*')
  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

const updateGroup = async (supabaseAdmin, profile, payload) => {
  const lessonIds = Array.from(new Set((payload.lesson_ids ?? []).filter(Boolean)))
  if (!lessonIds.length) {
    throw new Error('No lessons were selected.')
  }

  const { data: existingLessons, error: lessonsError } = await supabaseAdmin.from('lessons').select('*').in('id', lessonIds)
  if (lessonsError) {
    throw new Error(lessonsError.message)
  }
  if (!existingLessons?.length) {
    throw new Error('The selected class could not be found.')
  }

  const currentTeacherId = existingLessons[0].teacher_id
  const nextTeacherId = payload.teacher_id || currentTeacherId
  ensureTeacherPermission(profile, currentTeacherId)
  ensureTeacherPermission(profile, nextTeacherId)

  const sharedUpdate = {
    subject: String(payload.subject ?? existingLessons[0].subject).trim(),
    class_name: String(payload.class_name ?? existingLessons[0].class_name),
    teacher_id: nextTeacherId,
    starts_at: payload.starts_at ?? existingLessons[0].starts_at,
    duration_minutes: Number(payload.duration_minutes) || existingLessons[0].duration_minutes,
  }

  const { error: updateError } = await supabaseAdmin.from('lessons').update(sharedUpdate).in('id', lessonIds)
  if (updateError) {
    throw new Error(updateError.message)
  }

  const existingStudentIds = new Set(existingLessons.map((lesson) => lesson.student_id))
  const newStudentIds = Array.from(new Set((payload.student_ids ?? []).filter(Boolean))).filter((id) => !existingStudentIds.has(id))

  if (newStudentIds.length) {
    const insertedRows = newStudentIds.map((studentId) => ({
      ...sharedUpdate,
      student_id: studentId,
    }))
    const { error: insertError } = await supabaseAdmin.from('lessons').insert(insertedRows)
    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  const finalStudentIds = Array.from(new Set([...existingStudentIds, ...newStudentIds]))
  const { data: refreshedLessons, error: refreshError } = await supabaseAdmin
    .from('lessons')
    .select('*')
    .eq('teacher_id', nextTeacherId)
    .eq('starts_at', sharedUpdate.starts_at)
    .eq('subject', sharedUpdate.subject)
    .eq('duration_minutes', sharedUpdate.duration_minutes)
    .in('student_id', finalStudentIds)

  if (refreshError) {
    throw new Error(refreshError.message)
  }

  return refreshedLessons ?? []
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' })
  }

  try {
    const { supabaseAdmin, profile } = await assertAuthenticated(req)
    const { action, payload } = req.body || {}

    if (action === 'create_group') {
      const created = await createGroup(supabaseAdmin, profile, payload)
      return json(res, 200, { data: created })
    }

    if (action === 'update_group') {
      const updated = await updateGroup(supabaseAdmin, profile, payload)
      return json(res, 200, { data: updated })
    }

    return json(res, 400, { error: 'Unknown action.' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Unexpected server error.' })
  }
}

