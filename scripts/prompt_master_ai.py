#!/usr/bin/env python3
import argparse, base64, json, mimetypes, os, re, sys, urllib.error, urllib.request
from pathlib import Path

STYLE_CONFIG = {
    "CINEMATIC": ("Điện ảnh (Live Action)", "photorealistic, cinematic lighting, 8k, highly detailed, shot on 35mm lens, shallow depth of field, blockbuster movie style"),
    "ANIME": ("Anime (Hoạt hình Nhật)", "anime style, studio ghibli, makoto shinkai style, vibrant colors, detailed background, high quality 2d animation"),
    "PAINTING": ("Tranh vẽ (Digital Art)", "digital painting, oil painting texture, artistic style, concept art, artstation, masterpiece, intricate details"),
    "RENDER_3D": ("3D Render", "3d render, unreal engine 5, octane render, global illumination, highly detailed, 8k resolution, ray tracing"),
    "COMIC_BOOK": ("Truyện tranh (Comic Book)", "comic book style, graphic novel, bold outlines, halftone patterns, high contrast, dynamic lighting, marvel comics style"),
    "PIXEL_ART": ("Pixel Art", "pixel art, 16-bit, retro gaming style, highly detailed pixel art, isometric perspective, vibrant colors"),
    "WATERCOLOR": ("Màu nước (Watercolor)", "watercolor painting, soft edges, color bleeding, traditional art, ethereal, dreamy, delicate brushstrokes"),
    "CYBERPUNK": ("Cyberpunk", "cyberpunk style, neon lights, futuristic city, high tech, sci-fi, dark atmosphere, holographic elements"),
    "STEAMPUNK": ("Steampunk", "steampunk style, brass gears, steam powered, victorian era, intricate machinery, sepia tones, retro-futuristic"),
    "NONE": ("Tự do", ""),
}
MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]


def _is_retryable_model_error(e) -> bool:
    msg = str(e).lower()
    return any(x in msg for x in ["not found", "not supported", "404", "model", "publisher model"])


def _gemini_text(api_key: str, model: str, parts: list, system_instruction: str, json_mode=False, temperature=0.7) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {"temperature": temperature},
    }
    if json_mode:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            obj = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"Gemini HTTP {e.code}: {body[:500]}")
    candidates = obj.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini không trả candidates: {json.dumps(obj, ensure_ascii=False)[:500]}")
    out = []
    for part in ((candidates[0].get("content") or {}).get("parts") or []):
        if part.get("text"):
            out.append(part["text"])
    return "\n".join(out).strip()


def _call_models(api_key: str, parts: list, system_instruction: str, json_mode=False, temperature=0.7) -> str:
    last_err = None
    for model in MODEL_CANDIDATES:
        try:
            return _gemini_text(api_key, model, parts, system_instruction, json_mode=json_mode, temperature=temperature)
        except Exception as e:
            last_err = e
            if not _is_retryable_model_error(e):
                raise
    raise last_err or RuntimeError("AI model failed")


def refine_prompt(api_key: str, raw_input: str, style: str, media_type: str) -> str:
    label, suffix = STYLE_CONFIG.get(style, STYLE_CONFIG["CINEMATIC"])
    system_instruction = f"""
Bạn là một chuyên gia kỹ sư prompt (Prompt Engineer) hàng đầu thế giới cho các mô hình AI tạo sinh như Gemini Image (Banana Pro) và Veo (Video).
Nhiệm vụ của bạn là nhận ý tưởng thô từ người dùng và viết lại thành một prompt tiếng Anh cực kỳ chi tiết, chất lượng cao để tạo ra kết quả tốt nhất.

YÊU CẦU QUAN TRỌNG NHẤT:
1. BÁM SÁT NỘI DUNG GỐC: Không được thay đổi cốt truyện, chủ thể hoặc hành động chính của người dùng. Chỉ được phép thêm các từ miêu tả chi tiết (adjectives) và các tham số kỹ thuật (technical parameters).
2. GIỮ NGUYÊN NGÔN NGỮ KỊCH BẢN: Nếu input chứa kịch bản hoặc đoạn hội thoại tiếng Việt, hãy viết phần miêu tả hình ảnh bằng tiếng Anh nhưng giữ các thành phần cốt lõi của kịch bản không bị biến dạng.
3. KHÔNG TỰ Ý TÓM TẮT: Nếu người dùng nhập một đoạn dài, hãy dịch và chi tiết hóa toàn bộ đoạn đó, không được tóm tắt thành một câu ngắn.
4. Chỉ trả về nội dung prompt tiếng Anh đã tối ưu. Không giải thích, không thêm râu ria.
5. Tích hợp phong cách: {label}. ({suffix})
6. Loại media mục tiêu: {'Video (Veo 3.1) - Cần mô tả chuyển động, góc máy, nhịp độ' if media_type == 'VIDEO' else 'Hình ảnh (Gemini Pro Image) - Cần mô tả bố cục, ánh sáng, chi tiết tĩnh'}.
"""
    return _call_models(api_key, [{"text": raw_input}], system_instruction, temperature=0.7) or raw_input


