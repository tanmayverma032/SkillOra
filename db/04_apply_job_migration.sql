-- =====================================================================
-- SKILLORA - DIRECT JOB APPLICATION & RESUME VAULT MIGRATION (v3)
-- Run this in Supabase -> SQL Editor to add direct application support.
-- Safe to re-run (idempotent).
-- =====================================================================

-- 1. Add extra candidate fields to public.job_applications
alter table public.job_applications add column if not exists current_city text;
alter table public.job_applications add column if not exists current_state text;
alter table public.job_applications add column if not exists work_status text;
alter table public.job_applications add column if not exists preferred_location text;
alter table public.job_applications add column if not exists sector text;
alter table public.job_applications add column if not exists target_role text;
alter table public.job_applications add column if not exists qualification text;

-- 2. Allow both authenticated and anonymous candidates to submit job applications
alter table public.job_applications enable row level security;
drop policy if exists apps_insert on public.job_applications;
drop policy if exists "Anyone can submit job application" on public.job_applications;

create policy apps_insert on public.job_applications for insert to anon, authenticated
  with check (stage = 'Applied' and (user_id is null or user_id = auth.uid()));

-- Grant insert privilege to anon role on job_applications
grant insert on public.job_applications to anon, authenticated;

-- 3. Storage bucket: allow candidates to upload their resume securely into the 'resumes' bucket
-- Resumes are stored under <user_id>/... or direct_applications/...
drop policy if exists resumes_insert_direct on storage.objects;
create policy resumes_insert_direct on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'resumes');

-- Note: Viewing/downloading resumes remains strictly locked to the candidate (own resume)
-- and authorized administrators/employers via signed temporary URLs.
