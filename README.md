# MET Clinician Pro

A professional static HTML app for clinicians, physical therapists, and researchers who want a cleaner way to search the full MET compendium, build weekly exercise-dose blocks, organize a seven-specifier profile, and export a professional plan summary.

## Project files

- `index.html` — app shell
- `styles.css` — design system, layout, responsive rules, button and card styling
- `app.js` — tabs, search, dose builder, planner, calculations, import/export logic
- `data/bundled-compendium-2024.js` — bundled compendium data for offline/local use
- `data/bundled-compendium-2024.json` — plain JSON copy of the bundled dataset

## Best way to edit it

1. Unzip the folder.
2. Open the folder in VS Code.
3. Edit `styles.css` to change colors, spacing, buttons, tabs, and card styling.
4. Edit `app.js` to change behaviors and workflows.
5. Save and refresh the browser.

## Good files to edit first

- **Tab colors:** `styles.css` → search for `.tab-btn[data-tab=`
- **Page width:** `styles.css` → search for `.topbar-inner, .page`
- **Dose + Plan workflow:** `app.js` → search for `function renderDose()`
- **Activity Library behavior:** `app.js` → search for `function renderLibrary()` and `function selectActivity()`
- **Calculation cards:** `app.js` → search for `function renderCalculations()`

## GitHub Pages notes

Upload the extracted project files, not just the zip archive. `index.html` should stay in the repository root.


## Added asset
- `assets/specifier-radar-example.png` — illustrative radar visual used on the home page in the “Why the seven specifiers matter” section.
