# MoneyFlow

MoneyFlow is a local-first personal finance tracker built with React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts, Lucide React, and Capacitor. It runs in a browser as a PWA or as a packaged Android app. Authenticated accounts can sync the supported finance dataset through an owner-scoped atomic outbox; local-only mode remains available. User A/B hosted acceptance and isolated browser-driven first-login Import/Skip acceptance are complete. Production deployment and physical-device release checks remain open.

## Run locally

Use Node.js 22.12+ (or a supported newer LTS) and npm for Vite and Capacitor 8.

- `npm install`
- `npm run dev`
- `npm run build` for a production build
- `npm run lint` for ESLint
- `npm test` for backup and finance regression tests

Vite prints the local development URL after the dev server starts.

## Build and install Android

The native Android project is generated under `android/`. Capacitor packages `dist/` into the APK; the installed app does not need this laptop, an HTTPS host, a hotspot, or a development server to run. The browser build includes a web manifest, a service worker, and automatic worker updates. Offline full-page reload and the current service-worker update check passed in local production preview. Vercel deployment, Android Chrome installation, and standalone launch remain unverified.

On a Windows development machine:

1. Install Android Studio with JDK 21, Android SDK Platform 36, and its SDK Build Tools. Set `JAVA_HOME` to JDK 21 and configure the SDK through Android Studio or an untracked `android/local.properties` file.
2. Run `npm install`, then `npm run android:sync` to build and copy the latest web assets and native plugins.
3. Run `npm run android:open` to open the project in Android Studio, or `npm run android:apk` to assemble a debug APK.
4. After a successful build, the debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Transfer the APK to your Android phone and permit installation from your chosen trusted source, or install through Android Studio on a USB-connected phone.

Android 7.0/API 24 or newer is configured. Keep Android System WebView updated. For daily use, generate a signed release APK through Android Studio, protect its signing key, and keep the same signing key, application ID (`com.moneyflow.personal`), and local WebView origin (`https://localhost`) for updates. Increment the Android versionCode for each release. Do not uninstall to update: uninstalling or clearing app storage removes local records.

This workspace currently has no detected Java or Android SDK installation. APK assembly was attempted and stopped because `JAVA_HOME` is unset and Java is unavailable. No APK or device installation has been verified here. See [ANDROID_AUDIT.md](ANDROID_AUDIT.md) for evidence and the device acceptance checklist.

## Move your records to your phone

1. On the desktop app, open Settings > Backup & recovery > Export JSON. Verify the file was saved; filenames follow `MoneyFlow_Backup_YYYY_MM_DD.json`.
2. Transfer the file locally to the phone. Desktop browser storage and the Android app are separate; data does not move automatically.
3. In the phone app, open More > Backup & recovery > Import JSON. Review the collection counts and confirm replacement.
4. Export a second backup from the phone and verify you can read it before deleting any desktop copy.

Backup import rejects unsupported schema versions, invalid records, missing account references, and duplicate IDs. Legacy schema 1/2 and unversioned files, schema 3–6 backups, and schema 7 backups are validated and normalized; current schema 7 exports include goals, budgets, schedules/occurrences, reservations, notes, notifications, and activity history. An exact, bounded on-device pre-import recovery snapshot is written and verified before replacement. Failed storage writes stop restore. The recovery button asks for confirmation through the same validation workflow.

Create backup now saves an on-device recovery snapshot; it is not a second-device backup. Export JSON creates a browser download or opens Android's native share sheet. Choose a trusted local file destination and verify that the receiving app saved the file: share-sheet completion cannot guarantee that. Original storage can also be extracted for manual repair if a legacy record fails validation; this rescue file is not a standard import backup.

Backups are unencrypted JSON containing personal finance records. Keep a separate local copy. Android automatic cloud backup and automatic device transfer are disabled; moving records is explicit import/export. LocalStorage has finite capacity and is not an encrypted application database. A device restart should retain app storage, but uninstall, storage clearing, device loss, and storage failure can remove it.

## Features

- Dashboard with balance, monthly expenses, savings, budget remaining, category spending, six-month cash-flow trends, recent activity, budget progress, savings rate, and a financial health indicator.
- Income, expense, and savings entries with editing, deletion, and transaction search and filters.
- Contributions with date-driven pending, scheduled, historical, and paid states; paid records use a linked, idempotent expense ledger entry that can be safely edited or reversed on delete.
- Savings breakdowns and goals with progress, deadlines, remaining amounts, and account-linked contributions that can reserve funds or pay money out.
- Account and global available balances that distinguish physical money from savings, goal, and planned-spending allocations.
- Searchable permanent activity history and calendar notes that do not affect finance totals.
- Monthly category budgets with safe, warning, and exceeded states.
- Spending calendar with selected-day expense, income, savings, activity, daily limits, and no-spend highlighting.
- Analytics for category ranking, average daily and monthly spending, monthly comparisons, savings growth, and highest-spend day.
- Local budget and goal alerts, installable PWA support, light/dark theme, JSON backup export/import, and confirmed data clearing.
- Responsive navigation, accessible keyboard-operable controls, and reduced-motion support.

