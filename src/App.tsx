import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import AdminCalendar from './components/AdminCalendar'
import {
  BrowserPermission,
  InstallPromptEvent,
  Lesson,
  Profile,
  ReminderIntent,
  ReminderNotification,
  UserRole,
} from './lib/types'

type UserFormState = {
  id?: string
  full_name: string
  email: string
  password: string
  role: UserRole
  class_name: string
  speciality: string
}

type AccountFormState = {
  full_name: string
  email: string
  password: string
  confirm_password: string
}

type PendingLink = {
  lessonId: string | null
  intent: ReminderIntent | null
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
const NOTIFICATION_KEY = 'lesson-reminder-sent-keys'

const defaultUserForm = (): UserFormState => ({
  full_name: '',
  email: '',
  password: '',
  role: 'student',
  class_name: '',
  speciality: '',
})

const defaultAccountForm = (profile: Profile | null): AccountFormState => ({
  full_name: profile?.full_name ?? '',
  email: profile?.email ?? '',
  password: '',
  confirm_password: '',
})

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))

const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))

const sortByDateAsc = (a: Lesson, b: Lesson) =>
  new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()

const sortByDateDesc = (a: Lesson, b: Lesson) =>
  new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()

const minutesUntil = (from: Date, to: string) => Math.round((new Date(to).getTime() - from.getTime()) / 60000)

const statusLabel = (lesson: Lesson) => {
  if (lesson.teacher_lesson_status === 'student_no_show') return 'Student did not show up'
  if (lesson.teacher_lesson_status === 'happened') return 'Lesson happened'
  if (lesson.teacher_lesson_status === 'not_happened') return 'Lesson did not happen'
  if (lesson.student_lesson_status === 'done') return 'Student marked done'
  if (lesson.student_lesson_status === 'not_done') return 'Student marked not done'
  if (lesson.student_attendance === 'attend') return 'Student confirmed attendance'
  if (lesson.student_attendance === 'cancel') return 'Student requested cancellation'
  return 'Awaiting response'
}

const badgeClass = (value: string) => {
  if (value.includes('confirmed') || value.includes('happened') || value.includes('done')) return 'badge badge-success'
  if (value.includes('cancel') || value.includes('not happen') || value.includes('not done') || value.includes('did not show')) {
    return 'badge badge-danger'
  }
  return 'badge badge-neutral'
}

const applyIntentToLesson = (intent: ReminderIntent): Partial<Lesson> => {
  switch (intent) {
    case 'attend':
      return { student_attendance: 'attend' }
    case 'cancel':
      return { student_attendance: 'cancel' }
    case 'done':
      return { student_lesson_status: 'done' }
    case 'not_done':
      return { student_lesson_status: 'not_done' }
    case 'happened':
      return { teacher_lesson_status: 'happened' }
    case 'not_happened':
      return { teacher_lesson_status: 'not_happened' }
    case 'student_no_show':
      return { teacher_lesson_status: 'student_no_show' }
  }
}

const getStandaloneMode = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))

const getStoredNotificationKeys = () => {
  const stored = localStorage.getItem(NOTIFICATION_KEY)
  return stored ? (JSON.parse(stored) as string[]) : []
}

