# OCR Provider Comparison Report

## Test Set

- Cases: 8 public internet price-tag images selected in `test_artifacts/selected_cases.json`
- Target: one product name and one final selling unit price per image
- Baseline parser: current `app.js` coordinate/text parser
- Evaluation:
  - Name score: normalized text similarity
  - Price score: exact numeric final-price match
  - Combined: 50% name + 50% price

## Summary

| Provider | Report | Avg Name | Avg Price | Avg Combined | Price Exact |
| --- | --- | ---: | ---: | ---: | ---: |
| Tesseract.js + app parser | `ocr_regression_20260606_135134.md` | 0.159 | 0.250 | 0.205 | 2/8 |
| PaddleOCR + app parser | `paddleocr_eval_20260606_135400.md` | 0.381 | 0.500 | 0.441 | 4/8 |
| OpenAI Vision LLM | `openai_vision_20260606_134020.md` | 0.973 | 1.000 | 0.986 | 8/8 |

## Findings

### Tesseract.js

Tesseract remains weak for Korean retail price tags. Multiple crop OCR and coordinate parsing helped only slightly. It still misreads reflected labels, agricultural labels, and multi-tag shelves. Current Tesseract results are not good enough for automatic insertion without user review.

### PaddleOCR

PaddleOCR reads Korean product text and price-tag text much better than Tesseract. It correctly solved:

- `candidate_05`: `신라면멀티팩120g*5 / 2,490`
- `candidate_14`: `CJ/햇반 / 4,480`
- `candidate_22`: `종가집 포기김치10kg+맛김치 1kg 증정 / 56,800`
- `candidate_02`: price `6,900`, but product name selection still failed

The main remaining issue is not OCR itself but the app parser. PaddleOCR raw text often contains the correct answer, but the parser still chooses nearby unit prices, dates, original prices, or unrelated lines.

### OpenAI Vision LLM

OpenAI Vision LLM performed best by a large margin. It extracted all 8 final prices correctly and produced natural product names. It also correctly ignored unit prices, barcode numbers, original prices, and nearby unrelated tags.

Two minor name issues remain:

- `candidate_17`: extracted `적신돔 체리 세요[국산]` instead of expected `적신들 체리 세요[국산]`, and marked review needed.
- `candidate_22`: included `(증정)`, which is acceptable but slightly broader than the ground truth.

## Implementation Impact

The current frontend-only app cannot safely call OpenAI directly because the API key must not be exposed in browser JavaScript. A production Vision LLM path needs a small backend or serverless function:

1. Browser uploads/resizes the image.
2. Backend calls the Vision LLM with structured JSON output.
3. Backend returns `{ name, price, confidence, needsReview, rationale }`.
4. Frontend fills the row and stores user corrections as templates.

PaddleOCR is also not browser-native. It is best used in a local/server Python worker. If the app must stay fully offline/browser-only, Tesseract remains the only easy option, but quality will stay limited.

## Current Recommendation

1. Use OpenAI Vision LLM as the primary extraction path when network/API access is available.
2. Use PaddleOCR as the local/server fallback when API use is not desired.
3. Keep Tesseract.js as a browser-only emergency fallback, but mark low-confidence results as requiring review.
4. Continue improving the parser using PaddleOCR raw results, especially:
   - unit-price exclusion (`100g당`, `g당`)
   - original/normal price exclusion
   - agricultural label final price under `가격(원)`
   - multi-tag segmentation before price ranking

## Environment Notes

- PaddleOCR 3.6.0 installed successfully.
- PaddlePaddle 3.3.1 failed on Windows CPU with a PIR/oneDNN runtime error.
- PaddlePaddle 3.2.2 ran successfully.
- The Python environment still reports a `PyYAML` compatibility warning because PaddleX pins `PyYAML==6.0.2` while another installed package expects `>=6.0.3`. A dedicated virtual environment is recommended before further PaddleOCR work.
