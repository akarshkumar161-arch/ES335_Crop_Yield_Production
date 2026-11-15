/**
 * ES 335: Crop Yield Prediction
 * Interactive Web Application (app.js)
 * Authors: Akarsh Kumar (25110015) & Arpit Mahajan (25110054)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Global State
  const state = {
    year: "2021",
    viewMode: "error", // 'actual', 'error', 'gain', 'soil_imp'
    model: "anom",     // 'anom' (anomaly model, main result), 'full' (direct HGB), 'base' (county mean)
    selectedState: "ALL",
    countiesData: null,
    stateErrorsData: null,
    metricsData: null,
    simulatorParams: null,
    activeCounty: null
  };

  // 1. Fetch Data
  Promise.all([
    fetch("data/ablation_metrics.json").then(r => r.json()),
    fetch("data/counties_summary.json").then(r => r.json()),
    fetch("data/state_errors.json").then(r => r.json()),
    fetch("data/simulator_params.json").then(r => r.json())
  ]).then(([metrics, counties, stateErrors, simParams]) => {
    state.metricsData = metrics;
    state.countiesData = counties;
    state.stateErrorsData = stateErrors;
    state.simulatorParams = simParams;

    initPopulateStateDropdown();
    initMapExplorer();
    initSimulator();
    populateMetricsTables();
    populateStateErrorTable();
  }).catch(err => {
    console.error("Error loading web data:", err);
    // Graceful fallback for offline / local viewing
    initSimulatorOffline();
  });

  // 2. State Filter Dropdown
  function initPopulateStateDropdown() {
    const sel = document.getElementById("select-state-filter");
    if (!sel || !state.countiesData) return;

    const currentCounties = state.countiesData[state.year] || [];
    const statesMap = new Map();
    currentCounties.forEach(c => {
      if (!statesMap.has(c.state)) {
        statesMap.set(c.state, c.state_name);
      }
    });

    const sortedStates = Array.from(statesMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    sel.innerHTML = `<option value="ALL">All States (${currentCounties.length} Counties)</option>`;
    sortedStates.forEach(([abbr, name]) => {
      sel.innerHTML += `<option value="${abbr}">${name} (${abbr})</option>`;
    });

    sel.addEventListener("change", (e) => {
      state.selectedState = e.target.value;
      renderMap();
      updateStateStatsCard();
    });

    // Year Selector
    const yearSel = document.getElementById("select-year");
    if (yearSel) {
      yearSel.addEventListener("change", (e) => {
        state.year = e.target.value;
        initPopulateStateDropdown();
        renderMap();
        updateStateStatsCard();
      });
    }

    // Model Selector
    const modelSel = document.getElementById("select-model");
    if (modelSel && !modelSel.dataset.bound) {
      modelSel.dataset.bound = "1";
      modelSel.addEventListener("change", (e) => {
        state.model = e.target.value;
        updateMapLegend();
        renderMap();
        if (state.activeCounty) inspectCounty(state.activeCounty);
        updateStateStatsCard();
      });
    }

    // View Mode Selector
    const modeSel = document.getElementById("select-view-mode");
    if (modeSel) {
      modeSel.addEventListener("change", (e) => {
        state.viewMode = e.target.value;
        updateMapLegend();
        renderMap();
      });
    }
  }

  // 3. Interactive SVG Map Explorer
  function initMapExplorer() {
    updateMapLegend();
    renderMap();
    // Default pick a notable county (e.g., Story County, IA - FIPS 19169 or first Iowa county)
    const currentCounties = state.countiesData[state.year] || [];
    const sample = currentCounties.find(c => c.state === "IA") || currentCounties[0];
    if (sample) {
      inspectCounty(sample);
    }
    updateStateStatsCard();
  }

  function projectCoords(lat, lon, width = 900, height = 520) {
    // Albers-like bounding box for contiguous US
    const minLon = -124.5;
    const maxLon = -68.0;
    const minLat = 24.5;
    const maxLat = 49.5;

    const x = ((lon - minLon) / (maxLon - minLon)) * (width - 60) + 30;
    const y = height - (((lat - minLat) / (maxLat - minLat)) * (height - 60) + 30);
    return { x, y };
  }

  const MODEL_LABEL = { anom: "Anomaly model", full: "Direct HGB", base: "County-mean baseline" };
  function predOf(c) { return state.model === "anom" ? c.pred_anom : state.model === "full" ? c.pred_full : c.baseline; }
  function errOf(c)  { return state.model === "anom" ? c.err_anom  : state.model === "full" ? c.err_full  : c.err_base; }
  // > 0: the selected model's absolute error is smaller than the baseline's
  function gainOf(c) { return Math.abs(c.err_base) - Math.abs(errOf(c)); }
  function signed(v) { return `${v > 0 ? "+" : ""}${v}`; }

  function getColorForCounty(c) {
    if (state.viewMode === "actual") {
      // Scale: 60 bu/acre (red) -> 160 (yellow) -> 230 (deep green)
      const y = Math.max(60, Math.min(230, c.actual));
      const t = (y - 60) / 170; // 0 to 1
      if (t < 0.5) {
        // Red to yellow
        const f = t / 0.5;
        const r = 220 + Math.round(f * 20);
        const g = Math.round(f * 200);
        return `rgb(${r}, ${g}, 80)`;
      } else {
        // Yellow to forest green
        const f = (t - 0.5) / 0.5;
        const r = Math.round(240 * (1 - f) + 27 * f);
        const g = Math.round(200 * (1 - f) + 125 * f);
        const b = Math.round(80 * (1 - f) + 40 * f);
        return `rgb(${r}, ${g}, ${b})`;
      }
    } else if (state.viewMode === "error") {
      // Residual absolute error: 0 (green) -> 20 (yellow) -> 50+ (red)
      const absErr = Math.abs(errOf(c));
      const t = Math.min(1.0, absErr / 45.0);
      const r = Math.round(40 + t * 200);
      const g = Math.round(160 * (1 - t * 0.7));
      const b = Math.round(50 * (1 - t));
      return `rgb(${r}, ${g}, ${b})`;
    } else if (state.viewMode === "gain") {
      // Better than baseline (green) / worse (red), saturating at 20 bu/ac
      const g = gainOf(c);
      const t = Math.min(1.0, Math.abs(g) / 20.0);
      if (Math.abs(g) < 0.5) return "#cbd5e1";
      return g > 0
        ? `rgb(${Math.round(200 - t * 170)}, ${Math.round(210 - t * 60)}, ${Math.round(200 - t * 150)})`
        : `rgb(${Math.round(230 - t * 30)}, ${Math.round(190 - t * 160)}, ${Math.round(190 - t * 160)})`;
    } else {
      // Soil Improvement: negative (red/orange) -> zero (gray) -> positive (bright green)
      const imp = c.soil_improvement;
      if (imp > 0) {
        const t = Math.min(1.0, imp / 10.0);
        return `rgb(${Math.round(40 + (1 - t) * 80)}, ${Math.round(130 + t * 70)}, ${Math.round(60 + (1 - t) * 40)})`;
      } else {
        return `#94a3b8`;
      }
    }
  }

  function updateMapLegend() {
    const title = document.getElementById("legend-title");
    const bar = document.getElementById("legend-color-bar");
    const minLabel = document.getElementById("legend-min");
    const maxLabel = document.getElementById("legend-max");
    if (!title || !bar) return;

    if (state.viewMode === "actual") {
      title.innerText = "Corn Yield (bu/acre)";
      bar.className = "legend-bar yield-scale";
      minLabel.innerText = "≤ 70 bu/ac (Low)";
      maxLabel.innerText = "≥ 220 bu/ac (High)";
    } else if (state.viewMode === "error") {
      title.innerText = `${MODEL_LABEL[state.model]}: |Actual − Predicted|`;
      bar.className = "legend-bar error-scale";
      minLabel.innerText = "0 bu/ac (Accurate)";
      maxLabel.innerText = "≥ 45 bu/ac (High Error)";
    } else if (state.viewMode === "gain") {
      title.innerText = `${MODEL_LABEL[state.model]} vs baseline (green = smaller error)`;
      bar.className = "legend-bar gain-scale";
      minLabel.innerText = "≥ 20 bu/ac worse";
      maxLabel.innerText = "≥ 20 bu/ac better";
    } else {
      title.innerText = "Soil Improvement Over Weather-Only";
      bar.className = "legend-bar yield-scale";
      minLabel.innerText = "0 bu/ac (No Change)";
      maxLabel.innerText = "≥ +8 bu/ac Gain";
    }
  }

  function renderMap() {
    const svg = document.getElementById("svg-us-map");
    if (!svg || !state.countiesData) return;

    const allCounties = state.countiesData[state.year] || [];
    const filtered = state.selectedState === "ALL" 
      ? allCounties 
      : allCounties.filter(c => c.state === state.selectedState);

    // Render county points
    let html = `
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="glow"/>
          <feComposite in="SourceGraphic" in2="glow" operator="over"/>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="#f8fafc" rx="8" />
      <g id="counties-group">
    `;

    filtered.forEach((c) => {
      const { x, y } = projectCoords(c.lat, c.lon);
      const color = getColorForCounty(c);
      const isSelected = state.activeCounty && state.activeCounty.fips === c.fips;
      const radius = isSelected ? 6.5 : (state.selectedState === "ALL" ? 3.0 : 5.0);
      const stroke = isSelected ? "#000" : (state.selectedState === "ALL" ? "rgba(0,0,0,0.15)" : "#334155");
      const strokeWidth = isSelected ? 2.5 : 0.6;

      html += `
        <circle 
          cx="${x.toFixed(1)}" 
          cy="${y.toFixed(1)}" 
          r="${radius}" 
          fill="${color}" 
          stroke="${stroke}" 
          stroke-width="${strokeWidth}"
          class="county-circle ${isSelected ? 'selected' : ''}"
          data-fips="${c.fips}"
          style="cursor: pointer; transition: r 0.15s ease;"
        >
          <title>${c.state_name} (${c.state}) | FIPS ${c.fips}
Actual: ${c.actual} bu/ac
${MODEL_LABEL[state.model]}: ${predOf(c)} bu/ac
Error: ${errOf(c)} bu/ac</title>
        </circle>
      `;
    });

    html += `</g>`;
    svg.innerHTML = html;

    // Attach click listeners to circles
    svg.querySelectorAll("circle.county-circle").forEach(circle => {
      circle.addEventListener("click", (e) => {
        const fips = e.target.getAttribute("data-fips");
        const found = allCounties.find(c => c.fips === fips);
        if (found) {
          inspectCounty(found);
          renderMap();
        }
      });
      circle.addEventListener("mouseenter", (e) => {
        e.target.setAttribute("r", parseFloat(e.target.getAttribute("r")) + 2);
      });
      circle.addEventListener("mouseleave", (e) => {
        const isSel = e.target.classList.contains("selected");
        e.target.setAttribute("r", isSel ? 6.5 : (state.selectedState === "ALL" ? 3.0 : 5.0));
      });
    });
  }

  function inspectCounty(c) {
    state.activeCounty = c;
    const title = document.getElementById("insp-name");
    const fips = document.getElementById("insp-fips");
    const actual = document.getElementById("insp-actual");
    const pred = document.getElementById("insp-pred");
    const base = document.getElementById("insp-base");
    const err = document.getElementById("insp-err");
    const errW = document.getElementById("insp-err-w");
    const soilImp = document.getElementById("insp-soil-imp");
    const soc = document.getElementById("insp-soc");
    const nitro = document.getElementById("insp-nitro");
    const ph = document.getElementById("insp-ph");
    const rain = document.getElementById("insp-rain");
    const heat = document.getElementById("insp-heat");

    if (title) title.innerText = `County ${c.fips}, ${c.state_name}`;
    if (fips) fips.innerText = `FIPS: ${c.fips} | Lat: ${c.lat}°, Lon: ${c.lon}°`;
    if (actual) actual.innerText = `${c.actual} bu/ac`;
    const predLabel = document.getElementById("insp-pred-label");
    if (predLabel) predLabel.innerText = `Predicted (${MODEL_LABEL[state.model]})`;
    if (pred) pred.innerText = `${predOf(c)} bu/ac`;
    if (base) base.innerText = `${c.baseline} bu/ac`;
    if (err) {
      const e = errOf(c);
      err.innerText = `${signed(e)} bu/ac`;
      err.style.color = Math.abs(e) <= 15 ? "#166534" : "#b91c1c";
    }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set("insp-err-anom", `${signed(c.err_anom)} bu/ac`);
    set("insp-err-full", `${signed(c.err_full)} bu/ac`);
    set("insp-err-base", `${signed(c.err_base)} bu/ac`);
    set("insp-history", c.history_years === 0
      ? "none: baseline falls back to the state average"
      : `${c.history_years} earlier year${c.history_years > 1 ? "s" : ""}`);
    if (errW) errW.innerText = `${c.err_w > 0 ? '+' : ''}${c.err_w} bu/ac`;
    if (soilImp) {
      soilImp.innerText = `${c.soil_improvement >= 0 ? '+' : ''}${c.soil_improvement} bu/ac`;
      soilImp.style.color = c.soil_improvement >= 0 ? "#166534" : "#b91c1c";
    }
    if (soc) soc.innerText = `${c.soc} g/kg`;
    if (nitro) nitro.innerText = `${c.nitrogen} g/kg`;
    if (ph) ph.innerText = `${c.ph}`;
    if (rain) rain.innerText = `${c.precip} mm`;
    if (heat) heat.innerText = `${c.heat_days} days`;
  }

  function updateStateStatsCard() {
    if (!state.stateErrorsData) return;
    const yInt = parseInt(state.year, 10);
    const yearStats = state.stateErrorsData.filter(s => s.year === yInt);

    const cardState = document.getElementById("stat-sel-state");
    const cardYield = document.getElementById("stat-sel-yield");
    const cardRmse = document.getElementById("stat-sel-rmse");
    const cardGain = document.getElementById("stat-sel-gain");

    if (state.selectedState === "ALL") {
      const allCounties = state.countiesData[state.year] || [];
      const avgY = (allCounties.reduce((a, b) => a + b.actual, 0) / (allCounties.length || 1)).toFixed(1);
      const isTestYear = state.year === "2022";
      if (cardState) cardState.innerText = `All States (${allCounties.length} Counties)`;
      if (cardYield) cardYield.innerText = `${avgY} bu/ac`;
      const m = isTestYear ? state.metricsData.final_test_2022 : state.metricsData.val_2021;
      const sel = state.model === "anom" ? m.anomaly_model : state.model === "full" ? m.full_model : m.county_mean_baseline;
      if (cardRmse) cardRmse.innerText = `${sel.rmse.toFixed(2)} bu/ac (${MODEL_LABEL[state.model]}, ${isTestYear ? "test" : "validation"})`;
      if (cardGain) cardGain.innerText = state.model === "base" ? "reference" : `${signed(sel.gain_pct_vs_baseline)}% vs county-mean baseline`;
    } else {
      const found = yearStats.find(s => s.state === state.selectedState);
      if (found) {
        if (cardState) cardState.innerText = `${found.state_name} (${found.counties_count} Counties)`;
        if (cardYield) cardYield.innerText = `${found.avg_yield} bu/ac`;
        const r = state.model === "anom" ? found.rmse_anom : state.model === "full" ? found.rmse_full : found.rmse_base;
        const g = state.model === "anom" ? found.rmse_gain_pct_anom : state.model === "full" ? found.rmse_gain_pct : 0;
        if (cardRmse) cardRmse.innerText = `${r} bu/ac (${MODEL_LABEL[state.model]})`;
        if (cardGain) cardGain.innerText = state.model === "base" ? "reference" : `${signed(g)}% vs baseline`;
      }
    }
  }

  // 4. Interactive What-If Crop Yield Simulator
  function initSimulator() {
    const P = state.simulatorParams;
    if (!P || !P.features) { showSimulatorUnavailable(); return; }

    Object.entries(P.features).forEach(([key, f]) => {
      const el = document.getElementById(`sim-${key}`);
      const valDisp = document.getElementById(`val-${key}`);
      const label = document.getElementById(`label-${key}`);
      if (label) label.innerText = f.name;
      if (!el) return;
      // Slider range = 1st-99th percentile of the training data, so users stay where the model has data
      el.min = f.min; el.max = f.max; el.step = f.step; el.value = f.default;
      if (valDisp) valDisp.innerText = formatSimValue(key, f.default);
      el.addEventListener("input", () => {
        if (valDisp) valDisp.innerText = formatSimValue(key, el.value);
        calculateSimulator();
      });
    });

    Object.entries(P.presets || {}).forEach(([key, cfg]) => {
      const btn = document.getElementById(`btn-preset-${key}`);
      if (btn) btn.addEventListener("click", () => applySimulatorPreset(cfg));
    });

    const acc = document.getElementById("sim-model-accuracy");
    if (acc) {
      const v = P.validation_2021, t = P.test_2022;
      acc.innerText = `Model: Ridge regression, alpha = ${P.alpha}. ` +
        `2021 validation RMSE ${v.rmse} bu/ac (R² ${v.r2}); 2022 test RMSE ${t.rmse} bu/ac (R² ${t.r2}). ` +
        P.note;
    }
    calculateSimulator();
  }

  function formatSimValue(id, val) {
    const f = state.simulatorParams && state.simulatorParams.features[id];
    const v = parseFloat(val);
    const txt = f && f.step >= 1 ? v.toFixed(0) : v.toFixed(1);
    return f && f.unit !== "pH" ? `${txt} ${f.unit}` : txt;
  }

  function applySimulatorPreset(cfg) {
    Object.keys(cfg).forEach(k => {
      const el = document.getElementById(`sim-${k}`);
      const disp = document.getElementById(`val-${k}`);
      if (el) {
        el.value = cfg[k];
        if (disp) disp.innerText = formatSimValue(k, cfg[k]);
      }
    });
    calculateSimulator();
  }

  // Same formula as the exported Ridge model:
  //   yield = intercept + sum_k (b1_k * x_k + b2_k * x_k^2)
  function featureTerm(f, x) { return f.b1 * x + f.b2 * x * x; }

  function predictSimulator(values) {
    const P = state.simulatorParams;
    let y = P.intercept;
    Object.entries(P.features).forEach(([k, f]) => { y += featureTerm(f, values[k]); });
    return y;
  }

  function calculateSimulator() {
    const P = state.simulatorParams;
    if (!P || !P.features) return;

    const values = {}, defaults = {};
    Object.entries(P.features).forEach(([k, f]) => {
      const el = document.getElementById(`sim-${k}`);
      values[k] = el ? parseFloat(el.value) : f.default;
      defaults[k] = f.default;
    });

    const predicted = predictSimulator(values);
    const reference = predictSimulator(defaults);   // a "typical county": every input at its median

    const predEl = document.getElementById("sim-output-yield");
    const compEl = document.getElementById("sim-output-comparison");
    if (predEl) predEl.innerText = predicted.toFixed(1);
    if (compEl) {
      const diff = predicted - reference;
      const pct = (diff / reference) * 100;
      compEl.innerText = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} bu/ac (${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%) vs typical county (${reference.toFixed(1)})`;
      compEl.className = `yield-comparison ${diff >= 0 ? "badge-success" : "badge-danger"}`;
    }

    // Contribution of each input = its term at the chosen value minus its term at the median.
    // Because the model is additive, these add up exactly to the difference shown above.
    const rows = { precip: "impact-rain", heat: "impact-heat", temp: "impact-temp",
                   soc: "impact-soc", nitrogen: "impact-nitro", ph: "impact-ph" };
    Object.entries(rows).forEach(([k, id]) => {
      const f = P.features[k];
      if (!f) return;
      updateBreakdownRow(id, featureTerm(f, values[k]) - featureTerm(f, f.default), f.name);
    });
  }

  function showSimulatorUnavailable() {
    const predEl = document.getElementById("sim-output-yield");
    const compEl = document.getElementById("sim-output-comparison");
    if (predEl) predEl.innerText = "–";
    if (compEl) compEl.innerText = "Model file could not be loaded. Serve the site over HTTP (see README).";
  }

  function updateBreakdownRow(id, val, label) {
    const el = document.getElementById(id);
    if (!el) return;
    const formatted = `${val >= 0 ? '+' : ''}${val.toFixed(1)} bu/ac`;
    el.innerHTML = `
      <span>${label}</span>
      <span class="${val >= 0 ? 'breakdown-impact-pos' : 'breakdown-impact-neg'}">${formatted}</span>
    `;
  }

  // 5. Metrics & Ablation Tables
  function populateMetricsTables() {
    if (!state.metricsData) return;
    const directBody = document.getElementById("table-direct-ablation-body");
    const anomalyBody = document.getElementById("table-anomaly-body");
    const spatialBody = document.getElementById("table-spatial-body");

    // Direct Ablation
    if (directBody && state.metricsData.direct_ablation_val2021) {
      directBody.innerHTML = state.metricsData.direct_ablation_val2021.map(row => {
        const isBest = row.features === "weather+geo+soil" && row.model === "hgb";
        return `
          <tr class="${isBest ? 'highlight-row' : ''}">
            <td><strong>${formatFeatureSetName(row.features)}</strong></td>
            <td><code>${row.model.toUpperCase()}</code></td>
            <td><strong>${row.rmse.toFixed(2)}</strong></td>
            <td>${row.mae.toFixed(2)}</td>
            <td>${row.r2.toFixed(2)}</td>
            <td><span class="badge ${row.gain_pct >= 0 ? 'badge-success' : 'badge-danger'}">${row.gain_pct}%</span></td>
          </tr>
        `;
      }).join("");
    }

    // Anomaly Setting A
    if (anomalyBody && state.metricsData.settingA_anomaly_val2021) {
      anomalyBody.innerHTML = state.metricsData.settingA_anomaly_val2021.map(row => {
        const isBest = row.model === "hgb" && row.features === "weather+geo+soil";
        return `
          <tr class="${isBest ? 'highlight-row' : ''}">
            <td><strong>${formatFeatureSetName(row.features)}</strong></td>
            <td><code>${row.model.toUpperCase()}</code></td>
            <td><strong>${row.rmse.toFixed(2)}</strong></td>
            <td>${row.mae.toFixed(2)}</td>
            <td>${row.r2.toFixed(2)}</td>
            <td><span class="badge badge-success">+${row.gain_pct}%</span></td>
          </tr>
        `;
      }).join("");
    }

    // Spatial Setting B
    if (spatialBody && state.metricsData.settingB_leave_states_out) {
      spatialBody.innerHTML = state.metricsData.settingB_leave_states_out.map(row => {
        const isBest = row.features === "weather+geo" && row.model === "hgb";
        return `
          <tr class="${isBest ? 'highlight-row' : ''}">
            <td><strong>${formatFeatureSetName(row.features)}</strong></td>
            <td><code>${row.model.toUpperCase()}</code></td>
            <td><strong>${row.rmse.toFixed(2)}</strong></td>
            <td>${row.mae.toFixed(2)}</td>
            <td>${row.r2.toFixed(2)}</td>
            <td><span class="badge badge-success">+${row.gain_pct}%</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  function formatFeatureSetName(f) {
    if (f === "weather") return "Weather Only (50 features)";
    if (f === "weather+geo") return "Weather + Geography (52 features)";
    if (f === "weather+geo+soil") return "Weather + Geo + SoilGrids (58 features)";
    if (f === "geo+soil (no weather)") return "Geo + Soil Only (No Weather)";
    return f;
  }

  // 6. Regional Error Table
  function populateStateErrorTable() {
    if (!state.stateErrorsData) return;
    const tbody = document.getElementById("table-state-errors-body");
    if (!tbody) return;

    // 2022 test year, states with 5+ counties, sorted by anomaly-model RMSE (hardest first)
    const rows = state.stateErrorsData.filter(s => s.year === 2022 && s.counties_count >= 5)
      .sort((a, b) => b.rmse_anom - a.rmse_anom);
    tbody.innerHTML = rows.map(s => `
      <tr>
        <td><strong>${s.state_name}</strong> (${s.state})</td>
        <td><span class="badge ${s.is_corn_belt ? 'badge-success' : 'badge-info'}">${s.region}</span></td>
        <td>${s.counties_count}</td>
        <td>${s.avg_yield.toFixed(1)} bu/ac</td>
        <td><strong>${s.rmse_anom.toFixed(2)}</strong></td>
        <td>${s.rmse_full.toFixed(2)}</td>
        <td>${s.rmse_base.toFixed(2)}</td>
        <td><span class="badge ${s.rmse_gain_pct_anom >= 0 ? 'badge-success' : 'badge-danger'}">${signed(s.rmse_gain_pct_anom)}%</span></td>
      </tr>
    `).join("");
  }

  function initSimulatorOffline() {
    // The simulator needs simulator_params.json; without it, say so instead of showing made-up numbers
    showSimulatorUnavailable();
  }
});
