(() => {
  const SPECIFIERS = [
    "Metabolic Equivalents of Task (METs)",
    "Heart Rate",
    "Breathing Control and Pacing",
    "Specific Exercise Type",
    "Neurological and Physiological Targets",
    "Time and Frequency",
    "Clinician Integration Specifier"
  ];

  const DEFAULT_PRINT_META = {
    clinician: "",
    client: "",
    diagnosis: "",
    setting: "",
    goal: "",
    summary: "",
    whyDistinct: "",
    modality: "",
    supervision: "",
    timing: "",
    timingNote: "",
    progression: "",
    response: "",
    risk: "",
    trigger: "",
    reviewDate: ""
  };

  const DEFAULT_STATE = {
    activeTab: "home",
    uiScale: 1,
    usingCustomDb: false,
    db: Array.isArray(window.BUNDLED_DB) ? clone(window.BUNDLED_DB) : [],
    libraryFilters: {
      query: "",
      minMet: "",
      maxMet: "",
      category: "all",
      system: "all",
      intensity: "all",
      page: 1
    },
    doseLookupQuery: "",
    selectedActivityCode: null,
    dose: {
      duration: 30,
      frequency: 5,
      weight: 70,
      weightUnit: "kg",
      manualMET: "",
      note: ""
    },
    plan: [],
    planNote: "",
    printMeta: clone(DEFAULT_PRINT_META),
    specifiers: {
      "Metabolic Equivalents of Task (METs)": 8,
      "Heart Rate": 6,
      "Breathing Control and Pacing": 5,
      "Specific Exercise Type": 8,
      "Neurological and Physiological Targets": 7,
      "Time and Frequency": 8,
      "Clinician Integration Specifier": 6
    },
    showRadar: true,
    specifierModalOpen: false,
    calculations: {},
    toast: null,
    lastMessage: ""
  };

  const STORAGE_KEY = "exercisePxStateV1";

  const COMMON_LIBRARY_PRESETS = [
    { label: "Yoga", query: "yoga" },
    { label: "Outdoor Running", query: "outdoor running" },
    { label: "Treadmill Running", query: "treadmill running" },
    { label: "Outdoor Cycling", query: "outdoor cycling" },
    { label: "Stationary Cycling", query: "stationary cycling" },
    { label: "Resistance Training", query: "resistance training" },
    { label: "Bodyweight Resistance", query: "bodyweight strength" },
    { label: "Free Weights", query: "dumbbell weight training" }
  ];

  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  
  const root = document.getElementById("app");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.className = "hidden";
  document.body.appendChild(fileInput);

  let state = hydrateState();
  let toastTimer = null;
  let pendingScrollId = null;

  root.addEventListener("click", handleClick);
  root.addEventListener("submit", handleSubmit);
  root.addEventListener("input", handleInput);
  root.addEventListener("change", handleInput);
  root.addEventListener("dragstart", handleDragStart);
  root.addEventListener("dragover", handleDragOver);
  root.addEventListener("drop", handleDrop);
  root.addEventListener("dragend", handleDragEnd);
  fileInput.addEventListener("change", handleFileImport);

  function hydrateState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return clone(DEFAULT_STATE);
      return {
        ...clone(DEFAULT_STATE),
        ...saved,
        db: clone(DEFAULT_STATE.db),
        usingCustomDb: false,
        libraryFilters: { ...DEFAULT_STATE.libraryFilters, ...(saved.libraryFilters || {}) },
        dose: { ...DEFAULT_STATE.dose, ...(saved.dose || {}) },
        specifiers: { ...DEFAULT_STATE.specifiers, ...(saved.specifiers || {}) },
        calculations: saved.calculations || {},
        printMeta: { ...DEFAULT_PRINT_META, ...(saved.printMeta || {}) },
        plan: Array.isArray(saved.plan) ? saved.plan.map(normalizeStoredPlanItem) : []
      };
    } catch (error) {
      return clone(DEFAULT_STATE);
    }
  }

  function persistState() {
    const safeState = {
      activeTab: state.activeTab,
      uiScale: state.uiScale,
      libraryFilters: state.libraryFilters,
      doseLookupQuery: state.doseLookupQuery,
      selectedActivityCode: state.selectedActivityCode,
      dose: state.dose,
      plan: state.plan,
      planNote: state.planNote,
      printMeta: state.printMeta,
      specifiers: state.specifiers,
      showRadar: state.showRadar,
      calculations: state.calculations,
      lastMessage: state.lastMessage
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
  }
  
  function getSelectedActivity() {
    if (!state.selectedActivityCode) return null;
    return state.db.find(item => item.code === state.selectedActivityCode) || null;
  }
  
  function computeCurrentDose() {
    const activity = getSelectedActivity();
    const chosen = activity || null;
    const metSource = state.dose.manualMET !== "" ? Number(state.dose.manualMET) : chosen?.met;
    const met = Number.isFinite(Number(metSource)) ? Number(metSource) : 0;
    const duration = Number(state.dose.duration || 0);
    const frequency = Number(state.dose.frequency || 0);
    const weightKg = (state.dose.weightUnit === "lb")
      ? Number(state.dose.weight || 0) * 0.45359237
      : Number(state.dose.weight || 0);
  
    const baselineKcalPerKgHr =
      chosen?.baselineKcalPerKgHr ??
      baselineFromSystem(chosen?.metSystem).baselineKcalPerKgHr;
  
    const metSystem = chosen?.metSystem || (state.dose.manualMET !== "" ? "MET" : "MET");
    const metMinSession = met * duration;
    const metMinWeek = metMinSession * frequency;
    const kcalWeek = (duration / 60) * frequency * weightKg * met * baselineKcalPerKgHr;
  
    return {
      met,
      duration,
      frequency,
      weightKg,
      metSystem,
      metMinSession,
      metMinWeek,
      kcalWeek
    };
  }
  
  function renderApp() {
    root.innerHTML = `
      <div class="app-shell">
        ${renderTopbar()}
        <main class="page">
          ${renderActiveTab()}
        </main>
        <div class="toast-stack">${renderToast()}</div>
      </div>
    `;
    afterRender();
    persistState();
  }

  function renderTopbar() {
    const datasetSummary = getDatasetSummary();
    const tabs = [
      ["home", "⌂", "Home"],
      ["library", "◫", "Activity Library"],
      ["dose", "↗", "Dose + Plan"],
      ["calc", "∑", "Calculations"],
      ["data", "☰", "Data & Sources"]
    ];

    return `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="brand-badge brand-badge-textmark" aria-label="Exercise Px logo">
              <span class="brand-badge-e">E</span>
              <span class="brand-badge-px">Px</span>
            </div>
            <div class="brand-copy">
              <h1>Exercise Px</h1>
              <p>Exercise prescription, planning, and clinical documentation toolkit.</p>
            </div>
          </div>
          <div class="topbar-meta">
            <span class="meta-pill">${numberWithCommas(state.db.length)} activities</span>
            <span class="meta-pill">${datasetSummary.categories} categories</span>
            <span class="meta-pill meta-pill-soft">Seven-specifier workflow</span>
          </div>
        </div>

        <div class="tabs-row">
          <div class="tabs tabs-inner">
            ${tabs.map(([key, icon, label]) => `
              <button class="tab-btn ${state.activeTab === key ? "active" : ""}" data-action="switch-tab" data-tab="${key}">
                <span>${icon}</span>
                <span>${label}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </header>
    `;
  }

  function renderActiveTab() {
    switch (state.activeTab) {
      case "home": return renderHome();
      case "library": return renderLibrary();
      case "dose": return renderDose();
      case "calc": return renderCalculations();
      case "data": return renderData();
      default: return renderHome();
    }
  }

  function renderHome() {
    const totalActivities = Array.isArray(state.db) ? state.db.length : 0;
    const totalBlocks = Array.isArray(state.plan) ? state.plan.length : 0;
    const totals = totalPlanDose();

    return `
      <section class="panel panel-home">
        <div class="home-shell">
    
          <section class="px-hero px-hero-refined">
            <div class="px-hero-copy">
              <div class="hero-kicker-row">
                <span class="eyebrow">Exercise prescription platform</span>
                <span class="hero-inline-pill">Built around seven specifiers</span>
              </div>
              
              <h2>Exercise Px</h2>
              
              <p class="hero-lead hero-lead-italic">
                <em>A cleaner way for healthcare providers, clinicians, students, researchers, and specialists to build, organize, and document exercise prescriptions with measurable, repeatable, and clinically impactful structure.</em>
              </p>
              
              <p class="hero-sub">
                This program is built from the seven specifiers framework:<br>
                <strong>Metabolic Equivalents of Task (METs), Heart Rate, Breathing Control and Pacing, Specific Exercise Type, Neurological and Physiological Targets, Time and Frequency, and Clinician Integration Specifier.</strong><br>
                Use the Data & Sources page to see a brief overview of each specifier and an example of how it may matter in clinical use.
              </p>
              
              <p class="hero-sub">
                These seven specifiers are key categories of exercise prescription to note, prioritize, and control in order to improve replicability, clarity, and clinical outcomes.
              </p>
              
              <div class="hero-actions hero-actions-four">
                <button class="btn btn-dose" data-action="switch-tab" data-tab="dose">Dose + Plan</button>
                <button class="btn btn-primary" data-action="switch-tab" data-tab="library">Activity Library</button>
                <button class="btn btn-calc" data-action="switch-tab" data-tab="calc">Calculations</button>
                <button class="btn btn-soft" data-action="switch-tab" data-tab="data">Data & Sources</button>
              </div>



    
  
              <div class="px-stats compact">
                <div class="px-stat-card">
                  <span>Bundled activities</span>
                  <strong>${numberWithCommas(totalActivities)}</strong>
                </div>
                <div class="px-stat-card">
                  <span>Weekly plan blocks</span>
                  <strong>${numberWithCommas(totalBlocks)}</strong>
                </div>
                <div class="px-stat-card">
                  <span>Current weekly MET-min</span>
                  <strong>${round(totals.metMinWeek || 0, 1)}</strong>
                </div>
              </div>
            </div>
  
            <div class="px-hero-side">
              <div class="glass-card glass-card-hero radar-example-card">
                <div class="hero-side-head hero-side-head-stack">
                  <div>
                    <div class="mini-label">Radar example</div>
                    <h3>ADHD vs. Eating Disorders</h3>
                  </div>
                </div>
  
                <div class="radar-image-wrap">
                  <img
                    src="assets/specifier-radar-example.png"
                    alt="Example radar comparing ADHD and eating disorders across the seven exercise specifiers"
                    class="radar-example-image"
                  />
                </div>
  
                <p class="radar-caption">
                  The 7 Specifiers capture the core domains needed to specify, interpret, and compare exercise interventions across disorders and diagnoses with greater fidelity, reproducibility, and therapeutic precision.<br>
                  As seen in this radar diagram example, current literature suggests that a key difference between ADHD and eating disorders is the role and need for clinician or specialist oversight and involvement. The goal is not to maximize every specifier equally, but to identify which specifiers deserve greater or lesser priority in shaping clinically meaningful outcomes. <em>See the Data &amp; Sources page for a brief overview of each specifier.</em>
                </p>
              </div>
            </div>
          </section>
  
          <section class="home-card-section">
            <div class="section-header">
              <div>
                <div class="eyebrow">Workflow</div>
                <h3>Use the app in the same order you would build a clinical plan</h3>
              </div>
            </div>
  
            <div class="px-card-grid three">
              <article class="feature-card feature-card-apple">
                <div class="feature-icon">◫</div>
                <h4>Activity Library</h4>
                <p>Search activities by term, MET range, system, category, and intensity to identify realistic movement options.</p>
                <button class="btn btn-primary" data-action="switch-tab" data-tab="library">Open Library</button>
              </article>
  
              <article class="feature-card feature-card-apple">
                <div class="feature-icon">↗</div>
                <h4>Dose + Plan</h4>
                <p>Turn selected activities into weekly dosage blocks, structure them, and organize them into a usable exercise plan.</p>
                <button class="btn btn-dose" data-action="switch-tab" data-tab="dose">Open Planner</button>
              </article>
  
              <article class="feature-card feature-card-apple">
                <div class="feature-icon">∑</div>
                <h4>Calculations</h4>
                <p>Use exercise-prescription calculations to support more defensible documentation and planning.</p>
                <button class="btn btn-calc" data-action="switch-tab" data-tab="calc">Open Calculations</button>
              </article>
            </div>
          </section>
  
          <section class="home-card-section home-card-section-app">
            <div class="section-header">
              <div>
                <div class="eyebrow">Future Development</div>
                <h3>Educational Content, Access, and App Development</h3>
              </div>
            </div>
          
            <div class="future-dev-panel">
              <div class="substack-callout">
                <div class="substack-copy">
                  <div class="mini-label">Education Content</div>
                  <h4>Follow Exercise Px on Substack</h4>
                  <p>
                    As I continue developing this app and program, I expect it to grow into both free and paid tiers. My intention is for the platform’s foundational tools to remain accessible, while expanded features, clinical tools, and services are added through premium offerings over time to support ongoing development and long-term sustainability.
                  </p>
                  <p>
                    I plan to keep more of the clinical tools and services on the website, while Substack will be where I publish education content. You can scan the QR code with your phone or click the link below.
                  </p>
                  <p class="substack-thanks">
                    Thank you to all of you who choose to support me in this endeavor!
                  </p>
                  <a
                    class="btn btn-soft substack-link-btn"
                    href="https://exercisepx.substack.com/?r=87ocx9&utm_campaign=pub-share-checklist"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Substack
                  </a>
                </div>
          
                <a
                  class="substack-qr-link"
                  href="https://exercisepx.substack.com/?r=87ocx9&utm_campaign=pub-share-checklist"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the Exercise Px Substack"
                >
                  <img
                    src="assets/exercisepx-substack-qr.svg"
                    alt="QR code linking to the Exercise Px Substack"
                    class="substack-qr"
                  />
                </a>
              </div>
          
              <div class="future-dev-compare">
                <article class="glass-card dev-tier-card">
                  <div class="mini-label">Free Version</div>
                  <h4>Core access</h4>
                  <ul class="coming-list">
                    <li>Activity lookup and MET browsing</li>
                    <li>Dose building and weekly plan blocks</li>
                    <li>Seven-specifier radar profile</li>
                    <li>Core calculations and basic planning text</li>
                  </ul>
                </article>
          
                <article class="glass-card dev-tier-card pro-card">
                  <div class="mini-label">Premium Version</div>
                  <h4>Expanded workflow</h4>
                  <ul class="coming-list">
                    <li>Saved client templates and reusable prescriptions</li>
                    <li>Cleaner documentation exports and print-ready outputs</li>
                    <li>More structured clinician workflow tools</li>
                    <li>Future app-first features for regular professional use</li>
                  </ul>
                </article>
              </div>
          
              <div class="future-dev-intro">
                <div class="mini-label">App</div>
                <h4>Planned App Development</h4>
                <p>
                  The app is meant to make Exercise Px easier to use in real settings, with a cleaner interface, smoother navigation, and a more convenient experience for repeat clinical or educational use.
                </p>
              </div>
            </div>
          </section>
  
        </div>
      </section>
    `;
  }

  function renderLibrary() {
    const results = filterActivities(state.libraryFilters);
    const categories = getCategoryList();
    const selected = getSelectedActivity();
  
    return `
      <section class="panel">
        <section class="hero library-hero">
          <div>
            <h2>Activity Library</h2>
            <p>Search the activity database by name, Metabolic Equivalents of Task (METs) range, category, system, or intensity band. When you find the right activity, send it to the dose builder, and then continue to the plan section below.</p>
          </div>
          <div class="kpi-band library-kpi-band">
            <div class="kpi"><span>Total results</span><strong>${numberWithCommas(results.length)}</strong></div>
            <div class="kpi"><span>Selected activity</span><strong>${selected ? escapeHtml(shortLabel(selected.activity, 36)) : "None"}</strong></div>
            <div class="kpi"><span>Current filter</span><strong>${state.libraryFilters.intensity === "all" ? "All bands" : capitalize(state.libraryFilters.intensity)}</strong></div>
          </div>
        </section>
  
        <section class="section-card library-search-card">
          <div class="card-head">
            <div>
              <h2>Search and filter</h2>
              <p>The exercise names come from the Compendium of Physical Activities 2024, so some entries may differ from standard clinical, coaching, or consumer naming.</p>
            </div>
          </div>
  
          <div class="library-preset-head">
            <span class="library-preset-label">General Categories:</span>
          </div>
  
          <div class="preset-strip">
            ${COMMON_LIBRARY_PRESETS.map(preset => `
              <button type="button" class="preset-chip" data-action="library-preset" data-query="${escapeAttr(preset.query)}">
                ${escapeHtml(preset.label)}
              </button>
            `).join("")}
          </div>
  
          <form data-form="library-search">
            <div class="form-grid">
              <label><span>Search activity</span><input type="text" id="libraryQuery" value="${escapeAttr(state.libraryFilters.query)}" placeholder="walking, rowing, resistance, gardening" /></label>
              <label><span>Min MET</span><input type="number" id="libraryMinMet" step="0.1" value="${escapeAttr(state.libraryFilters.minMet)}" /></label>
              <label><span>Max MET</span><input type="number" id="libraryMaxMet" step="0.1" value="${escapeAttr(state.libraryFilters.maxMet)}" /></label>
              <label><span>Category</span>
                <select id="libraryCategory">
                  <option value="all">All categories</option>
                  ${categories.map(cat => `<option value="${escapeAttr(cat)}" ${state.libraryFilters.category === cat ? "selected" : ""}>${escapeHtml(cat)}</option>`).join("")}
                </select>
              </label>
              <label><span>MET system</span>
                <select id="librarySystem">
                  ${[["all","All systems"],["MET","Adult MET"],["MET60+","Older Adult MET60+"],["METWC","Wheelchair METWC"]].map(([value, label]) => `<option value="${value}" ${state.libraryFilters.system === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </label>
            </div>
  
            <div class="button-row">
              <button class="btn btn-primary" type="submit">Search</button>
              <button class="btn btn-soft" type="button" data-action="library-clear">Clear filters</button>
            </div>
  
            <div class="filter-row">
              ${["all","light","moderate","vigorous"].map(level => `<button type="button" class="filter-chip ${state.libraryFilters.intensity === level ? "active" : ""}" data-action="library-intensity" data-intensity="${level}">${level === "all" ? "All intensity bands" : capitalize(level)}</button>`).join("")}
            </div>
          </form>
        </section>
  
        <section class="library-results library-results-continuous">
          ${results.length
            ? results.map(item => renderActivityCard(item)).join("")
            : `<div class="empty-state">No activities match the current filters. Broaden the search or clear one of the range fields.</div>`
          }
        </section>
      </section>
    `;
  }

  function renderActivityCard(item) {
    const selected = state.selectedActivityCode === item.code;
    return `
      <article class="activity-card ${selected ? "selected" : ""}">
        <div class="topline">
          <div>
            <div class="activity-title">${escapeHtml(item.activity)}</div>
            <div class="inline-meta">
              <span class="badge">${escapeHtml(item.category)}</span>
              <span class="badge">${round(item.met, 1)} ${escapeHtml(item.metSystem || "MET")}</span>
              <span class="badge">${escapeHtml(item.population || "Adult")}</span>
              <span class="badge">Code ${escapeHtml(item.code || "—")}</span>
            </div>
          </div>
          <div class="button-row">
            <button class="btn btn-dose" data-action="library-use" data-code="${escapeAttr(item.code)}">Use in Dose + Plan</button>
          </div>
        </div>
      </article>
    `;
  }
  function renderSpecifierEngine(isModal = false) {
    return `
      <section class="${isModal ? "specifier-modal-card" : "section-card specifier-engine-card"}">
        <div class="card-head">
          <div>
            <h2>Specifier Radar Tool</h2>
            <p>This radar tool highlights what the prescription is prioritizing as a visual tool. Move the sliders, watch the radar change, and use the summary to clarify what matters most in the current dose. See the Data tab for more info on the specifiers.</p>
          </div>
          <div class="button-row">
            ${isModal
              ? `<button class="btn btn-soft" type="button" data-action="specifier-close">Close</button>`
              : `<button class="btn btn-soft" type="button" data-action="specifier-expand">Expand</button>`}
            <button class="btn btn-soft" type="button" data-action="toggle-radar">${state.showRadar ? "Hide radar" : "Show radar"}</button>
            <button class="btn btn-soft" type="button" data-action="specifier-reset">Reset sliders</button>
          </div>
        </div>
  
        <div id="${isModal ? "radarAreaModal" : "radarArea"}" class="specifier-engine-chart ${isModal ? "expanded" : ""}">
          ${state.showRadar
            ? renderRadarChart()
            : `<div class="empty-state">Radar chart hidden. Use the button above to show it again.</div>`}
        </div>
  
        <div class="specifier-grid specifier-grid-compact">
          ${SPECIFIERS.map(spec => `
            <div class="specifier-row">
              <label for="${isModal ? "modal-" : ""}spec-${slugify(spec)}">${escapeHtml(spec)}</label>
              <input
                id="${isModal ? "modal-" : ""}spec-${slugify(spec)}"
                type="range"
                min="0"
                max="10"
                value="${state.specifiers[spec]}"
                data-specifier="${escapeAttr(spec)}"
              />
              <div class="specifier-score">${state.specifiers[spec]}</div>
            </div>
          `).join("")}
        </div>
  
        <details class="help-box specifier-summary-toggle" style="margin-top:14px;" open>
          <summary>Specifier scoring guide</summary>
          <div class="helper-copy">
            ${renderSpecifierSummary()}
          </div>
        </details>
    `;
  }



  
  function renderDose() {
    const activity = getSelectedActivity();
    const metrics = computeCurrentDose();
    const quickResults = filterDoseLookup(state.doseLookupQuery);
    const quality = getPlanQuality(metrics);
    const totals = totalPlanDose();
  
    return `
      <section class="panel">
        <div class="dose-page">
          <div class="dose-main">
            <section class="section-card dose-specifier-intro-card">
              <div class="card-head">
                <div>
                  <h2>The 7 Specifiers Framework</h2>
                  <p>Use this page to build exercise prescriptions with the seven specifiers in mind.</p>
                </div>
              </div>
            
              <div class="dose-specifier-intro-copy">
                <p>
                  This framework organizes exercise prescription into seven major categories that can be noted, prioritized, and controlled to improve replicability, clarity, and clinical usefulness.
                </p>
            
                <p>
                  The seven specifiers are:
                  <strong>
                    Metabolic Equivalents of Task (METs), Heart Rate, Breathing Control and Pacing, Specific Exercise Type, Neurological and Physiological Targets, Time and Frequency, and Clinician Integration Specifier.
                  </strong>
                </p>
            
                <p>
                  On this page, you can select an activity, build the dose, shape the specifier profile, and translate the result into a weekly plan and printable prescription sheet.
                </p>
              </div>
            </section>

            
            <section class="section-card" id="doseSelectActivitySection">
              <div class="card-head">
                <div>
                  <h2>Select activity</h2>
                  <p>Search once, choose the activity, then move on.</p>
                </div>
              </div>
  
              <form data-form="dose-search">
                <div class="form-grid">
                  <label>
                    <span>Search activity</span>
                    <input
                      type="text"
                      id="doseQuickSearch"
                      value="${escapeAttr(state.doseLookupQuery)}"
                      placeholder="walking, rowing, lifting, gardening"
                    />
                  </label>
                </div>
                <div class="button-row">
                  <button class="btn btn-primary" type="submit">Search quick lookup</button>
                  <button class="btn btn-soft" type="button" data-action="dose-clear-search">Clear</button>
                </div>
              </form>
  
              <div class="card-list" style="margin-top:14px;">
                ${quickResults.length ? quickResults.map(item => `
                  <div class="mini-note">
                    <div class="topline">
                      <div>
                        <strong>${escapeHtml(item.activity)}</strong>
                        <div class="small muted">
                          ${escapeHtml(item.category)} • ${round(item.met, 1)} ${escapeHtml(item.metSystem || "MET")} • ${escapeHtml(item.population || "Adult")}
                        </div>
                      </div>
                      <button class="btn btn-soft" data-action="dose-pick" data-code="${escapeAttr(item.code)}">Select</button>
                    </div>
                  </div>
                `).join("") : `<div class="mini-note">${state.doseLookupQuery ? "No quick-lookup matches yet. Try a shorter search term." : "Type a term above to search common activities from within Dose + Plan."}</div>`}
              </div>
            </section>
  
            <section class="section-card" id="doseBuilderCard">
              <div class="card-head">
                <div>
                  <h2>Build the dose</h2>
                  <p>Set the workload and details for this exercise block.</p>
                </div>
              </div>
  
              <div class="dose-builder-grid">
                <div>
                  ${activity ? renderSelectedActivityBanner(activity) : `<div class="mini-note">No activity is selected yet. Pick one from the Activity Library or quick lookup above. You can still use a manual MET value if needed.</div>`}
  
                  <div class="form-grid" style="margin-top:14px;">
                    <label><span>Minutes per session</span><input data-bind="dose.duration" type="number" min="0" step="1" value="${escapeAttr(state.dose.duration)}" /></label>
                    <label><span>Sessions per week</span><input data-bind="dose.frequency" type="number" min="0" step="1" value="${escapeAttr(state.dose.frequency)}" /></label>
                    <label><span>Body weight</span><input data-bind="dose.weight" type="number" min="0" step="0.1" value="${escapeAttr(state.dose.weight)}" /></label>
                    <label><span>Weight unit</span>
                      <select data-bind="dose.weightUnit">
                        <option value="kg" ${state.dose.weightUnit === "kg" ? "selected" : ""}>kg</option>
                        <option value="lb" ${state.dose.weightUnit === "lb" ? "selected" : ""}>lb</option>
                      </select>
                    </label>
                    <label><span>Manual MET (optional)</span><input data-bind="dose.manualMET" type="number" min="0" step="0.1" value="${escapeAttr(state.dose.manualMET)}" placeholder="Use only when you need a custom MET value" /></label>
                  </div>
  
                  <label style="margin-top:14px;">
                    <span>Exercise details / set structure</span>
                    <textarea
                      data-bind="dose.note"
                      placeholder="Use this box for the exact structure that makes the block reproducible: movement selection, sets, reps, load or intensity marker, work-to-rest intervals, breathing instructions, target adaptation, environment, and timing note."
                    >${escapeHtml(state.dose.note || "")}</textarea>
                  </label>
  
                  <details class="help-box" style="margin-top:12px;">
                    <summary>What belongs in exercise details?</summary>
                    <div class="helper-copy">
                      <p>This field is where you make the exercise block specific enough to replicate later.</p>
                    </div>
                  </details>
  
                  <div class="button-row" style="margin-top:16px;">
                    <button class="btn btn-dose" data-action="dose-add-plan">Add block to weekly plan</button>
                    <button class="btn btn-soft" data-action="dose-jump-planner">Jump to weekly plan</button>
                    <button class="btn btn-soft" data-action="dose-clear-selected">Clear selected activity</button>
                  </div>
                </div>
  
                <div id="doseSummaryPanel">
                  ${renderDoseSummary(metrics, activity)}
                </div>
              </div>
            </section>
  
            <section class="section-card" id="weeklyPlannerSection">
              <div class="card-head">
                <div>
                  <h2>Weekly plan</h2>
                  <p>Your completed exercise blocks live here.</p>
                </div>
              </div>
  
              ${renderDraftCard(metrics, activity)}
  
              <div class="kpi-band" style="margin-top:14px;">
                <div class="kpi"><span>Exercise blocks</span><strong>${state.plan.length}</strong></div>
                <div class="kpi"><span>Total dose</span><strong>${round(totals.metMinWeek, 1)}</strong></div>
                <div class="kpi"><span>Weekly kcal</span><strong>${round(totals.kcalWeek, 1)}</strong></div>
              </div>

              ${renderWeeklyPlannerBoard()}
  
              <div class="plan-list" style="margin-top:16px;">
                ${state.plan.length ? state.plan.map(renderPlanCard).join("") : `<div class="empty-state">No exercise blocks added yet. Start with the selected activity above, set the dose, and click <strong>Add block to weekly plan</strong>.</div>`}
              </div>
            </section>
  
            <section class="section-card" id="doseDocumentationSection">
              <div class="card-head">
                <div>
                  <h2>Documentation & export</h2>
                  <p>Finalize the note and export the plan.</p>
                </div>
              </div>

              ${renderPrintMetaEditor()}
  
              <textarea id="planNoteBox" data-bind="planNote" placeholder="Write your plan note here.">${escapeHtml(state.planNote)}</textarea>
  
              <details class="help-box" style="margin-top:12px;">
                <summary>What makes a strong plan note?</summary>
                <div class="helper-copy">
                  <p>A strong note explains why exercise is being used, which specifiers matter most, and how the block is expected to influence the behavioral health goal.</p>
                </div>
              </details>
  
              <div class="button-row" style="margin-top:16px;">
                <button class="btn btn-primary" data-action="plan-autofill-sheet">Auto-fill prescription sheet</button>
                <button class="btn btn-primary" data-action="plan-example-note">Use example note</button>
                <button class="btn btn-soft" data-action="plan-export-txt">Download TXT</button>
                <button class="btn btn-dose" data-action="plan-print">Download PDF</button>
                <button class="btn btn-danger" data-action="plan-clear">Clear Plan</button>
              </div>
  
              ${renderPlanPrintSheet()}
            </section>
  
          </div>
  
          <aside class="dose-sidebar">
            <section class="section-card quality-check-card">
              <div class="card-head">
                <div>
                  <h2>Plan quality check</h2>
                  <p>Use this checklist to see what still needs attention before exporting.</p>
                </div>
              </div>
  
              ${renderQualityChecklist(quality)}
            </section>
  
            ${renderSpecifierEngine()}
          </aside>
        </div>
      </section>
  
      ${state.specifierModalOpen ? `
        <div class="specifier-modal-backdrop">
          <div class="specifier-modal-shell">
            ${renderSpecifierEngine(true)}
          </div>
        </div>
      ` : ""}
    `;
  }


  function renderPlanPrintSheet() {
    const totals = totalPlanDose();
    const today = new Date().toLocaleDateString();
    const meta = { ...DEFAULT_PRINT_META, ...state.printMeta };
    const schedule = getWeeklySchedule();
    const primarySpecifier = getPrimarySpecifierSummary(3);
  
    const weeklyRows = WEEKDAYS.map(day => {
      const sessions = schedule[day];
      const content = sessions.length
        ? sessions.map(session => `${escapeHtml(session.item.activityName)} (${round(session.item.duration, 0)} min)`).join("<br>")
        : "—";
      return `
        <div class="print-week-row">
          <div class="print-week-day">${escapeHtml(day)}</div>
          <div class="print-week-content">${content}</div>
        </div>
      `;
    }).join("");
  
    const dosageBlocks = state.plan.length
      ? state.plan.map(item => `
        <div class="print-dose-block">
          <div class="print-dose-block-head">
            <span>Activity</span>
            <span>MET</span>
            <span>Minutes</span>
            <span>Sessions/week</span>
            <span>Estimated weekly MET-min</span>
          </div>
          <div class="print-dose-block-row">
            <strong>${escapeHtml(item.activityName)}</strong>
            <strong>${round(item.met, 1)} ${escapeHtml(item.metSystem || "MET")}</strong>
            <strong>${round(item.duration, 0)}</strong>
            <strong>${round(item.frequency, 0)}</strong>
            <strong>${round(item.metMinWeek, 1)}</strong>
          </div>
          ${item.blockDetails ? `
            <div class="print-dose-block-note">
              <span>Exercise details</span>
              <div>${escapeHtml(item.blockDetails).replace(/\n/g, "<br>")}</div>
            </div>
          ` : ""}
        </div>
      `).join("")
      : `<div class="print-dose-empty">No exercise blocks added yet.</div>`;
  
    return `
      <section id="printPlanSheet" class="print-sheet">
        <div class="print-sheet-head print-sheet-head-advanced">
          <div class="print-sheet-title-copy">
            <h1>EXERCISE PRESCRIPTION SHEET</h1>
            <div class="print-meta-grid">
              <div class="print-meta-row"><span>Date</span><strong>${escapeHtml(today)}</strong></div>
              <div class="print-meta-row"><span>Clinician</span><strong>${escapeHtml(meta.clinician || "—")}</strong></div>
              <div class="print-meta-row"><span>Client</span><strong>${escapeHtml(meta.client || "—")}</strong></div>
              <div class="print-meta-row"><span>Diagnosis / Target</span><strong>${escapeHtml(meta.diagnosis || "—")}</strong></div>
              <div class="print-meta-row"><span>Setting</span><strong>${escapeHtml(meta.setting || "—")}</strong></div>
              <div class="print-meta-row"><span>Goal / Intended Outcome</span><strong>${escapeHtml(meta.goal || "—")}</strong></div>
            </div>
          </div>
        </div>
  
        <section class="print-section">
          <h2>Summary / Rationale</h2>
          <div class="print-summary-rationale">
            <p><strong>This exercise plan is designed to support</strong><br>${escapeHtml(meta.summary || "—")}</p>
            <p><strong>Client comments / considerations</strong><br>${escapeHtml(meta.whyDistinct || "—")}</p>
            <p><strong>Primary specifier emphasis</strong><br>${escapeHtml(primarySpecifier)}</p>
          </div>
        </section>
  
        <section class="print-section">
          <h2>Weekly Plan</h2>
          <div class="print-week-radar-layout">
            <div class="print-week-grid">${weeklyRows}</div>
  
            <div class="print-radar-card print-radar-card-inline">
              <div class="print-radar-label">Specifier Profile</div>
              ${renderPrintRadarChart()}
            </div>
          </div>
        </section>
  
        <section class="print-section">
          <h2>Dosage Block Details</h2>
          <div class="print-dose-block-list">
            ${dosageBlocks}
          </div>
  
          <div class="print-summary-grid print-summary-grid-compact">
            <div class="print-summary-card"><span>Exercise blocks</span><strong>${state.plan.length}</strong></div>
            <div class="print-summary-card"><span>Total weekly dose</span><strong>${round(totals.metMinWeek, 1)} MET-min</strong></div>
            <div class="print-summary-card"><span>Estimated weekly kcal</span><strong>${round(totals.kcalWeek, 1)}</strong></div>
          </div>
        </section>
  
        <section class="print-section">
          <h2>Prescribed Exercise Structure</h2>
          <div class="print-structure-grid">
            <div class="print-structure-row"><span>Modality</span><strong>${escapeHtml(meta.modality || "—")}</strong></div>
            <div class="print-structure-row"><span>Supervision level</span><strong>${escapeHtml(meta.supervision || "—")}</strong></div>
            <div class="print-structure-row">
              <span>Timing Relative to Appointments</span>
              <strong>
                ${escapeHtml(meta.timing || "—")}
                ${meta.timingNote ? `<br><span class="print-inline-note">${escapeHtml(meta.timingNote)}</span>` : ""}
              </strong>
            </div>
            <div class="print-structure-row"><span>Progression logic</span><strong>${escapeHtml(meta.progression || "—")}</strong></div>
          </div>
        </section>
  
        <section class="print-section">
          <h2>Monitoring Notes</h2>
          <div class="print-monitor-grid">
            <div class="print-monitor-row"><span>Response to exercise</span><strong>${escapeHtml(meta.response || "—")}</strong></div>
            <div class="print-monitor-row"><span>Risk / caution</span><strong>${escapeHtml(meta.risk || "—")}</strong></div>
            <div class="print-monitor-row"><span>When to Progress</span><strong>${escapeHtml(meta.trigger || "—")}</strong></div>
            <div class="print-monitor-row"><span>Review date / reassessment</span><strong>${escapeHtml(meta.reviewDate || "—")}</strong></div>
          </div>
        </section>
  
        ${state.planNote ? `
          <section class="print-section">
            <h2>Additional Note</h2>
            <div class="print-note">${escapeHtml(state.planNote).replace(/\n/g, "<br>")}</div>
          </section>
        ` : ""}
  
        <div class="print-sheet-footer">
          Powered by <strong>Exercise Px</strong> by <strong>Motus Salus</strong>
        </div>
      </section>
    `;
  }
  



  function renderPrintMetaEditor() {
    const suggested = buildPrintMetaSuggestions();
    return `
      <section class="print-editor-shell">
        <div class="card-head">
          <div>
            <h3>Printable sheet details</h3>
            <p>These fields feed the printable prescription sheet. Use Auto-fill to pre-populate the guidance fields from the current plan.</p>
          </div>
        </div>
  
        <div class="form-grid print-form-grid">
          <label><span>Clinician</span><input data-bind="printMeta.clinician" type="text" value="${escapeAttr(state.printMeta.clinician)}" placeholder="Name and credentials" /></label>
          <label><span>Client</span><input data-bind="printMeta.client" type="text" value="${escapeAttr(state.printMeta.client)}" placeholder="Client name or identifier" /></label>
          <label><span>Diagnosis / Target</span><input data-bind="printMeta.diagnosis" type="text" value="${escapeAttr(state.printMeta.diagnosis)}" placeholder="ADHD, PTSD, eating disorder, pain, etc." /></label>
          <label><span>Setting</span><input data-bind="printMeta.setting" type="text" value="${escapeAttr(state.printMeta.setting)}" placeholder="${escapeAttr(suggested.setting)}" /></label>
        </div>
        
        <label style="margin-top:14px;">
          <span>Goal / Intended Outcome</span>
          <textarea data-bind="printMeta.goal" placeholder="${escapeAttr(suggested.goal)}">${escapeHtml(state.printMeta.goal || "")}</textarea>
        </label>
        
        <label style="margin-top:14px;">
          <span>Summary / Rationale</span>
          <textarea data-bind="printMeta.summary" placeholder="${escapeAttr(suggested.summary)}">${escapeHtml(state.printMeta.summary || "")}</textarea>
        </label>
  
        <label style="margin-top:14px;">
          <span>Client Comments / Considerations</span>
          <textarea data-bind="printMeta.whyDistinct" placeholder="This is where comments from the client regarding the exercise can be noted. E.g., Client reports having difficulty walking to the mailbox due to weight. Client states they are willing to try yoga in combination with somatic therapy for depression and noted interest in group yoga therapy once a 50 lb weight-loss goal is reached.">${escapeHtml(state.printMeta.whyDistinct || "")}</textarea>
        </label>
  
        <div class="form-grid print-form-grid" style="margin-top:14px;">
          <label><span>Modality</span><input data-bind="printMeta.modality" type="text" value="${escapeAttr(state.printMeta.modality)}" placeholder="${escapeAttr(suggested.modality)}" /></label>
          <label><span>Supervision Level</span>
            <select data-bind="printMeta.supervision">
              <option value="">Select supervision level</option>
              <option value="Independent, no supervision" ${state.printMeta.supervision === "Independent, no supervision" ? "selected" : ""}>Independent, no supervision</option>
              <option value="Light or independent" ${state.printMeta.supervision === "Light or independent" ? "selected" : ""}>Light or independent</option>
              <option value="Moderate supervision by provider recommended" ${state.printMeta.supervision === "Moderate supervision by provider recommended" ? "selected" : ""}>Moderate supervision by provider recommended</option>
              <option value="Advanced supervision by provider always needed" ${state.printMeta.supervision === "Advanced supervision by provider always needed" ? "selected" : ""}>Advanced supervision by provider always needed</option>
            </select>
          </label>
          <label><span>Timing Relative to Appointments</span>
            <select data-bind="printMeta.timing">
              <option value="">Select timing category</option>
              <option value="In Session" ${state.printMeta.timing === "In Session" ? "selected" : ""}>In Session</option>
              <option value="Out of Session - Any Day" ${state.printMeta.timing === "Out of Session - Any Day" ? "selected" : ""}>Out of Session - Any Day</option>
              <option value="Out of Session - Non Appointment Days" ${state.printMeta.timing === "Out of Session - Non Appointment Days" ? "selected" : ""}>Out of Session - Non Appointment Days</option>
              <option value="Immediately Before Appointment" ${state.printMeta.timing === "Immediately Before Appointment" ? "selected" : ""}>Immediately Before Appointment</option>
              <option value="Immediately After Appointment" ${state.printMeta.timing === "Immediately After Appointment" ? "selected" : ""}>Immediately After Appointment</option>
              <option value="Within 2 Hours Before Appointment" ${state.printMeta.timing === "Within 2 Hours Before Appointment" ? "selected" : ""}>Within 2 Hours Before Appointment</option>
              <option value="Within 2 Hours After Appointment" ${state.printMeta.timing === "Within 2 Hours After Appointment" ? "selected" : ""}>Within 2 Hours After Appointment</option>
              <option value="Same Day as Appointment" ${state.printMeta.timing === "Same Day as Appointment" ? "selected" : ""}>Same Day as Appointment</option>
              <option value="Other / See timing note" ${state.printMeta.timing === "Other / See timing note" ? "selected" : ""}>Other / See timing note</option>
            </select>
          </label>        
          </div>


        <label class="timing-note-field" style="margin-top:14px;">
          <span>Timing Note (optional)</span>
          <textarea
            data-bind="printMeta.timingNote"
            placeholder="Add timing detail if needed. E.g., complete within 2 hours after psychotherapy, avoid on injection days, or perform only on days without scheduled appointments."
          >${escapeHtml(state.printMeta.timingNote || "")}</textarea>
        </label>

        
        <label style="margin-top:14px;">
          <span>Progression Logic</span>
          <textarea data-bind="printMeta.progression" placeholder="Any additions or changes to the exercise plan expected as tolerance, adherence, comfort, and symptom response dictate. E.g., Patient comes to PT after a hip injury from hiking. Progression may look like increasing banded leg lifts from 3 sets of 6 to 6 sets of 6 after 8 weeks of PT sessions twice weekly.">${escapeHtml(state.printMeta.progression || "")}</textarea>
        </label>
  
        <div class="form-grid print-form-grid" style="margin-top:14px;">
          <label><span>Response to Exercise</span><textarea data-bind="printMeta.response" placeholder="Example: Patient reports positive improvement on ADL's from runing but notes shooting pain through the sciatic nerve when doing hot yoga and stops the exercise. Lab results indicate....">${escapeHtml(state.printMeta.response || "")}</textarea></label>
          <label><span>Risk / Caution</span><textarea data-bind="printMeta.risk" placeholder="${escapeAttr(suggested.risk)}">${escapeHtml(state.printMeta.risk || "")}</textarea></label>
          <label><span>When to Progress</span><textarea data-bind="printMeta.trigger" placeholder="${escapeAttr(suggested.trigger)}">${escapeHtml(state.printMeta.trigger || "")}</textarea></label>
          <label><span>Review Date / Reassessment</span><input data-bind="printMeta.reviewDate" type="text" value="${escapeAttr(state.printMeta.reviewDate)}" placeholder="Follow-up date" /></label>
        </div>
      </section>
    `;
  }
  
  function renderWeeklyPlannerBoard() {
    if (!state.plan.length) return "";
    const schedule = getWeeklySchedule();
    return `
      <section class="weekly-board-shell">
        <div class="small muted weekly-board-help">Drag session chips between days to reorganize the week. Each chip represents one scheduled session.</div>
        <div class="weekly-board">
          ${WEEKDAYS.map(day => `
            <div class="weekday-column">
              <div class="weekday-head">${escapeHtml(day)}</div>
              <div class="weekday-dropzone" data-day-dropzone="${escapeAttr(day)}">
                ${schedule[day].length ? schedule[day].map(session => `
                  <button
                    type="button"
                    class="session-chip"
                    draggable="true"
                    data-plan-id="${escapeAttr(session.item.id)}"
                    data-session-index="${escapeAttr(session.sessionIndex)}"
                    title="Drag this session to another day"
                  >
                    <span class="session-chip-name">${escapeHtml(shortLabel(session.item.activityName, 28))}</span>
                    <span class="session-chip-meta">${round(session.item.duration, 0)} min</span>
                  </button>
                `).join("") : `<div class="weekday-empty">Drop sessions here</div>`}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }
  
  function getWeeklySchedule() {
    const schedule = Object.fromEntries(WEEKDAYS.map(day => [day, []]));
    state.plan.forEach(item => {
      const normalized = normalizeStoredPlanItem(item);
      normalized.dayAssignments.forEach((day, sessionIndex) => {
        const safeDay = WEEKDAYS.includes(day) ? day : WEEKDAYS[sessionIndex % WEEKDAYS.length];
        schedule[safeDay].push({ item: normalized, sessionIndex });
      });
    });
    return schedule;
  }
  
  function summarizeDayAssignments(assignments) {
    if (!Array.isArray(assignments) || !assignments.length) return "No days assigned";
    const counts = WEEKDAYS
      .map(day => [day, assignments.filter(entry => entry === day).length])
      .filter(([, count]) => count > 0);
    return counts.map(([day, count]) => count > 1 ? `${day} ×${count}` : day).join(", ");
  }
  
  function defaultAssignmentsForFrequency(frequency) {
    const count = Math.max(1, Math.min(7, Math.round(Number(frequency || 0))));
    const spreadOrder = ["Monday", "Wednesday", "Friday", "Sunday", "Tuesday", "Thursday", "Saturday"];
    return spreadOrder.slice(0, count);
  }
  
  function normalizeStoredPlanItem(item) {
    const frequency = Math.max(0, Math.round(Number(item?.frequency || 0)));
    const base = Array.isArray(item?.dayAssignments)
      ? item.dayAssignments.filter(day => WEEKDAYS.includes(day))
      : [];
    let dayAssignments = [...base];
    const defaults = defaultAssignmentsForFrequency(Math.max(frequency, 1));
    while (dayAssignments.length < frequency) {
      dayAssignments.push(defaults[dayAssignments.length % defaults.length]);
    }
    if (dayAssignments.length > frequency) {
      dayAssignments = dayAssignments.slice(0, frequency);
    }
    return {
      ...item,
      dayAssignments
    };
  }
  
  function getPrimarySpecifierSummary(limit = 3) {
    return Object.entries(state.specifiers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name)
      .join(", ");
  }
  
  function buildPrintMetaSuggestions() {
    const entries = Object.entries(state.specifiers).sort((a, b) => b[1] - a[1]);
    const primarySpecifiers = entries.filter(([, value]) => value >= 7).map(([name]) => name);
    const flexibleSpecifiers = entries.filter(([, value]) => value >= 3 && value <= 6).map(([name]) => name);
    const lowPrioritySpecifiers = entries.filter(([, value]) => value <= 2).map(([name]) => name);
  
    const activityNames = state.plan.length
      ? state.plan.map(item => item.activityName)
      : (getSelectedActivity() ? [getSelectedActivity().activity] : []);
  
    const uniqueNames = Array.from(new Set(activityNames));
    const categories = Array.from(new Set(state.plan.map(item => item.category).filter(Boolean)));
    const totals = totalPlanDose();
  
    const modality = uniqueNames.length === 1
      ? uniqueNames[0]
      : categories.length === 1
        ? `${categories[0]}-focused plan`
        : uniqueNames.length
          ? "Mixed-modal exercise plan"
          : "Structured exercise plan";
  
    const diagnosisDisplay = state.printMeta.diagnosis?.trim() || "[Diagnosis / Target]";
    const activityDisplay = uniqueNames.length
      ? uniqueNames.join(", ")
      : "[Selected exercise block]";
  
    const primaryText = primarySpecifiers.length
      ? primarySpecifiers.join(", ")
      : getPrimarySpecifierSummary(3);
  
    const flexibleText = flexibleSpecifiers.length
      ? flexibleSpecifiers.join(", ")
      : "other lower-priority specifiers";
  
    const lowPriorityText = lowPrioritySpecifiers.length
      ? lowPrioritySpecifiers.join(", ")
      : "";
  
    const summaryFlexibleText = lowPriorityText
      ? `${flexibleText}, and ${lowPriorityText}`
      : flexibleText;
  
    return {
      clinician: "",
      client: "",
      diagnosis: state.printMeta.diagnosis || "",
      setting: "Outpatient / behavioral health setting",
      goal: `The goal of the exercise prescription is to target ${primaryText} through ${activityDisplay} for ${diagnosisDisplay}.`,
      summary: `Client has a diagnosis of ${diagnosisDisplay} and is assigned exercise as a behavioral health intervention to support regulation, attention, symptom management, and activities of daily living. The current plan includes ${activityDisplay}. Primary specifier emphasis: ${primaryText}. Flexible or lower-priority specifiers: ${summaryFlexibleText}. Planned weekly workload: ${round(totals.metMinWeek, 1)} MET-minutes with an estimated ${round(totals.kcalWeek, 1)} kcal per week.`,
      modality,
      supervision: state.specifiers["Clinician Integration Specifier"] >= 7
        ? "Moderate supervision by provider recommended"
        : "Light or independent",
      timing: "Out of Session - Any Day",
      timingNote: "",
      progression: "Increase one variable at a time as tolerance, adherence, comfort, and symptom response allow.",
      response: "Monitor symptom response, adherence, perceived exertion across the week, and metrics within the seven specifiers.",
      risk: "Watch for overexertion, symptom worsening, and barriers to consistency.",
      trigger: "Define the threshold for advancing the plan or changing specifier emphasis. What changes, and when should it change? E.g., A client starts at an activity of 4.0 METs. If symptoms do not improve and tolerance remains adequate, increase to 5.0 METs.",
      reviewDate: ""
    };
  }
  
  function resolvePrintMeta() {
    const suggestions = buildPrintMetaSuggestions();
    const resolved = {};
    Object.keys(DEFAULT_PRINT_META).forEach(key => {
      resolved[key] = (state.printMeta[key] || "").trim() || suggestions[key] || "";
    });
    return resolved;
  }
  
  function autofillPrintMeta(overwrite = false) {
    const suggestions = buildPrintMetaSuggestions();
    Object.entries(suggestions).forEach(([key, value]) => {
      if (overwrite || !String(state.printMeta[key] || "").trim()) {
        state.printMeta[key] = value;
      }
    });
  }
  
  function renderPrintRadarChart() {
    const values = SPECIFIERS.map(name => Number(state.specifiers[name] || 1));
    const width = 360;
    const height = 320;
    const centerX = 170;
    const centerY = 150;
    const radius = 86;
    const labelRadius = 122;
  
    const points = values.map((value, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const r = radius * (value / 10);
      return [centerX + Math.cos(angle) * r, centerY + Math.sin(angle) * r];
    });
  
    const grid = Array.from({ length: 5 }, (_, i) => {
      const level = (i + 1) / 5;
      const gridPoints = values.map((_, idx) => {
        const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
        const r = radius * level;
        return `${centerX + Math.cos(angle) * r},${centerY + Math.sin(angle) * r}`;
      }).join(" ");
      return `<polygon points="${gridPoints}" fill="none" stroke="#dbe5f1" stroke-width="1" />`;
    }).join("");
  
    const spokes = SPECIFIERS.map((_, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      return `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#dbe5f1" stroke-width="1" />`;
    }).join("");
  
    const labels = SPECIFIERS.map((label, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const x = centerX + Math.cos(angle) * labelRadius;
      const y = centerY + Math.sin(angle) * labelRadius;
      const isRight = x > centerX + 25;
      const isLeft = x < centerX - 25;
      const anchor = isRight ? "start" : isLeft ? "end" : "middle";
      const lines = wrapRadarLabel(label, 14);
      return `
        <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10" font-weight="700" fill="#475569">
          ${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 12}">${escapeHtml(line)}</tspan>`).join("")}
        </text>
      `;
    }).join("");
  
    return `
      <div class="print-radar-svg">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven specifier emphasis radar chart">
          ${grid}
          ${spokes}
          <polygon points="${points.map(point => point.join(",")).join(" ")}" fill="rgba(168, 85, 247, 0.24)" stroke="#7e22ce" stroke-width="2.2" />
          ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#7e22ce" />`).join("")}
          ${labels}
        </svg>
      </div>
    `;
  }
  
  function handleDragStart(event) {
    const chip = event.target.closest("[draggable='true'][data-plan-id][data-session-index]");
    if (!chip) return;
    event.dataTransfer.effectAllowed = "move";
    const payload = {
      planId: chip.dataset.planId,
      sessionIndex: Number(chip.dataset.sessionIndex || 0)
    };
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    chip.classList.add("dragging");
  }
  
  function handleDragOver(event) {
    const zone = event.target.closest("[data-day-dropzone]");
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.classList.add("is-drop-target");
  }
  
  function handleDrop(event) {
    const zone = event.target.closest("[data-day-dropzone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-drop-target");
  
    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
    } catch (error) {
      payload = null;
    }
    if (!payload?.planId && payload?.planId !== "") return;
  
    const item = state.plan.find(entry => entry.id === payload.planId);
    if (!item) return;
    const normalized = normalizeStoredPlanItem(item);
    const nextDay = zone.dataset.dayDropzone;
    if (!WEEKDAYS.includes(nextDay)) return;
  
    normalized.dayAssignments[payload.sessionIndex] = nextDay;
    Object.assign(item, normalized);
  
    showToast(`Moved session to ${nextDay}.`, "success");
    renderApp();
  }
  
  function handleDragEnd() {
    root.querySelectorAll(".weekday-dropzone.is-drop-target").forEach(zone => zone.classList.remove("is-drop-target"));
    root.querySelectorAll(".session-chip.dragging").forEach(chip => chip.classList.remove("dragging"));
  }











  
  function renderSelectedActivityBanner(activity) {
    return `
      <div class="mini-note status-box good">
        <strong>Selected activity</strong><br/>
        ${escapeHtml(activity.activity)}<br/>
        <span class="small">${escapeHtml(activity.category)} • ${round(activity.met, 1)} ${escapeHtml(activity.metSystem || "MET")} • ${escapeHtml(activity.population || "Adult")}</span>
      </div>
    `;
  }

  function renderDraftCard(metrics, activity) {
    const hasDraft = Boolean(activity || state.dose.manualMET);
    if (!hasDraft) return `<div class="empty-state">A draft exercise block will appear here after you select an activity or enter a manual MET value.</div>`;
    return `
      <div class="plan-card" id="draftPlanCard">
        <div class="topline">
          <div>
            <h4 style="margin:0;">Draft block</h4>
            <div class="small muted">This block is not yet in the weekly plan. Review it, then click <strong>Add block to weekly plan</strong>.</div>
          </div>
          <span class="badge">Not yet saved</span>
        </div>
        <div class="inline-meta">
          <span class="badge">${escapeHtml(activity ? activity.activity : "Manual MET entry")}</span>
          <span class="badge">${round(metrics.met || 0, 1)} ${escapeHtml(metrics.metSystem || "MET")}</span>
          <span class="badge">${round(metrics.duration || 0, 0)} min/session</span>
          <span class="badge">${round(metrics.frequency || 0, 0)} / week</span>
          <span class="badge">${round(metrics.metMinWeek || 0, 1)} ${escapeHtml(metrics.metSystem || "MET")}-min/week</span>
        </div>
        ${state.dose.note ? `<div class="small muted" style="margin-top:12px; white-space:pre-wrap;"><strong>Exercise details:</strong><br/>${escapeHtml(state.dose.note)}</div>` : ``}
      </div>
    `;
  }

  function renderPlanCard(item) {
    const daySummary = summarizeDayAssignments(item.dayAssignments || []);
    return `
      <article class="plan-card">
        <div class="topline">
          <div>
            <h4>${escapeHtml(item.activityName)}</h4>
            <div class="inline-meta">
              <span class="badge">${round(item.met, 1)} ${escapeHtml(item.metSystem || "MET")}</span>
              <span class="badge">${round(item.duration, 0)} min/session</span>
              <span class="badge">${round(item.frequency, 0)} / week</span>
              <span class="badge">${round(item.metMinWeek, 1)} ${escapeHtml(item.metSystem || "MET")}-min/week</span>
            </div>
            <div class="small muted plan-day-summary"><strong>Scheduled on:</strong> ${escapeHtml(daySummary)}</div>
          </div>
          <div class="button-row">
            <button class="btn btn-soft" data-action="plan-reset-days" data-id="${escapeAttr(item.id)}">Auto-spread days</button>
            <button class="btn btn-soft" data-action="plan-duplicate" data-id="${escapeAttr(item.id)}">Duplicate</button>
            <button class="btn btn-danger" data-action="plan-remove" data-id="${escapeAttr(item.id)}">Remove</button>
          </div>
        </div>
        ${item.blockDetails ? `<div class="small muted" style="white-space:pre-wrap; margin-top:12px;"><strong>Exercise details:</strong><br/>${escapeHtml(item.blockDetails)}</div>` : ``}
      </article>
    `;
  }


  function renderDoseSummary(metrics, activity) {
    if (!metrics.met) {
      return `
        <div class="card-head"><div><h2>Current dose summary</h2><p>Pick an activity or enter a manual MET value to preview the weekly dose.</p></div></div>
        <div class="empty-state">Once the activity is selected, this panel shows session dose, weekly MET-minutes, estimated calories, and a short interpretation that is easier to explain in supervision or documentation.</div>
      `;
    }
    const intensity = intensityBand(metrics.met);
    return `
      <div class="card-head">
        <div>
          <h2>Current dose summary</h2>
          <p>${escapeHtml(activity ? shortLabel(activity.activity, 80) : "Manual MET entry")}</p>
        </div>
      </div>
      <div class="metrics-grid">
        ${metricTile("MET value", `${round(metrics.met, 1)} ${metrics.metSystem}`)}
        ${metricTile("Per session", `${round(metrics.metMinSession, 1)} ${metrics.metSystem}-min`)}
        ${metricTile("Per week", `${round(metrics.metMinWeek, 1)} ${metrics.metSystem}-min`)}
        ${metricTile("Estimated kcal/week", `${round(metrics.kcalWeek, 1)}`)}
      </div>
      <div class="mini-note" style="margin-top:14px;">
        <strong>How to read this</strong><br/>
        This draft sits in the <strong>${capitalize(intensity)}</strong> intensity band. The current weekly structure is ${round(metrics.duration, 0)} minutes per session, ${round(metrics.frequency, 0)} times per week. Use the exercise-details box to capture sets, reps, rest intervals, or warm-up structure before adding the block to the weekly planner.
      </div>
    `;
  }

  function renderQualityChecklist(quality) {
    const items = [
      [quality.hasActivity, "Activity selected", "Select an activity from the library or quick lookup."],
      [quality.hasDose, "Dose fields filled", "Minutes, frequency, and a MET source are in place."],
      [quality.hasPlanBlock, "Block saved to weekly plan", "At least one exercise card has been added below."],
      [quality.hasNote, "Plan note started", "A summary note is present for export."]
    ];
  
    return `
      <div class="quality-check-shell">
        <div class="checklist">
          ${items.map(([good, title, detail]) => `
            <div class="check-item">
              <span>${good ? "✓" : "•"}</span>
              <div><strong>${title}</strong><br/>${detail}</div>
            </div>
          `).join("")}
        </div>
  
        <div class="mini-note quality-radar-note" style="margin-top:14px;">
          <strong>Specifier profile preview</strong><br/>
          <span class="small muted">Use this as a quick check that the current slider pattern matches the plan you are building.</span>
          <div class="quality-radar-wrap">
            ${renderPrintRadarChart()}
          </div>
        </div>
      </div>
    `;
  }

  function specifierRelevanceMeta(score) {
    if (score <= 2) {
      return {
        title: "low expected relevance",
        band: "0–2",
        guidance: "is expected to have low relevance to treatment outcomes and is generally omitted from the primary focus unless the case context changes."
      };
    }
    if (score <= 4) {
      return {
        title: "limited or context-dependent relevance",
        band: "3–4",
        guidance: "has limited or context-dependent relevance and may matter in select cases, treatment phases, or implementation settings."
      };
    }
    if (score <= 6) {
      return {
        title: "moderate relevance",
        band: "5–6",
        guidance: "has moderate relevance and should usually be considered in planning, even if it is not the main driver of the intervention."
      };
    }
    if (score <= 8) {
      return {
        title: "high relevance",
        band: "7–8",
        guidance: "has high relevance to treatment design and should usually be intentionally prioritized, monitored, or controlled within the intervention."
      };
    }
    return {
      title: "critical relevance",
      band: "9–10",
      guidance: "is of critical relevance to treatment design and is expected to meaningfully influence outcomes, so it should be treated as a central planning priority."
    };
  }

  function renderSpecifierSummary() {
    const entries = Object.entries(state.specifiers).sort((a, b) => b[1] - a[1]);

    const primary = entries.filter(([, value]) => value >= 7).map(([key]) => key);
    const secondary = entries.filter(([, value]) => value >= 3 && value <= 6).map(([key]) => key);
    const low = entries.filter(([, value]) => value <= 2).map(([key]) => key);

    const overview = [];
    if (primary.length) overview.push(`<strong>Primary emphasis:</strong> ${escapeHtml(primary.join(", "))}`);
    if (secondary.length) overview.push(`<strong>Secondary or context-dependent emphasis:</strong> ${escapeHtml(secondary.join(", "))}`);
    if (low.length) overview.push(`<strong>Lower-priority or omitted domains:</strong> ${escapeHtml(low.join(", "))}`);

    const details = entries.map(([name, score]) => {
      const meta = specifierRelevanceMeta(score);
      return `
        <li>
          <strong>${escapeHtml(name)}</strong> — <strong>${score}/10</strong> 
          <span class="specifier-band">(${meta.band}: ${escapeHtml(meta.title)})</span>: 
          ${escapeHtml(name)} ${meta.guidance}
        </li>
      `;
    }).join("");

    return `
      <div class="specifier-summary-scale">
        <p><strong>Specifier scoring guide:</strong> Specifiers are scored on a <strong>0–10 scale</strong> that reflects the degree to which each domain is expected to influence treatment outcomes and, therefore, should be intentionally prioritized, monitored, or controlled within the intervention.</p>

        <ul class="specifier-band-guide">
          <li><strong>0–2:</strong> low expected relevance; generally omitted from the primary focus.</li>
          <li><strong>3–4:</strong> limited or context-dependent relevance.</li>
          <li><strong>5–6:</strong> moderate relevance.</li>
          <li><strong>7–8:</strong> high relevance.</li>
          <li><strong>9–10:</strong> critical relevance to treatment design and success.</li>
        </ul>

        <p class="small muted">Scores are illustrative and may vary by diagnosis, treatment target, and clinical context.</p>

        ${overview.length ? `<p class="small muted">${overview.join("<br>")}</p>` : ""}

        <ul class="specifier-summary-list">
          ${details}
        </ul>
      </div>
    `;
  }

  function renderRadarChart() {
    const values = SPECIFIERS.map(name => Number(state.specifiers[name] || 1));

    const width = 900;
    const height = 620;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 220;
    const labelRadius = 345;

    const points = values.map((value, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const r = radius * (value / 10);
      return [
        centerX + Math.cos(angle) * r,
        centerY + Math.sin(angle) * r
      ];
    });

    const labels = SPECIFIERS.map((label, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const x = centerX + Math.cos(angle) * labelRadius;
      const y = centerY + Math.sin(angle) * labelRadius;

      const isRight = x > centerX + 40;
      const isLeft = x < centerX - 40;
      const anchor = isRight ? "start" : isLeft ? "end" : "middle";

      let xShift = isRight ? 12 : isLeft ? -12 : 0;
      let yShift = 0;

      // Nudge specific labels if they sit too close to an edge
      if (label === "Time and Frequency") {
        xShift += 22;   // moves it inward from the left edge
      }
      if (label === "Behavioral Health Integration") {
        xShift += 12;   // optional, if this one also feels tight
      }

      const lines = wrapRadarLabel(label, 20);

      return `
        <text x="${x + xShift}" y="${y + yShift}" text-anchor="${anchor}" font-size="15" font-weight="700" fill="#475569">
        ${lines.map((line, i) => `<tspan x="${x + xShift}" dy="${i === 0 ? 0 : 17}">${escapeHtml(line)}</tspan>`).join("")}
        </text>
      `;
    }).join("");

    const grid = Array.from({ length: 5 }, (_, i) => {
      const level = (i + 1) / 5;
      const gridPoints = values.map((_, idx) => {
        const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
        const r = radius * level;
        return `${centerX + Math.cos(angle) * r},${centerY + Math.sin(angle) * r}`;
      }).join(" ");
      return `<polygon points="${gridPoints}" fill="none" stroke="#dbe5f1" stroke-width="1" />`;
    }).join("");

    const spokes = SPECIFIERS.map((_, idx) => {
      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI / values.length);
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      return `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#dbe5f1" stroke-width="1" />`;
    }).join("");

    return `
      <div class="radar-shell">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven specifier emphasis radar chart">
          ${grid}
          ${spokes}
          <polygon points="${points.map(p => p.join(",")).join(" ")}" fill="rgba(168, 85, 247, 0.24)" stroke="#7e22ce" stroke-width="3" />
          ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#7e22ce" />`).join("")}
          ${labels}
        </svg>
      </div>
    `;
  }

  function renderCalculations() {
    return `
      <section class="panel">
        <section class="hero">
          <div>
            <h2>Calculations</h2>
            <p>The page is organized in three layers: common tools first, then clinical tools, then advanced physiology. Each card explains what the equation does, why we use it, how it works, and what to do with the result.</p>
          </div>
          <div class="quick-grid">
            <div class="feature-card"><h4>Common tools</h4><p>Quick conversions and dose-related estimates that are frequently used in practice.</p></div>
            <div class="feature-card"><h4>Clinical tools</h4><p>Exercise prescription, patient monitoring, and applied clinical exercise calculations.</p></div>
            <div class="feature-card"><h4>Advanced physiology</h4><p>Deeper cardiorespiratory and lab-oriented calculations for more technical workflows.</p></div>
          </div>
        </section>

        <section class="calc-section">
          <div class="section-title-row"><div><h3>Common tools</h3><p>For quick conversions and everyday exercise planning.</p></div></div>
          <div class="calc-grid">
            ${renderCalcCard("metvo2", "MET ↔ VO₂ conversion", "Translate MET values into ml/kg/min or convert back to a MET estimate.", commonFields.metvo2, state.calculations.metvo2)}
            ${renderCalcCard("metkcal", "MET ↔ session calories", "Convert MET workload into session calories or estimate implied average METs from calories burned.", commonFields.metkcal, state.calculations.metkcal)}
            ${renderCalcCard("bmr", "BMR + daily energy", "Estimate basal metabolic rate and optionally project daily calories using an activity multiplier.", commonFields.bmr, state.calculations.bmr)}
            ${renderCalcCard("hrzone", "Predicted max HR + target zone", "Estimate maximal heart rate and calculate a target heart-rate zone using heart-rate reserve (Karvonen).", commonFields.hrzone, state.calculations.hrzone)}
            ${renderCalcCard("pace", "Speed / pace converter", "Switch between mph, min/mile, and min/km to help translate field pace into a more familiar format.", commonFields.pace, state.calculations.pace)}
          </div>
        </section>

        <section class="calc-section">
          <div class="section-title-row"><div><h3>Clinical tools</h3><p>For exercise prescription, patient monitoring, and applied practice.</p></div></div>
          <div class="calc-grid">
            ${renderCalcCard("weeklydose", "Weekly dose from METs", "Estimate weekly MET-minutes and calories from a single activity block.", commonFields.weeklydose, state.calculations.weeklydose)}
            ${renderCalcCard("vo2reserve", "VO₂ reserve target", "Estimate a training target using VO₂ reserve and a chosen exercise intensity.", commonFields.vo2reserve, state.calculations.vo2reserve)}
            ${renderCalcCard("rppmap", "Rate-pressure product + MAP", "Estimate myocardial workload and mean arterial pressure from blood pressure and heart rate.", commonFields.rppmap, state.calculations.rppmap)}
            ${renderCalcCard("acsmwalkrun", "ACSM walking / running VO₂", "Estimate steady-state oxygen cost from speed and grade for treadmill-based walking or running.", commonFields.acsmwalkrun, state.calculations.acsmwalkrun)}
            ${renderCalcCard("acsmbike", "ACSM cycle ergometry", "Estimate VO₂ during cycle ergometry from work rate and body mass.", commonFields.acsmbike, state.calculations.acsmbike)}
            ${renderCalcCard("acsmstep", "ACSM stepping", "Estimate oxygen cost from stepping rate and step height.", commonFields.acsmstep, state.calculations.acsmstep)}
          </div>
        </section>

        <section class="calc-section">
          <div class="section-title-row"><div><h3>Advanced physiology</h3><p>For deeper interpretation of lab and performance data.</p></div></div>
          <div class="calc-grid">
            ${renderCalcCard("rer", "Respiratory exchange ratio (RER)", "Estimate RER and interpret whether the effort is more fat-leaning, carbohydrate-leaning, or near maximal.", commonFields.rer, state.calculations.rer)}
            ${renderCalcCard("o2pulse", "Oxygen pulse", "Estimate oxygen pulse as VO₂ divided by heart rate, a rough marker tied to stroke volume and peripheral extraction.", commonFields.o2pulse, state.calculations.o2pulse)}
            ${renderCalcCard("fick", "Fick cardiac output", "Estimate cardiac output using oxygen uptake and the arterial-venous oxygen difference.", commonFields.fick, state.calculations.fick)}
          </div>
        </section>
      </section>
    `;
  }

  function renderCalcCard(id, title, subtitle, fields, result) {
    return `
      <section class="calc-card" data-calc-card="${id}">
        <div class="card-head">
          <div>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div class="form-grid">
          ${fields.map(field => renderCalcField(id, field, result?.inputs?.[field.name])).join("")}
        </div>
        <div class="button-row" style="margin-top:14px;">
          <button class="btn btn-calc" data-action="calc-run" data-calc="${id}">Calculate</button>
          <button class="btn btn-soft" data-action="calc-clear" data-calc="${id}">Clear</button>
        </div>
        ${result ? `<div class="calc-result"><strong>${escapeHtml(result.title)}</strong><div class="result-text">${result.html}</div></div>` : ""}

        ${(calcPlainLanguage[id] || calcClinicalExamples[id]) ? `
          <details class="help-box calc-inline-details" open>
            <summary>Explanation</summary>
            <div class="helper-copy calc-inline-section">
              ${calcPlainLanguage[id] ? `
                <div>
                  <h5>What this means</h5>
                  <p>${escapeHtml(calcPlainLanguage[id])}</p>
                </div>
              ` : ""}
              ${calcClinicalExamples[id] ? `
                <div>
                  <h5>Clinical example</h5>
                  <p>${escapeHtml(calcClinicalExamples[id])}</p>
                </div>
              ` : ""}
            </div>
          </details>
        ` : ""}

        ${calcFormulaVisuals[id] ? `
          <div class="calc-divider"></div>
          <details class="help-box calc-inline-details">
            <summary>Formula / visual</summary>
            <div class="helper-copy calc-inline-section">
              ${calcFormulaVisuals[id]}
            </div>
          </details>
        ` : ""}

        ${calcSourcesHtml[id] ? `
          <div class="calc-divider"></div>
          <details class="help-box calc-inline-details">
            <summary>Source / APA citation</summary>
            <div class="helper-copy calc-inline-section">
              ${calcSourcesHtml[id]}
            </div>
          </details>
        ` : ""}
      </section>
    `;
  }

  function renderCalcField(calcId, field, value) {
    const currentValue = value ?? field.default ?? "";
    if (field.type === "select") {
      return `
        <label>
          <span>${escapeHtml(field.label)}</span>
          <select data-calc-input="${calcId}" data-name="${field.name}">
            ${field.options.map(opt => `<option value="${escapeAttr(opt.value)}" ${String(currentValue) === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
          </select>
        </label>
      `;
    }
    if (field.type === "range") {
      return `
        <label>
          <div class="calc-range-head">
            <span>${escapeHtml(field.label)}</span>
            <strong class="calc-range-value" data-calc-display>${escapeHtml(formatCalcFieldDisplay(field, currentValue))}</strong>
          </div>
          <input type="range" min="${escapeAttr(field.min ?? 0)}" max="${escapeAttr(field.max ?? 1)}" step="${escapeAttr(field.step ?? 0.01)}" data-calc-input="${calcId}" data-name="${field.name}" value="${escapeAttr(currentValue)}" />
        </label>
      `;
    }
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
        <input type="${field.type || "number"}" step="${field.step ?? "any"}" min="${field.min ?? ""}" max="${field.max ?? ""}" data-calc-input="${calcId}" data-name="${field.name}" value="${escapeAttr(currentValue)}" placeholder="${escapeAttr(field.placeholder || "")}" />
      </label>
    `;
  }

  function renderData() {
    return `
      <section class="panel">
        <section class="hero">
          <div>
            <h2>Data & Sources</h2>
            <p>This page lists the core DOI-based publications used for the activity library and key calculation features in APA format, with active links for verification.</p>
          </div>
        </section>
        <section class="section-card">
          <div class="card-head">
            <div>
              <h2>A Brief Overview of the 7 Specifiers Framework</h2>
              <p>
                The seven specifiers framework was made to help healthcare professionals, providers, and students move beyond vague exercise recommendations by identifying the major parts of a prescription that can be intentionally noted, prioritized, and controlled. Together, they improve clarity, replicability, and the ability to match exercise more precisely to diagnosis, treatment goals, and individual client needs.
              </p>
            </div>
          </div>
        
          <div class="source-list">
            <div class="source-item">
              <p><strong>Metabolic Equivalents of Task (METs)</strong><br>
              Metabolic Equivalents of Task (METs) are a standardized unit of external load that estimate the energy cost of an activity relative to rest. METs are fundamental for exercise prescription because they help healthcare professionals quantify whether activity is light, moderate, or vigorous, compare different exercise options, estimate weekly dose through MET-minutes, and review a client’s current physical exertion before building a plan.<br>
              <span class="small muted">Example: A provider could prescribe either brisk walking or light cycling if both reach the same target MET range. This also allows clinicians to adjust exercise choices based on client preferences and environments, such as cycling and running in the summer and cross-country skiing in the winter.</span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Heart Rate</strong><br>
              Heart rate reflects internal physiological load, or how hard the body is actually working in response to an exercise demand. This makes it valuable because two clients can complete the same activity at the same MET level while experiencing very different internal strain, so heart rate helps healthcare professionals better match exercise intensity to tolerance, readiness, and treatment goals.<br>
              <span class="small muted">Example: A client with panic symptoms may need a lower heart-rate target even if the external workload looks moderate on paper.</span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Breathing Control and Pacing</strong><br>
              Breathing control and pacing refer to how respiration is used both on its own and during exercise, including type, cadence, route of breathing, and recovery patterns. Healthcare professionals should pay attention to this specifier because breathing can change arousal, perceived exertion, distress tolerance, and emotional regulation, making it especially relevant when exercise is being used in populations with anxiety, panic, trauma, or autonomic dysregulation.<br>
              <span class="small muted">Example: A provider may pair light aerobic exercise with slow nasal breathing for a client with anxiety either to help with emotional regulation or strengthen the diaphragm and intercostal muscles.</span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Specific Exercise Type and Structure</strong><br>
              Specific Exercise Type and Structure refers to the exact activity being prescribed and the way it is organized, including movement selection, sets, reps, rest intervals, pace, and training format. This specifier matters because exercise is not interchangeable; different modalities create different physiological demands, psychological demands, emotional experiences, adherence patterns, and clinical effects, even when they appear similar in intensity or other specifiers.<br>
              <span class="small muted">Example: A healthcare professional might choose cross-country skiing instead of running for a Scandinavian client who enjoyed it as a kid, while a Veteran may enjoy boxing drills instead of jogging for emotional release and structured intensity. </span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Neurological and Physiological Targets</strong><br>
              Neurological and Physiological Targets refer to the primary body systems, adaptations, or mechanisms the exercise is intended to influence, such as aerobic capacity, autonomic regulation, proprioception, mood-related neurobiology, or muscular adaptation. Healthcare professionals should control this specifier so that exercise selection is tied to a clear rationale, rather than treating all movement as though it works through the same pathway.<br>
              <span class="small muted">Example: A provider may choose balance and coordination work when the target is sensorimotor regulation rather than a physiological response from cardiovascular fitness.</span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Time and Frequency</strong><br>
              Time and Frequency refer to how long exercise lasts, how often it is performed, invervals in session, rest periods, how it is spaced across the week, and when it occurs relative to treatment or daily functioning. This specifier is important because exercise outcomes are shaped not only by what activity is chosen, but also by how often and when it is delivered, which affects recovery, adherence, progression, and therapeutic usefulness.<br>
              <span class="small muted">Example: A healthcare professional may prescribe shorter High-Intensity Interval Training (HIIT) exercise three times per week, rather than one long weekend session, to improve outcomes.</span></p>
            </div>
        
            <div class="source-item">
              <p><strong>Clinician Integration Specifier</strong><br>
              The Clinician Integration Specifier refers to how much professional structure, oversight, interpretation, or coordination is built into the exercise intervention. This matters because some exercise plans can be delivered with broad independence, while others require closer clinical guidance to manage safety, symptom response, adherence, timing, or integration with broader treatment goals.<br>
              <span class="small muted">Example: Different disorders and diagnosis will require different structures from providers to achieve specific outcomes. A client with an eating disorder will need exercise paired with provider guidance and therapy, while a client with ADHD will be able to exercise completely independently.</span></p>
            </div>
          </div>
        </section>
        
        <div class="data-layout">
          <section class="section-card">
            <div class="card-head">
              <div>
                <h2>Primary compendium sources</h2>
                <p>These publications support the 2024 Adult, Older Adult, and Wheelchair activity databases used in this build.</p>
              </div>
            </div>
            <div class="source-list">
              <div class="source-item">
                <p>Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Fraser, M. M., Kim, Y., Tarp, J., Edwards, N., Héroux, M., & Tudor-Locke, C. (2024). 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. <em>Journal of Sport and Health Science, 13</em>(1), 6–12. <a href="https://doi.org/10.1016/j.jshs.2023.10.010" target="_blank" rel="noopener noreferrer">https://doi.org/10.1016/j.jshs.2023.10.010</a></p>
              </div>
              <div class="source-item">
                <p>Willis, E. A., Herrmann, S. D., Ainsworth, B. E., Kendall, B. J., Mâsse, L. C., Kim, Y., Tarp, J., Edwards, N., Héroux, M., Fraser, M. M., & Tudor-Locke, C. (2024). Energy costs of human activities in adults aged 60 and older. <em>Journal of Sport and Health Science, 13</em>(1), 13–21. <a href="https://doi.org/10.1016/j.jshs.2023.11.002" target="_blank" rel="noopener noreferrer">https://doi.org/10.1016/j.jshs.2023.11.002</a></p>
              </div>
              <div class="source-item">
                <p>Conger, S. A., Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Kim, Y., Tarp, J., Edwards, N., Héroux, M., Fraser, M. M., & Tudor-Locke, C. (2024). 2024 Wheelchair Compendium of Physical Activities: An update of activity codes and energy expenditure values. <em>Journal of Sport and Health Science, 13</em>(1), 22–28. <a href="https://doi.org/10.1016/j.jshs.2023.11.003" target="_blank" rel="noopener noreferrer">https://doi.org/10.1016/j.jshs.2023.11.003</a></p>
              </div>
            </div>
          </section>

          <section class="section-card">
            <div class="card-head">
              <div>
                <h2>Calculation references</h2>
                <p>These references support selected prediction and interpretation tools included in the calculations page.</p>
              </div>
            </div>
            <div class="source-list">
              <div class="source-item">
                <p>Tanaka, H., Monahan, K. D., & Seals, D. R. (2001). Age-predicted maximal heart rate revisited. <em>Journal of the American College of Cardiology, 37</em>(1), 153–156. <a href="https://doi.org/10.1016/S0735-1097(00)01054-8" target="_blank" rel="noopener noreferrer">https://doi.org/10.1016/S0735-1097(00)01054-8</a></p>
              </div>
              <div class="source-item">
                <p>Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Fraser, M. M., Kim, Y., Tarp, J., Edwards, N., Héroux, M., & Tudor-Locke, C. (2024). Promoting public health through the 2024 Compendium of Physical Activities: Strategies for adults, older adults, and wheelchair users. <em>Journal of Sport and Health Science, 13</em>(6), 739–742. <a href="https://doi.org/10.1016/j.jshs.2024.05.013" target="_blank" rel="noopener noreferrer">https://doi.org/10.1016/j.jshs.2024.05.013</a></p>
              </div>
            </div>
          </section>



          <section class="section-card">
            <div class="card-head">
              <div>
                <h2>Use note</h2>
                <p>The app applies these sources as a reference and planning aid. Users should still document when a value is directly measured, estimated from the compendium, or adapted through feasible clinical proxies.</p>
              </div>
            </div>
            <div class="mini-note">
              <strong>Why source transparency matters</strong><br/>
              <span class="small muted">The seven-specifier framework is strongest when the source of each estimate is clear. Separating direct measurement, compendium-based estimates, and lower-resource proxies improves interpretability and makes future replication much easier.</span>
            </div>
          </section>
          
          <section class="section-card qr-reference-card">
            <div class="card-head">
              <div>
                <h2>More references</h2>
                <p>Scan the QR code for additional references related to the poster and supporting material.</p>
              </div>
            </div>
            <div class="qr-reference-row">
              <div class="qr-reference-copy">
                <strong>For more sources</strong>
                <p>See my references for the poster <em>Prescribing Exercise in Behavioral Health: A Framework Toward an Evidence-Based Dose</em> for the SBM 2026 conference.</p>
                <p class="small muted">You can scan the QR code or open the linked resource directly if you are viewing this page on a computer.</p>
              </div>
              <div class="qr-reference-code">
                <a href="https://docs.google.com/spreadsheets/d/1nmlNWUk10V9Ux94SZo3z-JYVCOlSCQ84oRZasrKFeT8/edit?usp=sharing" target="_blank" rel="noopener noreferrer">
                  <img src="assets/sbm-2026-refs-qr.png" alt="QR code linking to additional SBM 2026 poster references" class="qr-code-image" />
                </a>
              </div>
            </div>
          </section>
          
            </div>
            </section>
          `;
  }

  function handleClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "switch-tab") {
      state.activeTab = button.dataset.tab;
      renderApp();
      return;
    }
    
    if (action === "zoom-in") {
      state.uiScale = clamp(round((state.uiScale || 1) + 0.1, 2), 0.8, 1.5);
      renderApp();
      return;
    }
    if (action === "zoom-out") {
      state.uiScale = clamp(round((state.uiScale || 1) - 0.1, 2), 0.8, 1.5);
      renderApp();
      return;
    }
    if (action === "zoom-reset") {
      state.uiScale = 1;
      renderApp();
      return;
    }
    if (action === "library-clear") {
      state.libraryFilters = { ...DEFAULT_STATE.libraryFilters };
      renderApp();
      return;
    }
    if (action === "library-preset") {
      state.libraryFilters = {
        ...state.libraryFilters,
        query: button.dataset.query || "",
        minMet: "",
        maxMet: "",
        category: "all",
        system: "all",
        intensity: "all",
        page: 1
      };
      renderApp();
      return;
    }
    if (action === "library-intensity") {
      state.libraryFilters.intensity = button.dataset.intensity;
      state.libraryFilters.page = 1;
      renderApp();
      return;
    }
    if (action === "library-page") {
      state.libraryFilters.page = clamp(Number(button.dataset.page || 1), 1, 999);
      renderApp();
      return;
    }
    if (action === "library-use") {
      selectActivity(button.dataset.code, "Selected activity sent to Dose + Plan.", "doseBuilderCard");
      return;
    }
    if (action === "dose-pick") {
      selectActivity(button.dataset.code, "Activity selected for the current dose block.", "doseBuilderCard", false);
      return;
    }
    if (action === "dose-clear-search") {
      state.doseLookupQuery = "";
      renderApp();
      return;
    }
    if (action === "dose-clear-selected") {
      state.selectedActivityCode = null;
      state.dose.manualMET = "";
      state.lastMessage = "Selected activity cleared. You can still use a manual MET value if needed.";
      renderApp();
      return;
    }
    if (action === "dose-jump-planner") {
      pendingScrollId = "weeklyPlannerSection";
      renderApp();
      return;
    }
    if (action === "dose-add-plan") {
      addCurrentBlockToPlan();
      return;
    }
    if (action === "plan-remove") {
      state.plan = state.plan.filter(item => item.id !== button.dataset.id);
      showToast("Exercise block removed.", "warn");
      renderApp();
      return;
    }
    if (action === "plan-duplicate") {
      const item = state.plan.find(entry => entry.id === button.dataset.id);
      if (!item) return;
      const copy = normalizeStoredPlanItem({ ...clone(item), id: makeId(), timestamp: new Date().toISOString() });
      state.plan.push(copy);
      showToast("Exercise block duplicated.", "success");
      renderApp();
      return;
    }

    if (action === "plan-reset-days") {
      const item = state.plan.find(entry => entry.id === button.dataset.id);
      if (!item) return;
      item.dayAssignments = defaultAssignmentsForFrequency(item.frequency);
      showToast("Weekly schedule reset across the week.", "success");
      renderApp();
      return;
    }
    
    if (action === "plan-autofill-sheet") {
      autofillPrintMeta(false);
      if (!state.planNote.trim()) state.planNote = buildExamplePlanNote();
      showToast("Prescription sheet fields auto-filled.", "success");
      renderApp();
      return;
    }
    
    if (action === "plan-example-note") {
      state.planNote = buildExamplePlanNote();
      renderApp();
      return;
    }
    if (action === "plan-export-txt") {
      downloadFile("exercise-px-plan.txt", buildPlanText(), "text/plain;charset=utf-8");
      showToast("Plan summary downloaded as TXT.", "success");
      return;
    }
    if (action === "plan-print") {
      window.print();
      return;
    }
    
    if (action === "plan-clear") {
      const ok = window.confirm("Are you sure you want to clear the weekly plan, note, and printable sheet fields?");
      if (!ok) return;
    
      state.plan = [];
      state.planNote = "";
      state.printMeta = clone(DEFAULT_PRINT_META);
    
      showToast("Plan and documentation fields cleared.", "warn");
      renderApp();
      return;
    }
    
    if (action === "toggle-radar") {
      state.showRadar = !state.showRadar;
      renderApp();
      return;
    }
    if (action === "specifier-expand") {
      state.specifierModalOpen = true;
      renderApp();
      return;
    }
    
    if (action === "specifier-close") {
      state.specifierModalOpen = false;
      renderApp();
      return;
    }
    if (action === "specifier-reset") {
      state.specifiers = { ...DEFAULT_STATE.specifiers };
      renderApp();
      return;
    }
    if (action === "calc-run") {
      runCalculation(button.dataset.calc, button.closest("[data-calc-card]"));
      return;
    }
    if (action === "calc-clear") {
      delete state.calculations[button.dataset.calc];
      renderApp();
      return;
    }
    if (action === "data-import") {
      fileInput.value = "";
      fileInput.click();
      return;
    }
    if (action === "data-export") {
      downloadFile("current-met-dataset.json", JSON.stringify(state.db, null, 2), "application/json");
      return;
    }
    if (action === "data-download-bundled") {
      downloadFile("bundled-compendium-2024.json", JSON.stringify(window.BUNDLED_DB || [], null, 2), "application/json");
      return;
    }
    if (action === "data-reset") {
      state.db = clone(window.BUNDLED_DB || []);
      state.usingCustomDb = false;
      showToast("Bundled compendium restored.", "success");
      renderApp();
      return;
    }
  }

  function handleSubmit(event) {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === "library-search") {
      const minVal = root.querySelector("#libraryMinMet")?.value || "";
      const maxVal = root.querySelector("#libraryMaxMet")?.value || "";
      state.libraryFilters = {
        ...state.libraryFilters,
        query: root.querySelector("#libraryQuery")?.value || "",
        minMet: minVal,
        maxMet: maxVal,
        category: root.querySelector("#libraryCategory")?.value || "all",
        system: root.querySelector("#librarySystem")?.value || "all",
        page: 1
      };
      renderApp();
      return;
    }
    if (form.dataset.form === "dose-search") {
      state.doseLookupQuery = root.querySelector("#doseQuickSearch")?.value || "";
      renderApp();
    }
  }

  
  function handleInput(event) {
    const bind = event.target.dataset.bind;
    if (bind) {
      setByPath(state, bind, event.target.type === "number" ? event.target.value : event.target.value);
    
      if (bind.startsWith("dose.")) {
        refreshDoseSection();
      }
    
      if (bind === "printMeta.diagnosis") {
        const suggestions = buildPrintMetaSuggestions();
    
        if (!String(state.printMeta.goal || "").trim()) {
          state.printMeta.goal = suggestions.goal;
        }
    
        if (!String(state.printMeta.summary || "").trim()) {
          state.printMeta.summary = suggestions.summary;
        }
      }
    
      if (bind === "planNote" || bind.startsWith("printMeta.")) {
        const printSheet = root.querySelector("#printPlanSheet");
        if (printSheet) printSheet.outerHTML = renderPlanPrintSheet();
        persistState();
      }
    }
    
    if (event.target.dataset.calcInput && event.target.type === "range") {
      const display = event.target.closest("label")?.querySelector("[data-calc-display]");
      const field = commonFields[event.target.dataset.calcInput]?.find(entry => entry.name === event.target.dataset.name);
      if (display && field) display.textContent = formatCalcFieldDisplay(field, event.target.value);
    }
    const specifier = event.target.dataset.specifier;
if (specifier) {
  state.specifiers[specifier] = Number(event.target.value || 1);

  const row = event.target.closest(".specifier-row");
  if (row) {
    const score = row.querySelector(".specifier-score");
    if (score) score.textContent = state.specifiers[specifier];
  }

  const radarArea = root.querySelector("#radarArea");
  if (radarArea) {
    radarArea.innerHTML = state.showRadar
      ? renderRadarChart()
      : `<div class="empty-state">Radar chart hidden. Use the button above to show it again.</div>`;
  }

  const radarAreaModal = root.querySelector("#radarAreaModal");
  if (radarAreaModal) {
    radarAreaModal.innerHTML = state.showRadar
      ? renderRadarChart()
      : `<div class="empty-state">Radar chart hidden. Use the button above to show it again.</div>`;
  }

  root.querySelectorAll(".specifier-summary-note").forEach(note => {
    note.innerHTML = renderSpecifierSummary();
  });

  persistState();
}

  }

  function refreshDoseSection() {
    const summaryPanel = root.querySelector("#doseSummaryPanel");
    const draftCardHolder = root.querySelector("#draftPlanCard")?.parentElement || root.querySelector("#weeklyPlannerSection");
    if (!summaryPanel || !draftCardHolder) return;
    const activity = getSelectedActivity();
    const metrics = computeCurrentDose();
    summaryPanel.innerHTML = renderDoseSummary(metrics, activity);
    const plannerSection = root.querySelector("#weeklyPlannerSection");
    const existingDraft = plannerSection?.querySelector("#draftPlanCard");
    const html = renderDraftCard(metrics, activity);
    if (existingDraft) {
      existingDraft.outerHTML = html;
    } else if (plannerSection) {
      const firstChild = plannerSection.querySelector(".kpi-band");
      if (firstChild) firstChild.insertAdjacentHTML("beforebegin", html);
    }
    persistState();
  }

  function selectActivity(code, message, scrollId, switchTabs = true) {
    state.selectedActivityCode = code;
    if (switchTabs) state.activeTab = "dose";
    state.lastMessage = message;
    pendingScrollId = scrollId || null;
    showToast(message, "success");
    renderApp();
  }

  function addCurrentBlockToPlan() {
    const metrics = computeCurrentDose();
    if (!metrics.met || !metrics.duration || !metrics.frequency) {
      showToast("Finish the dose fields before adding the block to the weekly plan.", "warn");
      return;
    }
    const activity = getSelectedActivity();
    state.plan.push(normalizeStoredPlanItem({
      id: makeId(),
      timestamp: new Date().toISOString(),
      activityCode: activity?.code || null,
      activityName: activity?.activity || "Manual MET entry",
      category: activity?.category || "Custom",
      met: metrics.met,
      metSystem: metrics.metSystem,
      duration: metrics.duration,
      frequency: metrics.frequency,
      weightKg: metrics.weightKg,
      kcalWeek: metrics.kcalWeek,
      metMinWeek: metrics.metMinWeek,
      blockDetails: state.dose.note || "",
      profileSnapshot: clone(state.specifiers),
      dayAssignments: defaultAssignmentsForFrequency(metrics.frequency)
    }));
    
    state.dose.note = "";
    showToast("Exercise block added to the weekly plan.", "success");
    pendingScrollId = "weeklyPlannerSection";
    renderApp();
  }

  async function handleFileImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array of activity records.");
      state.db = parsed;
      state.usingCustomDb = true;
      showToast("Custom dataset imported successfully.", "success");
      renderApp();
    } catch (error) {
      showToast(error.message || "Import failed.", "warn");
    }
  }

  function afterRender() {
    if (pendingScrollId) {
      const target = document.getElementById(pendingScrollId);
      if (target) {
        requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      pendingScrollId = null;
    }
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9+\-.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getSearchTokens(value) {
    return normalizeSearchText(value).split(" ").filter(Boolean);
  }

  function expandQuery(rawQuery) {
    const q = normalizeSearchText(rawQuery);
  
    const synonyms = {
      ski: ["ski", "skiing", "downhill", "cross country", "nordic"],
      bike: ["bike", "biking", "bicycle", "bicycling", "cycling", "stationary cycling", "outdoor cycling"],
      cycle: ["cycle", "cycling", "bicycle", "bicycling", "stationary cycling", "outdoor cycling"],
      row: ["row", "rowing", "erg", "erging", "rowing machine"],
      run: ["run", "running", "jogging", "outdoor running", "treadmill running"],
      walk: ["walk", "walking", "treadmill walking"],
      lift: ["lift", "lifting", "weights", "resistance training", "strength training", "weight training"],
      strength: ["strength", "resistance training", "weight training", "free weights", "bodyweight strength", "barbell weight training"],
      yoga: ["yoga", "hatha", "vinyasa", "power yoga"],
      bodyweight: ["bodyweight", "bodyweight strength", "calisthenics"],
      dumbbell: ["dumbbell", "free weights", "dumbbell weight training"],
      barbell: ["barbell", "barbell weight training", "weight training"]
    };
  
    return synonyms[q] || [q];
  }

  function buildSearchIndex(item) {
    const activity = normalizeSearchText(item.activity);
    const category = normalizeSearchText(item.category);
    const code = normalizeSearchText(item.code || "");
    const tags = Array.isArray(item.tags) ? item.tags.map(normalizeSearchText) : [];

    return {
      activity,
      category,
      code,
      tags,
      allText: [activity, category, code, ...tags].join(" ").trim(),
      activityWords: getSearchTokens(item.activity),
      categoryWords: getSearchTokens(item.category),
      tagWords: tags.flatMap(tag => getSearchTokens(tag))
    };
  }

  function scoreSingleQuery(item, query) {
    const q = normalizeSearchText(query);
    if (!q) return 0;

    const idx = buildSearchIndex(item);
    const qTokens = getSearchTokens(q);
    let score = 0;

    if (idx.activity === q) score += 1000;
    if (idx.activity.startsWith(q)) score += 300;
    if (idx.activityWords.some(word => word.startsWith(q))) score += 220;

    const activityTokenHits = qTokens.filter(token =>
      idx.activityWords.some(word => word.startsWith(token))
    ).length;
    score += activityTokenHits * 80;

    const tagHits = qTokens.filter(token =>
      idx.tagWords.some(word => word.startsWith(token))
    ).length;
    score += tagHits * 45;

    const categoryHits = qTokens.filter(token =>
      idx.categoryWords.some(word => word.startsWith(token))
    ).length;
    score += categoryHits * 25;

    if (idx.allText.includes(q)) score += 15;

    return score;
  }

  function scoreActivityMatch(item, rawQuery) {
    const expanded = expandQuery(rawQuery);
    let bestScore = 0;

    for (const q of expanded) {
      bestScore = Math.max(bestScore, scoreSingleQuery(item, q));
    }

    return bestScore;
  }
  
  
  function hasActiveLibraryFilters(filters) {
  return Boolean(
    (filters.query || "").trim() ||
    filters.minMet !== "" ||
    filters.maxMet !== "" ||
    (filters.category && filters.category !== "all") ||
    (filters.system && filters.system !== "all") ||
    (filters.intensity && filters.intensity !== "all")
  );
}

function getDefaultLibraryShowcase() {
  const showcaseQueries = [
    "yoga",
    "walking",
    "outdoor running",
    "treadmill running",
    "outdoor cycling",
    "stationary cycling",
    "resistance training",
    "bodyweight strength",
    "dumbbell weight training"
  ];

  const seen = new Set();
  const results = [];

  for (const query of showcaseQueries) {
    const matches = state.db
      .map(item => ({ item, score: scoreActivityMatch(item, query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.activity.localeCompare(b.item.activity);
      })
      .map(entry => entry.item);

    for (const item of matches) {
      const key = item.code || item.activity;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      break;
    }
  }

  return results;
}

function filterActivities(filters) {
  const query = (filters.query || "").trim();
  const minMet = filters.minMet === "" ? null : Number(filters.minMet);
  const maxMet = filters.maxMet === "" ? null : Number(filters.maxMet);

  if (!hasActiveLibraryFilters(filters)) {
    return getDefaultLibraryShowcase();
  }

  let list = state.db.slice();

  if (query) {
    list = list
      .map(item => ({ item, score: scoreActivityMatch(item, query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.activity.localeCompare(b.item.activity);
      })
      .map(entry => entry.item);
  }

  if (!Number.isNaN(minMet) && minMet !== null) {
    list = list.filter(item => Number(item.met) >= minMet);
  }

  if (!Number.isNaN(maxMet) && maxMet !== null) {
    list = list.filter(item => Number(item.met) <= maxMet);
  }

  if (filters.category && filters.category !== "all") {
    list = list.filter(item => item.category === filters.category);
  }

  if (filters.system && filters.system !== "all") {
    list = list.filter(item => (item.metSystem || "MET") === filters.system);
  }

  if (filters.intensity && filters.intensity !== "all") {
    list = list.filter(item => intensityBand(item.met) === filters.intensity);
  }

  if (!query) {
    list = list.sort((a, b) => a.activity.localeCompare(b.activity));
  }

  return list;
}

  function filterDoseLookup(query) {
    const q = (query || "").trim();
    if (!q) return [];

    return state.db
      .map(item => ({ item, score: scoreActivityMatch(item, q) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.activity.localeCompare(b.item.activity);
      })
      .slice(0, 8)
      .map(entry => entry.item);
  }

  function totalPlanDose() {
    return state.plan.reduce((acc, item) => {
      acc.metMinWeek += Number(item.metMinWeek || 0);
      acc.kcalWeek += Number(item.kcalWeek || 0);
      return acc;
    }, { metMinWeek: 0, kcalWeek: 0 });
  }

  function getPlanQuality(metrics) {
    return {
      hasActivity: Boolean(state.selectedActivityCode || state.dose.manualMET),
      hasDose: Boolean(metrics.met && metrics.duration && metrics.frequency),
      hasPlanBlock: state.plan.length > 0,
      hasNote: Boolean((state.planNote || "").trim())
    };
  }

  function buildExamplePlanNote() {
    const activities = state.plan.length
      ? state.plan.map(item => item.activityName).join(", ")
      : getSelectedActivity()?.activity || "the selected exercise block";
    const entries = Object.entries(state.specifiers).sort((a, b) => b[1] - a[1]);
    const primary = entries.slice(0, 4).map(([name]) => name).join(", ");
    const secondary = entries.slice(4).map(([name]) => name).join(", ");
    const totals = totalPlanDose();
    return `Client has a diagnosis of ADHD (F90.9) and is assigned exercise as a behavioral health intervention to support regulation, attention, and activities of daily living. The current plan includes ${activities}. The seven specifiers receiving the greatest emphasis in this plan are ${primary}, while ${secondary} remain visible but are treated as lower priority or more flexible based on current tolerance, adherence, and the resources available to monitor them. The planned weekly workload across selected exercise blocks is ${round(totals.metMinWeek, 1)} MET-minutes with an estimated ${round(totals.kcalWeek, 1)} kcal per week. METs are used to quantify external load, while the exercise-details field is used to document the exact modality, structure, load marker, rest intervals, breathing strategy, and intended neurological or physiological target when those details meaningfully affect the intervention. Behavioral Health Integration should state the therapeutic intent of the exercise block, such as improving self-efficacy, supporting social activation, providing interoceptive exposure, downregulating post-session arousal, or reducing symptom burden. When heart-rate monitoring, laboratory metrics, or formal breathing coaching are unavailable, feasible proxies and omitted specifiers should be reported transparently rather than leaving the exercise description vague. Continue to monitor symptom response, recovery, functional carryover, and treatment timing, then adjust the plan by revisiting the prioritized specifiers instead of changing every variable at once.`;
  }

  function buildPlanText() {
    const totals = totalPlanDose();
    const specifierLines = SPECIFIERS.map(name => `${name}: ${state.specifiers[name]}`).join("\n");
    const items = state.plan.length
      ? state.plan.map((item, idx) => `${idx + 1}. ${item.activityName} — ${round(item.met, 1)} ${item.metSystem || "MET"} — ${round(item.duration, 0)} min/session × ${round(item.frequency, 0)}/week — ${round(item.metMinWeek, 1)} ${item.metSystem || "MET"}-min/week — ${round(item.kcalWeek, 1)} kcal/week${item.blockDetails ? ` — Exercise details: ${item.blockDetails.replace(/\n/g, " ")}` : ""}`).join("\n")
      : "No exercise blocks added.";
    return [
      "7 Specifier Engine — Plan Summary",
      "",
      `Exercise blocks: ${state.plan.length}`,
      `Total weekly dose: ${round(totals.metMinWeek, 1)} MET-min`,
      `Estimated weekly kcal: ${round(totals.kcalWeek, 1)}`,
      "",
      "Selected exercise blocks",
      items,
      "",
      "7-Specifier emphasis profile",
      specifierLines,
      "",
      "Plan note",
      state.planNote || "No plan note entered."
    ].join("\n");
  }

  function runCalculation(id, cardEl) {
    if (!cardEl) return;
    const values = {};
    cardEl.querySelectorAll("[data-calc-input]").forEach(input => {
      values[input.dataset.name] = input.value;
    });
    const calculators = {
      metvo2: () => {
        const met = Number(values.met || 0);
        const vo2 = Number(values.vo2 || 0);
        if (met) return resultPayload(id, values, "MET ↔ VO₂ result", `VO₂ estimate: <strong>${round(met * 3.5, 2)} ml/kg/min</strong>. This is the simplest way to turn a MET estimate into relative oxygen cost.`);
        if (vo2) return resultPayload(id, values, "MET ↔ VO₂ result", `MET estimate: <strong>${round(vo2 / 3.5, 2)} METs</strong>. This can help translate lab output into a familiar planning unit.`);
        return null;
      },
      metkcal: () => {
        const direction = values.direction || "met-to-kcal";
        const met = Number(values.met || 0);
        const kcal = Number(values.kcal || 0);
        const duration = Number(values.duration || 0);
        const frequency = Number(values.frequency || 1);
        const weight = Number(values.weight || 0);
        const weightKg = values.unit === "lb" ? weight * 0.45359237 : weight;

        if (!duration || !weightKg) return null;

        if (direction === "met-to-kcal") {
          if (!met) return null;
          const kcalPerMin = (met * 3.5 * weightKg) / 200;
          const kcalSession = kcalPerMin * duration;
          const kcalWeek = kcalSession * frequency;
          return resultPayload(
            id,
            values,
            "MET → calories result",
            `Estimated energy cost: <strong>${round(kcalSession, 1)} kcal/session</strong>.<br/>Estimated weekly total: <strong>${round(kcalWeek, 1)} kcal/week</strong>.<br/>This assumes the MET value reflects the average intensity sustained during the session.`
          );
        }

        if (!kcal) return null;
        const impliedMET = (kcal * 200) / (3.5 * weightKg * duration);
        const metMinSession = impliedMET * duration;
        const metMinWeek = metMinSession * frequency;
        return resultPayload(
          id,
          values,
          "Calories → implied MET result",
          `Implied average intensity: <strong>${round(impliedMET, 2)} METs</strong>.<br/>Estimated session dose: <strong>${round(metMinSession, 1)} MET-min/session</strong>.<br/>Estimated weekly dose: <strong>${round(metMinWeek, 1)} MET-min/week</strong>.<br/>This works best when the calorie value reflects exercise-session calories rather than total daily calories or mixed resting + active estimates.`
        );
      },
      bmr: () => {
        const sex = values.sex || "";
        const age = Number(values.age || 0);
        const weight = Number(values.weight || 0);
        const height = Number(values.height || 0);
        const weightKg = values.weightUnit === "lb" ? weight * 0.45359237 : weight;
        const heightCm = values.heightUnit === "in" ? height * 2.54 : height;
        const activityKey = values.activity || "none";
        const activityMultipliers = {
          none: null,
          sedentary: 1.2,
          light: 1.375,
          moderate: 1.55,
          very: 1.725,
          extra: 1.9
        };
        if (!sex || !age || !weightKg || !heightCm) return null;
        const bmr = sex === "male"
          ? 88.362 + (13.397 * weightKg) + (4.799 * heightCm) - (5.677 * age)
          : 447.593 + (9.247 * weightKg) + (3.098 * heightCm) - (4.33 * age);
        const mult = activityMultipliers[activityKey];
        if (!mult) {
          return resultPayload(id, values, "BMR result", `Estimated BMR: <strong>${round(bmr, 0)} kcal/day</strong>.<br/>No activity multiplier was selected, so the result is shown as basal daily energy requirement only.`);
        }
        const daily = bmr * mult;
        return resultPayload(id, values, "BMR + daily energy result", `Estimated BMR: <strong>${round(bmr, 0)} kcal/day</strong>.<br/>Estimated daily calories at the selected activity level: <strong>${round(daily, 0)} kcal/day</strong>.<br/>Activity multiplier used: <strong>${mult}</strong>.`);
      },
      hrzone: () => {
        const age = Number(values.age || 0);
        const rest = Number(values.resting || 0);
        const lowRaw = Number(values.low || 0.6);
        const highRaw = Number(values.high || 0.8);
        const low = Math.min(lowRaw, highRaw);
        const high = Math.max(lowRaw, highRaw);
        const method = values.method || "tanaka";
        const hrMax = method === "tanaka" ? 208 - (0.7 * age) : 220 - age;
        const reserve = hrMax - rest;
        const lowTarget = rest + reserve * low;
        const highTarget = rest + reserve * high;
        return resultPayload(id, values, "Target zone result", `Predicted HRmax: <strong>${round(hrMax, 1)} bpm</strong>.<br/>Target zone: <strong>${round(lowTarget, 0)}–${round(highTarget, 0)} bpm</strong> (${round(low * 100, 0)}–${round(high * 100, 0)}% HRR).<br/>Use this when you want heart-rate based dosage rather than relying on activity labels alone.`);
      },
      pace: () => {
        const mph = Number(values.mph || 0);
        if (!mph) return null;
        const minPerMile = 60 / mph;
        const minPerKm = 37.2822715 / mph;
        return resultPayload(id, values, "Speed / pace result", `At <strong>${round(mph, 2)} mph</strong>, pace is <strong>${formatMinutes(minPerMile)} per mile</strong> and <strong>${formatMinutes(minPerKm)} per km</strong>. This helps convert field speed into coaching-friendly pace language.`);
      },
      weeklydose: () => {
        const met = Number(values.met || 0);
        const duration = Number(values.duration || 0);
        const frequency = Number(values.frequency || 0);
        const weight = Number(values.weight || 0);
        const weightKg = values.unit === "lb" ? weight * 0.45359237 : weight;
        const metMinWeek = met * duration * frequency;
        const kcalWeek = (duration / 60) * frequency * weightKg * met;
        return resultPayload(id, values, "Weekly dose result", `Weekly dose: <strong>${round(metMinWeek, 1)} MET-min/week</strong>.<br/>Estimated energy: <strong>${round(kcalWeek, 1)} kcal/week</strong>. This is useful when you want a quick weekly snapshot from a simple block prescription.`);
      },
      vo2reserve: () => {
        const vo2max = Number(values.vo2max || 0);
        const rest = Number(values.rest || 3.5);
        const intensity = Number(values.intensity || 0) / 100;
        const target = rest + (vo2max - rest) * intensity;
        return resultPayload(id, values, "VO₂ reserve result", `Target VO₂: <strong>${round(target, 2)} ml/kg/min</strong>. Use VO₂ reserve when you want an intensity target that better accounts for individual capacity than a fixed MET level.`);
      },
      rppmap: () => {
        const hr = Number(values.hr || 0);
        const sbp = Number(values.sbp || 0);
        const dbp = Number(values.dbp || 0);
        const rpp = hr * sbp;
        const map = dbp + ((sbp - dbp) / 3);
        return resultPayload(id, values, "Hemodynamic result", `Rate-pressure product: <strong>${numberWithCommas(round(rpp, 0))}</strong>.<br/>MAP: <strong>${round(map, 1)} mmHg</strong>. Use these values for a quick look at circulatory load and blood-pressure context.`);
      },
      acsmwalkrun: () => {
        const speed = Number(values.speed || 0);
        const grade = Number(values.grade || 0) / 100;
        const mode = values.mode || "walk";
        const vo2 = mode === "walk"
          ? (0.1 * speed) + (1.8 * speed * grade) + 3.5
          : (0.2 * speed) + (0.9 * speed * grade) + 3.5;
        return resultPayload(id, values, "ACSM walking / running result", `Estimated VO₂: <strong>${round(vo2, 2)} ml/kg/min</strong> (${round(vo2 / 3.5, 2)} METs). Use this to estimate treadmill oxygen cost when speed and grade are known.`);
      },
      acsmbike: () => {
        const workRate = Number(values.workrate || 0);
        const weight = Number(values.weight || 0);
        const vo2 = ((1.8 * workRate) / weight) + 7;
        return resultPayload(id, values, "ACSM cycle result", `Estimated VO₂: <strong>${round(vo2, 2)} ml/kg/min</strong> (${round(vo2 / 3.5, 2)} METs). This is most useful for ergometer sessions where work rate is already known.`);
      },
      acsmstep: () => {
        const stepRate = Number(values.rate || 0);
        const heightM = Number(values.height || 0);
        const vo2 = (0.2 * stepRate) + (1.33 * 1.8 * stepRate * heightM) + 3.5;
        return resultPayload(id, values, "ACSM stepping result", `Estimated VO₂: <strong>${round(vo2, 2)} ml/kg/min</strong> (${round(vo2 / 3.5, 2)} METs). This can help translate step work into a dose that looks more like the rest of your exercise data.`);
      },
      rer: () => {
        const vco2 = Number(values.vco2 || 0);
        const vo2 = Number(values.vo2 || 0);
        const rer = vo2 ? vco2 / vo2 : 0;
        const interpretation = rer < 0.85 ? "more fat-leaning" : rer < 1.0 ? "mixed fuel use" : rer < 1.1 ? "carbohydrate-dominant / hard effort" : "near-maximal effort range";
        return resultPayload(id, values, "RER result", `RER: <strong>${round(rer, 3)}</strong>. Interpretation: <strong>${interpretation}</strong>. This is helpful for understanding effort level and metabolic pattern during lab-style testing.`);
      },
      o2pulse: () => {
        const vo2L = Number(values.vo2 || 0);
        const hr = Number(values.hr || 0);
        const pulse = hr ? (vo2L * 1000) / hr : 0;
        return resultPayload(id, values, "Oxygen pulse result", `Oxygen pulse: <strong>${round(pulse, 2)} mL/beat</strong>. This is usually most helpful when compared across stages or sessions rather than used as a stand-alone number.`);
      },
      fick: () => {
        const vo2L = Number(values.vo2 || 0);
        const avDiff = Number(values.avdiff || 0);
        const output = avDiff ? vo2L / avDiff : 0;
        return resultPayload(id, values, "Fick result", `Estimated cardiac output: <strong>${round(output, 2)} L/min</strong>. Use this when VO₂ and arteriovenous oxygen difference are already part of the physiology workflow.`);
      }
    };
    const result = calculators[id]?.();
    if (!result) {
      showToast("Enter enough information to calculate this result.", "warn");
      return;
    }
    state.calculations[id] = result;
    renderApp();
  }

  function getDatasetSummary() {
    return {
      categories: new Set(state.db.map(item => item.category)).size,
      systems: new Set(state.db.map(item => item.metSystem || "MET")).size
    };
  }

  function getCategoryList() {
    return Array.from(new Set(state.db.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function intensityBand(met) {
    const value = Number(met || 0);
    if (value < 3) return "light";
    if (value < 6) return "moderate";
    return "vigorous";
  }

  function baselineFromSystem(system) {
    if (system === "MET60+") return { baselineVo2: 2.7, baselineKcalPerKgHr: 0.81 };
    if (system === "METWC") return { baselineVo2: 1.0, baselineKcalPerKgHr: 0.992 };
    return { baselineVo2: 3.5, baselineKcalPerKgHr: 1.0 };
  }

  function metricTile(label, value) {
    return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function showToast(message, kind = "success") {
    state.toast = { message, kind };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.toast = null;
      renderApp();
    }, 2600);
  }

  function renderToast() {
    if (!state.toast) return "";
    return `<div class="toast ${escapeAttr(state.toast.kind || "success")}">${escapeHtml(state.toast.message)}</div>`;
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function resultPayload(id, inputs, title, html) {
    return { id, inputs, title, html };
  }

  function makeId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function round(value, places = 1) {
    const factor = 10 ** places;
    return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
  }

  function capitalize(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatCalcFieldDisplay(field, value) {
    if (field.display === "percent") return `${round(Number(value || 0) * 100, 0)}%`;
    if (field.display === "multiplier") return `${round(Number(value || 0), 3)}×`;
    return String(value ?? "");
  }

  function shortLabel(label, max) {
    return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
  }
  //what stops the radar words from getting chopped off
  function wrapRadarLabel(label, maxLineLength = 20) {
    const words = label.split(" ");
    const lines = [];
    let current = "";

    words.forEach(word => {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxLineLength) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines.slice(0, 3);
  }
  function numberWithCommas(value) {
    return Number(value || 0).toLocaleString();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setByPath(target, path, value) {
    const parts = path.split(".");
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]];
    cursor[parts.at(-1)] = value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function countBy(list, selector) {
    return list.reduce((acc, item) => {
      const key = selector(item);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  function formatMinutes(decimalMinutes) {
    const minutes = Math.floor(decimalMinutes);
    const seconds = Math.round((decimalMinutes - minutes) * 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  const commonFields = {
    metvo2: [
      { name: "met", label: "MET value", default: "4.5", step: "0.1" },
      { name: "vo2", label: "VO₂ (ml/kg/min) — optional reverse conversion", default: "", step: "0.1" }
    ],
    metkcal: [
      {
        name: "direction",
        label: "Conversion direction",
        type: "select",
        default: "met-to-kcal",
        options: [
          { value: "met-to-kcal", label: "MET → calories" },
          { value: "kcal-to-met", label: "Calories → implied MET" }
        ]
      },
      { name: "met", label: "MET value", default: "6.0", step: "0.1" },
      { name: "kcal", label: "Calories burned", default: "", step: "0.1", placeholder: "Use for reverse conversion" },
      { name: "duration", label: "Duration (minutes)", default: "30", step: "1" },
      { name: "frequency", label: "Sessions per week", default: "1", step: "1" },
      { name: "weight", label: "Body weight", default: "70", step: "0.1" },
      {
        name: "unit",
        label: "Weight unit",
        type: "select",
        default: "kg",
        options: [
          { value: "kg", label: "kg" },
          { value: "lb", label: "lb" }
        ]
      }
    ],
    bmr: [
      {
        name: "sex",
        label: "Sex",
        type: "select",
        default: "male",
        options: [
          { value: "male", label: "Male" },
          { value: "female", label: "Female" }
        ]
      },
      { name: "age", label: "Age", default: "30", step: "1", min: "0" },
      { name: "weight", label: "Weight", default: "70", step: "0.1", min: "0" },
      {
        name: "weightUnit",
        label: "Weight unit",
        type: "select",
        default: "kg",
        options: [
          { value: "kg", label: "kg" },
          { value: "lb", label: "lb" }
        ]
      },
      { name: "height", label: "Height", default: "175", step: "0.1", min: "0" },
      {
        name: "heightUnit",
        label: "Height unit",
        type: "select",
        default: "cm",
        options: [
          { value: "cm", label: "cm" },
          { value: "in", label: "in" }
        ]
      },
      {
        name: "activity",
        label: "Activity level",
        type: "select",
        default: "none",
        options: [
          { value: "none", label: "No multiplier" },
          { value: "sedentary", label: "Sedentary (1.2)" },
          { value: "light", label: "Lightly active (1.375)" },
          { value: "moderate", label: "Moderately active (1.55)" },
          { value: "very", label: "Very active (1.725)" },
          { value: "extra", label: "Extra active (1.9)" }
        ]
      }
    ],
    hrzone: [
      { name: "age", label: "Age", default: "30", step: "1", min: "0" },
      { name: "resting", label: "Resting HR", default: "60", step: "1", min: "0" },
      { name: "low", label: "Low intensity fraction", type: "range", default: "0.6", min: "0.3", max: "0.9", step: "0.05", display: "percent" },
      { name: "high", label: "High intensity fraction", type: "range", default: "0.8", min: "0.4", max: "0.95", step: "0.05", display: "percent" },
      { name: "method", label: "HRmax method", type: "select", default: "tanaka", options: [
        { value: "tanaka", label: "Tanaka (208 − 0.7 × age)" },
        { value: "fox", label: "220 − age" }
      ] }
    ],
    pace: [
      { name: "mph", label: "Speed (mph)", default: "4.0", step: "0.1" }
    ],
    weeklydose: [
      { name: "met", label: "MET value", default: "4.5", step: "0.1" },
      { name: "duration", label: "Minutes per session", default: "30", step: "1" },
      { name: "frequency", label: "Sessions per week", default: "5", step: "1" },
      { name: "weight", label: "Body weight", default: "70", step: "0.1" },
      { name: "unit", label: "Weight unit", type: "select", default: "kg", options: [
        { value: "kg", label: "kg" },
        { value: "lb", label: "lb" }
      ] }
    ],
    vo2reserve: [
      { name: "vo2max", label: "VO₂max (ml/kg/min)", default: "40", step: "0.1" },
      { name: "rest", label: "Resting VO₂", default: "3.5", step: "0.1" },
      { name: "intensity", label: "Target intensity (%)", default: "60", step: "1" }
    ],
    rppmap: [
      { name: "hr", label: "Heart rate (bpm)", default: "120", step: "1" },
      { name: "sbp", label: "Systolic BP", default: "140", step: "1" },
      { name: "dbp", label: "Diastolic BP", default: "85", step: "1" }
    ],
    acsmwalkrun: [
      { name: "speed", label: "Speed (m/min)", default: "80", step: "0.1" },
      { name: "grade", label: "Grade (%)", default: "5", step: "0.1" },
      { name: "mode", label: "Mode", type: "select", default: "walk", options: [
        { value: "walk", label: "Walking" },
        { value: "run", label: "Running" }
      ] }
    ],
    acsmbike: [
      { name: "workrate", label: "Work rate (kgm/min)", default: "600", step: "1" },
      { name: "weight", label: "Body mass (kg)", default: "70", step: "0.1" }
    ],
    acsmstep: [
      { name: "rate", label: "Step rate (steps/min)", default: "24", step: "0.1" },
      { name: "height", label: "Step height (m)", default: "0.30", step: "0.01" }
    ],
    rer: [
      { name: "vco2", label: "VCO₂ (L/min)", default: "2.5", step: "0.01" },
      { name: "vo2", label: "VO₂ (L/min)", default: "2.8", step: "0.01" }
    ],
    o2pulse: [
      { name: "vo2", label: "VO₂ (L/min)", default: "2.8", step: "0.01" },
      { name: "hr", label: "Heart rate (bpm)", default: "150", step: "1" }
    ],
    fick: [
      { name: "vo2", label: "VO₂ (L/min)", default: "3.0", step: "0.01" },
      { name: "avdiff", label: "a-vO₂ diff (L O₂ per L blood)", default: "0.15", step: "0.01" }
    ]
  };

  const calcPlainLanguage = {
    metvo2: "This converts the familiar MET scale into relative oxygen cost (VO₂), helping translate external workload into a physiological measure of oxygen consumption during exercise. In clinical and research settings, this helps connect exercise-prescription language with internal-load concepts, since internal load reflects the psycho-physiological response to external work.",
    metkcal: "This tool turns a MET workload into estimated session calories, or works in reverse by estimating the average MET intensity from app-reported calories, session duration, and body weight.",
    bmr: "This estimates basal metabolic rate using the revised Harris-Benedict equations, then optionally applies an activity multiplier to project total daily calories. It is useful when you want a quick energy baseline that can sit alongside exercise-dose planning.",
    hrzone: "This gives you a heart-rate range tailored to the person’s age and resting heart rate, so intensity is prescribed by internal load rather than only by speed or exercise type.",
    pace: "This translates speed into coaching-friendly pace language so the same workload can be described in mph, minutes per mile, or minutes per kilometer.",
    weeklydose: "This summarizes a single block into weekly MET-minutes and estimated calories so you can see whether the overall prescription is large enough to matter.",
    vo2reserve: "VO₂ reserve estimates intensity relative to the person’s own capacity, which is often more clinically useful than assigning the same absolute workload to everyone.",
    rppmap: "These hemodynamic estimates help place an exercise response into a blood-pressure and myocardial-workload context rather than relying only on symptoms or effort labels.",
    acsmwalkrun: "This equation turns treadmill speed and grade into an estimated oxygen cost, which helps translate treadmill settings into a standardized exercise dose.",
    acsmbike: "This cycle ergometry equation turns work rate into estimated oxygen cost so bike sessions can be described in VO₂ and MET language.",
    acsmstep: "This estimates the oxygen cost of stepping work so a step protocol can be compared with treadmill, cycling, or Compendium-derived activity values.",
    rer: "RER helps describe fuel use and effort level, especially in testing contexts where you want to know whether the person is working at mixed, carbohydrate-dominant, or near-maximal intensity.",
    o2pulse: "Oxygen pulse gives a rough stroke-volume-related marker that is usually most useful when you compare stages or repeat tests within the same person.",
    fick: "The Fick equation estimates cardiac output from oxygen uptake and arteriovenous oxygen difference, which makes it a more advanced physiology tool for deeper lab interpretation."
  };

  const calcClinicalExamples = {
    metvo2: "A clinician may convert a 6-MET walking prescription into VO₂ language when coordinating with an exercise physiology lab or when comparing the plan to cardiopulmonary test data.",
    metkcal: "A patient reports that a watch estimated 420 exercise calories during a 40-minute workout at 80 kg. The implied average intensity is about 7.5 METs, which suggests a sustained moderate-to-vigorous session.",
    bmr: "A clinician estimating baseline daily energy needs for a sedentary adult can use BMR first, then apply an activity multiplier to approximate maintenance calories before discussing exercise, weight change, or nutrition goals.",
    hrzone: "A patient who does not tolerate pace-based instructions may be prescribed walking or cycling in a 60–75% HRR range so intensity is easier to monitor.",
    pace: "A coach or clinician may turn 4.0 mph into minutes per mile so the client can follow the same workload outdoors without treadmill speed cues.",
    weeklydose: "If a block is only producing a modest weekly MET-minute total, you may decide to increase frequency or duration before changing every other variable.",
    vo2reserve: "Two clients with very different fitness levels may need very different absolute workloads to reach the same intended intensity; VO₂ reserve helps show that difference.",
    rppmap: "If blood pressure rises sharply during moderate work, these values can help communicate circulatory load more clearly in follow-up documentation.",
    acsmwalkrun: "A patient walking at 80 m/min on 5% grade reaches a workload near 8 METs, which may be enough to classify the session as vigorous for some exercise goals.",
    acsmbike: "In a rehab or lab setting, a known cycle work rate can be translated into estimated VO₂ so the session is easier to compare with other exercise modes.",
    acsmstep: "A class-based or home step session can be translated into estimated METs so the workload is easier to compare with walking, cycling, or rowing.",
    rer: "An RER rising above 1.0 during a graded test suggests the effort is becoming very hard and increasingly carbohydrate-dominant.",
    o2pulse: "If oxygen pulse climbs across stages in a repeatable way, it can help show that cardiovascular response is scaling appropriately with workload.",
    fick: "In a physiology-focused setting, estimated cardiac output can help connect oxygen uptake data to broader cardiovascular interpretation."
  };

  const calcFormulaVisuals = {
    metvo2: `<div class="calc-formula-stack"><div class="formula-chip">VO₂ = MET × 3.5</div><div class="formula-arrow">↕</div><div class="formula-chip">MET = VO₂ ÷ 3.5</div></div>`,
    metkcal: `<div class="calc-formula-stack"><div class="formula-chip">kcal/min = (MET × 3.5 × kg) ÷ 200</div><div class="formula-arrow">→</div><div class="formula-chip">kcal/session = kcal/min × minutes</div><div class="formula-arrow">↕</div><div class="formula-chip">MET = (kcal × 200) ÷ (3.5 × kg × minutes)</div></div>`,
    bmr: `<div class="calc-formula-stack"><div class="formula-chip">Men: 88.362 + 13.397×kg + 4.799×cm − 5.677×age</div><div class="formula-chip">Women: 447.593 + 9.247×kg + 3.098×cm − 4.330×age</div><div class="formula-arrow">→</div><div class="formula-chip">Daily calories = BMR × activity multiplier</div></div>`,
    hrzone: `<div class="calc-formula-stack"><div class="formula-chip">HRmax ≈ 208 − 0.7 × age</div><div class="formula-arrow">→</div><div class="formula-chip">HRR = HRmax − resting HR</div><div class="formula-arrow">→</div><div class="formula-chip">Target HR = resting HR + (HRR × intensity)</div></div>`,
    weeklydose: `<div class="calc-formula-stack"><div class="formula-chip">MET-min/session = MET × minutes</div><div class="formula-arrow">→</div><div class="formula-chip">MET-min/week = MET-min/session × sessions/week</div></div>`,
    acsmwalkrun: `<div class="calc-formula-stack"><div class="formula-chip">Walking VO₂ = 0.1 × speed + 1.8 × speed × grade + 3.5</div><div class="formula-chip">Running VO₂ = 0.2 × speed + 0.9 × speed × grade + 3.5</div></div>`,
    acsmbike: `<div class="calc-formula-stack"><div class="formula-chip">VO₂ = ((1.8 × work rate) ÷ body mass) + 7</div></div>`,
    acsmstep: `<div class="calc-formula-stack"><div class="formula-chip">VO₂ = 0.2 × step rate + 1.33 × 1.8 × step rate × step height + 3.5</div></div>`,
    rer: `<div class="calc-formula-stack"><div class="formula-chip">RER = VCO₂ ÷ VO₂</div></div>`,
    o2pulse: `<div class="calc-formula-stack"><div class="formula-chip">O₂ pulse = VO₂ ÷ heart rate</div></div>`,
    fick: `<div class="calc-formula-stack"><div class="formula-chip">Cardiac output = VO₂ ÷ a-vO₂ difference</div></div>`
  };

  const calcSourcesHtml = {
    metvo2: `<p><em>Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Fraser, M. M., Kim, Y., Tarp, J., Edwards, N., Héroux, M., & Tudor-Locke, C. (2024). 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. Journal of Sport and Health Science, 13</em>(1), 6–12. https://doi.org/10.1016/j.jshs.2023.10.010</p>`,
    metkcal: `<p><em>Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Fraser, M. M., Kim, Y., Tarp, J., Edwards, N., Héroux, M., & Tudor-Locke, C. (2024). 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. Journal of Sport and Health Science, 13</em>(1), 6–12. https://doi.org/10.1016/j.jshs.2023.10.010</p>`,
    bmr: `<p><em>Roza, A. M., & Shizgal, H. M. (1984). The Harris Benedict equation reevaluated: Resting energy requirements and the body cell mass. The American Journal of Clinical Nutrition, 40</em>(1), 168–182. https://doi.org/10.1093/ajcn/40.1.168</p><p class="small muted">Activity multipliers in this calculator follow the same categories shown on the referenced BMR page.</p>`,
    hrzone: `<p><em>Tanaka, H., Monahan, K. D., & Seals, D. R. (2001). Age-predicted maximal heart rate revisited. Journal of the American College of Cardiology, 37</em>(1), 153–156. https://doi.org/10.1016/S0735-1097(00)01054-8</p>`,
    weeklydose: `<p><em>Herrmann, S. D., Ainsworth, B. E., Mâsse, L. C., Kendall, B. J., Willis, E. A., Fraser, M. M., Kim, Y., Tarp, J., Edwards, N., Héroux, M., & Tudor-Locke, C. (2024). 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. Journal of Sport and Health Science, 13</em>(1), 6–12. https://doi.org/10.1016/j.jshs.2023.10.010</p>`,
    acsmwalkrun: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    acsmbike: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    acsmstep: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    vo2reserve: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    rppmap: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    rer: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    o2pulse: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`,
    fick: `<p><em>American College of Sports Medicine. (2025). ACSM's guidelines for exercise testing and prescription</em> (12th ed.). Wolters Kluwer.</p>`
  };

  renderApp();
    
})();








