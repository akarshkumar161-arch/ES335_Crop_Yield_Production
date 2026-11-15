# Crop Yield Prediction (ES 335: Machine Learning)

[![Live Website](https://img.shields.io/badge/Live%20Website-GitHub%20Pages-brightgreen)](https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)

**Authors:** Akarsh Kumar (25110015) & Arpit Mahajan (25110054), IIT Gandhinagar
**Website (full reasoning, figures and interactive tools):** https://akarshkumar161-arch.github.io/ES335_Crop_Yield_Production/

The website explains the project. This repository lets you check it: every number on the website is produced by the code and notebooks here, and every result table is in `es335_crop/`.

---

## 1. Question and unit of analysis

> How well can county-level corn yield (bushels per acre) be predicted from April–September weather, topsoil chemistry and location, and how much does each group of features add over the county's own historical average?

* **One row** = one US county in one year (2017–2022), 8,691 rows, 1,898 counties, 32 states.
* **Target** = USDA corn grain yield, bu/acre.
* **Prediction time** = end of September: this season's observed weather, static soil and location, and the county's yields from earlier years are known; this year's yield is not.
* Results are predictive associations, not causal effects.

## 2. Main results

| Model | 2021 validation RMSE | 2022 test RMSE | 2022 MAE | 2022 R² | 2022 RMSE gain vs baseline (95% state-bootstrap interval) |
|---|---|---|---|---|---|
| County-mean baseline | 23.83 | 25.48 | 18.97 | 0.65 | reference |
| Direct HGB, weather+geo+soil (tuned on 2021) | 25.61 | 24.90 | 18.82 | 0.67 | +0.58 bu/ac (−2.13 to +2.98), not distinguishable from zero |
| **Anomaly HGB, weather+geo+soil (chosen on 2021)** | **20.38** | **21.82** | **15.88** | **0.74** | **+3.66 bu/ac (+2.46 to +4.95), 14.4% lower RMSE** |

* 81% of yield variance is between counties, so the county's own average is a strong baseline. Direct models do not beat it.
* The anomaly model predicts each year's departure from the county average using weather departures, soil and location. It beats the baseline on 2021 and again on the untouched 2022 test year.
* Soil adds little once location or county history is known (direct HGB 2021: 26.59 → 25.61; no gain in the anomaly model; slightly worse in leave-states-out CV: 28.56 → 29.51).
* Largest errors: low-yield counties with no earlier history (6 of the 10 worst 2022 errors) and irrigated western counties. The models shrink extreme years toward normal.

Full tables: `es335_crop/final_comparison_2021_2022.csv`, `bootstrap_ci.csv`, `ablation_val2021.csv`, `settingA_anomaly_val2021.csv`, `settingB_leave_states_out.csv`, `representative_errors_2022.csv`, `error_by_history_2022.csv`.

## 3. Data access

All sources are public and need no account or API key. The processed tables are committed in `es335_crop/`, so **you do not need to download anything to check the analysis.** Rebuilding them from the raw sources is optional.

| Source | What we use | Access |
|---|---|---|
| CropNet (Lin et al., 2024) | USDA county corn yields 2016-2022; WRF-HRRR daily weather (~3,500 files, one per state and month, ~25 MB each) | Hugging Face dataset [`CropNet/CropNet`](https://huggingface.co/datasets/CropNet/CropNet),<br>downloaded with `huggingface_hub` |
| ISRIC SoilGrids 2.0 (Poggio et al., 2021) | Topsoil organic carbon, total nitrogen, pH at 0–5 and 5–15 cm, 5 km aggregated rasters | `https://files.isric.org/soilgrids/latest/`<br>`data_aggregated/5000m/` |
| US Census cartographic boundaries (2021, 1:20m) | County polygons and centroids | `https://www2.census.gov/geo/tiger/`<br>`GENZ2021/shp/cb_2021_us_county_20m.zip` |

**Licence note:** the CropNet Hugging Face page lists `cc-by-4.0` in its metadata, but its dataset card states CC BY-NC 4.0 (non-commercial). We use the data for non-commercial coursework only and treat the files in `es335_crop/` that are derived from CropNet as subject to CropNet's licence. SoilGrids is CC BY 4.0.

**Rebuilding the tables:** run `notebooks/00_data_pipeline.ipynb` on Google Colab. The weather download takes several hours the first time; files are cached in Google Drive. Four weather files failed their download check (listed in `es335_crop/hrrr_skipped.csv`: New Mexico Jul–Sep 2018 and Nevada May 2020); neither state has rows in the final table.

## 4. Preprocessing (exact steps, `notebooks/00_data_pipeline.ipynb`)

1. **Yield:** corn grain yield (bu/acre), 5-digit FIPS codes, duplicate county-year rows averaged. 2016 is kept only for the previous-year baseline.
2. **Weather** (`county_month_features`): keep daily rows for April–September in counties that ever grew corn; average all 3 km grid cells in a county per day; convert K → °C; per month take the mean of daily tavg, tmax, tmin, relative humidity, VPD and solar radiation, the sum of daily precipitation (kg m⁻² = mm), and the count of days with county-mean tmax > 30 °C.
3. **Season features:** pivot to one row per county-year (6 months × 8 variables = 48 columns) plus season totals of precipitation and heat days.
4. **Soil:** mean of each SoilGrids raster over the county polygon (`all_touched=True`); missing counties filled with the state mean; SoilGrids integer scaling undone (pH ÷ 10, nitrogen ÷ 100, organic carbon ÷ 10).
5. **Location:** county centroid latitude/longitude computed in an equal-area projection (EPSG:5070).
6. **Join** on FIPS and year with inner joins and a row-count audit: 8,739 corn county-years → 8,691 (48 lost at the weather join, 37 of them in 2017). No missing values remain.

Model-side preprocessing (median imputation, scaling) is inside scikit-learn pipelines fit on training rows only. Anomaly-model training targets use leave-one-year-out county means, so no row's own yield is in its baseline.

## 5. Splits and evaluation

* **Time split:** train 2017–2020 (5,707 rows), validate 2021 (1,469), test 2022 (1,515). All choices (feature sets, direct vs anomaly formulation, hyperparameters) were made on 2021. 2022 was used only to report final scores and nothing was changed after seeing it. The 2022 baseline and models are refit on 2017–2021.
* **Leave-states-out CV** (Setting B): 5-fold `GroupKFold` by state on 2017–2021, to measure transfer to unseen states.
* **Metrics:** RMSE and MAE in bu/acre, R², and % RMSE reduction vs the county-mean baseline.
* **Uncertainty:** 2,000 bootstrap resamples of whole states (counties in a state share weather) give 95% intervals for each model's RMSE gain over the baseline. This covers which counties are evaluated, not other weather years.
* Random seed 42 throughout. scikit-learn is pinned to 1.6.1 because HistGradientBoosting results shift slightly between versions.

## 6. Repository structure

```
├── README.md
├── requirements.txt                       # pinned versions
├── notebooks/
│   ├── 00_data_pipeline.ipynb             # raw sources -> es335_crop/*.csv (Colab, slow)
│   ├── 01_model_ablation_and_tuning.ipynb # baselines, direct-model ablation, tuning on 2021, direct 2022 test
│   ├── 02_anomaly_and_spatial_cv.ipynb    # Setting A (anomaly models, 2021) and Setting B (leave-states-out)
│   ├── 03_figures_and_coefficients.ipynb  # model figures, permutation importance, Ridge coefficients
│   └── 04_eda_uncertainty_and_errors.ipynb# data plots and checks, anomaly 2022 test, bootstrap, error analysis
├── scripts/
│   └── export_web_data.py                 # trains the website models, writes docs/data/*.json, copies figures
├── es335_crop/                            # processed data and all result tables
│   ├── corn_model_table.csv               # modelling table: 8,691 rows x 62 columns
│   ├── corn_yield.csv                     # USDA county corn yields 2016-2022
│   ├── weather_county_month.csv           # county-month weather, Apr-Sep 2017-2022
│   ├── hrrr_skipped.csv                   # weather files that failed to download
│   ├── data_quality_summary.csv           # row counts and quality checks
│   ├── ablation_val2021.csv               # direct models, 2021
│   ├── settingA_anomaly_val2021.csv       # anomaly models, 2021
│   ├── settingB_leave_states_out.csv      # leave-states-out CV
│   ├── final_comparison_2021_2022.csv     # baseline / direct / anomaly, 2021 and 2022
│   ├── bootstrap_ci.csv                   # 95% state-bootstrap intervals
│   ├── representative_errors_2022.csv     # largest and typical 2022 errors
│   ├── error_by_history_2022.csv          # 2022 error by years of county history
│   └── ridge_coefficients.csv             # standardized Ridge coefficients
├── figures/                               # PNGs written by notebooks 03 and 04
└── docs/                                  # GitHub Pages website
    ├── index.html, style.css, app.js
    ├── figures/                           # copies of figures/ (Pages serves only docs/)
    └── data/                              # JSON written by scripts/export_web_data.py
```

## 7. Setup and run

```bash
git clone https://github.com/akarshkumar161-arch/ES335_Crop_Yield_Production.git
cd ES335_Crop_Yield_Production
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run in order (each reads es335_crop/ and writes its tables/figures there and to figures/):
jupyter notebook notebooks/
#   01_model_ablation_and_tuning.ipynb     -> 2021 ablation, tuning, direct 2022 test (RMSE 24.90)
#   02_anomaly_and_spatial_cv.ipynb        -> Setting A (2021 RMSE 20.38) and Setting B
#   03_figures_and_coefficients.ipynb      -> figures 01-06, ridge_coefficients.csv
#   04_eda_uncertainty_and_errors.ipynb    -> figures 07-09, anomaly 2022 test (RMSE 21.82), bootstrap, error tables

# Rebuild the website data (about 10 s) and preview the site
python scripts/export_web_data.py
python3 -m http.server 8000 --directory docs     # open http://localhost:8000
```

Notebooks also run on Google Colab: they detect Colab and read from `MyDrive/es335_crop`. `00_data_pipeline.ipynb` is Colab-only.

## 8. Extra experiments

* **Previous-year baseline** (2021: RMSE 27.51) is worse than the county mean (23.83), so we use the county mean.
* **Leave-states-out CV** (Setting B): best is weather+geo HGB, RMSE 28.56 vs 36.49 for the training mean; adding soil makes it worse (29.51).
* **What-if simulator model:** Ridge on six inputs and their squares, trained 2017–2021 (2021 RMSE 36.61, R² 0.08; 2022 RMSE 36.12, R² 0.30). It uses no county history and is shown only to illustrate learned associations.

## 9. Contributions

* **Akarsh Kumar (25110015):** Extracting the trained data for use outside the notebooks, and building the website (layout, county map explorer and what-if simulator). Worked jointly on the final models. 
* **Arpit Mahajan (25110054):** Data processing (building the county-year table from the raw yield, weather, soil and boundary data) and the baseline models (county mean, previous-year and training-mean). Worked jointly on the final models.

## 10. AI-use disclosure

* AI was used to plan and give the direction on how to proceed with the project, along with writing code in few parts.

* AI was also used to review the repository against the proposal and rubric.

* All of its code was run, and every reported number comes from that code.
* We reviewed all AI-written code and text and are responsible for the content.

## 11. Citations

* Lin, F., Guillot, K., Crawford, S., Zhang, Y., Yuan, X., & Tzeng, N.-F. (2024). An Open and Large-Scale Dataset for Multi-Modal Climate Change-aware Crop Yield Predictions. *Proceedings of the 30th ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD '24)*, 5375–5386. https://doi.org/10.1145/3637528.3671536. Dataset: https://huggingface.co/datasets/CropNet/CropNet
* Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E., & Rossiter, D. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. *SOIL*, 7, 217–240. https://doi.org/10.5194/soil-7-217-2021
* Dowell, D. C., et al. (2022). The High-Resolution Rapid Refresh (HRRR): An Hourly Updating Convection-Allowing Forecast Model. Part I: Motivation and System Description. *Weather and Forecasting*, 37(8). (Source model of the CropNet weather data.)
* U.S. Census Bureau (2021). Cartographic Boundary Files: Counties, 1:20,000,000. https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html
* Pedregosa, F., et al. (2011). Scikit-learn: Machine Learning in Python. *Journal of Machine Learning Research*, 12, 2825–2830.
