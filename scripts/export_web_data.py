#!/usr/bin/env python3
"""
scripts/export_web_data.py

Trains the models used on the website and writes the JSON files in docs/data/.
Every number shown on the map and in the simulator comes from a model trained here
and evaluated on years it never saw. Nothing is hand-tuned or blended with the truth.

  * counties_summary.json  - per county, real out-of-sample predictions:
        2021: models trained on 2017-2020 (validation year)
        2022: models trained on 2017-2021 (held-out test year)
        anomaly model = county mean + HGB prediction of the departure from it (Setting A, notebook 02);
                        the approach chosen on 2021 and the main result
        full model    = direct HistGradientBoosting on weather + geo + soil
        weather-only  = direct HistGradientBoosting on weather
        baseline      = county mean of the training years (fallback: state mean, then overall mean)
  * state_errors.json      - per-state RMSE of the full model vs the baseline
  * simulator_params.json  - a Ridge model (6 inputs + their squares) exported as plain numbers
                             so the browser can run exactly the same model
  * ablation_metrics.json  - notebook result tables + baselines and test metrics computed here

Usage:  python scripts/export_web_data.py
"""

import json
import os
import re

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import StandardScaler

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "es335_crop"))
OUT_DIR = os.environ.get("OUT_DIR", os.path.join(BASE_DIR, "docs", "data"))
SEED = 42

# Hyperparameters, taken from notebooks/01_model_ablation_and_tuning.ipynb
HGB_VAL_PARAMS = dict(max_iter=300, learning_rate=0.05)                          # ablation run (val 2021)
HGB_TEST_PARAMS = dict(learning_rate=0.1, max_iter=500, min_samples_leaf=20)     # tuned on 2021, used for 2022

STATE_NAMES = {
    "01": ("Alabama", "AL"), "04": ("Arizona", "AZ"), "05": ("Arkansas", "AR"),
    "06": ("California", "CA"), "08": ("Colorado", "CO"), "09": ("Connecticut", "CT"),
    "10": ("Delaware", "DE"), "12": ("Florida", "FL"), "13": ("Georgia", "GA"),
    "16": ("Idaho", "ID"), "17": ("Illinois", "IL"), "18": ("Indiana", "IN"),
    "19": ("Iowa", "IA"), "20": ("Kansas", "KS"), "21": ("Kentucky", "KY"),
    "22": ("Louisiana", "LA"), "23": ("Maine", "ME"), "24": ("Maryland", "MD"),
    "25": ("Massachusetts", "MA"), "26": ("Michigan", "MI"), "27": ("Minnesota", "MN"),
    "28": ("Mississippi", "MS"), "29": ("Missouri", "MO"), "30": ("Montana", "MT"),
    "31": ("Nebraska", "NE"), "32": ("Nevada", "NV"), "33": ("New Hampshire", "NH"),
    "34": ("New Jersey", "NJ"), "35": ("New Mexico", "NM"), "36": ("New York", "NY"),
    "37": ("North Carolina", "NC"), "38": ("North Dakota", "ND"), "39": ("Ohio", "OH"),
    "40": ("Oklahoma", "OK"), "41": ("Oregon", "OR"), "42": ("Pennsylvania", "PA"),
    "44": ("Rhode Island", "RI"), "45": ("South Carolina", "SC"), "46": ("South Dakota", "SD"),
    "47": ("Tennessee", "TN"), "48": ("Texas", "TX"), "49": ("Utah", "UT"),
    "50": ("Vermont", "VT"), "51": ("Virginia", "VA"), "53": ("Washington", "WA"),
    "54": ("West Virginia", "WV"), "55": ("Wisconsin", "WI"), "56": ("Wyoming", "WY"),
}
CORN_BELT_STATES = {"17", "18", "19", "26", "27", "29", "31", "39", "55"}
WEST_STATES = {"53", "16", "08", "06", "41"}


# --------------------------------------------------------------------------- helpers
def scores(y, p):
    return {"rmse": float(np.sqrt(mean_squared_error(y, p))),
            "mae": float(mean_absolute_error(y, p)),
            "r2": float(r2_score(y, p))}


def rounded(d, n=2):
    return {k: round(v, n) for k, v in d.items()}


def load_table():
    df = pd.read_csv(os.path.join(DATA_DIR, "corn_model_table.csv"),
                     dtype={"FIPS": str, "STATEFP": str})
    df["FIPS"] = df["FIPS"].str.zfill(5)
    df["STATEFP"] = df["STATEFP"].str.zfill(2)
    # summer (Jun-Aug) mean temperature, used by the simulator and the county inspector
    df["summer_tavg"] = df[["tavg_m06", "tavg_m07", "tavg_m08"]].mean(axis=1)
    return df