def parse_duration_to_seconds(d: str) -> int:
    s = (d or "").lower()
    secs = 0
    m = re.search(r"(\d+)\s*(m|phút|minute)", s)
    if m: secs += int(m.group(1)) * 60
    m = re.search(r"(\d+)\s*(s|giây|second)", s)
    if m: secs += int(m.group(1))
    if secs == 0:
        m = re.search(r"^(\d+)$", s.strip())
        if m: secs = int(m.group(1)) * 60
    return secs or 60


def _json_loads_loose(txt: str) -> dict:
    txt = (txt or "{}").strip()
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"```(?:json)?\s*(.*?)```", txt, re.S | re.I)
        if m:
            return json.loads(m.group(1).strip())
        start = txt.find("{")
        end = txt.rfind("}")
        if start >= 0 and end > start:
            return json.loads(txt[start:end+1])
        raise


def _image_parts(character_images: str):
    parts = []
    for raw in (character_images or "").split(os.pathsep):
        p = Path(raw.strip())
        if not p.exists() or not p.is_file():
            continue
        mt = mimetypes.guess_type(str(p))[0] or "image/jpeg"
        if not mt.startswith("image/"):
            continue
        data = base64.b64encode(p.read_bytes()).decode("ascii")
        parts.append({"text": f"Reference character image: {p.name}"})
        parts.append({"inline_data": {"mime_type": mt, "data": data}})
    return parts


def generate_video_script(api_key: str, topic: str, duration: str, style: str, character_images: str = "") -> dict:
    label, suffix = STYLE_CONFIG.get(style, STYLE_CONFIG["CINEMATIC"])
    total_seconds = parse_duration_to_seconds(duration)
    total_scenes = max(1, (total_seconds + 7) // 8)
    system_instruction = f"""
Bạn là một chuyên gia biên kịch và đạo diễn hình ảnh chuyên nghiệp.
Tạo kịch bản video chi tiết dựa trên chủ đề yêu cầu.

YÊU CẦU BẮT BUỘC ĐỂ KHÔNG BỊ LỖI NỘI DUNG:
1. TRUNG THÀNH VỚI CHỦ ĐỀ: Không được tự ý sáng tạo nội dung lệch khỏi yêu cầu của người dùng. Nếu người dùng nhập kịch bản sẵn, hãy phân bổ nó vào các cảnh thay vì viết mới.
2. TỔ CHỨC CẢNH: Tạo chính xác {total_scenes} cảnh quay. Mỗi cảnh 8s.
3. CHI TIẾT HÓA PROMPT: Viết prompt tiếng Anh cho Veo 3.1 phải cực kỳ chi tiết, mô tả rõ nhân vật, hành động, góc máy và ánh sáng theo phong cách {label} ({suffix}).
4. ĐỒNG NHẤT NHÂN VẬT: Nếu có ảnh tham chiếu, miêu tả nhân vật trong mọi cảnh phải khớp 100% với ảnh đó.
5. NGÔN NGỮ: "description" viết bằng tiếng Việt bám sát nội dung gốc. "prompt" viết bằng tiếng Anh kỹ thuật cao.
6. Trả về JSON: {{"title":"...","characterSheet":"...","scenes":[{{"sceneNumber":1,"duration":"8s","description":"Tiếng Việt bám sát nội dung người dùng nhập","prompt":"English technical prompt"}}]}}
"""
    parts = _image_parts(character_images)
    parts.append({"text": f"Chủ đề: {topic}. Tổng cảnh: {total_scenes}. Hãy giữ nhân vật đồng nhất theo ảnh tham chiếu nếu có."})
    txt = _call_models(api_key, parts, system_instruction, json_mode=True, temperature=0.7)
    obj = _json_loads_loose(txt)
    if not obj.get("scenes"):
        raise RuntimeError("AI không trả về danh sách cảnh")
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["refine", "script"], required=True)
    ap.add_argument("--api-key", required=True)
    ap.add_argument("--style", default="CINEMATIC")
    ap.add_argument("--media-type", default="IMAGE")
    ap.add_argument("--input-file", type=Path)
    ap.add_argument("--topic", default="")
    ap.add_argument("--duration", default="60 seconds")
    ap.add_argument("--output-file", type=Path, required=True)
    ap.add_argument("--character-images", default="")
    args = ap.parse_args()
    if args.mode == "refine":
        lines = [x.strip() for x in args.input_file.read_text(encoding="utf-8").splitlines() if x.strip()]
        results = []
        for i, line in enumerate(lines, 1):
            try:
                results.append({"index": i, "originalIdea": line, "prompt": refine_prompt(args.api_key, line, args.style, args.media_type), "ok": True})
            except Exception as e:
                results.append({"index": i, "originalIdea": line, "prompt": "", "ok": False, "error": str(e)})
        args.output_file.write_text(json.dumps({"ok": True, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        obj = generate_video_script(args.api_key, args.topic, args.duration, args.style, args.character_images)
        args.output_file.write_text(json.dumps({"ok": True, "script": obj}, ensure_ascii=False, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
