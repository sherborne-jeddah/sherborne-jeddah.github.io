# CCA Planner

Club (CCA) timetable planner for Sherborne School Jeddah, as an installable app for iPhone, Android and computers.
It is the "Obsolete" Claude artifact turned into a standalone web app (PWA).

**Live app:** https://sherborne-jeddah.github.io/ (repo sherborne-jeddah/sherborne-jeddah.github.io) · Supabase project `cca-planner` (org "Sherborne CCA")

**Email links are scanner-proof:** school mail scanners open links automatically, so the Supabase *Invite user* and *Reset password* email templates link to `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery`). The one-time code is only used when the person taps **Continue** in the app.

- **Front end:** plain HTML/JS, no build step. Hosted free on GitHub Pages.
- **Data:** Supabase (Postgres + sign-in + live updates). Everyone sees the same timetable, and changes appear on every open copy at once.
- **Who can do what:** anyone with an account can view the timetable and take attendance registers; only emails listed in the `cca_editors` table can change clubs and students.
- **Attendance:** the Attendance tab opens on today's date (teachers can pick another date). Tap a club, tap the students who are absent, Save register. The Absence report tab filters by period, class and club and exports to Excel (Summary, Absences, By student, Registers, Not taken).

This repository holds **code only**. The student/club export lives in `_private/` (git-ignored) and goes straight into Supabase.

| File | What it is |
| --- | --- |
| `index.html` | The planner (overview, by day, clubs, classes, students, locations & staff, Excel import/export) |
| `js/ccadb.js` | Sign-in screen + Supabase data layer |
| `config.js` | Supabase address and publishable key |
| `supabase/schema.sql` | Tables, permissions and live updates |
| `_private/seed.sql` | Current 82 clubs + 242 students from the artifact (private) |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable |
| `tools/` | Icon maker, seed maker, local test server |

## One-time setup (about 20 minutes)

### 1. Supabase project
1. Sign in at supabase.com → **New project** → name `cca-planner`, pick a region near Jeddah (e.g. Frankfurt), save the database password somewhere safe.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. New query → paste all of `_private/seed.sql` → **Run**. (Loads the current clubs and students.)
4. **Authentication → Sign In / Providers → Email:** turn **off** "Allow new users to sign up" (only you create accounts).
5. **Project Settings → API keys:** copy the **Project URL** and the **publishable** (anon) key into `config.js`. Never use the secret/service_role key.

### 2. Accounts
- **Authentication → Users → Add user → Create new user**, enter the teacher's email + a starter password, tick **Auto Confirm User**. Send them the link and starter password yourself (Teams, WhatsApp, in person); they change it with **Change password** at the top of the app. Prefer this over "Send invitation": the school mail scanner opens emailed links and uses them up, and the built-in Supabase email only sends a few messages an hour.
- To let someone edit, add their email in **Table Editor → cca_editors** (or run `insert into cca_editors(email) values ('name@school.com');`).
- People without a row in `cca_editors` can view, export and take registers, but cannot change the timetable.

### 3. Publish (GitHub Pages)
1. Create a new GitHub repository, e.g. `cca-planner`, and push this folder to it.
2. Repository **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
3. After a minute the app is live (here: `https://sherborne-jeddah.github.io/`).
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to that address (needed for "Forgot password" emails).

## Installing on phones

**iPhone / iPad (Safari):** open the link → **Share** button → **Add to Home Screen** → Add.
**Android (Chrome):** open the link → tap **Install** (or ⋮ menu → **Install app** / **Add to Home screen**).
**Computer (Chrome / Edge):** open the link → install icon in the address bar.

The app gets the school crest as its icon, opens full screen, and updates itself automatically whenever a new version is pushed.

## Updating

- Change the code, bump `CACHE` in `sw.js` and `APP_VERSION` in `config.js`, push. Phones pick it up next time the app opens.
- To try it on this computer first: `powershell -ExecutionPolicy Bypass -File tools\serve.ps1` then open http://localhost:8642/.
- Regenerate icons after changing `icons/crest-source.png`: `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`.

## Later: App Store / Play Store

If the school wants store listings, this same folder can be wrapped with Capacitor (or PWABuilder.com for Android).
That needs a Google Play developer account ($25 once), an Apple Developer account ($99/year) and a Mac or cloud build service for iOS.

## Staff access code (first sign-in)

Teachers can join on their own: they sign in with their **@sherbornejeddah.sa** email and the staff access code.
The server (`cca_join` in `supabase/schema.sql`) checks the code, creates a **teacher** account, and the app then
makes them choose their own password; after that the code no longer works for their email. Editors are still only
the emails in `cca_editors`. 20 wrong codes in 15 minutes pause joining for everyone.

- The code is stored only as a bcrypt hash in `cca_settings`. Never write it into this repo or the install guide.
- **Change the code** (SQL Editor, run on its own, don't save the snippet):
  `insert into public.cca_settings (key, value) values ('join_code_hash', extensions.crypt('NEW-CODE', extensions.gen_salt('bf'))) on conflict (key) do update set value = excluded.value;`
- **Turn it off:** `delete from public.cca_settings where key = 'join_code_hash';`
- **See who joined:** Authentication → Users (or `select email, created_at from auth.users order by created_at desc;`). Delete anyone who shouldn't be there.
- **Forgotten password:** Authentication → Users → the user → "Reset password" won't help (email links get used up by the school mail scanner); instead delete the user so they can join again with the code, or set a temporary password for them.
