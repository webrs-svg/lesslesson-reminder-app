import { FormEvent, useMemo, useState } from 'react'
import type { Lesson, Profile } from '../lib/types'

type LessonDraft = {
  subject: string
  starts_at: string
  duration_minutes: number
  student_ids: string[]
  teacher_id: string
  class_name: string
}

type LessonUpdateDraft = LessonDraft & {
  lesson_ids: string[]
}

type NewUserDraft = {
  full_name: string
  email: string
  password: string
  class_name?: string
  speciality?: string
}

type CalendarGroup = {
  key: string
  lessonIds: string[]
  subject: string
  class_name: string
  starts_at: string
  duration_minutes: number
  teacher_id: string
  student_ids: string[]
}

const pad2 = (value: number) => value.toString().padStart(2, '0')
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
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

const weekdayIndexFromDateKey = (dateKey: string) => (utcDateFromKey(dateKey).getUTCDay() + 6) % 7
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
    timestamp = utcGuess - nextOffset * 60000
  }
  return new Date(timestamp).toISOString()
}

const formatWeekLabel = (weekStart: string) => {
  const weekEnd = addDaysToDateKey(weekStart, 6)
  const formatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${formatter.format(utcDateFromKey(weekStart))} - ${formatter.format(utcDateFromKey(weekEnd))}`
}

const groupKeyForLesson = (lesson: Lesson) =>
  [lesson.subject, lesson.class_name, lesson.teacher_id, lesson.starts_at, lesson.duration_minutes].join('|')

export default function AdminCalendar({
  lessons,
  profilesById,
  students,
  teachers,
  timeZone,
  role,
  currentTeacherId,
  allowCreateUsers,
  allowTeacherChange,
  onCreateLesson,
  onUpdateLessonGroup,
  onCreateStudentLogin,
  onCreateTeacherLogin,
}: {
  lessons: Lesson[]
  profilesById: Record<string, Profile>
  students: Profile[]
  teachers: Profile[]
  timeZone: string
  role: 'admin' | 'teacher'
  currentTeacherId?: string
  allowCreateUsers: boolean
  allowTeacherChange: boolean
  onCreateLesson: (draft: LessonDraft) => Promise<void>
  onUpdateLessonGroup: (draft: LessonUpdateDraft) => Promise<void>
  onCreateStudentLogin: (draft: NewUserDraft) => Promise<Profile>
  onCreateTeacherLogin: (draft: NewUserDraft) => Promise<Profile>
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekDateKey(todayDateKeyInTimeZone(timeZone)))
  const [showModal, setShowModal] = useState(false)
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [repeatCount, setRepeatCount] = useState(4)
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(students[0] ? [students[0].id] : [])
  const [createStudent, setCreateStudent] = useState(false)
  const [createTeacher, setCreateTeacher] = useState(false)
  const [studentDraft, setStudentDraft] = useState<NewUserDraft>({ full_name: '', email: '', password: '', class_name: '' })
  const [teacherDraft, setTeacherDraft] = useState<NewUserDraft>({ full_name: '', email: '', password: '', speciality: '' })
  const [draft, setDraft] = useState<Omit<LessonDraft, 'student_ids'>>({
    subject: '',
    starts_at: '',
    duration_minutes: 60,
    teacher_id: currentTeacherId ?? teachers[0]?.id ?? '',
    class_name: '',
  })

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

  const visibleLessons = role === 'teacher' && currentTeacherId ? lessons.filter((lesson) => lesson.teacher_id === currentTeacherId) : lessons

  const lessonsThisWeek = useMemo(
    () =>
      visibleLessons.filter((lesson) => {
        const zoned = getZonedParts(new Date(lesson.starts_at), timeZone)
        const dateKey = `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`
        return dateKey >= weekStart && dateKey < weekEnd
      }),
    [visibleLessons, timeZone, weekStart, weekEnd],
  )

  const groupsThisWeek = useMemo(() => {
    const map = new Map<string, CalendarGroup>()
    for (const lesson of lessonsThisWeek) {
      const key = groupKeyForLesson(lesson)
      const current = map.get(key)
      if (current) {
        current.lessonIds.push(lesson.id)
        current.student_ids.push(lesson.student_id)
      } else {
        map.set(key, {
          key,
          lessonIds: [lesson.id],
          subject: lesson.subject,
          class_name: lesson.class_name,
          starts_at: lesson.starts_at,
          duration_minutes: lesson.duration_minutes,
          teacher_id: lesson.teacher_id,
          student_ids: [lesson.student_id],
        })
      }
    }
    return Array.from(map.values())
  }, [lessonsThisWeek])

  const groupsByDay = useMemo(() => {
    const grouped: Record<string, CalendarGroup[]> = Object.fromEntries(days.map((day) => [day, []]))
    for (const group of groupsThisWeek) {
      const zoned = getZonedParts(new Date(group.starts_at), timeZone)
      const key = `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`
      grouped[key] = grouped[key] ? [...grouped[key], group] : [group]
    }
    return grouped
  }, [days, groupsThisWeek, timeZone])

  const groupLayouts = useMemo(() => {
    const layouts: Record<string, { column: number; totalColumns: number }> = {}
    for (const day of days) {
      const dayGroups = groupsByDay[day] ?? []
      for (const group of dayGroups) {
        const start = getZonedParts(new Date(group.starts_at), timeZone)
        const startMinutes = start.hour * 60 + start.minute
        const endMinutes = startMinutes + group.duration_minutes
        const overlaps = dayGroups
          .filter((other) => {
            const otherStart = getZonedParts(new Date(other.starts_at), timeZone)
            const otherStartMinutes = otherStart.hour * 60 + otherStart.minute
            const otherEndMinutes = otherStartMinutes + other.duration_minutes
            return startMinutes < otherEndMinutes && otherStartMinutes < endMinutes
          })
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() || a.key.localeCompare(b.key))
        const column = overlaps.findIndex((item) => item.key === group.key)
        layouts[group.key] = { column: Math.max(column, 0), totalColumns: Math.max(overlaps.length, 1) }
      }
    }
    return layouts
  }, [days, groupsByDay, timeZone])

  const resetDrafts = () => {
    setCreateStudent(false)
    setCreateTeacher(false)
    setRepeatWeekly(false)
    setRepeatCount(4)
    setStudentDraft({ full_name: '', email: '', password: '', class_name: '' })
    setTeacherDraft({ full_name: '', email: '', password: '', speciality: '' })
  }

  const openCreate = (dayKey: string, minutesFromMidnight: number) => {
    const hours = Math.floor(minutesFromMidnight / 60)
    const minutes = minutesFromMidnight % 60
    resetDrafts()
    setEditingGroupKey(null)
    setSelectedStudentIds(students[0] ? [students[0].id] : [])
    setDraft({
      subject: '',
      starts_at: `${dayKey}T${pad2(hours)}:${pad2(minutes)}`,
      duration_minutes: 60,
      teacher_id: role === 'teacher' && currentTeacherId ? currentTeacherId : teachers[0]?.id ?? '',
      class_name: '',
    })
    setShowModal(true)
  }

  const openEdit = (group: CalendarGroup) => {
    resetDrafts()
    setEditingGroupKey(group.key)
    setSelectedStudentIds(group.student_ids)
    const zoned = getZonedParts(new Date(group.starts_at), timeZone)
    setDraft({
      subject: group.subject,
      starts_at: `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}T${pad2(zoned.hour)}:${pad2(zoned.minute)}`,
      duration_minutes: group.duration_minutes,
      teacher_id: group.teacher_id,
      class_name: group.class_name,
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingGroupKey(null)
    setSaving(false)
  }

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds((current) => (current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]))
  }

  const editingGroup = editingGroupKey ? groupsThisWeek.find((group) => group.key === editingGroupKey) ?? null : null

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      let teacherId = draft.teacher_id
      let className = draft.class_name
      let nextStudentIds = [...selectedStudentIds]

      if (createStudent) {
        const createdStudent = await onCreateStudentLogin(studentDraft)
        nextStudentIds = Array.from(new Set([...nextStudentIds, createdStudent.id]))
        className = createdStudent.class_name || className
      }

      if (createTeacher) {
        const createdTeacher = await onCreateTeacherLogin(teacherDraft)
        teacherId = createdTeacher.id
      }

      if (!className && nextStudentIds[0]) {
        className = profilesById[nextStudentIds[0]]?.class_name ?? ''
      }

      if (!editingGroup) {
        const occurrences = repeatWeekly ? Math.max(1, repeatCount) : 1
        for (let index = 0; index < occurrences; index += 1) {
          const [datePart, timePart] = draft.starts_at.split('T')
          const repeatedDate = addDaysToDateKey(datePart, index * 7)
          await onCreateLesson({
            subject: draft.subject,
            starts_at: zonedDateTimeToUtcIso(`${repeatedDate}T${timePart}`, timeZone),
            duration_minutes: draft.duration_minutes,
            student_ids: nextStudentIds,
            teacher_id: role === 'teacher' && currentTeacherId ? currentTeacherId : teacherId,
            class_name: className,
          })
        }
      } else {
        await onUpdateLessonGroup({
          lesson_ids: editingGroup.lessonIds,
          subject: draft.subject,
          starts_at: zonedDateTimeToUtcIso(draft.starts_at, timeZone),
          duration_minutes: draft.duration_minutes,
          student_ids: nextStudentIds,
          teacher_id: role === 'teacher' && currentTeacherId ? currentTeacherId : teacherId,
          class_name: className,
        })
      }

      closeModal()
    } catch {
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
          <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDaysToDateKey(current, -7))}>
            Previous week
          </button>
          <button className="ghost-button" type="button" onClick={() => setWeekStart(startOfWeekDateKey(todayDateKeyInTimeZone(timeZone)))}>
            This week
          </button>
          <button className="ghost-button" type="button" onClick={() => setWeekStart((current) => addDaysToDateKey(current, 7))}>
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
          const dayGroups = groupsByDay[day] ?? []
          return (
            <div key={day} className="calendar-day-column">
              {slots.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className="calendar-slot"
                  onClick={() => openCreate(day, minute)}
                  aria-label={`Create class on ${day} at ${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`}
                />
              ))}

              {dayGroups.map((group) => {
                const start = getZonedParts(new Date(group.starts_at), timeZone)
                const minutesFromMidnight = start.hour * 60 + start.minute
                const startIndex = Math.floor((minutesFromMidnight - startHour * 60) / slotMinutes)
                const span = Math.max(1, Math.ceil(group.duration_minutes / slotMinutes))
                const teacherName = profilesById[group.teacher_id]?.full_name ?? 'Teacher'
                const studentsForGroup = group.student_ids.map((id) => profilesById[id]?.full_name ?? 'Student')
                const confirmedCount = group.lessonIds.filter((lessonId) => {
                  const lesson = lessons.find((item) => item.id === lessonId)
                  return lesson?.student_attendance === 'attend'
                }).length
                const cancelledCount = group.lessonIds.filter((lessonId) => {
                  const lesson = lessons.find((item) => item.id === lessonId)
                  return lesson?.student_attendance === 'cancel'
                }).length
                const layout = groupLayouts[group.key] ?? { column: 0, totalColumns: 1 }
                if (startIndex < 0 || startIndex >= slotCount) return null

                return (
                  <button
                    key={group.key}
                    type="button"
                    className="calendar-event calendar-event-neutral"
                    style={{
                      gridRow: `${startIndex + 1} / span ${span}`,
                      width: `calc(${100 / layout.totalColumns}% - 8px)`,
                      marginLeft: `calc(${(100 / layout.totalColumns) * layout.column}% + 4px)`,
                    }}
                    title={`${group.subject} • ${studentsForGroup.join(', ')} with ${teacherName}`}
                    onClick={() => openEdit(group)}
                  >
                    <strong>{group.subject}</strong>
                    <span className="muted tiny-copy">{teacherName}</span>
                    <span className="muted tiny-copy">
                      {studentsForGroup.length} student{studentsForGroup.length === 1 ? '' : 's'}
                    </span>
                    <span className="muted tiny-copy">
                      Confirmed: {confirmedCount} · Cancelled: {cancelledCount}
                    </span>
                  </button>
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
                <p className="section-label">{editingGroup ? 'Edit class' : 'New class'}</p>
                <h2>{editingGroup ? 'Update class' : 'Create class'}</h2>
              </div>
            </div>

            <form className="form-card" onSubmit={submitCreate}>
              <input required placeholder="Subject" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />

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

              {!editingGroup && (
                <div className="calendar-form-section">
                  <label className="checkbox-row">
                    <input type="checkbox" checked={repeatWeekly} onChange={(event) => setRepeatWeekly(event.target.checked)} />
                    Repeat every week
                  </label>
                  {repeatWeekly && (
                    <div className="form-grid">
                      <input type="number" min={2} max={52} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} />
                      <div className="field-note">
                        <p className="muted">Number of weekly classes to create, including the first one.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="calendar-form-section">
                <h3>Students</h3>
                <div className="selection-grid">
                  {students.map((student) => (
                    <label key={student.id} className="checkbox-row selection-item">
                      <input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} />
                      {student.full_name}
                    </label>
                  ))}
                </div>
              </div>

              {allowCreateUsers && (
                <div className="calendar-form-section">
                  <label className="checkbox-row">
                    <input type="checkbox" checked={createStudent} onChange={(event) => setCreateStudent(event.target.checked)} />
                    Create student login
                  </label>
                  {createStudent && (
                    <div className="form-grid">
                      <input
                        required
                        placeholder="Student full name"
                        value={studentDraft.full_name}
                        onChange={(event) => setStudentDraft({ ...studentDraft, full_name: event.target.value })}
                      />
                      <input
                        type="email"
                        placeholder="Student email (optional)"
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
                        placeholder="Class label (optional)"
                        value={studentDraft.class_name ?? ''}
                        onChange={(event) => setStudentDraft({ ...studentDraft, class_name: event.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="calendar-form-section">
                <h3>Teacher</h3>
                {allowCreateUsers && allowTeacherChange && (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={createTeacher} onChange={(event) => setCreateTeacher(event.target.checked)} />
                    Create teacher login
                  </label>
                )}

                {allowTeacherChange && !createTeacher ? (
                  <select value={draft.teacher_id} onChange={(event) => setDraft({ ...draft, teacher_id: event.target.value })}>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.full_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="field-note">
                    <p className="muted">{profilesById[currentTeacherId ?? draft.teacher_id]?.full_name ?? 'Current teacher'}</p>
                  </div>
                )}

                {allowCreateUsers && createTeacher && (
                  <div className="form-grid">
                    <input
                      required
                      placeholder="Teacher full name"
                      value={teacherDraft.full_name}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, full_name: event.target.value })}
                    />
                    <input
                      type="email"
                      placeholder="Teacher email (optional)"
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
                      placeholder="Speciality (optional)"
                      value={teacherDraft.speciality ?? ''}
                      onChange={(event) => setTeacherDraft({ ...teacherDraft, speciality: event.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="button-row wrap">
                <button className="secondary-button" type="button" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving || selectedStudentIds.length === 0}>
                  {saving ? (editingGroup ? 'Saving...' : 'Creating...') : editingGroup ? 'Save class' : 'Create class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
