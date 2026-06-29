export type Language = 'en' | 'pt' | 'es'

const STORAGE_KEY = 'lesson_reminder_language'

export const supportedLanguages: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
]

export const getDeviceLanguage = (): Language => {
  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean) as string[]
  for (const lang of candidates) {
    const lower = lang.toLowerCase()
    if (lower.startsWith('pt')) return 'pt'
    if (lower.startsWith('es')) return 'es'
    if (lower.startsWith('en')) return 'en'
  }
  return 'en'
}

export const getStoredLanguage = (): Language | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'en' || value === 'pt' || value === 'es') return value
    return null
  } catch {
    return null
  }
}

export const storeLanguage = (language: Language) => {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // ignore
  }
}

type Dictionary = Record<string, string>

export const translations: Record<Language, Dictionary> = {
  en: {
    language: 'Language',
    users: 'Users',
    calendar: 'Calendar',
    management: 'Management',
    create_setup_link: 'Create a setup link (no password yet)',
    setup_link_help: 'You will get a link to share with the user. They’ll finish setting a password and then can sign in.',
    setup_link_title: 'Setup link',
    setup_link_share: 'Share this link with the new user:',
    copy_link: 'Copy link',
    add_user: 'Add user',
    full_name: 'Full name',
    email_optional: 'Email (optional)',
    password: 'Password',
    password_not_needed: 'Password (not needed)',
    choose_teacher_first_class: 'Choose a teacher for the first class',
    first_class_time_optional: 'First class time (optional)',
    opening_setup_link: 'Opening your setup link…',
    setup_finish_hint: 'Finish your account by checking your name, email, and password below.',
  },
  pt: {
    language: 'Idioma',
    users: 'Usuários',
    calendar: 'Calendário',
    management: 'Gestão',
    create_setup_link: 'Criar link de acesso (sem senha)',
    setup_link_help: 'Você receberá um link para compartilhar. A pessoa vai definir a senha e depois poderá entrar.',
    setup_link_title: 'Link de acesso',
    setup_link_share: 'Compartilhe este link com a pessoa:',
    copy_link: 'Copiar link',
    add_user: 'Adicionar usuário',
    full_name: 'Nome completo',
    email_optional: 'E-mail (opcional)',
    password: 'Senha',
    password_not_needed: 'Senha (não precisa)',
    choose_teacher_first_class: 'Escolha um professor para a primeira aula',
    first_class_time_optional: 'Horário da primeira aula (opcional)',
    opening_setup_link: 'Abrindo seu link de acesso…',
    setup_finish_hint: 'Finalize sua conta conferindo seu nome, e-mail e senha abaixo.',
  },
  es: {
    language: 'Idioma',
    users: 'Usuarios',
    calendar: 'Calendario',
    management: 'Gestión',
    create_setup_link: 'Crear enlace de acceso (sin contraseña)',
    setup_link_help: 'Recibirás un enlace para compartir. La persona definirá su contraseña y luego podrá iniciar sesión.',
    setup_link_title: 'Enlace de acceso',
    setup_link_share: 'Comparte este enlace con la persona:',
    copy_link: 'Copiar enlace',
    add_user: 'Agregar usuario',
    full_name: 'Nombre completo',
    email_optional: 'Correo (opcional)',
    password: 'Contraseña',
    password_not_needed: 'Contraseña (no necesaria)',
    choose_teacher_first_class: 'Elige un profesor para la primera clase',
    first_class_time_optional: 'Hora de la primera clase (opcional)',
    opening_setup_link: 'Abriendo tu enlace de acceso…',
    setup_finish_hint: 'Finaliza tu cuenta revisando tu nombre, correo y contraseña abajo.',
  },
}

export const t = (language: Language, key: string) => translations[language]?.[key] ?? translations.en[key] ?? key