def feature_groups(df):
    # same regex as the notebooks: 48 monthly columns + precip_season + heat_days_season = 50
    weather = [c for c in df.columns if re.match(r"(tavg|tmax|tmin|precip|rh|vpd|srad|heat_days)_", c)]
    soil = [c for c in df.columns if c.startswith(("nitrogen", "soc", "phh2o"))]
    geo = ["lat", "lon"]
    return weather, geo, soil


def county_mean_baseline(train, target):
    """County mean of training years -> state mean -> overall mean."""
    cm = train.groupby("FIPS")["Yield"].mean()
    sm = train.groupby("STATEFP")["Yield"].mean()
    return (target["FIPS"].map(cm)
            .fillna(target["STATEFP"].map(sm))
            .fillna(train["Yield"].mean()))


# --------------------------------------------------------------------------- 1. map data
ANOMALY_PARAMS = dict(max_iter=200, learning_rate=0.05, max_depth=4, min_samples_leaf=40)   # notebook 02, Setting A


def anomaly_predict(train, test, weather, geo, soil):
    """Setting A: county mean + HGB prediction of this year's departure from it.

    Training targets use leave-one-year-out county means (a row's own year is excluded), so the
    model never sees a mean that contains the value it is predicting. Same code as notebooks 02 and 04.
    """
    cols = ["Yield"] + weather
    x = train[cols]
    sums = train.groupby("FIPS")[cols].transform("sum")
    cnt = train.groupby("FIPS")[cols].transform("count")
    loo = (sums - x.fillna(0)) / (cnt - x.notna().astype(int))
    keep = train.groupby("FIPS")["Yield"].transform("count") >= 2
    tr, loo = train[keep], loo[keep]
    X_tr = (tr[weather] - loo[weather]).join(tr[geo + soil])
    y_tr = tr["Yield"] - loo["Yield"]

    cm = train.groupby("FIPS")[cols].mean().reindex(test["FIPS"])
    known = test["FIPS"].isin(train["FIPS"]).values
    X_te = pd.DataFrame(test[weather].values - cm[weather].values, columns=weather, index=test.index).join(test[geo + soil])
    model = HistGradientBoostingRegressor(**ANOMALY_PARAMS, random_state=SEED).fit(X_tr, y_tr)
    corr = pd.Series(model.predict(X_te), index=test.index)
    corr[~known] = 0.0                      # no county history: fall back to the baseline
    return corr


def predict_year(df, year, hgb_params, weather, geo, soil):
    train = df[df["Year"].between(2017, year - 1)]
    test = df[df["Year"] == year].copy()

    full_cols = weather + geo + soil
    m_full = HistGradientBoostingRegressor(**hgb_params, random_state=SEED).fit(train[full_cols], train["Yield"])
    m_w = HistGradientBoostingRegressor(**hgb_params, random_state=SEED).fit(train[weather], train["Yield"])

    test["pred_full"] = m_full.predict(test[full_cols])
    test["pred_w"] = m_w.predict(test[weather])
    test["baseline"] = county_mean_baseline(train, test)
    test["pred_anom"] = test["baseline"] + anomaly_predict(train, test, weather, geo, soil)
    test["history_years"] = test["FIPS"].map(train.groupby("FIPS").size()).fillna(0).astype(int)

    metrics = {
        "train_years": f"2017-{year - 1}",
        "n_counties": int(len(test)),
        "full_model": rounded(scores(test["Yield"], test["pred_full"])),
        "weather_only": rounded(scores(test["Yield"], test["pred_w"])),
        "county_mean_baseline": rounded(scores(test["Yield"], test["baseline"])),
        "anomaly_model": rounded(scores(test["Yield"], test["pred_anom"])),
    }
    b = metrics["county_mean_baseline"]["rmse"]
    metrics["anomaly_model"]["gain_pct_vs_baseline"] = round((b - metrics["anomaly_model"]["rmse"]) / b * 100, 1)
    metrics["full_model"]["gain_pct_vs_baseline"] = round((b - metrics["full_model"]["rmse"]) / b * 100, 1)
    metrics["weather_only"]["gain_pct_vs_baseline"] = round((b - metrics["weather_only"]["rmse"]) / b * 100, 1)
    return test, metrics


