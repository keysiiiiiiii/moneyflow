# MoneyFlow workspace checklist

- [x] Verify that this workspace instruction file exists.
- [x] Clarify project requirements: MoneyFlow, React + TypeScript, Vite, Tailwind CSS, Zustand, Recharts, Lucide React, and browser LocalStorage.
- [x] Scaffold the project at the workspace root with Vite's React TypeScript template.
- [x] Customize the app with finance workflows, responsive navigation, charts, validation, and light/dark themes.
- [x] Check extension requirements: none were specified or installed.
- [x] Install dependencies and run project diagnostics/build validation.
- [x] Create and run task: not required; npm scripts are available in `package.json`.
- [ ] Launch the project: wait for the user's confirmation before starting the development server.
- [x] Keep `README.md` and this checklist current; setup-template HTML comments have been removed.

## Project conventions

- Keep finance records in the Zustand store and preserve browser LocalStorage persistence.
- Keep calculations and date/currency formatting in `src/lib/finance.ts`.
- Validate imported data before applying it to persisted state.
- Keep dialogs keyboard-operable with visible focus indicators and Escape handling.
- Use `npm run build` and `npm run lint` for local verification.
