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

type TimeZoneOption = {
  value: string
  label: string
}

const pad2 = (value: number) => value.toString().padStart(2, '0')

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const zonedPartsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

const getDateKeyParts = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return { year, month, day }
}

const formatDateKey = (date: Date) => dateKeyFormatter.format(date)

const utcDateFromKey = (dateKey: string) => {
  const { year, month, day } = getDateKeyParts(dateKey)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = utcDateFromKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDateKey(date)
}

const weekdayIndexFromDateKey = (dateKey: string) => {
  const day = utcDateFromKey(dateKey).getUTCDay()
  return (day + 6) % 7
}

const startOfWeekDateKey = (dateKey: string) => addDaysToDateKey(dateKey, -weekdayIndexFromDateKey(dateKey))

const getZonedParts = (date: Date, timeZone: string) => {
  const parts = zonedPartsFormatter(timeZone).formatToParts(date)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  }
}

const todayDateKeyInTimeZone = (timeZone: string) => {
  const parts = getZonedParts(new Date(), timeZone)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = getZonedParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return (asUtc - date.getTime()) / 60000
}

const zonedDateTimeToUtcIso = (dateTimeLocal: string, timeZone: string) => {
  const [datePart, timePart] = dateTimeLocal.split('T')
  const { year, month, day } = getDateKeyParts(datePart)
  const [hour, minute] = timePart.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let offset = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone)
  let timestamp = utcGuess - offset * 60000
  const nextOffset = getTimeZoneOffsetMinutes(new Date(timestamp), timeZone)
  if (nextOffset !== offset) {
    offset = nextOffset
    timestamp = utcGuess - offset * 60000
  }
  return new Date(timestamp).toISOString()
}

