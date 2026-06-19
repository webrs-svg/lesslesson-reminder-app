create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('admin', 'teacher', 'student')),
  class_name text not null default '',
  speciality text not null default '',
  push_enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  class_name text not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  student_attendance text null check (student_attendance in ('attend', 'cancel')),
  student_lesson_status text null check (student_lesson_status in ('done', 'not_done')),
  teacher_lesson_status text null check (teacher_lesson_status in ('happened', 'not_happened', 'student_no_show')),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.lessons enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles
for insert
with check (public.is_admin());

drop policy if exists "lessons_select" on public.lessons;
create policy "lessons_select" on public.lessons
for select
using (
  public.is_admin()
  or student_id = auth.uid()
  or teacher_id = auth.uid()
);

drop policy if exists "lessons_insert_admin" on public.lessons;
create policy "lessons_insert_admin" on public.lessons
for insert
with check (public.is_admin());

drop policy if exists "lessons_update" on public.lessons;
create policy "lessons_update" on public.lessons
for update
using (
  public.is_admin()
  or student_id = auth.uid()
  or teacher_id = auth.uid()
)
with check (
  public.is_admin()
  or student_id = auth.uid()
  or teacher_id = auth.uid()
);