## Data and privacy

Zustand persists anonymous finance records in LocalStorage under the unchanged `moneyflow-data-v1` key with persistence version 7; authenticated caches use a per-user LocalStorage key. Theme and accent sync through the authenticated profile. Migrations preserve existing records and create a pre-migration backup when upgrading old persisted versions. Analytics are derived from the preserved ledger rather than exported as separate stale totals. A local validation warning never replaces existing records; use original-storage extraction for recovery. Supabase auth requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; only a publishable key belongs in frontend configuration.

Authenticated atomic sync covers accounts, transactions, transfers, budgets, goals/contributions, schedules/occurrences, planned spending, reservations, notes, notifications, activity history, and profile preferences. A per-user durable outbox retries after reload/reconnect and retains records on conflicts. Choosing Skip Import preserves legacy records in the authenticated user's local cache and keeps that user's data local-only until explicitly imported. Browser-driven Import/Skip acceptance used isolated synthetic Auth/API fixtures; it did not write to the accepted User A/B datasets. These local checks do not replace production verification. In-app scheduled plans are processed on app load/resume; there is no background scheduler, push service, bank API, or external analytics service. The sync indicator reports outbox status, not proof by itself that hosted records match.

## Production deployment

Reconnect this GitHub repository to the existing MoneyFlow Vercel project; do not create a duplicate project or Supabase project. This workspace has no local `.vercel/project.json` link. The Git remote is `origin` (`https://github.com/keysiiiiiiii/moneyflow.git`), and production should deploy from `main` after the reviewed changes are committed and pushed.

Use these Vercel project settings:

- Framework Preset: `Vite`
- Root Directory: `.`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js: `22.x` (project minimum is Node 22.12; newer supported LTS is fine)

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production. Add the same two values to Preview only if you intend to test authenticated previews; use a disposable QA account because previews will connect to the configured Supabase project. Without Preview values, previews remain unauthenticated/local-only. Never add a Supabase secret or service-role key to Vercel frontend variables.

`vercel.json` supplies the Vite SPA fallback to `/index.html`, disables caching for `/` and `/index.html`, and revalidates `/sw.js` and `/manifest.webmanifest`. Vite's hashed assets retain Vercel's normal immutable caching. In Supabase Auth > URL Configuration, set Site URL to the exact production origin (`https://<production-domain>/`). Allow the exact app redirect (`https://<production-domain>`) and `https://<production-domain>/**`. If authenticated Vercel previews are enabled, add the narrower team-scoped pattern `https://*-<vercel-team-or-account-slug>.vercel.app/**`; replace the placeholder with the actual Vercel scope slug. The production domain and Vercel scope are not present in this workspace, so obtain both from the existing Vercel project before saving these URLs.

After deploying, verify production login, authenticated sync, cache headers, worker update, and offline reload. Do not mark the release ready before production HTTPS/Auth/cloud-sync and Android Chrome/physical-device acceptance pass.

The PWA service worker precaches the app shell and removes older MoneyFlow caches during activation. Offline full-page reload and a service-worker update check passed in the current local production preview; Vercel production behavior and Android standalone launch remain unverified. In-app scheduled plans are processed on app load/resume; there is no background scheduler, push service, bank API, or external analytics service.

Official Maya and BDO site icons are bundled locally from `https://www.maya.ph/favicon.ico` and `https://www.bdo.com.ph/favicon.ico`. Other institutions retain existing Lucide fallbacks and institution labels until verified official assets can be obtained. No runtime institution-logo requests are made.

## Project layout

- `src/types.ts`: finance entity and store contracts.
- `src/store.ts`: LocalStorage-persisted finance state and mutations.
- `src/lib/finance.ts`: currency/date formatting and derived analytics.
- `src/components/EntryDialog.tsx`: validated create/edit forms.
- `src/components/RecordDialog.tsx`: profile, account, contribution, scheduled-spending, and reconciliation forms.
- `src/MoneyFlowApp.tsx`: navigation, pages, charts, and interactions.
- `src/App.css` and `src/index.css`: responsive component styles and theme tokens.
