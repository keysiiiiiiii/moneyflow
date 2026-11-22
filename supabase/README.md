# Supabase Setup

This repository targets the existing MoneyFlow Supabase project. It does not create a project or use a service-role key in the browser.

## Current Deployment Status

The user confirmed that all three migrations in `supabase/migrations/` have already been applied to the existing MoneyFlow project. Do not execute the initial migration again or rerun these scripts against that project. The procedure below is retained for reference and fresh-schema deployments only; any future database change must use a new migration. Real User A/User B RLS acceptance passed for the tested operations; see `V2_AUDIT.md` for current evidence and remaining production/device gates.

## Local Configuration

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`: Project URL from the Supabase Dashboard → Connect dialog, or Integrations → Data API.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Publishable key from Supabase Dashboard → Project Settings → API Keys → Publishable key (`sb_publishable_...`). This key is intentionally frontend-visible; Row Level Security is the authorization boundary.

Never set a `service_role` or secret key in any `VITE_` variable or frontend file. `.env.local` is ignored by Git. The same two public values must be configured in Vercel Project Settings → Environment Variables for Preview and Production.

The runtime connectivity check uses the configured `@supabase/supabase-js` client. For a new `sb_publishable_...` key, the client sends the key through `apikey` and does not reuse that non-JWT value as a Bearer user token; a real authenticated session token is preserved. It queries `profiles` with a zero-row select. A PostgREST schema-cache/table-not-found response is reported as “API connected; migration pending,” which is expected before the first migration. If the client still receives `401 Secret API key required`, verify the URL and publishable key belong to the same project and that the Data API is enabled at Dashboard → Integrations → Data API. Never work around the response by placing a secret key in the frontend.

## Apply the Migration

### Dashboard SQL Editor (Current Deployment Path)

The corporate TLS trust issue does not require changing TLS verification or application credentials. Use the existing Finance/app project's Dashboard session to deploy the source-controlled SQL. Do not run these administrative SQL scripts from the browser's publishable-key client.

1. Open `supabase/migrations/20261021000100_moneyflow_v2_initial.sql`. Execute its **complete current contents**, including `begin;` and `commit;`, in **Supabase Dashboard → SQL Editor → New query** for the existing Finance/app project. Use the SQL Editor's administrative database role (normally `postgres`). Run the whole query with no partial selection. No environment placeholders or credentials need substitution.
2. Expect success with no error, typically `Success. No rows returned`. The script is transactional: a statement failure prevents the migration from committing. It checks for existing MoneyFlow tables before changing anything and is intentionally **not rerunnable after successful deployment**. If it reports an error, retain the error text and stop; do not drop tables, disable RLS, or execute isolated fragments to bypass it. A trigger-replacement warning is expected because named triggers are replaced; the script does not drop or truncate tables.
3. In a **separate new query**, execute the complete contents of `supabase/tests/schema_inventory.sql`. It is read-only and asserts 18 tables with RLS, four owner policies per table, both security-invoker views, six authenticated-only financial RPCs, and the auth profile trigger. The last result is `MoneyFlow schema inventory passed`. Review the returned object inventory as well.
4. In another **separate new query**, execute the complete contents of `supabase/tests/rls_isolation.sql`, starting as the SQL Editor's administrative role. Fixture setup uses that role, but the actual checks switch to `authenticated` with synthetic User A claims. The script checks own-account CRUD, cross-user SELECT/INSERT/UPDATE/DELETE, forbidden owner reassignment, and cross-owner foreign keys. Expect `MoneyFlow RLS isolation passed; test fixtures will be rolled back` and no error. The script ends with `rollback;`, leaving no test users or test records behind. If an assertion fails, stop and report the error; do not disable policies.
5. Confirm the migration and both acceptance queries completed. The app's configured Supabase JS client must then be retested; SQL Editor success alone is not hosted Auth/API acceptance. Email/password signup/login/logout, session restoration, repository CRUD, balances, RPCs, and two real authenticated-user sessions still require testing through the publishable-key client.

### Expected Objects

- Tables (18): `profiles`, `accounts`, `goals`, `transactions`, `transfers`, `balance_adjustments`, `monthly_budgets`, `daily_budgets`, `budget_schedules`, `budget_occurrences`, `goal_contributions`, `contributions`, `planned_spending`, `reservations`, `calendar_notes`, `notifications`, `activity_history`, `migration_batches`.
- Savings classifications intentionally remain `transactions.entry_type = 'saving'` plus reservations, matching the actual application model rather than adding a competing savings balance table.
- Views (2): `account_balances`, `financial_totals`; both use `security_invoker = true` and underlying table RLS.
- Financial RPCs (6): `record_transfer`, `upsert_transaction`, `delete_transaction`, `upsert_goal_contribution`, `process_budget_occurrence`, `reconcile_budget_occurrence`. These run as the caller, use `auth.uid()`, and are not executable by `anon`/`PUBLIC`.
- Trigger functions (2): `set_updated_at` and `handle_new_auth_user`. Only the profile-creation trigger function is security-definer, with an empty search path and schema-qualified references.
- Triggers: `on_auth_user_created_moneyflow` on `auth.users`, plus `set_updated_at` on 15 mutable application tables.
- Indexes: primary/unique indexes for IDs and import deduplication, plus six explicit indexes for transaction/transfer dates, occurrence dates, note dates, unread notifications, and history dates.
- Policies: 72 total, four per user-owned table. SELECT/DELETE use owner checks; INSERT uses an owner `WITH CHECK`; UPDATE uses both owner `USING` and `WITH CHECK`. Owner-aware composite foreign keys reject relationships to another user's records.

### Source Control and Future CLI Use

The migration file above remains the only deployment source of truth; there is no separately edited SQL copy. Dashboard execution does not automatically record a CLI migration-history entry. When corporate certificate trust is properly configured later, reconcile migration history **after verifying this exact migration was applied**, before any `supabase db push`. Do not blindly push the initial migration again. No TLS bypass is needed or permitted.

## Authentication URLs

In Supabase Dashboard → Authentication → URL Configuration, set Site URL to the deployed MoneyFlow origin and add the local Vite origin (normally `http://localhost:5173`) and production origin to Redirect URLs. Add the Vercel preview origin only if password recovery is expected to work on previews.

## RLS Test

`supabase/tests/rls_isolation.sql` uses synthetic users in a rollback-only transaction. It tests all four cross-user operations on the seeded profiles/accounts/goals/transactions/schedules/occurrences/notes/notifications/history domains. Local PostgreSQL tests execute the same migration and SQL acceptance scripts using PGlite with simulated `auth.users`/`auth.uid()`. PGlite uses core UUID generation rather than loading the hosted `pgcrypto` extension. This validates local SQL behavior, not hosted GoTrue email delivery, real JWT verification, TLS, or Data API grants. Real User A/User B RLS acceptance passed for the tested operations; see `V2_AUDIT.md`. This does not certify every possible policy path or replace production-origin acceptance.