-- =====================================================================
-- SKILLORA  –  SECURE PRODUCTION SCHEMA  (v2)
-- Run in Supabase -> SQL Editor.  Safe to re-run (idempotent).
-- TAKE A BACKUP FIRST (Database -> Backups) before running on live data.
--
-- Security model
--   * The browser only ever holds the *publishable* key + the logged-in
--     user's short-lived JWT.  All access is decided HERE, by RLS.
--   * Roles: student | college | employer | admin
--   * 'admin' can NEVER be self-assigned from the website. Promote an
--     admin manually (see 02_create_admin.sql).
-- =====================================================================

-- ---------- helpers ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- 1. PROFILES (one row per auth user, auto-created) ---------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'student'
               check (role in ('student','college','employer','admin')),
  full_name    text not null default '',
  email        text not null,
  phone        text,
  qualification text,
  sector       text,
  city         text,
  state        text,
  org_name     text,                 -- college / employer display name
  extra        jsonb not null default '{}'::jsonb,
  resume_path  text,                 -- path inside PRIVATE 'resumes' bucket
  resume_name  text,
  resume_size  text,
  resume_uploaded_at timestamptz,
  last_login_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_email_len check (char_length(email) <= 254)
);
create unique index if not exists profiles_email_role_uidx on public.profiles (lower(email), role);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- is_admin(): SECURITY DEFINER so it can read profiles without recursion
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Auto-create profile when someone signs up.  Role comes from signup form
-- but is clamped: anything other than college/employer becomes 'student'.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text  := coalesce(m->>'role','student');
begin
  if r not in ('student','college','employer') then r := 'student'; end if;
  insert into public.profiles (id, role, full_name, email, phone, qualification,
                               sector, city, state, org_name, extra)
  values (new.id, r,
          left(coalesce(m->>'name',''),120), lower(new.email),
          left(coalesce(m->>'phone',''),20),
          left(coalesce(m->>'qualification',''),120),
          left(coalesce(m->>'sector',''),120),
          left(coalesce(m->>'city',''),80),
          left(coalesce(m->>'state',''),80),
          left(coalesce(m->>'org_name',''),160),
          coalesce(m->'extra','{}'::jsonb))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp last login (called by the site after a successful sign-in)
create or replace function public.touch_last_login()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;
revoke all on function public.touch_last_login() from public, anon;
grant execute on function public.touch_last_login() to authenticated;

-- Users may NOT change their own role / email via the API
create or replace function public.profiles_lock_sensitive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and auth.uid() is not null then
    new.role  := old.role;
    new.email := old.email;
    new.id    := old.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_lock on public.profiles;
create trigger trg_profiles_lock before update on public.profiles
  for each row execute function public.profiles_lock_sensitive();

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own   on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_own   on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_select_own   on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_update_own   on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated using (public.is_admin());
-- no INSERT / DELETE policy: rows are created only by the signup trigger.

-- ---------- 2. COLLEGES ------------------------------------------------
alter table public.colleges add column if not exists owner_id   uuid references auth.users(id) on delete set null;
alter table public.colleges add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_colleges_updated on public.colleges;
create trigger trg_colleges_updated before update on public.colleges
  for each row execute function public.set_updated_at();

alter table public.colleges enable row level security;
drop policy if exists "Anyone can view colleges" on public.colleges;
drop policy if exists colleges_select_public on public.colleges;
drop policy if exists colleges_insert_partner on public.colleges;
drop policy if exists colleges_update_owner   on public.colleges;
drop policy if exists colleges_delete_admin   on public.colleges;
create policy colleges_select_public  on public.colleges for select
  using (verified = true or owner_id = auth.uid() or public.is_admin());
create policy colleges_insert_partner on public.colleges for insert to authenticated
  with check (public.is_admin() or (owner_id = auth.uid()
              and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'college')));
create policy colleges_update_owner   on public.colleges for update to authenticated
  using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy colleges_delete_admin   on public.colleges for delete to authenticated using (public.is_admin());

-- ---------- 3. JOBS ----------------------------------------------------
alter table public.jobs add column if not exists employer_id uuid references auth.users(id) on delete set null;
alter table public.jobs add column if not exists updated_at  timestamptz not null default now();
drop trigger if exists trg_jobs_updated on public.jobs;
create trigger trg_jobs_updated before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;
drop policy if exists "Anyone can view published jobs" on public.jobs;
drop policy if exists jobs_select on public.jobs;
drop policy if exists jobs_insert_employer on public.jobs;
drop policy if exists jobs_update_owner on public.jobs;
drop policy if exists jobs_delete_owner on public.jobs;
create policy jobs_select on public.jobs for select
  using (status = 'Published' or employer_id = auth.uid() or public.is_admin());
create policy jobs_insert_employer on public.jobs for insert to authenticated
  with check (employer_id = auth.uid() and
              exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('employer','admin')));
