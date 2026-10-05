# SkinRush

A demo CS2 skin site: 46 cases, upgrades, contracts, trades, a market of 2,114 skins and a free-money quiz every 15 minutes. All money is pretend. Prices show in US dollars or Uzbek som.

The site runs in one of two modes, chosen automatically:

| Mode | When | Where the rules run |
| --- | --- | --- |
| Local demo | `js/config.js` has no Supabase URL (double-click `index.html`, or the claude.ai page) | In the browser. Balance and skins live in this browser. |
| Supabase | `js/config.js` has a Supabase URL and anon key (set automatically on Vercel) | In Postgres functions. Players can't edit their balance from the browser. |

## Deploy: Supabase + Vercel

### 1. Create the database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**. Paste and run `supabase/migrations/0001_skinrush.sql`. This creates the tables, security rules and game functions.
3. Paste and run `supabase/seed.sql`. This loads the 2,114 skins and 46 cases.
   Then paste and run `supabase/migrations/0002_case_battles.sql`. This adds case battles.
4. Go to **Authentication → Sign In / Providers → Email** and turn **off** “Confirm email”. Players sign up with a username and password only. The site turns each username into an internal address (`name@skinrush.local`) that is never emailed.
5. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable** key. Never use the `service_role` / secret key in this site; the build refuses it.

### 2. Put the site online (Vercel)

1. Push this folder to a GitHub repository.
2. In [vercel.com](https://vercel.com) choose **Add New → Project** and import the repository. Leave **Framework Preset** as **Other**; `vercel.json` already sets the build command and output folder.
3. Under **Environment Variables**, add:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_ANON_KEY`: the anon / publishable key

   If you connect Supabase through Vercel's **Integrations** page instead, these variables are added for you.
4. Click **Deploy**. Then open the site and **create the admin account first** (see below).

With the Vercel CLI instead of GitHub: run `vercel` in this folder, add the two variables when asked or with `vercel env add`, then run `vercel --prod`.

## Accounts and admin

- The first time someone opens the site (Supabase mode), they see a login screen with **Log in** and **Create account**. Each needs only a username (3–20 lowercase letters, digits or _) and a password (6+ characters). A new account starts with $2,000.
- Usernames listed in the `public.admins` table become admins when they register. The migration lists `aziz`. Register that username yourself right after deploying, before anyone else can take it. The password is whatever you type when you register; it is never stored in this repository.
- Admins see a bar at the bottom of the page: enter a username (or leave it empty for yourself) and an amount, then press **Deposit**. The server checks the admin flag, caps each deposit at $1,000,000, and records every deposit in `public.admin_log`.
- To add another admin later, run this in the SQL Editor: `update public.profiles set is_admin = true where username = 'name';`

## Run locally

- **Demo mode:** open `index.html`.
- **Supabase mode:** put your URL and anon key in `.env` (copy `.env.example`; `.env` is never committed), then run `npm run preview`.
- **Rebuild the Vercel output:** `npm run build` writes `dist/`.

## Change prices or cases

`js/data.js` is the catalog for both modes. After editing it, run `npm run seed` to regenerate `supabase/seed.sql`, then run that file again in the SQL Editor. Prices that differ between the site and the database make the market and odds tables disagree with what the server charges.

## How the game rules work

- **Rolls** are provably fair: `HMAC-SHA256(server seed, "client seed:nonce")`, first 13 hex digits ÷ 2^52. The site shows the server seed's SHA-256 hash before play and reveals the seed when you rotate it. The checker in the shield-icon menu re-computes any roll.
- **Cases:** each case's odds sum to 100%. The average drop is worth about 90% of the case price (Souvenir: about 84%).
- **Upgrade:** stake 1–4 skins. Your win chance is `stake ÷ target × 0.95`, capped at 80%.
- **Contracts:** put in 3–10 skins and get one back. Its target value is `total × 0.25 × 16^(roll^2.07)`, between 0.25× and 4× the total and 0.9× on average. You get the catalog skin priced closest to that value.
- **Quiz:** every 15 minutes you get 3 tries to name a skin, worth $1,000. In Supabase mode the answer stays on the server.
- **Trade:** swap skins with the bot, with the value difference paid from or to your balance.
- **Case battles:** 1v1, 1v1v1, 1v1v1v1 or 2v2, with up to 25 rounds. Each player pays the sum of the case prices.
  - Every round, each seat opens the same case. The drop for round *r*, seat *s* comes from `HMAC-SHA256(battle seed, "<battle id>:<r>:<s>")`.
  - The team with the highest total takes every drop; in Crazy mode the lowest total wins. Ties are decided by `HMAC(seed, "<battle id>:tie")`.
  - On a 2-player team, drops are shared out most-expensive first, each to whoever has less so far.
  - The battle starts the moment the last seat fills. The creator can fill empty seats with bots (a bot's winnings go to the house) or cancel for a full refund.
  - The seed hash shows from the start and the seed is revealed at the end. **Verify this battle** re-rolls everything in your browser.

Each rule exists twice: in `js/game.js` for local mode and in `supabase/migrations/0001_skinrush.sql` for Supabase mode. Change both together.

## Known limits

- **New accounts:** each new account starts with $2,000, so one person can register several accounts. Turn off sign-ups in Supabase (Authentication → Sign In / Providers → “Allow new users to sign up”) if you only want people you create yourself.
- **Quiz images:** the quiz picture comes from the public sprite sheets, so a determined player could look up which skin a picture is. Serve quiz images from the server to close this.
- **Prices:** prices are a Skinport snapshot from October 2026, and the som rate is fixed (1 USD = 11,814 so'm). Blue Gem prices are fixed showcase values.

## Files

```
index.html, css/, sprites/       the site (sprites = all skin images packed into 22 sheets)
js/data.js                       skins and cases (generated)
js/core.js                       money format, state, provably fair, sound, modals
js/game.js                       game rules, local mode
js/game-supabase.js              game rules via Supabase RPCs, sign-in, live drops
js/battles.js                    case battles: rules (shared with the verifier), lobby, builder, battle room
js/reel.js, pages.js, app.js     reel animation, pages, router and header
supabase/migrations/0001_…sql    database schema, security rules, game functions
supabase/migrations/0002_…sql    case battles (run after 0001)
supabase/seed.sql                catalog for the database (generated)
scripts/build.js                 Vercel build: copies the site to dist/ and writes the config
scripts/make-seed.js             regenerates supabase/seed.sql from js/data.js
vercel.json, package.json        Vercel settings
```
