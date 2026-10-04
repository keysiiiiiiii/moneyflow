# MoneyFlow

MoneyFlow is a local-first personal finance tracker built with React, TypeScript, Vite, Tailwind CSS, Zustand, Recharts, Lucide React, and Capacitor. It runs in a browser or as a packaged Android app. No login, backend, cloud storage, or cloud sync is implemented.

## Run locally

Use Node.js 22.12+ (or a supported newer LTS) and npm for Vite and Capacitor 8.

- `npm install`
- `npm run dev`
- `npm run build` for a production build
- `npm run lint` for ESLint
- `npm test` for backup and finance regression tests

Vite prints the local development URL after the dev server starts.

## Build and install Android

The native Android project is generated under `android/`. Capacitor packages `dist/` into the APK; the installed app does not need this laptop, an HTTPS host, a hotspot, or a development server to run. The browser version is not an offline PWA.

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

Backup import rejects unsupported schema versions, invalid records, missing account references, and duplicate IDs. Legacy schema 1/2 and unversioned files can be validated and normalized; current schema 3 exports require all collections. An exact, bounded on-device pre-import recovery snapshot is written and verified before replacement. Failed storage writes stop restore. The recovery button asks for confirmation through the same validation workflow.

Create backup now saves an on-device recovery snapshot; it is not a second-device backup. Export JSON creates a browser download or opens Android's native share sheet. Choose a trusted local file destination and verify that the receiving app saved the file: share-sheet completion cannot guarantee that. Original storage can also be extracted for manual repair if a legacy record fails validation; this rescue file is not a standard import backup.

Backups are unencrypted JSON containing personal finance records. Keep a separate local copy. Android automatic cloud backup and automatic device transfer are disabled; moving records is explicit import/export. LocalStorage has finite capacity and is not an encrypted application database. A device restart should retain app storage, but uninstall, storage clearing, device loss, and storage failure can remove it.

## Features

- Dashboard with balance, monthly expenses, savings, budget remaining, category spending, six-month cash-flow trends, recent activity, budget progress, savings rate, and a financial health indicator.
- Income, expense, and savings entries with editing, deletion, and transaction search and filters.
- Contributions with date-driven pending, scheduled, historical, and paid states; paid records use a linked, idempotent expense ledger entry that can be safely edited or reversed on delete.
- Savings breakdowns and goals with progress, deadlines, remaining amounts, and contributions.
- Monthly category budgets with safe, warning, and exceeded states.
- Spending calendar with selected-day expense, income, savings, activity, daily limits, and no-spend highlighting.
- Analytics for category ranking, average daily and monthly spending, monthly comparisons, savings growth, and highest-spend day.
- Local budget and goal alerts, light/dark theme, JSON backup export/import, and confirmed data clearing.
- Responsive navigation, accessible keyboard-operable controls, and reduced-motion support.

## Data and privacy

Zustand persists finance records in LocalStorage under the unchanged `moneyflow-data-v1` key with persistence version 3; theme and accent preferences are separate. No finance-store migration was introduced by the Android conversion. Fresh app installs start empty. Analytics are derived from the preserved ledger rather than exported as separate stale totals. A local validation warning never replaces existing records; use original-storage extraction for recovery. The local profile is optional display information, not an authenticated user account.

All tracking calculations and mutations operate offline. In-app scheduled plans are processed on app load/resume using the existing rules; there is no background scheduler, push service, bank API, or external analytics service. The offline indicator reports device/browser connectivity, not access to any finance backend.

Official Maya and BDO site icons are bundled locally from `https://www.maya.ph/favicon.ico` and `https://www.bdo.com.ph/favicon.ico`. Other institutions retain existing Lucide fallbacks and institution labels until verified official assets can be obtained. No runtime institution-logo requests are made.

## Project layout

- `src/types.ts`: finance entity and store contracts.
- `src/store.ts`: LocalStorage-persisted finance state and mutations.
- `src/lib/finance.ts`: currency/date formatting and derived analytics.
- `src/components/EntryDialog.tsx`: validated create/edit forms.
- `src/components/RecordDialog.tsx`: profile, account, contribution, scheduled-spending, and reconciliation forms.
- `src/MoneyFlowApp.tsx`: navigation, pages, charts, and interactions.
- `src/App.css` and `src/index.css`: responsive component styles and theme tokens.
