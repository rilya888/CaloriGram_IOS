#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_BASE_URL:-}" ]]; then
  echo "API_BASE_URL is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

DATASET_PATH="${DATASET_PATH:-scripts/data/analysis-v2-golden.json}"
if [[ ! -f "${DATASET_PATH}" ]]; then
  echo "Dataset not found: ${DATASET_PATH}"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MAX_CALORIES_MAE="${MAX_CALORIES_MAE:-35}"
MAX_MACRO_MAE="${MAX_MACRO_MAE:-6}"
MAX_CALORIES_MAPE="${MAX_CALORIES_MAPE:-20}"
MAX_MACRO_MAPE="${MAX_MACRO_MAPE:-30}"
MIN_SCHEMA_VALID_RATE="${MIN_SCHEMA_VALID_RATE:-0.95}"
MAX_LOCALE_MISMATCH_RATE="${MAX_LOCALE_MISMATCH_RATE:-0.01}"

if [[ -z "${AUTH_TOKEN:-}" ]]; then
  if [[ -z "${AUTH_EMAIL:-}" ]]; then
    echo "AUTH_EMAIL is required when AUTH_TOKEN is not provided"
    exit 1
  fi

  if [[ -z "${AUTH_PASSWORD:-}" ]]; then
    echo "AUTH_PASSWORD is required when AUTH_TOKEN is not provided"
    exit 1
  fi

  LOGIN_PAYLOAD="$(jq -n --arg email "$AUTH_EMAIL" --arg password "$AUTH_PASSWORD" '{email:$email,password:$password}')"
  LOGIN_RESPONSE="$(curl -sS -X POST "${API_BASE_URL}/auth/login" -H "Content-Type: application/json" -d "${LOGIN_PAYLOAD}")"
  AUTH_TOKEN="$(echo "${LOGIN_RESPONSE}" | jq -r '.access_token // empty')"

  if [[ -z "${AUTH_TOKEN}" ]]; then
    echo "Failed to login for golden evaluation"
    echo "${LOGIN_RESPONSE}" | jq .
    exit 1
  fi
fi

total_cases=0
schema_valid_count=0
locale_mismatch_count=0

sum_abs_cal=0
sum_abs_protein=0
sum_abs_fat=0
sum_abs_carbs=0

sum_ape_cal=0
sum_ape_protein=0
sum_ape_fat=0
sum_ape_carbs=0