def county_records(test):
    out = []
    for r in test.to_dict("records"):
        st = r["STATEFP"]
        name, abbr = STATE_NAMES.get(st, (f"State {st}", st))
        err_full = r["Yield"] - r["pred_full"]     # sign convention: actual - predicted
        err_w = r["Yield"] - r["pred_w"]
        err_anom = r["Yield"] - r["pred_anom"]
        err_base = r["Yield"] - r["baseline"]
        out.append({
            "fips": r["FIPS"], "state": abbr, "state_name": name,
            "lat": round(float(r["lat"]), 3), "lon": round(float(r["lon"]), 3),
            "actual": round(float(r["Yield"]), 1),
            "baseline": round(float(r["baseline"]), 1),
            "pred_full": round(float(r["pred_full"]), 1),
            "pred_w": round(float(r["pred_w"]), 1),
            "err_full": round(float(err_full), 1),
            "err_w": round(float(err_w), 1),
            "err_base": round(float(err_base), 1),
            "pred_anom": round(float(r["pred_anom"]), 1),
            "err_anom": round(float(err_anom), 1),
            # > 0 means the anomaly model's absolute error is smaller than the baseline's
            "anom_gain": round(float(abs(err_base) - abs(err_anom)), 1),
            "history_years": int(r["history_years"]),
            # > 0 means adding geo + soil reduced this county's absolute error
            "soil_improvement": round(float(abs(err_w) - abs(err_full)), 1),
            "precip": round(float(r["precip_season"]), 1),
            "heat_days": round(float(r["heat_days_season"]), 1),
            "tavg": round(float(r["summer_tavg"]), 1),
            "soc": round(float(r["soc_0-5cm"]), 1),
            "nitrogen": round(float(r["nitrogen_0-5cm"]), 2),
            "ph": round(float(r["phh2o_0-5cm"]), 1),
        })
    return out


def state_errors(test, year):
    rows = []
    for st, g in test.groupby("STATEFP"):
        name, abbr = STATE_NAMES.get(st, (f"State {st}", st))
        s_full = scores(g["Yield"], g["pred_full"]) if len(g) > 1 else {
            "rmse": float(abs(g["Yield"] - g["pred_full"]).iloc[0]), "mae": float(abs(g["Yield"] - g["pred_full"]).iloc[0])}
        rmse_base = float(np.sqrt(((g["Yield"] - g["baseline"]) ** 2).mean()))
        rmse_anom = float(np.sqrt(((g["Yield"] - g["pred_anom"]) ** 2).mean()))
        corn_belt = st in CORN_BELT_STATES
        rows.append({
            "year": year, "state": abbr, "state_code": st, "state_name": name,
            "counties_count": int(len(g)),
            "avg_yield": round(float(g["Yield"].mean()), 1),
            "rmse_full": round(s_full["rmse"], 2),
            "rmse_base": round(rmse_base, 2),
            "mae_full": round(s_full["mae"], 2),
            "rmse_gain_pct": round((rmse_base - s_full["rmse"]) / rmse_base * 100, 1) if rmse_base > 0 else 0.0,
            "rmse_anom": round(rmse_anom, 2),
            "rmse_gain_pct_anom": round((rmse_base - rmse_anom) / rmse_base * 100, 1) if rmse_base > 0 else 0.0,
            "is_corn_belt": corn_belt,
            "region": "Corn Belt" if corn_belt else ("West / Pacific" if st in WEST_STATES else "General Plains / East"),
        })
    return rows


# --------------------------------------------------------------------------- 2. simulator model
SIM_FEATURES = [
    # key in JSON / slider id suffix, column, label, unit, slider step
    ("precip",   "precip_season",    "Growing-season rainfall (Apr-Sep total)", "mm",   10),
    ("heat",     "heat_days_season", "Heat days, max temp > 30 °C (Apr-Sep)",   "days", 1),
    ("temp",     "summer_tavg",         "Mean summer temperature (Jun-Aug)",       "°C",   0.1),
    ("soc",      "soc_0-5cm",        "Soil organic carbon (0-5 cm)",            "g/kg", 1),
    ("nitrogen", "nitrogen_0-5cm",   "Soil total nitrogen (0-5 cm)",            "g/kg", 0.1),
    ("ph",       "phh2o_0-5cm",      "Soil pH (H2O, 0-5 cm)",                   "pH",   0.1),
]


def sim_design(df):
    """Each input plus its square, so the Ridge can learn a curve (e.g. too little or too much rain)."""
    X = pd.DataFrame(index=df.index)
    for key, col, *_ in SIM_FEATURES:
        X[f"{key}"] = df[col]
        X[f"{key}^2"] = df[col] ** 2
    return X


def fit_sim(train, alpha):
    X = sim_design(train)
    scaler = StandardScaler().fit(X)
    model = Ridge(alpha=alpha).fit(scaler.transform(X), train["Yield"])
    return scaler, model