const storeNotificationKeys = (keys: string[]) => {
  localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(keys))
}

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <article className="summary-card">
    <span>{label}</span>
    <strong>{value}</strong>
  </article>
)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [appError, setAppError] = useState('')
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [userForm, setUserForm] = useState<UserFormState>(defaultUserForm())
  const [notificationPermission, setNotificationPermission] = useState<BrowserPermission>(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(getStandaloneMode())
  const [focusedLessonId, setFocusedLessonId] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [pendingLink, setPendingLink] = useState<PendingLink>({ lessonId: null, intent: null })
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [adminTab, setAdminTab] = useState<'users' | 'calendar' | 'management'>('users')
  const [createWithSetupLink, setCreateWithSetupLink] = useState(false)
  const [latestSetupLink, setLatestSetupLink] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState<AccountFormState>(() => defaultAccountForm(null))
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountSaved, setAccountSaved] = useState(false)
  const [managementRole, setManagementRole] = useState<'student' | 'teacher'>('student')
  const [managementUserId, setManagementUserId] = useState<string>('')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lessonId = params.get('lessonId')
    const intent = params.get('intent') as ReminderIntent | null

    if (lessonId || intent) {
      setPendingLink({ lessonId, intent })
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }

    const handleInstalled = () => {
      setInstallPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      setSession(data.session)
      setLoading(false)
    }

    void loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) throw error
    setProfile(data as Profile)
    return data as Profile
  }

  const refreshProfiles = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    if (error) throw error
    setProfiles((data ?? []) as Profile[])
  }

  const refreshLessons = async () => {
    const { data, error } = await supabase.from('lessons').select('*').order('starts_at', { ascending: true })
    if (error) throw error
    setLessons((data ?? []) as Lesson[])
  }

  useEffect(() => {
    if (!session?.user || !isSupabaseConfigured) {
      setProfile(null)
      setProfiles([])
      setLessons([])
      return
    }

    let cancelled = false

    const loadData = async () => {
      try {
        const currentProfile = await refreshProfile(session.user.id)
        if (cancelled) return
        if (currentProfile.role === 'admin') {
          await refreshProfiles()
        } else {
          setProfiles([currentProfile])
        }
        if (cancelled) return
        await refreshLessons()
        setAppError('')
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setAppError('The app could not load data from Supabase. Check the environment variables and database setup.')
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    setAccountForm(defaultAccountForm(profile))
    setAccountSaved(false)
  }, [profile?.id])

  useEffect(() => {
    if (!session?.user?.id) return

    const channel = supabase
      .channel(`db-changes-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, () => {
        void refreshLessons()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload: any) => {
        const changedId = payload?.new?.id || payload?.old?.id
        if (profile?.role === 'admin') {
          void refreshProfiles()
        }
        if (changedId && changedId === session.user.id) {
          void refreshProfile(session.user.id)
        }
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session?.user?.id, profile?.role])

  useEffect(() => {
    if (!pendingLink.lessonId || !pendingLink.intent || !session?.user) return

    const targetLesson = lessons.find((lesson) => lesson.id === pendingLink.lessonId)
    if (!targetLesson) return

    const changes = applyIntentToLesson(pendingLink.intent)
    setFocusedLessonId(pendingLink.lessonId)
    void updateLesson(targetLesson.id, changes)
    setPendingLink({ lessonId: null, intent: null })
  }, [pendingLink, lessons, session])

  const profilesById = useMemo(
    () => Object.fromEntries(profiles.map((item) => [item.id, item])),
    [profiles],
  )

  const students = profiles.filter((item) => item.role === 'student')
  const teachers = profiles.filter((item) => item.role === 'teacher')

  useEffect(() => {
    if (!managementUserId) {
      const nextId = managementRole === 'student' ? students[0]?.id : teachers[0]?.id
      if (nextId) {
        setManagementUserId(nextId)
      }
    }
  }, [managementUserId, managementRole, students, teachers])

  const managementLessons = useMemo(() => {
    if (!managementUserId) return []
    const filtered =
      managementRole === 'student'
        ? lessons.filter((lesson) => lesson.student_id === managementUserId)
        : lessons.filter((lesson) => lesson.teacher_id === managementUserId)
    return filtered.sort(sortByDateDesc)
  }, [lessons, managementRole, managementUserId])

  const managementAttended = managementLessons.filter((lesson) => lesson.student_attendance === 'attend')
  const managementCancelled = managementLessons.filter((lesson) => lesson.student_attendance === 'cancel')

  const visibleLessons = useMemo(() => {
    if (!profile) return []
    if (profile.role === 'admin') return [...lessons]
    if (profile.role === 'teacher') return lessons.filter((lesson) => lesson.teacher_id === profile.id)
    return lessons.filter((lesson) => lesson.student_id === profile.id)
  }, [lessons, profile])

  const studentPastLessons = profile?.role === 'student'
    ? visibleLessons.filter((lesson) => new Date(lesson.starts_at) < now).sort(sortByDateDesc).slice(0, 3)
    : []

  const studentUpcomingLessons = profile?.role === 'student'
    ? visibleLessons.filter((lesson) => new Date(lesson.starts_at) >= now).sort(sortByDateAsc).slice(0, 4)
    : []

  const teacherPastWeek = profile?.role === 'teacher'
    ? visibleLessons
        .filter((lesson) => {
          const lessonTime = new Date(lesson.starts_at).getTime()
          return lessonTime < now.getTime() && lessonTime >= now.getTime() - ONE_WEEK_MS
        })
        .sort(sortByDateDesc)
    : []

  const teacherUpcomingTenDays = profile?.role === 'teacher'
    ? visibleLessons
        .filter((lesson) => {
          const lessonTime = new Date(lesson.starts_at).getTime()
          return lessonTime >= now.getTime() && lessonTime <= now.getTime() + TEN_DAYS_MS
        })
        .sort(sortByDateAsc)
    : []

  const dueStudentFourHourReminders = profile?.role === 'student'
    ? visibleLessons
        .filter((lesson) => {
          const lessonTime = new Date(lesson.starts_at).getTime()
          return now.getTime() >= lessonTime - FOUR_HOURS_MS && now.getTime() < lessonTime && lesson.student_attendance === null
        })
        .sort(sortByDateAsc)
    : []

  const dueStudentStartReminders = profile?.role === 'student'
    ? visibleLessons
        .filter((lesson) => now.getTime() >= new Date(lesson.starts_at).getTime() && lesson.student_lesson_status === null)
        .sort(sortByDateAsc)
    : []

  const dueTeacherFourHourReminders = profile?.role === 'teacher'
    ? visibleLessons
        .filter((lesson) => {
          const lessonTime = new Date(lesson.starts_at).getTime()
          return now.getTime() >= lessonTime - FOUR_HOURS_MS && now.getTime() < lessonTime
        })
        .sort(sortByDateAsc)
    : []

  const dueTeacherStartReminders = profile?.role === 'teacher'
    ? visibleLessons
        .filter((lesson) => now.getTime() >= new Date(lesson.starts_at).getTime() && lesson.teacher_lesson_status === null)
        .sort(sortByDateAsc)
    : []

  const trackedLessons = lessons
    .filter(
      (lesson) =>
        lesson.student_attendance !== null || lesson.student_lesson_status !== null || lesson.teacher_lesson_status !== null,
    )
    .sort(sortByDateDesc)

  const reminderCount =
    dueStudentFourHourReminders.length +
    dueStudentStartReminders.length +
    dueTeacherFourHourReminders.length +
    dueTeacherStartReminders.length

  const dueNotifications = useMemo(() => {
    if (!profile) return []

    const reminderList: ReminderNotification[] = []

    if (profile.role === 'student') {
      for (const lesson of dueStudentFourHourReminders) {
        reminderList.push({
          key: `${profile.id}-${lesson.id}-student-4h`,
          title: 'Lesson reminder',
          body: `${lesson.subject} starts in ${minutesUntil(now, lesson.starts_at)} minutes.`,
          lessonId: lesson.id,
          userId: profile.id,
          actions: [
            { action: 'attend', title: 'I will attend' },
            { action: 'cancel', title: 'I need to cancel' },
          ],
          intentMap: { attend: 'attend', cancel: 'cancel' },
        })
      }

      for (const lesson of dueStudentStartReminders) {
        reminderList.push({
          key: `${profile.id}-${lesson.id}-student-start`,
          title: 'Class-time reminder',
          body: `${lesson.subject} is due now. Confirm whether the class was done.`,
          lessonId: lesson.id,
          userId: profile.id,
          actions: [
            { action: 'done', title: 'I did my class' },
            { action: 'not_done', title: 'I did not do it' },
          ],
          intentMap: { done: 'done', not_done: 'not_done' },
        })
      }
    }

    if (profile.role === 'teacher') {
      for (const lesson of dueTeacherFourHourReminders) {
        const student = profilesById[lesson.student_id]
        reminderList.push({
          key: `${profile.id}-${lesson.id}-teacher-4h`,
          title: 'Upcoming lesson reminder',
          body: `${student?.full_name ?? 'Student'} has ${lesson.student_attendance ?? 'not replied'} for ${lesson.subject}.`,
          lessonId: lesson.id,
          userId: profile.id,
          actions: [{ action: 'open', title: 'Open lesson' }],
          intentMap: {},
        })
      }

      for (const lesson of dueTeacherStartReminders) {
        reminderList.push({
          key: `${profile.id}-${lesson.id}-teacher-start`,
          title: 'Teacher class check',
          body: `${lesson.subject} is due now. Record what happened.`,
          lessonId: lesson.id,
          userId: profile.id,
          actions: [
            { action: 'happened', title: 'Class happened' },
            { action: 'not_happened', title: 'Did not happen' },
            { action: 'student_no_show', title: "Student didn't show" },
          ],
          intentMap: {
            happened: 'happened',
            not_happened: 'not_happened',
            student_no_show: 'student_no_show',
          },
        })
      }
    }

    return reminderList
  }, [
    dueStudentFourHourReminders,
    dueStudentStartReminders,
    dueTeacherFourHourReminders,
    dueTeacherStartReminders,
    now,
    profile,
    profilesById,
  ])

  useEffect(() => {
    if (!profile || notificationPermission !== 'granted' || !profile.push_enabled || dueNotifications.length === 0) {
      return
    }

    const storedKeys = getStoredNotificationKeys()
    const newNotifications = dueNotifications.filter((item) => !storedKeys.includes(item.key))
    if (newNotifications.length === 0) return

    const sendNotifications = async () => {
      const registration = await navigator.serviceWorker.ready

      for (const notification of newNotifications) {
        const payload = {
          title: notification.title,
          options: {
            body: notification.body,
            tag: notification.key,
            renotify: true,
            icon: '/app-icon.svg',
            badge: '/app-icon.svg',
            data: {
              baseUrl: `${window.location.origin}/?lessonId=${encodeURIComponent(notification.lessonId)}`,
              intentMap: notification.intentMap,
            },
            actions: notification.actions,
          },
        }

        if (registration.active) {
          registration.active.postMessage({ type: 'SHOW_NOTIFICATION', payload })
        } else {
          await registration.showNotification(notification.title, payload.options)
        }
      }

      storeNotificationKeys([...storedKeys, ...newNotifications.map((item) => item.key)])
    }

    void sendNotifications()
  }, [dueNotifications, notificationPermission, profile])

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setLoginError('')

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    })

    if (error) {
      setLoginError(error.message)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setFocusedLessonId(null)
  }

  const requestPushPermission = async () => {
    if (!profile || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)

    if (permission === 'granted') {
      await fetch('/api/me/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ push_enabled: true }),
      })
      await refreshProfile(profile.id)
      if (profile.role === 'admin') {
        await refreshProfiles()
      }
    }
  }

  const disablePush = async () => {
    if (!profile) return
    await fetch('/api/me/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ push_enabled: false }),
    })
    await refreshProfile(profile.id)
    if (profile.role === 'admin') {
      await refreshProfiles()
    }
  }

  const promptInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') {
      setIsStandalone(true)
      setInstallPrompt(null)
    }
  }

  const updateLesson = async (lessonId: string, changes: Partial<Lesson>) => {
    const { error } = await supabase.from('lessons').update(changes).eq('id', lessonId)
    if (error) {
      setAppError(error.message)
      return
    }
    await refreshLessons()
  }

  const callAdminUsersApi = async <T,>(action: 'create' | 'invite' | 'update' | 'delete', payload: unknown): Promise<T> => {
    if (!session?.access_token) {
      throw new Error('You are not signed in.')
    }

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, payload }),
    })

    const result = (await response.json()) as { data?: T; error?: string }
    if (!response.ok) {
      throw new Error(result.error ?? 'Request failed.')
    }

    if (!result.data) {
      throw new Error('Unexpected API response.')
    }

    return result.data
  }

  const createLessonFromDraft = async (draft: {
    subject: string
    class_name: string
    student_id: string
    teacher_id: string
    starts_at: string
    duration_minutes: number
  }) => {
    setAppError('')

    const payload = {
      ...draft,
      starts_at: /[zZ]$|[+-]\d{2}:\d{2}$/.test(draft.starts_at) ? draft.starts_at : new Date(draft.starts_at).toISOString(),
    }

    const { error } = await supabase.from('lessons').insert(payload)
    if (error) {
      setAppError(error.message)
      throw error
    }

    await refreshLessons()
  }

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault()
    setAppError('')
    setLatestSetupLink(null)

    try {
      if (createWithSetupLink) {
        const result = await callAdminUsersApi<{ profile: Profile; invite_link: string }>('invite', {
          full_name: userForm.full_name,
          email: userForm.email,
          role: userForm.role,
          class_name: userForm.class_name,
          speciality: userForm.speciality,
        })
        setLatestSetupLink(result.invite_link)
      } else {
        await callAdminUsersApi('create', userForm)
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Could not create the user.')
      return
    }

    setUserForm(defaultUserForm())
    await refreshProfiles()
  }

  const handleSaveUser = async (updatedUser: Profile & { password?: string }) => {
    setSavingUserId(updatedUser.id)
    try {
      await callAdminUsersApi('update', updatedUser)
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Could not update the user.')
      setSavingUserId(null)
      return
    }

    await refreshProfiles()
    setSavingUserId(null)
  }

  const handleDeleteUser = async (userId: string) => {
    setAppError('')
    setDeletingUserId(userId)
    const confirmed = window.confirm('Delete this user? This cannot be undone.')
    if (!confirmed) {
      setDeletingUserId(null)
      return
    }

    try {
      await callAdminUsersApi('delete', { id: userId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not delete the user.'
      if (message.includes('linked to lessons')) {
        const force = window.confirm('This user has lessons. Delete the user AND all linked lessons?')
        if (!force) {
          setAppError(message)
          setDeletingUserId(null)
          return
        }
        try {
          await callAdminUsersApi('delete', { id: userId, force: true })
        } catch (forceError) {
          setAppError(forceError instanceof Error ? forceError.message : 'Could not delete the user.')
          setDeletingUserId(null)
          return
        }
      } else {
        setAppError(message)
        setDeletingUserId(null)
        return
      }
    }

    await refreshProfiles()
    await refreshLessons()
    setDeletingUserId(null)
  }

  const createStudentLoginFromCalendar = async (draft: {
    full_name: string
    email: string
    password: string
    class_name?: string
  }) => {
    setAppError('')
    try {
      const created = await callAdminUsersApi<Profile>('create', {
        full_name: draft.full_name,
        email: draft.email,
        password: draft.password,
        role: 'student',
        class_name: draft.class_name ?? '',
        speciality: '',
      })
      await refreshProfiles()
      return created
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Could not create the student login.')
      throw error
    }
  }

  const createTeacherLoginFromCalendar = async (draft: {
    full_name: string
    email: string
    password: string
    speciality?: string
  }) => {
    setAppError('')
    try {
      const created = await callAdminUsersApi<Profile>('create', {
        full_name: draft.full_name,
        email: draft.email,
        password: draft.password,
        role: 'teacher',
        class_name: '',
        speciality: draft.speciality ?? '',
      })
      await refreshProfiles()
      return created
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Could not create the teacher login.')
      throw error
    }
  }

  const handleUpdateAccount = async (event: FormEvent) => {
    event.preventDefault()
    if (!session?.access_token) return
    if (!profile) return

    setAppError('')
    setAccountSaved(false)

    if (accountForm.password && accountForm.password !== accountForm.confirm_password) {
      setAppError('Passwords do not match.')
      return
    }

    setAccountSaving(true)
    try {
      const response = await fetch('/api/me/account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: accountForm.full_name,
          email: accountForm.email,
          password: accountForm.password || undefined,
        }),
      })

      const result = (await response.json()) as { data?: { full_name: string; email: string }; error?: string }
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not update account details.')
      }

      await refreshProfile(profile.id)
      setAccountForm((current) => ({ ...current, password: '', confirm_password: '' }))
      setAccountSaved(true)
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'Could not update account details.')
    } finally {
      setAccountSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="login-shell">
        <section className="login-panel">
          <h2>Loading app...</h2>
        </section>
      </div>
    )
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="login-shell">
        <section className="login-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Setup required</p>
              <h2>Supabase environment variables are missing</h2>
            </div>
          </div>
          <div className="install-note">
            <p className="muted">
              Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, then deploy to Vercel and
              run the demo seed script.
            </p>
          </div>
        </section>
      </div>
    )
  }

  if (!session || !profile) {
    return (
      <div className="login-shell">
        <section className="login-hero">
          <div>
            <p className="eyebrow">Welcome</p>
            <h1>Keep every class organized</h1>
            <p className="muted large-copy">
              This app helps schools, teachers, and students see upcoming classes, stay on time, and keep a clear record of what
              happened in each lesson.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <h3>See what’s next</h3>
              <p className="muted">Check upcoming classes and recent lessons in one place.</p>
            </article>
            <article className="feature-card">
              <h3>Stay on time</h3>
              <p className="muted">Get reminders before class so nobody misses an important lesson.</p>
            </article>
            <article className="feature-card">
              <h3>Keep everyone aligned</h3>
              <p className="muted">Students, teachers, and admins can each see the information that matters to them.</p>
            </article>
            <article className="feature-card">
              <h3>Track each class</h3>
              <p className="muted">Mark whether a class happened and keep a simple history of lessons.</p>
            </article>
          </div>
        </section>

        <section className="login-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Login</p>
              <h2>Sign in to your account</h2>
            </div>
          </div>

          <form className="form-card" onSubmit={handleLogin}>
            <input
              required
              type="email"
              placeholder="Email"
              value={loginForm.email}
              onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
            />
            <input
              required
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            />
            {loginError && <p className="error-text">{loginError}</p>}
            {appError && <p className="error-text">{appError}</p>}
            <button className="primary-button">Sign in</button>
          </form>

          <div className="install-note">
            <h3>Getting started</h3>
            <p className="muted">Use the email and password shared with you by your school or admin.</p>
          </div>
        </section>
      </div>
    )
  }

  const isAdmin = profile.role === 'admin'
  const isTeacher = profile.role === 'teacher'
  const isStudent = profile.role === 'student'

  const summaryCards = isAdmin
    ? [
        { label: 'Users', value: profiles.length },
        { label: 'Students', value: students.length },
        { label: 'Teachers', value: teachers.length },
        { label: 'Lessons', value: lessons.length },
      ]
    : [
        { label: 'Upcoming lessons', value: isTeacher ? teacherUpcomingTenDays.length : studentUpcomingLessons.length },
        { label: 'Past lessons', value: isTeacher ? teacherPastWeek.length : studentPastLessons.length },
        { label: 'Pending reminders', value: reminderCount },
        { label: 'Push status', value: profile.push_enabled ? 'Enabled' : 'Disabled' },
      ]

  const lessonCardClass = (lessonId: string) =>
    focusedLessonId === lessonId ? 'lesson-card lesson-card-focus' : 'lesson-card'

  return (
    <div className="app-shell final-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Signed in as {profile.role}</p>
          <h1>{profile.full_name}</h1>
          <p className="muted">
            {isAdmin && 'Manage the school users, schedule lessons, and track lesson outcomes across the whole app.'}
            {isTeacher && 'See your weekly teaching schedule and record lesson outcomes with your students.'}
            {isStudent && 'Review your lessons, respond to reminders, and mark whether classes happened.'}
          </p>
        </div>

        <div className="clock-panel">
          <p className="section-label">Live time</p>
          <h2>{formatDateTime(now.toISOString())}</h2>
          <p className="muted">Reminder cards appear automatically when the lesson enters the 4-hour window or starts.</p>
        </div>

        <div className="clock-panel">
          <p className="section-label">Device features</p>
          <div className="feature-status">
            <span>Push alerts</span>
            <strong>{notificationPermission === 'granted' && profile.push_enabled ? 'On' : 'Off'}</strong>
          </div>
          <div className="feature-status">
            <span>Install mode</span>
            <strong>{isStandalone ? 'Installed' : 'Browser'}</strong>
          </div>
          <div className="button-stack">
            {notificationPermission !== 'granted' || !profile.push_enabled ? (
              <button className="primary-button" onClick={requestPushPermission}>
                Enable push alerts
              </button>
            ) : (
              <button className="secondary-button" onClick={disablePush}>
                Disable push alerts
              </button>
            )}

            {!isStandalone && installPrompt ? (
              <button className="secondary-button" onClick={promptInstall}>
                Install app
              </button>
            ) : (
              <p className="muted tiny-copy">
                {!isStandalone
                  ? 'If Chrome does not show an install prompt yet, use Add to Home Screen from the browser menu.'
                  : 'The app is already running in installed mode.'}
              </p>
            )}
          </div>
        </div>

        <div className="clock-panel">
          <p className="section-label">Session</p>
          <p className="muted">
            Email: <span className="inline-code">{profile.email}</span>
          </p>
          <button className="danger-button full-width" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <section className="summary-grid">
          {summaryCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} />
          ))}
        </section>

        {appError && (
          <section className="panel">
            <p className="error-text">{appError}</p>
          </section>
        )}

        {isAdmin && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Admin</p>
                <h2>{adminTab === 'users' ? 'Users' : adminTab === 'calendar' ? 'Calendar' : 'Management'}</h2>
              </div>
              <div className="tab-row">
                <button
                  type="button"
                  className={adminTab === 'users' ? 'tab-button tab-button-active' : 'tab-button'}
                  onClick={() => setAdminTab('users')}
                >
                  Users
                </button>
                <button
                  type="button"
                  className={adminTab === 'calendar' ? 'tab-button tab-button-active' : 'tab-button'}
                  onClick={() => setAdminTab('calendar')}
                >
                  Calendar
                </button>
                <button
                  type="button"
                  className={adminTab === 'management' ? 'tab-button tab-button-active' : 'tab-button'}
                  onClick={() => setAdminTab('management')}
                >
                  Management
                </button>
              </div>
            </div>

            {adminTab === 'users' ? (
              <>
                <form className="form-card" onSubmit={handleCreateUser}>
                  <div className="form-grid">
                    <input
                      required
                      placeholder="Full name"
                      value={userForm.full_name}
                      onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })}
                    />
                    <input
                      required
                      type="email"
                      placeholder="Email"
                      value={userForm.email}
                      onChange={(event) => setUserForm({ ...userForm, email: event.target.value })}
                    />
                    <input
                      required={!createWithSetupLink}
                      type="password"
                      placeholder={createWithSetupLink ? 'Password (not needed)' : 'Password'}
                      value={userForm.password}
                      disabled={createWithSetupLink}
                      onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                    />
                    <select
                      value={userForm.role}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          role: event.target.value as UserRole,
                          class_name: event.target.value === 'student' ? userForm.class_name : '',
                          speciality: event.target.value !== 'student' ? userForm.speciality : '',
                        })
                      }
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                    {userForm.role === 'student' ? (
                      <input
                        required
                        placeholder="Class"
                        value={userForm.class_name}
                        onChange={(event) => setUserForm({ ...userForm, class_name: event.target.value })}
                      />
                    ) : (
                      <input
                        required
                        placeholder={userForm.role === 'teacher' ? 'Speciality' : 'Admin label'}
                        value={userForm.speciality}
                        onChange={(event) => setUserForm({ ...userForm, speciality: event.target.value })}
                      />
                    )}
                  </div>
                  <div className="calendar-form-section">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={createWithSetupLink}
                        onChange={(event) => {
                          setCreateWithSetupLink(event.target.checked)
                          if (event.target.checked) {
                            setUserForm((current) => ({ ...current, password: '' }))
                          }
                        }}
                      />
                      Create a setup link (no password yet)
                    </label>
                    <p className="muted tiny-copy">
                      You will get a link to share with the user. They’ll finish setting a password and then can sign in.
                    </p>
                  </div>
                  <button className="primary-button">Add user</button>
                </form>

                {latestSetupLink && (
                  <div className="credential-card">
                    <p className="section-label">Setup link</p>
                    <p className="muted tiny-copy">Share this link with the new user:</p>
                    <p className="inline-code" style={{ wordBreak: 'break-all' }}>
                      {latestSetupLink}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void navigator.clipboard.writeText(latestSetupLink)}
                    >
                      Copy link
                    </button>
                  </div>
                )}

                <div className="user-table">
                  {profiles.map((item) => (
                    <EditableUserRow
                      key={item.id}
                      user={item}
                      saving={savingUserId === item.id}
                      deleting={deletingUserId === item.id}
                      onSave={handleSaveUser}
                      onDelete={handleDeleteUser}
                    />
                  ))}
                </div>
              </>
            ) : adminTab === 'calendar' ? (
              <>
                <AdminCalendar
                  lessons={lessons}
                  profilesById={profilesById}
                  students={students}
                  teachers={teachers}
                  onCreateLesson={createLessonFromDraft}
                  onCreateStudentLogin={createStudentLoginFromCalendar}
                  onCreateTeacherLogin={createTeacherLoginFromCalendar}
                />

                <div className="list-stack">
                  <h3>Tracked outcomes</h3>
                  {trackedLessons.map((lesson) => (
                    <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                      <div>
                        <h3>{lesson.subject}</h3>
                        <p className="muted">
                          {profilesById[lesson.student_id]?.full_name} with {profilesById[lesson.teacher_id]?.full_name}
                        </p>
                        <p className="muted">{formatShortDate(lesson.starts_at)}</p>
                      </div>
                      <div className="status-stack">
                        <span className={badgeClass(statusLabel(lesson))}>{statusLabel(lesson)}</span>
                        <span className={badgeClass(lesson.student_attendance ? `student ${lesson.student_attendance}` : 'pending')}>
                          Student 4h: {lesson.student_attendance ?? 'pending'}
                        </span>
                        <span className={badgeClass(lesson.student_lesson_status ? `student ${lesson.student_lesson_status}` : 'pending')}>
                          Student at start: {lesson.student_lesson_status ?? 'pending'}
                        </span>
                        <span className={badgeClass(lesson.teacher_lesson_status ?? 'pending')}>
                          Teacher at start: {lesson.teacher_lesson_status ?? 'pending'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="form-card">
                  <div className="form-grid">
                    <select
                      value={managementRole}
                      onChange={(event) => {
                        const nextRole = event.target.value as 'student' | 'teacher'
                        setManagementRole(nextRole)
                        const nextId = nextRole === 'student' ? students[0]?.id : teachers[0]?.id
                        setManagementUserId(nextId ?? '')
                      }}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                    </select>

                    <select value={managementUserId} onChange={(event) => setManagementUserId(event.target.value)}>
                      {(managementRole === 'student' ? students : teachers).map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {managementRole === 'student' ? (
                  <div className="split-column">
                    <section>
                      <h3>Confirmed</h3>
                      <div className="list-stack">
                        {managementAttended.map((lesson) => (
                          <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                            <div>
                              <h3>{lesson.subject}</h3>
                              <p className="muted">{formatShortDate(lesson.starts_at)}</p>
                              <p className="muted">Teacher: {profilesById[lesson.teacher_id]?.full_name}</p>
                            </div>
                            <span className={badgeClass('confirmed')}>Confirmed</span>
                          </div>
                        ))}
                        {managementAttended.length === 0 && <p className="empty-state">No confirmed lessons yet.</p>}
                      </div>
                    </section>

                    <section>
                      <h3>Cancelled</h3>
                      <div className="list-stack">
                        {managementCancelled.map((lesson) => (
                          <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                            <div>
                              <h3>{lesson.subject}</h3>
                              <p className="muted">{formatShortDate(lesson.starts_at)}</p>
                              <p className="muted">Teacher: {profilesById[lesson.teacher_id]?.full_name}</p>
                            </div>
                            <span className={badgeClass('cancel')}>Cancelled</span>
                          </div>
                        ))}
                        {managementCancelled.length === 0 && <p className="empty-state">No cancelled lessons yet.</p>}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="list-stack">
                    <h3>Teacher lesson history</h3>
                    {managementLessons.map((lesson) => (
                      <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                        <div>
                          <h3>{lesson.subject}</h3>
                          <p className="muted">
                            {profilesById[lesson.student_id]?.full_name} · {formatShortDate(lesson.starts_at)}
                          </p>
                        </div>
                        <span className={badgeClass(statusLabel(lesson))}>{statusLabel(lesson)}</span>
                      </div>
                    ))}
                    {managementLessons.length === 0 && <p className="empty-state">No lessons found for this teacher yet.</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {isStudent && (
          <section className="panel-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Student</p>
                  <h2>Pending reminders</h2>
                </div>
              </div>

              <div className="split-column">
                <section>
                  <h3>4-hour reminders</h3>
                  <div className="list-stack">
                    {dueStudentFourHourReminders.map((lesson) => (
                      <div key={lesson.id} className={`reminder-card ${focusedLessonId === lesson.id ? 'reminder-card-focus' : ''}`}>
                        <p className="reminder-title">{lesson.subject}</p>
                        <p className="muted">
                          Starts in {minutesUntil(now, lesson.starts_at)} minutes on {formatShortDate(lesson.starts_at)}
                        </p>
                        <div className="button-row wrap">
                          <button className="primary-button" onClick={() => void updateLesson(lesson.id, { student_attendance: 'attend' })}>
                            I will attend
                          </button>
                          <button className="danger-button" onClick={() => void updateLesson(lesson.id, { student_attendance: 'cancel' })}>
                            I need to cancel
                          </button>
                        </div>
                      </div>
                    ))}
                    {dueStudentFourHourReminders.length === 0 && <p className="empty-state">No 4-hour reminders are currently due.</p>}
                  </div>
                </section>

                <section>
                  <h3>Class-time reminders</h3>
                  <div className="list-stack">
                    {dueStudentStartReminders.map((lesson) => (
                      <div key={lesson.id} className={`reminder-card ${focusedLessonId === lesson.id ? 'reminder-card-focus' : ''}`}>
                        <p className="reminder-title">{lesson.subject}</p>
                        <p className="muted">Your class is due now. Confirm whether you completed it.</p>
                        <div className="button-row wrap">
                          <button className="primary-button" onClick={() => void updateLesson(lesson.id, { student_lesson_status: 'done' })}>
                            I did my class
                          </button>
                          <button className="danger-button" onClick={() => void updateLesson(lesson.id, { student_lesson_status: 'not_done' })}>
                            I did not do it
                          </button>
                        </div>
                      </div>
                    ))}
                    {dueStudentStartReminders.length === 0 && <p className="empty-state">No class-time reminders are currently due.</p>}
                  </div>
                </section>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Student</p>
                  <h2>Lesson registry</h2>
                </div>
              </div>

              <div className="split-column">
                <section>
                  <h3>Past 3 lessons</h3>
                  <div className="list-stack">
                    {studentPastLessons.map((lesson) => (
                      <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                        <div>
                          <h3>{lesson.subject}</h3>
                          <p className="muted">
                            {formatShortDate(lesson.starts_at)} with {profilesById[lesson.teacher_id]?.full_name}
                          </p>
                        </div>
                        <span className={badgeClass(statusLabel(lesson))}>{statusLabel(lesson)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>Next 4 lessons</h3>
                  <div className="list-stack">
                    {studentUpcomingLessons.map((lesson) => (
                      <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                        <div>
                          <h3>{lesson.subject}</h3>
                          <p className="muted">
                            {formatShortDate(lesson.starts_at)} with {profilesById[lesson.teacher_id]?.full_name}
                          </p>
                        </div>
                        <span className={badgeClass(statusLabel(lesson))}>{statusLabel(lesson)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Student</p>
                  <h2>Account</h2>
                </div>
              </div>

              <form className="form-card" onSubmit={handleUpdateAccount}>
                <input
                  required
                  placeholder="Full name"
                  value={accountForm.full_name}
                  onChange={(event) => setAccountForm({ ...accountForm, full_name: event.target.value })}
                />
                <input
                  required
                  type="email"
                  placeholder="Email"
                  value={accountForm.email}
                  onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                />
                <div className="form-grid">
                  <input
                    type="password"
                    placeholder="New password (optional)"
                    value={accountForm.password}
                    onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={accountForm.confirm_password}
                    onChange={(event) => setAccountForm({ ...accountForm, confirm_password: event.target.value })}
                  />
                </div>
                {accountSaved && <p className="muted">Saved.</p>}
                <button className="primary-button" disabled={accountSaving}>
                  {accountSaving ? 'Saving...' : 'Save changes'}
                </button>
              </form>
            </article>
          </section>
        )}

        {isTeacher && (
          <section className="panel-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Teacher</p>
                  <h2>Reminder inbox</h2>
                </div>
              </div>

              <div className="split-column">
                <section>
                  <h3>4-hour reminders</h3>
                  <div className="list-stack">
                    {dueTeacherFourHourReminders.map((lesson) => (
                      <div key={lesson.id} className={`reminder-card ${focusedLessonId === lesson.id ? 'reminder-card-focus' : ''}`}>
                        <p className="reminder-title">{lesson.subject}</p>
                        <p className="muted">
                          {profilesById[lesson.student_id]?.full_name} · {formatShortDate(lesson.starts_at)}
                        </p>
                        <p className="muted">
                          Student response: {lesson.student_attendance === null ? 'Awaiting confirmation' : lesson.student_attendance}
                        </p>
                      </div>
                    ))}
                    {dueTeacherFourHourReminders.length === 0 && <p className="empty-state">No 4-hour reminders are currently due.</p>}
                  </div>
                </section>

                <section>
                  <h3>Class-time reminders</h3>
                  <div className="list-stack">
                    {dueTeacherStartReminders.map((lesson) => (
                      <div key={lesson.id} className={`reminder-card ${focusedLessonId === lesson.id ? 'reminder-card-focus' : ''}`}>
                        <p className="reminder-title">{lesson.subject}</p>
                        <p className="muted">
                          Student: {profilesById[lesson.student_id]?.full_name} · Response: {lesson.student_attendance ?? 'No 4h answer'}
                        </p>
                        <div className="button-row wrap">
                          <button className="primary-button" onClick={() => void updateLesson(lesson.id, { teacher_lesson_status: 'happened' })}>
                            Class happened
                          </button>
                          <button className="secondary-button" onClick={() => void updateLesson(lesson.id, { teacher_lesson_status: 'not_happened' })}>
                            Class did not happen
                          </button>
                          <button className="danger-button" onClick={() => void updateLesson(lesson.id, { teacher_lesson_status: 'student_no_show' })}>
                            Student didn't show up
                          </button>
                        </div>
                      </div>
                    ))}
                    {dueTeacherStartReminders.length === 0 && <p className="empty-state">No class-time reminders are currently due.</p>}
                  </div>
                </section>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Teacher</p>
                  <h2>Teaching schedule</h2>
                </div>
              </div>

              <div className="split-column">
                <section>
                  <h3>Past classes this week</h3>
                  <div className="list-stack">
                    {teacherPastWeek.map((lesson) => (
                      <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                        <div>
                          <h3>{lesson.subject}</h3>
                          <p className="muted">
                            {profilesById[lesson.student_id]?.full_name} · {formatShortDate(lesson.starts_at)}
                          </p>
                        </div>
                        <span className={badgeClass(statusLabel(lesson))}>{statusLabel(lesson)}</span>
                      </div>
                    ))}
                    {teacherPastWeek.length === 0 && <p className="empty-state">No completed or missed classes this week.</p>}
                  </div>
                </section>

                <section>
                  <h3>Upcoming 10 days</h3>
                  <div className="list-stack">
                    {teacherUpcomingTenDays.map((lesson) => (
                      <div key={lesson.id} className={lessonCardClass(lesson.id)}>
                        <div>
                          <h3>{lesson.subject}</h3>
                          <p className="muted">
                            {profilesById[lesson.student_id]?.full_name} · {formatShortDate(lesson.starts_at)}
                          </p>
                        </div>
                        <span
                          className={badgeClass(
                            lesson.student_attendance === null ? 'awaiting response' : `student ${lesson.student_attendance}`,
                          )}
                        >
                          Student: {lesson.student_attendance ?? 'waiting'}
                        </span>
                      </div>
                    ))}
                    {teacherUpcomingTenDays.length === 0 && <p className="empty-state">No upcoming classes in the next 10 days.</p>}
                  </div>
                </section>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="section-label">Teacher</p>
                  <h2>Account</h2>
                </div>
              </div>

              <form className="form-card" onSubmit={handleUpdateAccount}>
                <input
                  required
                  placeholder="Full name"
                  value={accountForm.full_name}
                  onChange={(event) => setAccountForm({ ...accountForm, full_name: event.target.value })}
                />
                <input
                  required
                  type="email"
                  placeholder="Email"
                  value={accountForm.email}
                  onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                />
                <div className="form-grid">
                  <input
                    type="password"
                    placeholder="New password (optional)"
                    value={accountForm.password}
                    onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={accountForm.confirm_password}
                    onChange={(event) => setAccountForm({ ...accountForm, confirm_password: event.target.value })}
                  />
                </div>
                {accountSaved && <p className="muted">Saved.</p>}
                <button className="primary-button" disabled={accountSaving}>
                  {accountSaving ? 'Saving...' : 'Save changes'}
                </button>
              </form>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}

function EditableUserRow({
  user,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  user: Profile
  onSave: (user: Profile & { password?: string }) => Promise<void>
  onDelete: (userId: string) => Promise<void>
  saving: boolean
  deleting: boolean
}) {
  const [draft, setDraft] = useState<Profile & { password?: string }>(user)

  useEffect(() => {
    setDraft(user)
  }, [user])

  return (
    <div className="user-row">
      <input value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} />
      <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
      <input
        placeholder="New password"
        value={draft.password ?? ''}
        onChange={(event) => setDraft({ ...draft, password: event.target.value })}
      />
      <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as UserRole })}>
        <option value="student">Student</option>
        <option value="teacher">Teacher</option>
        <option value="admin">Admin</option>
      </select>
      {draft.role === 'student' ? (
        <input value={draft.class_name} onChange={(event) => setDraft({ ...draft, class_name: event.target.value })} />
      ) : (
        <input value={draft.speciality} onChange={(event) => setDraft({ ...draft, speciality: event.target.value })} />
      )}
      <div className="button-stack">
        <button className="secondary-button" disabled={saving || deleting} onClick={() => void onSave(draft)}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="danger-button" disabled={saving || deleting} onClick={() => void onDelete(user.id)}>
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

export default App