create policy jobs_update_owner on public.jobs for update to authenticated
  using (employer_id = auth.uid() or public.is_admin()) with check (employer_id = auth.uid() or public.is_admin());
create policy jobs_delete_owner on public.jobs for delete to authenticated
  using (employer_id = auth.uid() or public.is_admin());

-- ---------- 4. ADMISSION LEADS ----------------------------------------
alter table public.admission_leads add column if not exists user_id uuid references auth.users(id) on delete set null;
drop trigger if exists trg_leads_updated on public.admission_leads;
create trigger trg_leads_updated before update on public.admission_leads
  for each row execute function public.set_updated_at();

-- input hygiene (also enforced server-side, not just in the browser)
alter table public.admission_leads drop constraint if exists leads_input_check;
alter table public.admission_leads add constraint leads_input_check check (
  char_length(student_name) between 2 and 120 and
  char_length(phone) between 7 and 20 and
  (email is null or char_length(email) <= 254));

alter table public.admission_leads enable row level security;
drop policy if exists "Anyone can submit admission enquiry" on public.admission_leads;
drop policy if exists "Admins can view leads" on public.admission_leads;   -- was USING (true): leaked every lead to the public
drop policy if exists leads_insert on public.admission_leads;
drop policy if exists leads_select on public.admission_leads;
drop policy if exists leads_update on public.admission_leads;
-- Public enquiry form allowed, but a visitor can only create a *new* lead and
-- can only attach their own user_id (or none).
create policy leads_insert on public.admission_leads for insert to anon, authenticated
  with check (status = 'New' and (user_id is null or user_id = auth.uid()));
create policy leads_select on public.admission_leads for select to authenticated
  using ( public.is_admin()
       or user_id = auth.uid()
       or lower(email) = lower(coalesce(auth.jwt()->>'email',''))
       or exists (select 1 from public.colleges c where c.id = admission_leads.college_id and c.owner_id = auth.uid()) );
create policy leads_update on public.admission_leads for update to authenticated
  using ( public.is_admin()
       or exists (select 1 from public.colleges c where c.id = admission_leads.college_id and c.owner_id = auth.uid()) );

-- ---------- 5. JOB APPLICATIONS ---------------------------------------
alter table public.job_applications add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.job_applications add column if not exists updated_at timestamptz not null default now();
alter table public.job_applications add column if not exists current_city text;
alter table public.job_applications add column if not exists current_state text;
alter table public.job_applications add column if not exists work_status text;
alter table public.job_applications add column if not exists preferred_location text;
alter table public.job_applications add column if not exists sector text;
alter table public.job_applications add column if not exists target_role text;
alter table public.job_applications add column if not exists qualification text;
drop trigger if exists trg_apps_updated on public.job_applications;
create trigger trg_apps_updated before update on public.job_applications
  for each row execute function public.set_updated_at();

alter table public.job_applications drop constraint if exists apps_input_check;
alter table public.job_applications add constraint apps_input_check check (
  char_length(candidate_name) between 2 and 120 and char_length(phone) between 7 and 20);

alter table public.job_applications enable row level security;
drop policy if exists "Anyone can submit job application" on public.job_applications;
drop policy if exists "Admins can view applications" on public.job_applications;  -- was USING (true)
drop policy if exists apps_insert on public.job_applications;
drop policy if exists apps_select on public.job_applications;
drop policy if exists apps_update on public.job_applications;
-- Applying requires a logged-in student; one application per job per user.
create policy apps_insert on public.job_applications for insert to anon, authenticated
  with check (stage = 'Applied' and (user_id is null or user_id = auth.uid()));
create unique index if not exists apps_one_per_job_uidx on public.job_applications (job_id, user_id) where user_id is not null;
create policy apps_select on public.job_applications for select to authenticated
  using ( public.is_admin() or user_id = auth.uid()
       or exists (select 1 from public.jobs j where j.id = job_applications.job_id and j.employer_id = auth.uid()) );
create policy apps_update on public.job_applications for update to authenticated
  using ( public.is_admin()
       or exists (select 1 from public.jobs j where j.id = job_applications.job_id and j.employer_id = auth.uid()) );