def sim_predict(scaler, model, df):
    return model.predict(scaler.transform(sim_design(df)))


def build_simulator(df):
    train = df[df["Year"].between(2017, 2020)]
    val = df[df["Year"] == 2021]
    trval = df[df["Year"].between(2017, 2021)]
    test = df[df["Year"] == 2022]

    # choose alpha on 2021 only
    alphas = [0.01, 0.1, 1, 10, 100, 1000]
    val_rmse = {}
    for a in alphas:
        sc, m = fit_sim(train, a)
        val_rmse[a] = scores(val["Yield"], sim_predict(sc, m, val))["rmse"]
    best_alpha = min(val_rmse, key=val_rmse.get)

    sc_v, m_v = fit_sim(train, best_alpha)
    val_scores = scores(val["Yield"], sim_predict(sc_v, m_v, val))
    val_base = scores(val["Yield"], np.full(len(val), train["Yield"].mean()))

    # final simulator model: refit on 2017-2021, test once on 2022
    sc, m = fit_sim(trval, best_alpha)
    test_scores = scores(test["Yield"], sim_predict(sc, m, test))
    test_base = scores(test["Yield"], np.full(len(test), trval["Yield"].mean()))

    # Fold the scaler into raw-unit coefficients:  yield = intercept + sum(b1*x + b2*x^2)
    names = list(sim_design(trval).columns)
    w = m.coef_ / sc.scale_
    intercept = float(m.intercept_ - np.sum(m.coef_ * sc.mean_ / sc.scale_))
    coef = dict(zip(names, w))

    # sanity check: the folded formula must equal sklearn's prediction
    Xt = sim_design(test)
    manual = intercept + Xt.values @ w
    assert np.allclose(manual, sim_predict(sc, m, test), atol=1e-6), "coefficient export mismatch"

    def snap(x, step):
        """Round to the slider step so the browser slider shows exactly this value."""
        return round(round(x / step) * step, 1)

    features = {}
    for key, col, label, unit, step in SIM_FEATURES:
        v = trval[col]
        lo, hi = float(v.quantile(0.01)), float(v.quantile(0.99))
        features[key] = {
            "column": col, "name": label, "unit": unit, "step": step,
            "min": snap(lo, step), "max": snap(hi, step),
            "default": snap(float(v.median()), step),   # contributions are shown relative to this
            "b1": float(coef[key]), "b2": float(coef[f"{key}^2"]),
        }

    step_of = {key: step for key, _, _, _, step in SIM_FEATURES}

    def q(key, col, p):
        return snap(float(trval[col].quantile(p)), step_of[key])

    cb = trval[trval["STATEFP"].isin({"17", "19"})]  # Illinois + Iowa
    presets = {
        "typical": {k: f["default"] for k, f in features.items()},
        "cornbelt": {k: snap(float(cb[f["column"]].median()), f["step"]) for k, f in features.items()},
        # 10th-percentile rain, 90th-percentile heat days and summer temperature; soil at medians
        "hotdry": {**{k: f["default"] for k, f in features.items()},
                   "precip": q("precip", "precip_season", 0.10), "heat": q("heat", "heat_days_season", 0.90),
                   "temp": q("temp", "summer_tavg", 0.90)},
        # 5th-percentile pH, 10th-percentile soil carbon; weather at medians
        "acidic": {**{k: f["default"] for k, f in features.items()},
                   "ph": q("ph", "phh2o_0-5cm", 0.05), "soc": q("soc", "soc_0-5cm", 0.10)},
    }

    return {
        "model": "Ridge regression on 6 inputs and their squares (scaling folded into the coefficients)",
        "formula": "yield = intercept + sum over inputs of (b1 * x + b2 * x^2)",
        "alpha": best_alpha,
        "intercept": intercept,
        "trained_on": "2017-2021 (alpha chosen on 2021 with a 2017-2020 fit)",
        "validation_2021": rounded(val_scores),
        "validation_2021_training_mean_baseline": rounded(val_base),
        "test_2022": rounded(test_scores),
        "test_2022_training_mean_baseline": rounded(test_base),
        "note": ("Uses no county history, so it explains much less than the county-mean baseline. "
                 "It shows how yield moves with weather and soil on average across counties, "
                 "not a forecast for a particular farm. Values outside the slider range were not seen in training."),
        "features": features,
        "presets": presets,
    }


