# Crop Yield Prediction (ES 335: Machine Learning)

[![Live Website](https://img.shields.io/badge/Live%20Website-GitHub%20Pages-brightgreen)](https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)

**Authors:** Akarsh Kumar (25110015) &amp; Arpit Mahajan (25110054)  
**Institution:** Indian Institute of Technology Gandhinagar (IITGN)  
**Live Interactive Website:** [https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/](https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/)

---

## 🌾 Project Overview

Farmers, regional planners, and crop insurers need accurate, pre-harvest estimates of county-level crop yields to optimize grain storage, manage food supply security, and underwrite insurance risk. This project investigates:

> **Core Question:** *How well can county-level corn yield (bushels per acre) be predicted from growing-season weather extremes, soil chemistry, and geographic coordinates, and how much predictive power does each feature group add over historical agricultural baselines?*

We evaluate tabular machine learning models (**Ridge Regression**, **Random Forest**, and **HistGradientBoosting**) across **8,691 county-year observations (2017–2022)** spanning 32 US agricultural states, benchmarking both temporal generalization (held-out 2022 season) and spatial cross-validation (leave-states-out).

---

## 📊 Summary of Experimental Results

### 1. Baselines (2021 Validation Set)
* **County-Mean Baseline (4-year historical average):** RMSE = **23.83 bu/ac** | MAE = 18.77 | R² = 0.61
* **Previous-Year Yield Baseline ($y_{t-1}$):** RMSE = **27.51 bu/ac** | MAE = 20.98 | R² = 0.48
* **Spatial Training-Mean Baseline:** RMSE = **36.49 bu/ac** | MAE = 29.11 | R² = -0.01

### 2. Direct Feature Ablation (2021 Validation Set)
| Feature Set | Model | RMSE (bu/ac) | MAE (bu/ac) | R² Score | Gain vs. County Mean |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Weather Only | Ridge | 35.17 | 26.93 | 0.15 | -47.6% |
| Weather Only | Random Forest | 30.78 | 24.36 | 0.35 | -29.2% |
| Weather Only | HistGradientBoosting | 30.23 | 23.21 | 0.37 | -26.9% |
| Weather + Geo | HistGradientBoosting | 26.59 | 21.35 | 0.51 | -11.6% |
| **Weather + Geo + Soil** | **HistGradientBoosting** | **25.61** | **20.07** | **0.55** | **-7.5%** |

*Takeaway:* Historical county averages dominate raw weather models because local infrastructure and deep soils carry tremendous annual persistence.

### 3. Setting A: Anomaly Formulation (Known Counties with Weather Departures)
By predicting departures from each county's leave-one-out historical average ($\hat{y} = \bar{y}_{\text{historical}} + \hat{\Delta}_{\text{weather}}$), the machine learning models decisively outperform the baseline:
* **Weather Only (HGB):** RMSE = **20.40 bu/ac** (+14.4% gain, R² = 0.71)
* **Weather + Geo + Soil (HGB):** RMSE = **20.38 bu/ac** (**+14.5% gain**, R² = 0.71)

### 4. Setting B: Spatial Generalization (Leave-States-Out CV)
Evaluating on unseen states where county history does not exist:
* **Geo + Soil Only (No Weather):** RMSE = 32.94 bu/ac (+9.7% gain vs. spatial baseline)
* **Weather Only:** RMSE = 29.19 bu/ac (+20.0% gain)
* **Weather + Geo:** RMSE = **28.56 bu/ac** (**+21.7% gain**)

### 5. Final Held-Out Test Set (2022 Season)
Trained on 2017–2021 data using optimal hyperparameters found on 2021 validation:
* **Test RMSE:** **24.90 bu/ac**
* **Test MAE:** **18.82 bu/ac**
* **Test R²:** **0.67** (67% of nationwide yield variance explained)

---

## 🌐 Interactive Deliverables (`docs/`)

Published live on GitHub Pages: [https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/](https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/)

1. **US County Yield &amp; Prediction Error Explorer**:
   * Interactive US map and county inspector rendering all 1,500+ agricultural counties.
   * View toggles between Actual Yield, Prediction Error ($|y - \hat{y}|$), and Soil Improvement over weather-only models.
   * County detail cards displaying local Soil Organic Carbon (SOC), Soil Nitrogen, Soil pH, rainfall, and summer heat days.
2. **What-If Crop Yield Simulator**:
   * Real-time client-side interactive inference engine with dynamic sliders for rainfall, extreme heat days (>30°C), temperature, and soil chemistry.
   * Preset buttons simulating Optimal Corn Belt seasons, severe 2012-style droughts, high-SOC buffering, and acidic soils.

---

## 📁 Repository Structure

```
ES335_Crop_Yield_Production/
├── README.md                           # Project report, evaluation tables & instructions
├── notebooks/
│   ├── 01_model_ablation_and_tuning.ipynb   # Baseline models, feature ablations & 2022 test
│   └── 02_anomaly_and_spatial_cv.ipynb      # Setting A (anomaly) & Setting B (leave-states-out)
├── scripts/
│   └── export_web_data.py              # Export script generating JSON artifacts for the web app
├── es335_crop/                         # Raw & processed datasets
│   ├── corn_model_table.csv            # 8,691 rows, 62 columns (2017-2022)
│   ├── corn_yield.csv                  # USDA NASS annual county yields
│   ├── ablation_val2021.csv            # 2021 direct ablation benchmark table
│   ├── settingA_anomaly_val2021.csv    # 2021 anomaly benchmark table
│   └── settingB_leave_states_out.csv   # 5-fold spatial CV results
└── docs/                               # GitHub Pages interactive web application
    ├── index.html                      # 10 rubric sections + interactive tools
    ├── style.css                       # Responsive academic stylesheet
    ├── app.js                          # Map explorer & what-if simulator logic
    └── data/                           # Web data artifacts (JSON)
        ├── ablation_metrics.json
        ├── counties_summary.json
        ├── state_errors.json
        └── simulator_params.json
```

---

## 🔬 Reproduction Guide

### 1. Environment Setup
```bash
git clone https://github.com/akarshkumar161-arch/ES335_Crop_Yield_Production.git
cd ES335_Crop_Yield_Production

python3 -m venv venv
source venv/bin/activate
pip install numpy pandas scikit-learn matplotlib seaborn jupyter
```

### 2. Running Analysis & Generating Deliverables
```bash
# Run Jupyter notebooks to inspect models and evaluations
jupyter notebook notebooks/01_model_ablation_and_tuning.ipynb

# Regenerate web data JSON artifacts
python scripts/export_web_data.py

# Test website locally
python3 -m http.server 8000 --directory docs
# Open http://localhost:8000 in your web browser
```

---

## 📜 Academic Rubric Alignment (ES 335)
This project strictly adheres to the ES 335 assessment criteria:
* **Framing & Scope (10 pts):** Predict county corn yield at end of season; non-causal predictive framing.
* **Data Understanding (10 pts):** Multi-source integration (CropNet WRF-HRRR, ISRIC SoilGrids, USDA CDL, US Census TIGER).
* **Preprocessing & Leakage Prevention (10 pts):** Imputation/scaling inside pipelines; leave-one-out historical means.
* **Baselines & Candidate Methods (15 pts):** Meaningful historical county baseline compared with regularized linear and tree ensembles.
* **Evaluation Design (20 pts):** Temporal splits (2017–2020 train, 2021 val, 2022 test) and spatial leave-states-out CV.
* **Results & Limitations (10 pts):** Outlier state analysis (irrigated West vs. rainfed Midwest), omitted variable bias.
* **Reproducibility (5 pts):** Automated scripts, documented environments, publicly accessible data.
* **Interactive Deliverable & Interaction (15 pts):** GitHub Pages site with County Map Explorer and What-If Simulator.