while IFS= read -r case_row; do
  total_cases=$((total_cases + 1))

  id="$(echo "${case_row}" | jq -r '.id')"
  input_type="$(echo "${case_row}" | jq -r '.input_type')"
  locale="$(echo "${case_row}" | jq -r '.locale')"
  text="$(echo "${case_row}" | jq -r '.text')"
  comment="$(echo "${case_row}" | jq -r '.comment // empty')"
  image_path="$(echo "${case_row}" | jq -r '.image_path // empty')"

  expected_cal="$(echo "${case_row}" | jq -r '.expected.calories')"
  expected_protein="$(echo "${case_row}" | jq -r '.expected.protein')"
  expected_fat="$(echo "${case_row}" | jq -r '.expected.fat')"
  expected_carbs="$(echo "${case_row}" | jq -r '.expected.carbs')"

  if [[ "${input_type}" == "photo" ]]; then
    if [[ -z "${image_path}" ]]; then
      echo "[golden:${id}] missing_image_path"
      continue
    fi
    absolute_image_path="${ROOT_DIR}/${image_path}"
    if [[ ! -f "${absolute_image_path}" ]]; then
      echo "[golden:${id}] image_not_found=${absolute_image_path}"
      continue
    fi
    image_base64="$(base64 -i "${absolute_image_path}" | tr -d '\n')"
    payload="$(jq -n --arg input_type "${input_type}" --arg locale "${locale}" --arg comment "${comment}" --arg image "${image_base64}" '{input_type:$input_type,locale:$locale,comment:$comment,image:$image}')"
  else
    payload="$(jq -n --arg input_type "${input_type}" --arg locale "${locale}" --arg text "${text}" '{input_type:$input_type,locale:$locale,text:$text}')"
  fi

  response="$(curl -sS --retry 3 --retry-all-errors --retry-delay 1 -X POST "${API_BASE_URL}/analysis/v2" -H "Authorization: Bearer ${AUTH_TOKEN}" -H "Content-Type: application/json" -d "${payload}")"

  schema_ok="$(echo "${response}" | jq -r '
    (.ok == true) and
    (.analysis_id | type == "string") and
    (.input_type | type == "string") and
    (.locale | type == "string") and
    (.totals | type == "object") and
    (.totals.calories | type == "number") and
    (.totals.protein | type == "number") and
    (.totals.fat | type == "number") and
    (.totals.carbs | type == "number") and
    (.error_code == null)
  ')"

  if [[ "${schema_ok}" == "true" ]]; then
    schema_valid_count=$((schema_valid_count + 1))
  else
    echo "[golden:${id}] schema_invalid"
    echo "${response}" | jq .
    continue
  fi

  actual_locale="$(echo "${response}" | jq -r '.locale')"
  if [[ "${actual_locale}" != "${locale}" ]]; then
    locale_mismatch_count=$((locale_mismatch_count + 1))
  fi

  actual_cal="$(echo "${response}" | jq -r '.totals.calories')"
  actual_protein="$(echo "${response}" | jq -r '.totals.protein')"
  actual_fat="$(echo "${response}" | jq -r '.totals.fat')"
  actual_carbs="$(echo "${response}" | jq -r '.totals.carbs')"

  abs_cal="$(awk -v a="${actual_cal}" -v e="${expected_cal}" 'BEGIN{d=a-e; if(d<0)d=-d; printf "%.6f", d}')"
  abs_protein="$(awk -v a="${actual_protein}" -v e="${expected_protein}" 'BEGIN{d=a-e; if(d<0)d=-d; printf "%.6f", d}')"
  abs_fat="$(awk -v a="${actual_fat}" -v e="${expected_fat}" 'BEGIN{d=a-e; if(d<0)d=-d; printf "%.6f", d}')"
  abs_carbs="$(awk -v a="${actual_carbs}" -v e="${expected_carbs}" 'BEGIN{d=a-e; if(d<0)d=-d; printf "%.6f", d}')"

  ape_cal="$(awk -v abs="${abs_cal}" -v e="${expected_cal}" 'BEGIN{den=(e==0?1:e); printf "%.6f", (abs/den)*100}')"
  ape_protein="$(awk -v abs="${abs_protein}" -v e="${expected_protein}" 'BEGIN{den=(e==0?1:e); printf "%.6f", (abs/den)*100}')"
  ape_fat="$(awk -v abs="${abs_fat}" -v e="${expected_fat}" 'BEGIN{den=(e==0?1:e); printf "%.6f", (abs/den)*100}')"
  ape_carbs="$(awk -v abs="${abs_carbs}" -v e="${expected_carbs}" 'BEGIN{den=(e==0?1:e); printf "%.6f", (abs/den)*100}')"

  sum_abs_cal="$(awk -v s="${sum_abs_cal}" -v x="${abs_cal}" 'BEGIN{printf "%.6f", s+x}')"
  sum_abs_protein="$(awk -v s="${sum_abs_protein}" -v x="${abs_protein}" 'BEGIN{printf "%.6f", s+x}')"
  sum_abs_fat="$(awk -v s="${sum_abs_fat}" -v x="${abs_fat}" 'BEGIN{printf "%.6f", s+x}')"
  sum_abs_carbs="$(awk -v s="${sum_abs_carbs}" -v x="${abs_carbs}" 'BEGIN{printf "%.6f", s+x}')"

  sum_ape_cal="$(awk -v s="${sum_ape_cal}" -v x="${ape_cal}" 'BEGIN{printf "%.6f", s+x}')"
  sum_ape_protein="$(awk -v s="${sum_ape_protein}" -v x="${ape_protein}" 'BEGIN{printf "%.6f", s+x}')"
  sum_ape_fat="$(awk -v s="${sum_ape_fat}" -v x="${ape_fat}" 'BEGIN{printf "%.6f", s+x}')"
  sum_ape_carbs="$(awk -v s="${sum_ape_carbs}" -v x="${ape_carbs}" 'BEGIN{printf "%.6f", s+x}')"

  echo "[golden:${id}] ok cal_abs=${abs_cal} p_abs=${abs_protein} f_abs=${abs_fat} c_abs=${abs_carbs}"