# --------------------------------------------------------------------------- 3. tables from notebooks
def read_result_csv(name, gain_col):
    p = os.path.join(DATA_DIR, name)
    if not os.path.exists(p):
        return None
    t = pd.read_csv(p)
    return [{"features": r["features"], "model": r["model"],
             "rmse": round(r["RMSE"], 2), "mae": round(r["MAE"], 2), "r2": round(r["R2"], 2),
             "gain_pct": round(r[gain_col], 1)} for _, r in t.iterrows()]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    df = load_table()
    weather, geo, soil = feature_groups(df)
    print(f"Loaded {len(df)} rows | features: weather={len(weather)} geo={len(geo)} soil={len(soil)}")

    test21, m21 = predict_year(df, 2021, HGB_VAL_PARAMS, weather, geo, soil)
    test22, m22 = predict_year(df, 2022, HGB_TEST_PARAMS, weather, geo, soil)
    for y, m in [(2021, m21), (2022, m22)]:
        print(f"{y}: anomaly {m['anomaly_model']} | direct {m['full_model']} | baseline {m['county_mean_baseline']}")

    counties = {"2021": county_records(test21), "2022": county_records(test22)}
    with open(os.path.join(OUT_DIR, "counties_summary.json"), "w", encoding="utf-8") as f:
        json.dump(counties, f)

    st = state_errors(test21, 2021) + state_errors(test22, 2022)
    st.sort(key=lambda s: (s["year"], -s["rmse_anom"]))
    with open(os.path.join(OUT_DIR, "state_errors.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)

    sim = build_simulator(df)
    print(f"Simulator Ridge alpha={sim['alpha']} | val2021 {sim['validation_2021']} | test2022 {sim['test_2022']}")
    with open(os.path.join(OUT_DIR, "simulator_params.json"), "w", encoding="utf-8") as f:
        json.dump(sim, f, indent=2)

    train20 = df[df["Year"].between(2017, 2020)]
    val21 = df[df["Year"] == 2021]
    prev = df[["FIPS", "Year", "Yield"]].assign(Year=lambda d: d["Year"] + 1).rename(columns={"Yield": "prev"})
    corn_y_p = os.path.join(DATA_DIR, "corn_yield.csv")
    if os.path.exists(corn_y_p):  # corn_yield.csv includes 2016, so 2017 rows also get a previous year
        cy = pd.read_csv(corn_y_p, dtype={"FIPS": str})
        cy["FIPS"] = cy["FIPS"].str.zfill(5)
        prev = cy.assign(Year=cy["Year"] + 1).rename(columns={"Yield": "prev"})
    v = val21.merge(prev[["FIPS", "Year", "prev"]], on=["FIPS", "Year"], how="left")
    v_cm = county_mean_baseline(train20, v)

    def read_csv_records(name):
        p = os.path.join(DATA_DIR, name)
        return pd.read_csv(p, dtype={"FIPS": str}).to_dict("records") if os.path.exists(p) else None

    metrics = {
        "bootstrap_ci": read_csv_records("bootstrap_ci.csv"),                      # notebook 04
        "error_by_history_2022": read_csv_records("error_by_history_2022.csv"),    # notebook 04
        "direct_ablation_val2021": read_result_csv("ablation_val2021.csv", "RMSE_gain_vs_county_mean_%"),
        "settingA_anomaly_val2021": read_result_csv("settingA_anomaly_val2021.csv", "RMSE_gain_vs_baseline_%"),
        "settingB_leave_states_out": read_result_csv("settingB_leave_states_out.csv", "RMSE_gain_vs_baseline_%"),
        "baselines_val2021": {
            "county_mean": rounded(scores(v["Yield"], v_cm)),
            "prev_year": rounded(scores(v["Yield"], v["prev"].fillna(v_cm))),
        },
        "val_2021": m21,
        "final_test_2022": {"model": "HistGradientBoosting (tuned on 2021)", "features": "weather+geo+soil",
                            "params": HGB_TEST_PARAMS, **m22},
    }
    with open(os.path.join(OUT_DIR, "ablation_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(f"Wrote counties_summary.json, state_errors.json, simulator_params.json, ablation_metrics.json to {OUT_DIR}")

    # GitHub Pages serves only docs/, so copy the report figures there for the website
    import shutil
    fig_src = os.path.join(BASE_DIR, "figures")
    fig_dst = os.path.join(os.path.dirname(OUT_DIR), "figures")
    if os.path.isdir(fig_src):
        os.makedirs(fig_dst, exist_ok=True)
        n = 0
        for f in sorted(os.listdir(fig_src)):
            if f.endswith(".png"):
                shutil.copy2(os.path.join(fig_src, f), os.path.join(fig_dst, f)); n += 1
        print(f"Copied {n} figures to {fig_dst}")


if __name__ == "__main__":
    main()