const formatWeekLabel = (weekStart: string) => {
  const weekEnd = addDaysToDateKey(weekStart, 6)
  const formatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${formatter.format(utcDateFromKey(weekStart))} - ${formatter.format(utcDateFromKey(weekEnd))}`
}

const baseTimeZoneOptions: TimeZoneOption[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
]

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
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timeZoneOptions = useMemo(() => {
    if (baseTimeZoneOptions.some((option) => option.value === browserTimeZone)) {
      return baseTimeZoneOptions
    }
    return [...baseTimeZoneOptions, { value: browserTimeZone, label: `My time zone (${browserTimeZone})` }]
  }, [browserTimeZone])
  const [selectedTimeZone, setSelectedTimeZone] = useState('America/Sao_Paulo')
  const [weekStart, setWeekStart] = useState(() => startOfWeekDateKey(todayDateKeyInTimeZone('America/Sao_Paulo')))
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [repeatCount, setRepeatCount] = useState(4)

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

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStart, index)), [weekStart])

  const dayLabels = useMemo(
    () =>
      days.map((day) => ({
        key: day,
        short: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(utcDateFromKey(day)),
        day: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utcDateFromKey(day)),
      })),
    [days],
  )

  const slotMinutes = 30
  const startHour = 6
  const endHour = 22
  const slotCount = ((endHour - startHour) * 60) / slotMinutes
  const slots = useMemo(() => Array.from({ length: slotCount }, (_, idx) => startHour * 60 + idx * slotMinutes), [slotCount])

  const weekEnd = useMemo(() => addDaysToDateKey(weekStart, 7), [weekStart])

  const lessonsThisWeek = useMemo(() => {
    return lessons.filter((lesson) => {
      const dateKey = formatDateKey(
        new Date(
          Date.UTC(
            getZonedParts(new Date(lesson.starts_at), selectedTimeZone).year,
            getZonedParts(new Date(lesson.starts_at), selectedTimeZone).month - 1,
            getZonedParts(new Date(lesson.starts_at), selectedTimeZone).day,
            12,
          ),
        ),
      )
      return dateKey >= weekStart && dateKey < weekEnd
    })
  }, [lessons, selectedTimeZone, weekStart, weekEnd])

  const lessonsByDay = useMemo(() => {
    const grouped: Record<string, Lesson[]> = {}
    for (const day of days) {
      grouped[day] = []
    }
    for (const lesson of lessonsThisWeek) {
      const zoned = getZonedParts(new Date(lesson.starts_at), selectedTimeZone)
      const key = `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`
      grouped[key] = grouped[key] ? [...grouped[key], lesson] : [lesson]
    }
    return grouped
  }, [days, lessonsThisWeek, selectedTimeZone])

  const lessonLayouts = useMemo(() => {
    const layouts: Record<string, { column: number; totalColumns: number }> = {}

    for (const day of days) {
      const dayLessons = [...(lessonsByDay[day] ?? [])]
      for (const lesson of dayLessons) {
        const lessonStart = getZonedParts(new Date(lesson.starts_at), selectedTimeZone)
        const lessonStartMinutes = lessonStart.hour * 60 + lessonStart.minute
        const lessonEndMinutes = lessonStartMinutes + lesson.duration_minutes

        const overlaps = dayLessons
          .filter((other) => {
            const otherStart = getZonedParts(new Date(other.starts_at), selectedTimeZone)
            const otherStartMinutes = otherStart.hour * 60 + otherStart.minute
            const otherEndMinutes = otherStartMinutes + other.duration_minutes
            return lessonStartMinutes < otherEndMinutes && otherStartMinutes < lessonEndMinutes
          })
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() || a.id.localeCompare(b.id))

        const column = overlaps.findIndex((item) => item.id === lesson.id)
        layouts[lesson.id] = {
          column: Math.max(column, 0),
          totalColumns: Math.max(overlaps.length, 1),
        }
      }
    }

    return layouts
  }, [days, lessonsByDay, selectedTimeZone])

  const openCreate = (dayKey: string, minutesFromMidnight: number) => {
    const hours = Math.floor(minutesFromMidnight / 60)
    const minutes = minutesFromMidnight % 60
    setDraft((current) => ({
      ...current,
      starts_at: `${dayKey}T${pad2(hours)}:${pad2(minutes)}`,
    }))
    setCreateStudent(false)
    setCreateTeacher(false)
    setRepeatWeekly(false)
    setRepeatCount(4)
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

      const occurrences = repeatWeekly ? Math.max(1, repeatCount) : 1
      for (let index = 0; index < occurrences; index += 1) {
        const [datePart, timePart] = draft.starts_at.split('T')
        const repeatedDate = addDaysToDateKey(datePart, index * 7)
        await onCreateLesson({
          ...draft,
          starts_at: zonedDateTimeToUtcIso(`${repeatedDate}T${timePart}`, selectedTimeZone),
          student_id: studentId,
          teacher_id: teacherId,
          class_name: className,
        })
      }

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
          <p className="muted tiny-copy">Showing times in {timeZoneOptions.find((option) => option.value === selectedTimeZone)?.label}</p>
        </div>
        <div className="calendar-toolbar-actions">
          <label className="timezone-picker">
            <span className="muted tiny-copy">Time zone</span>
            <select
              value={selectedTimeZone}
              onChange={(event) => {
                const nextTimeZone = event.target.value
                setSelectedTimeZone(nextTimeZone)
                setWeekStart(startOfWeekDateKey(todayDateKeyInTimeZone(nextTimeZone)))
              }}
            >
              {timeZoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="button-row wrap">
            <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDaysToDateKey(current, -7))}>
              Previous week
            </button>
            <button className="ghost-button" type="button" onClick={() => setWeekStart(startOfWeekDateKey(todayDateKeyInTimeZone(selectedTimeZone)))}>
              This week
            </button>
            <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDaysToDateKey(current, 7))}>
              Next week
            </button>
          </div>
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
          const dayKey = day
          const dayLessons = lessonsByDay[dayKey] ?? []
          return (
            <div key={dayKey} className="calendar-day-column">
              {slots.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className="calendar-slot"
                  onClick={() => openCreate(dayKey, minute)}
                  aria-label={`Create class on ${dayKey} at ${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`}
                />
              ))}

              {dayLessons.map((lesson) => {
                const start = getZonedParts(new Date(lesson.starts_at), selectedTimeZone)
                const minutesFromMidnight = start.hour * 60 + start.minute
                const startIndex = Math.floor((minutesFromMidnight - startHour * 60) / slotMinutes)
                const span = Math.max(1, Math.ceil(lesson.duration_minutes / slotMinutes))
                const studentName = profilesById[lesson.student_id]?.full_name ?? 'Student'
                const teacherName = profilesById[lesson.teacher_id]?.full_name ?? 'Teacher'
                const attendanceLabel =
                  lesson.student_attendance === 'attend'
                    ? 'Confirmed'
                    : lesson.student_attendance === 'cancel'
                      ? 'Cancelled'
                      : 'No reply yet'
                const attendanceClass =
                  lesson.student_attendance === 'attend'
                    ? 'calendar-event calendar-event-success'
                    : lesson.student_attendance === 'cancel'
                      ? 'calendar-event calendar-event-danger'
                      : 'calendar-event calendar-event-neutral'

                if (startIndex < 0 || startIndex >= slotCount) return null

                return (
                  <div
                    key={lesson.id}
                    className={attendanceClass}
                    style={{
                      gridRow: `${startIndex + 1} / span ${span}`,
                      width: `calc(${100 / lessonLayouts[lesson.id].totalColumns}% - 8px)`,
                      marginLeft: `calc(${(100 / lessonLayouts[lesson.id].totalColumns) * lessonLayouts[lesson.id].column}% + 4px)`,
                    }}
                    title={`${lesson.subject} • ${studentName} with ${teacherName}`}
                  >
                    <strong>{lesson.subject}</strong>
                    <span className="muted tiny-copy">
                      {studentName} · {teacherName}
                    </span>
                    <span className="muted tiny-copy">Student: {attendanceLabel}</span>
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
                  <input type="checkbox" checked={repeatWeekly} onChange={(event) => setRepeatWeekly(event.target.checked)} />
                  Repeat every week
                </label>

                {repeatWeekly && (
                  <div className="form-grid">
                    <input
                      required
                      type="number"
                      min={2}
                      max={52}
                      value={repeatCount}
                      onChange={(event) => setRepeatCount(Number(event.target.value))}
                    />
                    <div className="field-note">
                      <p className="muted">Number of weekly classes to create, including the first one.</p>
                    </div>
                  </div>
                )}
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
