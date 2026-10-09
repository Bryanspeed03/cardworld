# Card World

An offline-first inventory and profit tracker for **Bryan's Card World**, a sports and Pokémon card business that sells at local shows and online.

It tracks every card bought and sold, splits lot purchases across cards by comp value, follows cards through PSA grading, totals show results after table costs, and works out how much profit to reinvest, set aside for taxes, and pay out. It installs as an app on iPhone, Mac, and Windows, and keeps working with no internet at card shows.

## How it's built

```
 iPhone / Mac / Windows (installed web app)
 ┌─────────────────────────────────────────┐
 │  App files (HTML, CSS, JS)              │◄── cached by a service worker,
 │                                         │    so the app opens offline
 │  Local copy of data + change queue      │◄── localStorage: every change
 │                                         │    is saved here first
 └───────────────┬─────────────────────────┘
                 │ HTTPS, when online
                 ▼
 ┌─────────────────────────────────────────┐
 │  Supabase (Postgres + Auth)             │
 │  Row Level Security: each user can only │
 │  read and change their own rows         │
 └─────────────────────────────────────────┘
        Hosting: GitHub Pages (static files)
```

- **Hosting:** GitHub Pages serves the static files. No server code.
- **Database:** Supabase Postgres. Schema and security rules are in [`supabase/schema.sql`](supabase/schema.sql).
- **Login:** Supabase Auth with email and password.
- **Security:** The Supabase key in `js/config.js` is public by design. Access is enforced in the database by Row Level Security policies (`user_id = auth.uid()`) on every table. New sign-ups are turned off after the owner's account is created.
- **Offline sync:** Every change is written to the device first and queued. The queue uploads in order when the connection returns. Each change is an upsert of the full row with a client-generated UUID, so a retry after a dropped connection can't create duplicates. On startup and when returning online, the app pulls a fresh copy from the database and layers any unsent changes on top. See [`js/store.js`](js/store.js).
- **Money math:** Kept separate from the screens in [`js/calc.js`](js/calc.js).

## Files

| Path | What it does |
| --- | --- |
| `index.html` | Page structure for every screen |
| `css/app.css` | Styles, colors from the logo, phone and laptop layouts |
| `js/app.js` | Screens, forms, and buttons |
| `js/store.js` | Local storage, change queue, sync with Supabase |
| `js/calc.js` | Profit, buy %, sell %, lot splits, pay split |
| `js/config.js` | Supabase project URL and public key |
| `sw.js` | Service worker that saves the app for offline use |
| `manifest.webmanifest` | App name and icons for installing |
| `supabase/schema.sql` | Database tables and security rules |
| `vendor/supabase.js` | Supabase client library (v2.117.1), saved locally so it works offline |

## Setup

1. **Database.** Create a Supabase project. Open **SQL Editor**, paste `supabase/schema.sql`, and run it.
2. **Connect.** Copy the project URL and the public (anon/publishable) key into `js/config.js`.
3. **Host.** Push the repo to GitHub. In **Settings → Pages**, deploy from the `main` branch, root folder.
4. **Auth.** In Supabase **Authentication → URL Configuration**, set the Site URL to the GitHub Pages address.
5. **Account.** Open the site, create your account, and confirm your email.
6. **Lock it down.** In Supabase **Authentication → Sign In / Providers**, turn off "Allow new users to sign up".
7. **Install.** iPhone: Safari → Share → Add to Home Screen. Mac: Safari → File → Add to Dock. Windows: Edge or Chrome → Install app.

## Updating the app

After changing any file, bump `VERSION` in `sw.js` (for example `cw-v1` → `cw-v2`) so installed copies pick up the change. Then commit and push.

## Credits

Most of the code was written with Claude (Anthropic) as an AI coding assistant. I set up and configured the hosting, database, login, and security rules, and own the design decisions and how the app is run.

Font: Archivo (SIL Open Font License, see `fonts/OFL-LICENSE`). Supabase client: MIT License (see `vendor/supabase-LICENSE`).
