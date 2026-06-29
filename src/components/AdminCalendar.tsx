import { FormEvent, useMemo, useState } from 'react'
import type { Lesson, Profile } from '../lib/types'

type LessonDraft = {
  subject: string
  starts_at: string
  duration_minutes: number
  student_id: string
  teacher_id: string
  class_name: string
}

type NewUserDraft = {
  full_name: string
  email: string
  password: string
  class_name?: string
  speciality?: string
}

const pad2 = (value: number) => value.toString().padStart(2, '0')

const startOfWeekMonday = (date: Date) => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay() // 0=Sun
  const mondayOffset = (day + 6) % 7
  copy.setDate(copy.getDate() - mondayOffset)
  return copy
}

const addDays = (date: Date, days: number) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

const toDateTimeLocal = (date: Date) => {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  return `${year}-${month}-${day}T${hour}:${minute}`
}

const formatWeekLabel = (weekStart: Date) => {
  const weekEnd = addDays(weekStart, 6)
  const formatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' })
  return `${formatter.format(weekStart)} - ${formatter.format(weekEnd)}`
}

export default function AdminCalendar({
  lessons,
  profilesById,
  students,
  teachers,
  onCreateLesson,
  onCreateStudentLogin,
  onCreateTeacherLogin,
}: {
  lessons: Lesson[]
  profilesById: Record<string, Profile>
  students: Profile[]
  teachers: Profile[]
  onCreateLesson: (draft: LessonDraft) => Promise<void>
  onCreateStudentLogin: (draft: NewUserDraft) => Promise<Profile>
  onCreateTeacherLogin: (draft: NewUserDraft) => Promise<Profile>
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()))
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)

  const [draft, setDraft] = useState<LessonDraft>(() => ({
    subject: '',
    starts_at: '',
    duration_minutes: 60,
    student_id: students[0]?.id ?? '',
    teacher_id: teachers[0]?.id ?? '',
    class_name: students[0]?.class_name ?? '',
  }))

  const [createStudent, setCreateStudent] = useState(false)
  const [createTeacher, setCreateTeacher] = useState(false)
  const [studentDraft, setStudentDraft] = useState<NewUserDraft>({ full_name: '', email: '', password: '', class_name: '' })
  const [teacherDraft, setTeacherDraft] = useState<NewUserDraft>({ full_name: '', email: '', password: '', speciality: '' })

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])

  const dayLabels = useMemo(
    () =>
      days.map((day) => ({
        key: day.toISOString(),
        short: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day),
        day: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(day),
      })),
    [days],
  )

  const slotMinutes = 30
  const startHour = 6
  const endHour = 22
  const slotCount = ((endHour - startHour) * 60) / slotMinutes
  const slots = useMemo(() => Array.from({ length: slotCount }, (_, idx) => startHour * 60 + idx * slotMinutes), [slotCount])

  const weekEnd = useMemo(() => {
    const end = addDays(weekStart, 7)
    return end.getTime()
  }, [weekStart])

  const lessonsThisWeek = useMemo(() => {
    const start = weekStart.getTime()
    return lessons.filter((lesson) => {
      const value = new Date(lesson.starts_at).getTime()
      return value >= start && value < weekEnd
    })
  }, [lessons, weekStart, weekEnd])

  const lessonsByDay = useMemo(() => {
    const grouped: Record<string, Lesson[]> = {}
    for (const day of days) {
      grouped[day.toDateString()] = []
    }
    for (const lesson of lessonsThisWeek) {
      const key = new Date(lesson.starts_at).toDateString()
      grouped[key] = grouped[key] ? [...grouped[key], lesson] : [lesson]
    }
    return grouped
  }, [days, lessonsThisWeek])

  const openCreate = (day: Date, minutesFromMidnight: number) => {
    const selected = new Date(day)
    selected.setHours(0, 0, 0, 0)
    selected.setMinutes(minutesFromMidnight)
    setDraft((current) => ({
      ...current,
      starts_at: toDateTimeLocal(selected),
    }))
    setCreateStudent(false)
    setCreateTeacher(false)
    setStudentDraft({ full_name: '', email: '', password: '', class_name: '' })
    setTeacherDraft({ full_name: '', email: '', password: '', speciality: '' })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setSaving(false)
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      let studentId = draft.student_id
      let teacherId = draft.teacher_id
      let className = draft.class_name

      if (createStudent) {
        const createdStudent = await onCreateStudentLogin(studentDraft)
        studentId = createdStudent.id
        className = createdStudent.class_name
      } else {
        className = profilesById[studentId]?.class_name ?? className
      }

      if (createTeacher) {
        const createdTeacher = await onCreateTeacherLogin(teacherDraft)
        teacherId = createdTeacher.id
      }

      await onCreateLesson({
        ...draft,
        student_id: studentId,
        teacher_id: teacherId,
        class_name: className,
      })

      closeModal()
    } catch (error) {
      // Let the parent show error text (appError)
      setSaving(false)
    }
  }

  return (
    <div className="calendar-shell">
      <div className="calendar-toolbar">
        <div>
          <p className="section-label">Calendar</p>
          <h3>{formatWeekLabel(weekStart)}</h3>
        </div>
        <div className="button-row wrap">
          <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDays(current, -7))}>
            Previous week
          </button>
          <button className="ghost-button" type="button" onClick={() => setWeekStart(startOfWeekMonday(new Date()))}>
            This week
          </button>
          <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDays(current, 7))}>
            Next week
          </button>
        </div>
      </div>

      <div className="calendar-grid">
        <div className="calendar-header-spacer" />
        {dayLabels.map((label) => (
          <div key={label.key} className="calendar-header-cell">
            <strong>{label.short}</strong>
            <span className="muted tiny-copy">{label.day}</span>
          </div>
        ))}

        <div className="calendar-time-column">
          {slots.map((minute) => {
            const hour = Math.floor(minute / 60)
            const mins = minute % 60
            const isHour = mins === 0
            return (
              <div key={minute} className={`calendar-time-slot ${isHour ? 'calendar-time-slot-hour' : ''}`}>
                {isHour ? `${pad2(hour)}:00` : ''}
              </div>
            )
          })}
        </div>

        {days.map((day) => {
          const dayKey = day.toDateString()
          const dayLessons = lessonsByDay[dayKey] ?? []
          return (
            <div key={dayKey} className="calendar-day-column">
              {slots.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className="calendar-slot"
                  onClick={() => openCreate(day, minute)}
                  aria-label={`Create class on ${day.toDateString()} at ${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`}
                />
              ))}

              {dayLessons.map((lesson) => {
                const start = new Date(lesson.starts_at)
                const minutesFromMidnight = start.getHours() * 60 + start.getMinutes()
                const startIndex = Math.floor((minutesFromMidnight - startHour * 60) / slotMinutes)
                const span = Math.max(1, Math.ceil(lesson.duration_minutes / slotMinutes))
                const studentName = profilesById[lesson.student_id]?.full_name ?? 'Student'
                const teacherName = profilesById[lesson.teacher_id]?.full_name ?? 'Teacher'

                if (startIndex < 0 || startIndex >= slotCount) return null

                return (
                  <div
                    key={lesson.id}
                    className="calendar-event"
                    style={{
                      gridRow: `${startIndex + 1} / span ${span}`,
                    }}
                    title={`${lesson.subject} • ${studentName} with ${teacherName}`}
                  >
                    <strong>{lesson.subject}</strong>
                    <span className="muted tiny-copy">
                      {studentName} · {teacherName}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <div>
                <p className="section-label">New class</p>
                <h2>Create lesson</h2>
              </div>
            </div>

            <form className="form-card" onSubmit={submitCreate}>
              <input
                required
                placeholder="Subject"
                value={draft.subject}
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              />

              <div className="form-grid">
                <input
                  required
                  type="datetime-local"
                  value={draft.starts_at}
                  onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })}
                />
                <input
                  required
                  type="number"
                  min={15}
                  step={5}
                  value={draft.duration_minutes}
                  onChange={(event) => setDraft({ ...draft, duration_minutes: Number(event.target.value) })}
                />
              </div>

              <div className="calendar-form-section">
                <label className="checkbox-row">
                  <input type="checkbox" checked={createStudent} onChange={(event) => setCreateStudent(event.target.checked)} />
                  Create student login
                </label>

                {createStudent ? (
                  <div className="form-grid">
                    <input
                      required
                      placeholder="Student full name"
                      value={studentDraft.full_name}
                      onChange={(event) => setStudentDraft({ ...studentDraft, full_name: event.target.value })}
                    />
                    <input
                      required
                      type="email"
                      placeholder="Student email"
                      value={studentDraft.email}
                      onChange={(event) => setStudentDraft({ ...studentDraft, email: event.target.value })}
                    />
                    <input
                      required
                      type="password"
                      placeholder="Student password"
                      value={studentDraft.password}
                      onChange={(event) => setStudentDraft({ ...studentDraft, password: event.target.value })}
                    />
                    <input
                      required
                      placeholder="Class name"
                      value={studentDraft.class_name ?? ''}
                      onChange={(event) => setStudentDraft({ ...studentDraft, class_name: event.target.value })}
                    />
                  </div>
                ) : (
                  <select
                    value={draft.student_id}
                    onChange={(event) => {
                      const studentId = event.target.value
                      setDraft({
                        ...draft,
                        student_id: studentId,
                        class_name: profilesById[studentId]?.class_name ?? '',
                      })
                    }}
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="calendar-form-section">
                <label className="checkbox-row">
                  <input type="checkbox" checked={createTeacher} onChange={(event) => setCreateTeacher(event.target.checked)} />
                  Create teacher login
                </label>

                {createTeacher ? (
                  <div className="form-grid">
                    <input
                      required
                      placeholder="Teacher full name"
                      value={teacherDraft.full_name}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, full_name: event.target.value })}
                    />
                    <input
                      required
                      type="email"
                      placeholder="Teacher email"
                      value={teacherDraft.email}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, email: event.target.value })}
                    />
                    <input
                      required
                      type="password"
                      placeholder="Teacher password"
                      value={teacherDraft.password}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, password: event.target.value })}
                    />
                    <input
                      required
                      placeholder="Speciality"
                      value={teacherDraft.speciality ?? ''}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, speciality: event.target.value })}
                    />
                  </div>
                ) : (
                  <select value={draft.teacher_id} onChange={(event) => setDraft({ ...draft, teacher_id: event.target.value })}>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="button-row wrap">
                <button className="secondary-button" type="button" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Creating...' : 'Create class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

