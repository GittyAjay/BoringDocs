"""HandFonted long-running HTTP service.

Loads PaddleOCR + ResInceptionNet models once at startup, then serves
font-build requests over HTTP. Node spawns this as a child process when
the main app starts, so per-request latency drops from ~30s (cold) to
~3-8s (warm) since we no longer pay model-load cost each call.

Endpoints:
  GET  /health      → {"ok": true} once models are loaded
  POST /build       → body: {"image_base64": str, "font_name": str?, "thickness": int?}
                      returns: {"ok": true, "ttf_base64": str, "bytes": int}
"""
import os
import sys
import base64
import uuid
import traceback
import time

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

# Make sure we run from the handfonted directory so the relative resource
# paths inside character_classification etc. continue to resolve, no matter
# where the parent process invoked us from.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

import torch
from paddleocr import TextDetection
from flask import Flask, request, jsonify

from character_classification import classify_characters, ResInceptionNet
from character_segmentation import segment_characters
from font_creation import update_font_from_images

CLASSIFICATION_MODEL_PATH = os.path.join(
    "resources", "best_ResInceptionNet_model0.8811.pth"
)
DETECTION_MODEL_NAME = "PP-OCRv5_mobile_det"
DETECTION_MODEL_PATH = os.path.join("resources", "PP-OCRv5_mobile_det_infer")
BASE_FONT_PATH = os.path.join("resources", "Arimo-Regular.ttf")

print("[handfonted] loading classification model…", flush=True)
_t0 = time.time()
CLASSIFICATION_MODEL = ResInceptionNet(num_classes=52)
CLASSIFICATION_MODEL.load_state_dict(
    torch.load(CLASSIFICATION_MODEL_PATH, map_location=torch.device("cpu"))
)
CLASSIFICATION_MODEL.eval()
print(f"[handfonted] classification model loaded in {time.time() - _t0:.1f}s", flush=True)

print("[handfonted] loading PaddleOCR detection model…", flush=True)
_t0 = time.time()
DETECTION_MODEL = TextDetection(
    model_name=DETECTION_MODEL_NAME,
    model_dir=DETECTION_MODEL_PATH,
    enable_mkldnn=False,
)
print(f"[handfonted] detection model loaded in {time.time() - _t0:.1f}s", flush=True)

app = Flask(__name__)
TMP_DIR = os.path.join(SCRIPT_DIR, "tmp")
os.makedirs(TMP_DIR, exist_ok=True)


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/build")
def build():
    payload = request.get_json(silent=True) or {}
    img_b64 = payload.get("image_base64") or ""
    font_name = (payload.get("font_name") or "My Handwriting")[:60]
    try:
        thickness = max(40, min(300, int(payload.get("thickness") or 100)))
    except (TypeError, ValueError):
        thickness = 100
    style = (payload.get("font_style") or "Regular")[:30]

    if not img_b64:
        return jsonify({"error": "missing image_base64"}), 400
    try:
        img_bytes = base64.b64decode(img_b64, validate=True)
    except Exception as e:
        return jsonify({"error": f"bad base64: {e}"}), 400

    uid = uuid.uuid4().hex[:8]
    in_path = os.path.join(TMP_DIR, f"in-{uid}.jpg")
    out_path = os.path.join(TMP_DIR, f"out-{uid}.ttf")

    started = time.time()
    try:
        with open(in_path, "wb") as f:
            f.write(img_bytes)

        list_of_char_images = segment_characters(in_path, det_model=DETECTION_MODEL)
        if not list_of_char_images:
            return jsonify({
                "error": "No characters segmented from the image. Try a clearer photo."
            }), 422

        char_images = classify_characters(
            list_of_char_images,
            model=CLASSIFICATION_MODEL,
            OUTPUT_PATH="",
        )
        if not char_images:
            return jsonify({
                "error": "Classification produced no characters."
            }), 422

        update_font_from_images(
            font_path=BASE_FONT_PATH,
            char_image_list=char_images,
            output_path=out_path,
            desired_thickness=thickness,
            new_family_name=font_name,
            new_style_name=style,
        )

        with open(out_path, "rb") as f:
            ttf_bytes = f.read()

        return jsonify({
            "ok": True,
            "ttf_base64": base64.b64encode(ttf_bytes).decode("ascii"),
            "bytes": len(ttf_bytes),
            "characters": len(char_images),
            "elapsed_seconds": round(time.time() - started, 1),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        for p in (in_path, out_path):
            try:
                os.remove(p)
            except OSError:
                pass


if __name__ == "__main__":
    port = int(os.environ.get("HANDFONTED_PORT", "5179"))
    print(f"[handfonted] listening on 127.0.0.1:{port}", flush=True)
    # threaded=False keeps PyTorch + PaddleOCR happy under concurrent calls;
    # we expect at most one build in flight at a time anyway.
    app.run(host="127.0.0.1", port=port, debug=False, threaded=False)
