import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY environment variables.')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const createDate = (offsetHours) => {
  const base = new Date()
  base.setMinutes(0, 0, 0)
  return new Date(base.getTime() + offsetHours * 60 * 60 * 1000).toISOString()
}

const seedUsers = [
  {
    email: 'admin@academy.app',
    password: 'admin123',
    full_name: 'School Admin',
    role: 'admin',
    class_name: '',
    speciality: 'Operations',
  },
  {
    email: 'olivia@academy.app',
    password: 'teacher123',
    full_name: 'Olivia Carter',
    role: 'teacher',
    class_name: '',
    speciality: 'Piano',
  },
  {
    email: 'noah@academy.app',
    password: 'teacher123',
    full_name: 'Noah Brooks',
    role: 'teacher',
    class_name: '',
    speciality: 'Guitar',
  },
  {
    email: 'emma@academy.app',
    password: 'student123',
    full_name: 'Emma Lewis',
    role: 'student',
    class_name: 'Piano A',
    speciality: '',
  },
  {
    email: 'liam@academy.app',
    password: 'student123',
    full_name: 'Liam Turner',
    role: 'student',
    class_name: 'Guitar B',
    speciality: '',
  },
  {
    email: 'sophia@academy.app',
    password: 'student123',
    full_name: 'Sophia Hall',
    role: 'student',
    class_name: 'Violin A',
    speciality: '',
  },
]

const seedLessons = (ids) => [
  {
    subject: 'Piano Technique',
    class_name: 'Piano A',
    student_id: ids['emma@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(-50),
    duration_minutes: 60,
    student_attendance: 'attend',
    student_lesson_status: 'done',
    teacher_lesson_status: 'happened',
  },
  {
    subject: 'Piano Repertoire',
    class_name: 'Piano A',
    student_id: ids['emma@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(-28),
    duration_minutes: 60,
    student_attendance: 'attend',
    student_lesson_status: 'done',
    teacher_lesson_status: 'happened',
  },
  {
    subject: 'Sight Reading',
    class_name: 'Piano A',
    student_id: ids['emma@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(-3),
    duration_minutes: 60,
  },
  {
    subject: 'Piano Scales',
    class_name: 'Piano A',
    student_id: ids['emma@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(4),
    duration_minutes: 60,
  },
  {
    subject: 'Performance Coaching',
    class_name: 'Piano A',
    student_id: ids['emma@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(28),
    duration_minutes: 60,
  },
  {
    subject: 'Guitar Chords',
    class_name: 'Guitar B',
    student_id: ids['liam@academy.app'],
    teacher_id: ids['noah@academy.app'],
    starts_at: createDate(-20),
    duration_minutes: 45,
    student_attendance: 'attend',
    student_lesson_status: 'done',
    teacher_lesson_status: 'happened',
  },
  {
    subject: 'Guitar Rhythm',
    class_name: 'Guitar B',
    student_id: ids['liam@academy.app'],
    teacher_id: ids['noah@academy.app'],
    starts_at: createDate(6),
    duration_minutes: 45,
  },
  {
    subject: 'Violin Bowing',
    class_name: 'Violin A',
    student_id: ids['sophia@academy.app'],
    teacher_id: ids['olivia@academy.app'],
    starts_at: createDate(36),
    duration_minutes: 50,
  },
]

const listExistingUsers = async () => {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw error
  return data.users
}

const ensureUser = async (existingUsers, seedUser) => {
  const existing = existingUsers.find((item) => item.email?.toLowerCase() === seedUser.email.toLowerCase())

  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, {
      email: seedUser.email,
      password: seedUser.password,
      user_metadata: { full_name: seedUser.full_name },
    })

    await supabase.from('profiles').upsert({
      id: existing.id,
      email: seedUser.email,
      full_name: seedUser.full_name,
      role: seedUser.role,
      class_name: seedUser.class_name,
      speciality: seedUser.speciality,
      push_enabled: false,
    })

    return existing.id
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: seedUser.email,
    password: seedUser.password,
    email_confirm: true,
    user_metadata: { full_name: seedUser.full_name },
  })

  if (error || !data.user) {
    throw error || new Error(`Could not create ${seedUser.email}`)
  }

  await supabase.from('profiles').upsert({
    id: data.user.id,
    email: seedUser.email,
    full_name: seedUser.full_name,
    role: seedUser.role,
    class_name: seedUser.class_name,
    speciality: seedUser.speciality,
    push_enabled: false,
  })

  return data.user.id
}

const run = async () => {
  const existingUsers = await listExistingUsers()
  const ids = {}

  for (const seedUser of seedUsers) {
    ids[seedUser.email] = await ensureUser(existingUsers, seedUser)
  }

  const { data: existingLessons, error: lessonQueryError } = await supabase.from('lessons').select('id')
  if (lessonQueryError) throw lessonQueryError

  if ((existingLessons ?? []).length === 0) {
    const { error: lessonInsertError } = await supabase.from('lessons').insert(seedLessons(ids))
    if (lessonInsertError) throw lessonInsertError
  }

  console.log('Demo users and lessons are ready.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
