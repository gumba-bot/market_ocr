import json
import os
from pathlib import Path

from paddleocr import PaddleOCR


ROOT = Path.cwd()
CASES_PATH = ROOT / "test_artifacts" / "selected_cases.json"
OUT_DIR = ROOT / "test_artifacts" / "ocr_runs"
RAW_PATH = OUT_DIR / "paddleocr_raw.json"


def point_bbox(poly):
    xs = [float(point[0]) for point in poly]
    ys = [float(point[1]) for point in poly]
    return {
        "x0": min(xs),
        "y0": min(ys),
        "x1": max(xs),
        "y1": max(ys),
    }


def normalize_prediction(prediction):
    data = getattr(prediction, "json", None)
    if callable(data):
        data = data()
    elif data is None:
        data = prediction

    if isinstance(data, dict) and "res" in data:
        data = data["res"]

    texts = data.get("rec_texts", []) if isinstance(data, dict) else []
    scores = data.get("rec_scores", []) if isinstance(data, dict) else []
    polys = data.get("rec_polys", data.get("dt_polys", [])) if isinstance(data, dict) else []

    words = []
    lines = []
    for idx, text in enumerate(texts):
      if not text:
          continue
      poly = polys[idx] if idx < len(polys) else None
      bbox = point_bbox(poly) if poly is not None else None
      confidence = float(scores[idx]) if idx < len(scores) else 0.0
      item = {
          "text": str(text),
          "confidence": confidence * 100 if confidence <= 1 else confidence,
          "bbox": bbox,
      }
      if bbox:
          words.append(item)
          lines.append(item)

    return {
        "text": "\n".join(item["text"] for item in lines),
        "words": words,
        "lines": lines,
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))

    # Korean recognition is the target workload. Disable optional document models
    # to keep local CPU evaluation focused on OCR detection/recognition.
    ocr = PaddleOCR(
        lang="korean",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )

    results = []
    for case in cases:
        print(f"[PaddleOCR] {case['id']}", flush=True)
        image_path = str(ROOT / case["path"])
        predictions = ocr.predict(input=image_path)
        normalized = [normalize_prediction(prediction) for prediction in predictions]
        merged_words = []
        merged_texts = []
        for item in normalized:
            merged_words.extend(item["words"])
            if item["text"]:
                merged_texts.append(item["text"])

        results.append({
            **case,
            "ocrData": {
                "text": "\n".join(merged_texts),
                "words": merged_words,
            },
        })

    RAW_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[DONE] {RAW_PATH}", flush=True)


if __name__ == "__main__":
    main()
