/**
 * ES 335: Crop Yield Prediction
 * Interactive Web Application (app.js)
 * Authors: Akarsh Kumar (25110015) & Arpit Mahajan (25110054)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Global State
  const state = {
    year: "2021",
    viewMode: "actual", // 'actual', 'error', 'soil_imp'
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
      const absErr = Math.abs(c.err_full);
      const t = Math.min(1.0, absErr / 45.0);
      const r = Math.round(40 + t * 200);
      const g = Math.round(160 * (1 - t * 0.7));
      const b = Math.round(50 * (1 - t));
      return `rgb(${r}, ${g}, ${b})`;
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
      title.innerText = "Prediction Error |Actual - Pred|";
      bar.className = "legend-bar error-scale";
      minLabel.innerText = "0 bu/ac (Accurate)";
      maxLabel.innerText = "≥ 45 bu/ac (High Error)";
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
Pred: ${c.pred_full} bu/ac
Error: ${c.err_full} bu/ac</title>
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

    if (title) title.innerText = `${c.state_name} County (${c.state})`;
    if (fips) fips.innerText = `FIPS: ${c.fips} | Lat: ${c.lat}°, Lon: ${c.lon}°`;
    if (actual) actual.innerText = `${c.actual} bu/ac`;
    if (pred) pred.innerText = `${c.pred_full} bu/ac`;
    if (base) base.innerText = `${c.baseline} bu/ac`;
    if (err) {
      err.innerText = `${c.err_full > 0 ? '+' : ''}${c.err_full} bu/ac`;
      err.style.color = Math.abs(c.err_full) <= 15 ? "#166534" : "#b91c1c";
    }
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
      if (cardRmse) cardRmse.innerText = isTestYear ? "24.90 bu/ac (Test)" : "25.61 bu/ac (Val)";
      if (cardGain) cardGain.innerText = isTestYear ? "+67% R² Explained" : "-7.5% vs Hist Baseline";
    } else {
      const found = yearStats.find(s => s.state === state.selectedState);
      if (found) {
        if (cardState) cardState.innerText = `${found.state_name} (${found.counties_count} Counties)`;
        if (cardYield) cardYield.innerText = `${found.avg_yield} bu/ac`;
        if (cardRmse) cardRmse.innerText = `${found.rmse_full} bu/ac`;
        if (cardGain) cardGain.innerText = `${found.rmse_gain_pct > 0 ? '+' : ''}${found.rmse_gain_pct}% vs Base`;
      }
    }
  }

  // 4. Interactive What-If Crop Yield Simulator
  function initSimulator() {
    const inputs = ["precip", "heat", "temp", "soc", "nitrogen", "ph"];
    inputs.forEach(id => {
      const el = document.getElementById(`sim-${id}`);
      const valDisp = document.getElementById(`val-${id}`);
      if (el && valDisp) {
        el.addEventListener("input", () => {
          valDisp.innerText = formatSimValue(id, el.value);
          calculateSimulator();
        });
      }
    });

    // Preset buttons
    const presets = {
      cornbelt: { precip: 650, heat: 16, temp: 23.5, soc: 42, nitrogen: 2.8, ph: 6.6 },
      drought: { precip: 320, heat: 46, temp: 28.0, soc: 25, nitrogen: 2.0, ph: 6.5 },
      highsoc: { precip: 450, heat: 35, temp: 26.5, soc: 75, nitrogen: 4.2, ph: 6.7 },
      acidic: { precip: 620, heat: 20, temp: 24.0, soc: 20, nitrogen: 1.5, ph: 5.1 }
    };

    Object.keys(presets).forEach(key => {
      const btn = document.getElementById(`btn-preset-${key}`);
      if (btn) {
        btn.addEventListener("click", () => {
          applySimulatorPreset(presets[key]);
        });
      }
    });

    calculateSimulator();
  }

  function formatSimValue(id, val) {
    if (id === "precip") return `${val} mm`;
    if (id === "heat") return `${val} days`;
    if (id === "temp") return `${parseFloat(val).toFixed(1)} °C`;
    if (id === "soc") return `${parseFloat(val).toFixed(1)} g/kg`;
    if (id === "nitrogen") return `${parseFloat(val).toFixed(1)} g/kg`;
    if (id === "ph") return `${parseFloat(val).toFixed(1)}`;
    return val;
  }

  function applySimulatorPreset(cfg) {
    Object.keys(cfg).forEach(k => {
      const el = document.getElementById(`sim-${k}`);
      const disp = document.getElementById(`val-${k}`);
      if (el && disp) {
        el.value = cfg[k];
        disp.innerText = formatSimValue(k, cfg[k]);
      }
    });
    calculateSimulator();
  }

  function calculateSimulator() {
    const precip = parseFloat(document.getElementById("sim-precip")?.value || 620);
    const heat = parseFloat(document.getElementById("sim-heat")?.value || 22);
    const temp = parseFloat(document.getElementById("sim-temp")?.value || 24.2);
    const soc = parseFloat(document.getElementById("sim-soc")?.value || 35.0);
    const nitrogen = parseFloat(document.getElementById("sim-nitrogen")?.value || 2.5);
    const ph = parseFloat(document.getElementById("sim-ph")?.value || 6.5);

    const baseYield = 172.5;

    // Response equations calibrated to HGB feature splits
    // 1. Rainfall curve: optimal at 650mm, penalties for drought and waterlogging
    const rainDelta = -0.00018 * Math.pow(precip - 650.0, 2) + 4.0;
    
    // 2. Heat stress: severe threshold above 18 days
    const heatPenalty = heat > 18 ? -0.85 * (heat - 18) : +2.0;

    // 3. Summer temperature: quadratic curve around 23.5°C
    const tempPenalty = -1.1 * Math.pow(temp - 23.5, 2);

    // 4. Soil Organic Carbon: buffering capacity
    const socGain = 0.22 * (soc - 30.0);

    // 5. Nitrogen content
    const nitroGain = 3.8 * (nitrogen - 2.0);

    // 6. Soil pH: quadratic lockup outside 6.2 - 6.8
    const phPenalty = -5.2 * Math.pow(ph - 6.5, 2);

    const totalPredicted = Math.max(30.0, Math.min(255.0, baseYield + rainDelta + heatPenalty + tempPenalty + socGain + nitroGain + phPenalty));

    // Update UI elements
    const predEl = document.getElementById("sim-output-yield");
    const compEl = document.getElementById("sim-output-comparison");
    if (predEl) predEl.innerText = totalPredicted.toFixed(1);

    const diff = totalPredicted - baseYield;
    if (compEl) {
      if (diff >= 0) {
        compEl.innerText = `+${diff.toFixed(1)} bu/ac (+${((diff/baseYield)*100).toFixed(1)}%) vs National Avg`;
        compEl.className = "yield-comparison badge-success";
      } else {
        compEl.innerText = `${diff.toFixed(1)} bu/ac (${((diff/baseYield)*100).toFixed(1)}%) vs National Avg`;
        compEl.className = "yield-comparison badge-danger";
      }
    }

    // Breakdown rows
    updateBreakdownRow("impact-rain", rainDelta, "mm Rain Response");
    updateBreakdownRow("impact-heat", heatPenalty, "Extreme Heat Stress");
    updateBreakdownRow("impact-temp", tempPenalty, "Temperature Variance");
    updateBreakdownRow("impact-soc", socGain, "SOC Moisture Buffer");
    updateBreakdownRow("impact-nitro", nitroGain, "Native Soil Nitrogen");
    updateBreakdownRow("impact-ph", phPenalty, "pH Bioavailability");
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

    // Show top 12 hardest and top 6 most accurate states from 2021
    const y2021 = state.stateErrorsData.filter(s => s.year === 2021);
    tbody.innerHTML = y2021.slice(0, 15).map(s => `
      <tr>
        <td><strong>${s.state_name}</strong> (${s.state})</td>
        <td><span class="badge ${s.is_corn_belt ? 'badge-success' : 'badge-info'}">${s.region}</span></td>
        <td>${s.counties_count}</td>
        <td>${s.avg_yield.toFixed(1)} bu/ac</td>
        <td><strong>${s.rmse_full.toFixed(2)}</strong></td>
        <td>${s.rmse_base.toFixed(2)}</td>
        <td><span class="badge ${s.rmse_gain_pct >= 0 ? 'badge-success' : 'badge-danger'}">${s.rmse_gain_pct > 0 ? '+' : ''}${s.rmse_gain_pct}%</span></td>
      </tr>
    `).join("");
  }

  function initSimulatorOffline() {
    // Basic offline calculations if JSON fetches are blocked locally
    initSimulator();
  }
});
