-- CCA Planner database. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Clubs and students are stored as one JSON document per row, exactly as the planner uses them.

create table if not exists public.cca_clubs (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);
create table if not exists public.cca_students (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);
-- Attendance registers: one row per club session per date (id = "<yyyy-mm-dd>__<club id>").
-- data = { date, day, club, clubName, teacher, students:[{id,name,cls}], absent:[{id,name,cls}], by, at }
create table if not exists public.cca_registers (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);
-- Who may change the timetable. Everyone else who can sign in can view it and take registers.
create table if not exists public.cca_editors (
  email text primary key
);

alter table public.cca_clubs    enable row level security;
alter table public.cca_students enable row level security;
alter table public.cca_editors  enable row level security;
alter table public.cca_registers enable row level security;

create or replace function public.cca_is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cca_editors where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Read: any signed-in user. Write: editors only.
drop policy if exists cca_clubs_read on public.cca_clubs;
drop policy if exists cca_clubs_write on public.cca_clubs;
drop policy if exists cca_students_read on public.cca_students;
drop policy if exists cca_students_write on public.cca_students;
create policy cca_clubs_read     on public.cca_clubs    for select to authenticated using (true);
create policy cca_clubs_write    on public.cca_clubs    for all    to authenticated using (public.cca_is_editor()) with check (public.cca_is_editor());
create policy cca_students_read  on public.cca_students for select to authenticated using (true);
create policy cca_students_write on public.cca_students for all    to authenticated using (public.cca_is_editor()) with check (public.cca_is_editor());
-- Registers: every signed-in teacher can read and take them.
drop policy if exists cca_registers_read on public.cca_registers;
drop policy if exists cca_registers_write on public.cca_registers;
create policy cca_registers_read  on public.cca_registers for select to authenticated using (true);
create policy cca_registers_write on public.cca_registers for all    to authenticated using (true) with check (true);
-- cca_editors has no policies: it is managed from the Supabase dashboard only.
-- Table access for signed-in users (the policies above decide which rows). Nothing for anonymous visitors.
grant select, insert, update, delete on public.cca_clubs, public.cca_students, public.cca_registers to authenticated;
revoke all on public.cca_clubs, public.cca_students, public.cca_registers, public.cca_editors from anon;
revoke all on public.cca_editors from authenticated;

-- Merge one JSON object into another, nested objects included (arrays and values are replaced).
create or replace function public.cca_jsonb_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; r jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then
    return b;
  end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    r := jsonb_set(r, array[k], public.cca_jsonb_merge(r -> k, v), true);
  end loop;
  return r;
end $$;

create or replace function public.cca_table(p_col text) returns regclass
language plpgsql immutable as $$
begin
  if p_col = 'clubs' then return 'public.cca_clubs'::regclass;
  elsif p_col = 'students' then return 'public.cca_students'::regclass;
  elsif p_col = 'registers' then return 'public.cca_registers'::regclass;
  else raise exception 'unknown collection %', p_col; end if;
end $$;

drop function if exists public.cca_guard();
create or replace function public.cca_guard(p_col text) returns void
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  -- Registers: any signed-in teacher. Clubs and students: editors only.
  if p_col <> 'registers' and not public.cca_is_editor() then
    raise exception 'You do not have permission to edit the timetable' using errcode = '42501';
  end if;
end $$;

-- Writes used by the app. They run as the signed-in user, so the policies above still apply.
create or replace function public.cca_set(p_col text, p_id text, p_data jsonb) returns void
language plpgsql set search_path = public as $$
begin
  perform public.cca_guard(p_col);
  execute format('insert into %s (id, data, updated_at, updated_by) values ($1, $2, now(), auth.uid())
                  on conflict (id) do update set data = excluded.data, updated_at = now(), updated_by = auth.uid()', public.cca_table(p_col))
    using p_id, coalesce(p_data, '{}'::jsonb);
end $$;

create or replace function public.cca_patch(p_col text, p_id text, p_patch jsonb) returns void
language plpgsql set search_path = public as $$
declare n int;
begin
  perform public.cca_guard(p_col);
  execute format('update %s set data = public.cca_jsonb_merge(data, $2), updated_at = now(), updated_by = auth.uid() where id = $1', public.cca_table(p_col))
    using p_id, coalesce(p_patch, '{}'::jsonb);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Record % not found', p_id using errcode = 'P0002'; end if;
end $$;

create or replace function public.cca_delete(p_col text, p_id text) returns void
language plpgsql set search_path = public as $$
begin
  perform public.cca_guard(p_col);
  execute format('delete from %s where id = $1', public.cca_table(p_col)) using p_id;
end $$;

revoke all on function public.cca_set(text, text, jsonb), public.cca_patch(text, text, jsonb), public.cca_delete(text, text) from anon, public;
grant execute on function public.cca_set(text, text, jsonb), public.cca_patch(text, text, jsonb), public.cca_delete(text, text), public.cca_is_editor() to authenticated;

-- Live updates to every open copy of the app.
do $$ begin
  begin alter publication supabase_realtime add table public.cca_clubs;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.cca_students; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.cca_registers; exception when duplicate_object then null; end;
end $$;
