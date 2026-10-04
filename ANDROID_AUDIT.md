# MoneyFlow Android Conversion Audit

Date: October 3, 2026

## Conversion path

Capacitor 8 packages the React/Vite production build into a native Android project. `webDir` is `dist`; there is no remote `server.url`. No PWA fallback is necessary for APK packaging. No login, cloud storage, sync, subscription, or multi-user system was added.

The existing Zustand store, LocalStorage key, persistence version, finance mutation rules, and finance calculations remain unchanged. Android uses a separate local WebView storage sandbox, so existing desktop data must be explicitly exported and imported. The conversion did not read, migrate, or overwrite the user's real browser records during automated tests.

## Requested audit

1. **Can an APK be generated?** The Android Gradle project and wrapper are present, and Windows build/sync scripts are configured. This machine cannot currently compile an APK: an `assembleDebug` attempt fails because Java is absent and `JAVA_HOME` is unset; no Android SDK was detected. Install JDK 21 and SDK Platform 36/Build Tools through an approved Android Studio installation first.
2. **Can the app now be installed?** Not yet verified: no APK was produced here. After compiling, install the debug APK for acceptance testing; use a consistently signed release APK for daily use. Keep the same application ID, signing key, and WebView origin for updates.
3. **What works offline?** Packaged screens/assets; expense, income, savings, account and contribution records; transfers; goals; budgets; calendar; scheduled-plan processing on app use; derived analytics; settings; local snapshots; and JSON import/export through local Android file/share destinations. No finance workflow requires a backend.
4. **What limitations remain?** Android cold launch, process termination, device restart, keyboard/system-bar behavior, and native file picker/share completion require real-device or emulator tests. LocalStorage and JSON backups are not application-level encrypted. Storage clearing/uninstall can destroy records. There is no automatic cross-device recovery, background scheduler, or sync. Remaining official institution logos are not yet verified/bundled; Maya and BDO official site icons are included, others use Lucide fallbacks. A large production bundle warning remains.
5. **Before cloud sync:** separate, explicitly approved design for opt-in data transfer, identity, encryption, authorization, conflict resolution, backups, deletion, version migrations, and security testing. None was implemented.
6. **Before login/authentication:** a separately approved identity provider/backend, secure session/token handling, recovery, privacy controls, and authorization tests. Optional display-profile fields are not an account system. None was implemented.

## Implemented safety and mobile behavior

- Validated schema-3 JSON exports; legacy-file compatibility; schema/version, amounts, dates, profile, reference, and duplicate checks.
- Record-count summary and keyboard-operable confirmation sheet before overwrite; verified pre-import recovery snapshot; original-storage rescue extraction; last backup timestamp.
- Android native file sharing through Capacitor Filesystem/Share, with bounded cached files retained through receiver handoff. Browser downloads remain available. Sharing to an external app is an explicit user decision; choose a local destination.
- OS automatic cloud backup and automatic device transfer disabled through the manifest and extraction rules.
- Main tabs: Dashboard, Expenses, Goals, Budget, More. More contains Accounts, Savings, Contributions, Calendar, Analytics, Settings, plus Notifications and Backup & recovery.
- Mobile sheets, sticky form actions, scroll lock, 44+ px targets, 16 px inputs, native CSS safe-area inset fallbacks, Android Back handling, date refresh on app visibility resume, and offline indicator.
- Six-action thumb-friendly FAB with staggered motion and dismiss backdrop. Account cards include existing balances and explicitly linked savings allocations/plan reservations, without changing derived balance calculations.

## Verification performed

- Automated backup tests cover valid legacy field preservation; unsupported/missing schemas; invalid dates/amounts/profile; missing account references; duplicate IDs; and recovery-write failure.
- Automated unchanged-store tests cover expense/income/savings recording, transfer total invariance and insufficient-funds rejection, budgets, goals, idempotent contribution payment, populated collection export/import round trip, equivalent analytics, and module reload persistence without network access.
- Browser tests ran on a separate `127.0.0.1:4175` origin with synthetic records only. Empty and populated pages were checked at 320/360/390 px; desktop was checked at 1440 px. No horizontal document overflow was detected.
- Confirmed restore summary, cancellation without mutation, no changes before confirmation, successful restore, and presence of a recovery snapshot.
- Verified generated JSON filename `MoneyFlow_Backup_2026_10_03.json`, schema 3 and collection counts. Integrated-browser automation does not expose a completed-download event; the generated file content was inspected instead. Native share/file-save behavior is not yet verified.
- Browser reload retains synthetic records; browser-offline expense recording persists. Sheet settles at viewport bottom; background scroll is restored after dismissal. Simulated 24 px native top/bottom insets move controls clear of bars. Official Maya asset loads from the local bundle.
- Final TypeScript compilation and Vite production build succeeded. The Android packaged index references the same final `index-CKMvXcAD.js` and `index-VHa_uVH2.css` assets as `dist`; both official institution images and App/Filesystem/Share plugin registration are packaged. Rebuild and sync after any source change.
- All 10 final regression tests passed, including a fully populated current-schema round trip. Current records bypass legacy normalization so contribution fields are preserved exactly.
- Changed source has no editor diagnostics. Full ESLint invocations returned no diagnostics but intermittent terminal execution/report capture prevented a definitive final lint report; rerun `npm run lint` locally before release.
- Dependency installation reported three moderate advisories. A complete advisory report was not captured in this environment; review `npm audit` before signing a daily-use release. Do not apply breaking `--force` fixes without testing.
- APK assembly was attempted: blocked by missing Java/toolchain, not a confirmed successful Android build.

## Required phone acceptance test

1. Create and verify a desktop JSON backup; keep it separate. Do not uninstall or clear old data during testing.
2. Compile and install an APK on a test phone or emulator, then import the synthetic fixture from `tests/fixtures/mobile-backup.json` before importing real records.
3. Record income, an expense, savings, a contribution and a transfer; create a budget and goal; reconcile a plan. Compare totals with the desktop fixture.
4. Export through the Android share sheet to a local destination. Verify the actual saved file, import it, inspect the summary, cancel once, then confirm. Test the recovery snapshot too.
5. Force-stop/reopen, reboot the phone, and cold-launch in airplane mode. Verify every collection and continue tracking offline. Test native file import/export without network.
6. Verify gesture and three-button navigation, display cutouts, keyboard resize, Android Back, small screens, large text, landscape, and reduced motion.
7. Install an update signed by the same key without uninstalling. Confirm records remain available. Only then move the primary tracker to the phone and import the real desktop backup.

## Build commands

```powershell
npm install
npm test
npm run build
npm run lint
npm run android:sync
npm run android:open
npm run android:apk
```

APK output after a successful build: `android/app/build/outputs/apk/debug/app-debug.apk`. Never commit signing secrets or local SDK paths. Protect release signing material outside the repository.