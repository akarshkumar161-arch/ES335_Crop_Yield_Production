# Crop Yield Prediction (ES 335)

**Team Members:** Akarsh Kumar (25110015) & Arpit Mahajan (25110054)

## Problem Statement
Farmers, planners, and insurers want to know what yield to expect for a given combination of soil, rainfall, and location. This project predicts county-level corn yield (bushels per acre) from soil properties, growing-season rainfall, temperature, and geographic variables. We compare weather-only, weather+geography, and weather+soil+geography feature sets to measure what each group adds to the model's accuracy.

## Data Sources
*   **Crop & Weather:** CropNet on Hugging Face (tabular USDA Crop and WRF-HRRR weather files)
*   **Soil Properties:** ISRIC SoilGrids
*   **Geography:** Elevation from SRTM, Crop area from USDA Cropland Data Layer (CDL), and County centroids from US Census boundaries

## Models & Baselines
*   **Baseline:** County-mean over training years and Ridge Regression to establish simple linear connections.
*   **Candidate Methods:** Random Forest and HistGradientBoosting to capture non-linear thresholds (e.g., heat stress) and interactions.

## Repository Structure
*   `/notebooks`: Jupyter notebooks containing the data pipeline, model ablation, and leave-states-out cross-validation.
*   `/docs`: Static HTML, CSS, and JS files for the interactive GitHub Pages website.
*   `/data`: Raw and processed datasets (ignored in version control due to size constraints).