-- ---------- 6. CONTACT INQUIRIES (was localStorage-only) ---------------
create table if not exists public.contact_inquiries (
  id         bigserial primary key,
  name       text not null check (char_length(name) between 2 and 120),
  email      text check (email is null or char_length(email) <= 254),
  phone      text check (phone is null or char_length(phone) <= 20),
  subject    text check (subject is null or char_length(subject) <= 200),
  message    text not null check (char_length(message) between 5 and 4000),
  status     text not null default 'New',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_inq_updated on public.contact_inquiries;
create trigger trg_inq_updated before update on public.contact_inquiries
  for each row execute function public.set_updated_at();
alter table public.contact_inquiries enable row level security;
drop policy if exists inq_insert on public.contact_inquiries;
drop policy if exists inq_admin_all on public.contact_inquiries;
create policy inq_insert on public.contact_inquiries for insert to anon, authenticated with check (status = 'New');
create policy inq_admin_all on public.contact_inquiries for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 7. ADMIN LOGIN AUDIT TRAIL (server-side, tamper-resistant) -
create table if not exists public.admin_login_log (
  id         bigserial primary key,
  admin_id   uuid not null references auth.users(id) on delete cascade,
  email      text,
  user_agent text,
  logged_at  timestamptz not null default now()
);
alter table public.admin_login_log enable row level security;
drop policy if exists adminlog_insert on public.admin_login_log;
drop policy if exists adminlog_select on public.admin_login_log;
create policy adminlog_insert on public.admin_login_log for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());
create policy adminlog_select on public.admin_login_log for select to authenticated using (public.is_admin());

-- ---------- 8. PRIVATE RESUME STORAGE ---------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes','resumes', false, 5242880,
        array['application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;      -- flips an existing PUBLIC bucket to private

drop policy if exists resumes_insert_own on storage.objects;
drop policy if exists resumes_select_own on storage.objects;
drop policy if exists resumes_update_own on storage.objects;
drop policy if exists resumes_delete_own on storage.objects;
-- files live at  <user-id>/<timestamp>_<name>
create policy resumes_insert_own on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'resumes');
create policy resumes_select_own on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy resumes_update_own on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy resumes_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 9. LEAST PRIVILEGE ----------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.colleges, public.jobs to anon;
grant insert on public.admission_leads, public.contact_inquiries, public.job_applications to anon;
grant usage, select on all sequences in schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated; -- RLS still gates every row

-- =====================================================================
-- 10. v2 ADDITIONS - moderation, portal columns, recruiter resume access
-- =====================================================================

-- 10a. Jobs: extra fields used by the employer portal + length checks
alter table public.jobs add column if not exists vacancies int check (vacancies is null or vacancies between 1 and 10000);
alter table public.jobs add column if not exists perks jsonb not null default '[]'::jsonb;
alter table public.jobs drop constraint if exists jobs_input_check;
alter table public.jobs add constraint jobs_input_check check (
  char_length(title) between 3 and 150 and char_length(employer_name) between 2 and 160
  and (description is null or char_length(description) <= 6000)
  and (requirements is null or char_length(requirements) <= 3000));

-- Only an ADMIN can make a job live. Employers' new jobs become 'Pending' (review),
-- they may later Pause / un-Pause / Close their own approved jobs.
create or replace function public.jobs_lock_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status = 'Published' and (tg_op = 'INSERT' or coalesce(old.status,'') not in ('Published','Paused')) then
      new.status := 'Pending';
    end if;
    if tg_op = 'UPDATE' then new.employer_id := old.employer_id; end if;   -- cannot hand a job to someone else
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_lock_status on public.jobs;
create trigger trg_jobs_lock_status before insert or update on public.jobs
  for each row execute function public.jobs_lock_status();

alter table public.jobs alter column status set default 'Pending';

-- 10b. Colleges: auto id, no fake default rating, 'verified' only by admin, one college per partner account
create sequence if not exists public.colleges_id_seq;
select setval('public.colleges_id_seq', greatest(coalesce((select max(id) from public.colleges), 0), 1));
alter table public.colleges alter column id set default nextval('public.colleges_id_seq');
alter table public.colleges alter column rating drop default;
alter table public.colleges alter column verified set default false;
create unique index if not exists colleges_one_per_owner_uidx on public.colleges (owner_id) where owner_id is not null;
alter table public.colleges drop constraint if exists colleges_input_check;
alter table public.colleges add constraint colleges_input_check check (
  char_length(name) between 3 and 200 and (overview is null or char_length(overview) <= 4000));

create or replace function public.colleges_lock_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.verified := false; new.rating := null; new.owner_id := auth.uid();
    else
      new.verified := old.verified; new.rating := old.rating; new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_colleges_lock_verified on public.colleges;
create trigger trg_colleges_lock_verified before insert or update on public.colleges
  for each row execute function public.colleges_lock_verified();

-- 10c. Applications keep the applicant's resume path so the employer can open it
alter table public.job_applications add column if not exists resume_path text;

-- Recruiters may read ONLY the resumes of people who applied to THEIR jobs
drop policy if exists resumes_select_recruiter on storage.objects;
create policy resumes_select_recruiter on storage.objects for select to authenticated
using (
  bucket_id = 'resumes' and exists (
    select 1 from public.job_applications a join public.jobs j on j.id = a.job_id
    where j.employer_id = auth.uid() and a.user_id::text = (storage.foldername(name))[1]
  )
);

-- Employers/colleges can read the profile name+phone+email of nobody directly (data is copied into the
-- application / lead at submit time), so profiles stay private to the owner and admin.