done < <(jq -c '.[]' "${DATASET_PATH}")

if [[ "${total_cases}" -eq 0 ]]; then
  echo "Dataset is empty"
  exit 1
fi

schema_valid_rate="$(awk -v ok="${schema_valid_count}" -v n="${total_cases}" 'BEGIN{printf "%.6f", ok/n}')"
locale_mismatch_rate="$(awk -v bad="${locale_mismatch_count}" -v n="${total_cases}" 'BEGIN{printf "%.6f", bad/n}')"

mae_cal="$(awk -v s="${sum_abs_cal}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mae_protein="$(awk -v s="${sum_abs_protein}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mae_fat="$(awk -v s="${sum_abs_fat}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mae_carbs="$(awk -v s="${sum_abs_carbs}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mae_macro_avg="$(awk -v p="${mae_protein}" -v f="${mae_fat}" -v c="${mae_carbs}" 'BEGIN{printf "%.6f", (p+f+c)/3}')"

mape_cal="$(awk -v s="${sum_ape_cal}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mape_protein="$(awk -v s="${sum_ape_protein}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mape_fat="$(awk -v s="${sum_ape_fat}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mape_carbs="$(awk -v s="${sum_ape_carbs}" -v n="${total_cases}" 'BEGIN{printf "%.6f", s/n}')"
mape_macro_avg="$(awk -v p="${mape_protein}" -v f="${mape_fat}" -v c="${mape_carbs}" 'BEGIN{printf "%.6f", (p+f+c)/3}')"

echo "=== GOLDEN EVALUATION SUMMARY ==="
echo "cases=${total_cases}"
echo "schema_valid_rate=${schema_valid_rate}"
echo "locale_mismatch_rate=${locale_mismatch_rate}"
echo "mae_calories=${mae_cal}"
echo "mae_protein=${mae_protein}"
echo "mae_fat=${mae_fat}"
echo "mae_carbs=${mae_carbs}"
echo "mae_macro_avg=${mae_macro_avg}"
echo "mape_calories=${mape_cal}"
echo "mape_protein=${mape_protein}"
echo "mape_fat=${mape_fat}"
echo "mape_carbs=${mape_carbs}"
echo "mape_macro_avg=${mape_macro_avg}"

failure=0

if ! awk -v v="${schema_valid_rate}" -v t="${MIN_SCHEMA_VALID_RATE}" 'BEGIN{exit !(v>=t)}'; then
  echo "FAIL: schema_valid_rate ${schema_valid_rate} < ${MIN_SCHEMA_VALID_RATE}"
  failure=1
fi

if ! awk -v v="${locale_mismatch_rate}" -v t="${MAX_LOCALE_MISMATCH_RATE}" 'BEGIN{exit !(v<=t)}'; then
  echo "FAIL: locale_mismatch_rate ${locale_mismatch_rate} > ${MAX_LOCALE_MISMATCH_RATE}"
  failure=1
fi

if ! awk -v v="${mae_cal}" -v t="${MAX_CALORIES_MAE}" 'BEGIN{exit !(v<=t)}'; then
  echo "FAIL: mae_calories ${mae_cal} > ${MAX_CALORIES_MAE}"
  failure=1
fi

if ! awk -v v="${mae_macro_avg}" -v t="${MAX_MACRO_MAE}" 'BEGIN{exit !(v<=t)}'; then
  echo "FAIL: mae_macro_avg ${mae_macro_avg} > ${MAX_MACRO_MAE}"
  failure=1
fi

if ! awk -v v="${mape_cal}" -v t="${MAX_CALORIES_MAPE}" 'BEGIN{exit !(v<=t)}'; then
  echo "FAIL: mape_calories ${mape_cal} > ${MAX_CALORIES_MAPE}"
  failure=1
fi

if ! awk -v v="${mape_macro_avg}" -v t="${MAX_MACRO_MAPE}" 'BEGIN{exit !(v<=t)}'; then
  echo "FAIL: mape_macro_avg ${mape_macro_avg} > ${MAX_MACRO_MAPE}"
  failure=1
fi

if [[ "${failure}" -ne 0 ]]; then
  exit 1
fi

echo "Golden evaluation passed"
