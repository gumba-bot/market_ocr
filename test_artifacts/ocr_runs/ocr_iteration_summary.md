# OCR Iteration Summary

## Scope

- Test images were collected from public internet image search results and saved under `test_artifacts/price_tag_images`.
- Ground-truth cases are listed in `test_artifacts/selected_cases.json`.
- The evaluation target is one price tag per image, selected by the `targetRule` field.
- Metrics:
  - Name score: normalized edit similarity against the expected product name.
  - Price score: exact final unit price match.
  - Combined score: 50% name, 50% price.

## Iteration Results

| Iteration | Report | Avg Name | Avg Price | Avg Combined | Price Exact |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | `ocr_regression_20260606_112231.md` | 0.073 | 0.125 | 0.099 | 1/8 |
| 2 | `ocr_regression_20260606_112612.md` | 0.167 | 0.125 | 0.146 | 1/8 |
| 3 | `ocr_regression_20260606_130351.md` | 0.167 | 0.125 | 0.146 | 1/8 |
| 4 | `ocr_regression_20260606_130749.md` | 0.167 | 0.250 | 0.208 | 2/8 |
| 5 | `ocr_regression_20260606_131204.md` | 0.161 | 0.250 | 0.205 | 2/8 |
| 6 | `ocr_regression_20260606_131802.md` | 0.161 | 0.250 | 0.205 | 2/8 |

## What Improved

- The test harness now evaluates multiple OCR crop variants instead of only the full image.
- Price plausibility scoring now penalizes non-price-like values such as `7,771`, `1,008`, and three-digit partial numbers.
- The actual app now also performs multiple crop OCR passes and chooses the strongest result.
- OCR regression runs now cache compact OCR results, so parser/selection changes can be evaluated quickly.

## Current Limits

- Tesseract often fails to read large Korean product names naturally in reflective or skewed price-tag photos.
- Several correct price candidates appear in variant results but are not consistently selected.
- Agricultural label formats confuse unit price (`100g당`) and final price (`가격(원)`).
- Multi-tag images still need true tag segmentation, not only fixed crop variants.

## Evaluator Agent Reports

- `ocr_regression_20260606_112231_eval.md`
- `ocr_regression_iter2_to_5_eval.md`

## Recommendation

Short-term rule-based work is still useful for ranking fixes where the correct price is already present in OCR variants. For robust product-name naturalness and low-quality photos, compare PaddleOCR or a vision LLM extractor against this same dataset before investing much more in Tesseract-only rules.
