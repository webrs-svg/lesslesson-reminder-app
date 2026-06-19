export type UserRole = 'admin' | 'teacher' | 'student'

export type StudentAttendance = 'attend' | 'cancel' | null
export type StudentLessonStatus = 'done' | 'not_done' | null
export type TeacherLessonStatus = 'happened' | 'not_happened' | 'student_no_show' | null
export type BrowserPermission = NotificationPermission | 'unsupported'
export type ReminderIntent =
  | 'attend'
  | 'cancel'
  | 'done'
  | 'not_done'
  | 'happened'
  | 'not_happened'
  | 'student_no_show'

export type Profile = {
  id: string
  email: string
  full_name: string
  role: UserRole
  class_name: string
  speciality: string
  push_enabled: boolean
  created_at?: string
}

export type Lesson = {
  id: string
  subject: string
  class_name: string
  student_id: string
  teacher_id: string
  starts_at: string
  duration_minutes: number
  student_attendance: StudentAttendance
  student_lesson_status: StudentLessonStatus
  teacher_lesson_status: TeacherLessonStatus
  created_at?: string
}

export type ReminderNotification = {
  key: string
  title: string
  body: string
  lessonId: string
  userId: string
  actions: { action: string; title: string }[]
  intentMap: Record<string, ReminderIntent>
}

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
