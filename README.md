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
4. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Players start as guests and can add an email later.
5. Go to **Authentication → URL Configuration** and set **Site URL** to your Vercel address (for example `https://skinrush.vercel.app`). Email sign-in links go there.
6. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable** key. Never use the `service_role` / secret key in this site; the build refuses it.

### 2. Put the site online (Vercel)

1. Push this folder to a GitHub repository.
2. In [vercel.com](https://vercel.com) choose **Add New → Project** and import the repository. Leave **Framework Preset** as **Other**; `vercel.json` already sets the build command and output folder.
3. Under **Environment Variables**, add:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_ANON_KEY`: the anon / publishable key

   If you connect Supabase through Vercel's **Integrations** page instead, these variables are added for you.
4. Click **Deploy**. Open the site on your PC and phone. Each device starts as a guest; use the person icon → **Save progress** to attach an email, then sign in with that email on the other device.

With the Vercel CLI instead of GitHub: run `vercel` in this folder, add the two variables when asked or with `vercel env add`, then run `vercel --prod`.

## Run locally

- **Demo mode:** open `index.html`.
- **Supabase mode:** paste your URL and anon key into `js/config.js`, then serve the folder over http (`npm run preview`). Opening the file directly also works.
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

Each rule exists twice: in `js/game.js` for local mode and in `supabase/migrations/0001_skinrush.sql` for Supabase mode. Change both together.

## Known limits

- **Guest accounts:** each new guest account starts with $2,000. Someone who clears their browser gets a fresh $2,000. To stop that, turn off anonymous sign-ins and require email sign-in.
- **Quiz images:** the quiz picture comes from the public sprite sheets, so a determined player could look up which skin a picture is. Serve quiz images from the server to close this.
- **Prices:** prices are a Skinport snapshot from October 2026, and the som rate is fixed (1 USD = 11,814 so'm). Blue Gem prices are fixed showcase values.

## Files

```
index.html, css/, sprites/       the site (sprites = all skin images packed into 22 sheets)
js/data.js                       skins and cases (generated)
js/core.js                       money format, state, provably fair, sound, modals
js/game.js                       game rules, local mode
js/game-supabase.js              game rules via Supabase RPCs, sign-in, live drops
js/reel.js, pages.js, app.js     reel animation, pages, router and header
supabase/migrations/…sql         database schema, security rules, game functions
supabase/seed.sql                catalog for the database (generated)
scripts/build.js                 Vercel build: copies the site to dist/ and writes the config
scripts/make-seed.js             regenerates supabase/seed.sql from js/data.js
vercel.json, package.json        Vercel settings
```
