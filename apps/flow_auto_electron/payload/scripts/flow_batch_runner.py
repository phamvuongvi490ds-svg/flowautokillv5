import argparse
import base64
import hashlib
import os
from pathlib import Path
from urllib import error, request
from datetime import datetime, timezone
def build_char_map(char_images):
    char_map = {}
    for img_path in char_images:
        name = Path(img_path).stem.lower().replace("_", " ")
        char_map[name] = img_path
    return char_map

import subprocess
import uuid
import ssl
import socket
import sys
import json
import random
import re
import time

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

PROMPT_INPUT_RULE_VERSION = "v2.0-ref-image-map"
PAUSE_FILE_DEFAULT = Path(os.environ.get("FLOW_PAUSE_FILE", "flow-auto/job-state/pause.flag"))


def log_line(msg: str):
    # avoid UnicodeEncodeError on Windows cp1252 console/log sink
    try:
        print(msg)
    except UnicodeEncodeError:
        try:
            safe = msg.encode("ascii", "ignore").decode("ascii", "ignore")
            print(safe)
        except Exception:
            print("[flow] log encoding fallback")


def natural_file_key(path: Path):
    parts = re.split(r'(\d+)', path.name.lower())
    return [int(x) if x.isdigit() else x for x in parts]


def resolve_ref_image(refs_dir: Path | None, prompt_no: int):
    if refs_dir is None:
        return None
    exts = [".jpg", ".jpeg", ".png", ".webp"]
    for ext in exts:
        p = refs_dir / f"{prompt_no}{ext}"
        if p.exists() and p.is_file():
            return p
    return None


def resolve_first_ref_image(refs_dir: Path | None):
    if refs_dir is None:
        return None
    exts = [".jpg", ".jpeg", ".png", ".webp"]
    files = []
    for ext in exts:
        files.extend(sorted(refs_dir.glob(f"*{ext}"), key=natural_file_key))
    return sorted(files, key=natural_file_key)[0] if files else None


def set_upload_file_input(page, image_path: Path):
    # set file vào input[type=file] đúng dialog hiện tại, ưu tiên input mới nhất
    wanted = image_path.name.lower()
    try:
        inputs = page.locator("input[type='file']")
        c = inputs.count()
        if c <= 0:
            return False

        # thử từ input cuối về đầu (thường input mới mở nằm cuối DOM)
        for i in range(c - 1, -1, -1):
            try:
                ip = inputs.nth(i)
                ip.set_input_files(str(image_path))
                time.sleep(0.2)

                # verify input đang giữ đúng filename cần upload
                ok = False
                try:
                    v = (ip.input_value(timeout=1200) or "").lower()
                    if wanted in v:
                        ok = True
                except Exception:
                    pass

                if not ok:
                    try:
                        names = ip.evaluate("el => Array.from(el.files || []).map(f => f.name)")
                        if isinstance(names, list) and any(str(n).lower() == wanted for n in names):
                            ok = True
                    except Exception:
                        pass

                if ok:
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def prompt_file_prefix(prompt: str, prompt_no: int):
    # File tải về đặt tên đúng theo số thứ tự prompt: 1.jpg / 1.mp4, 2.jpg / 2.mp4...
    return str(int(prompt_no))


def load_prompts(path: Path):
    text = path.read_text(encoding="utf-8")
    return [p.strip().replace("\n", " ") for p in text.split("\n\n") if p.strip()]


def load_state(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def find_flow_page(browser, timeout=25):
    """Wait for the single Flow tab launched by Electron; never navigate/reload it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for context in browser.contexts:
            for page in context.pages:
                if "flow.google.com" in (page.url or ""):
                    return page
        time.sleep(0.25)
    return None

_PROJECT_LAUNCH_ATTEMPTED = False

def _prompt_ready(page, timeout=1200):
    try:
        return page.locator("flow-prompt-box.prompt-box-container, flow-prompt-box").first.is_visible(timeout=timeout)
    except Exception:
        return False

def ensure_project_page(page):
    global _PROJECT_LAUNCH_ATTEMPTED
    if _prompt_ready(page):
        return page
    url = page.url or ""
    if "flow.google.com" not in url:
        raise RuntimeError("flow_page_not_ready_without_reload")
    if re.search(r"https://flow\.google\.com/project/", url, re.I):
        try:
            page.locator("flow-prompt-box.prompt-box-container, flow-prompt-box").first.wait_for(state="visible", timeout=20000)
        except Exception:
            pass
        return page
    if _PROJECT_LAUNCH_ATTEMPTED:
        try:
            page.locator("flow-prompt-box.prompt-box-container, flow-prompt-box").first.wait_for(state="visible", timeout=20000)
        except Exception:
            pass
        return page
    launch = page.locator(
        "button[aria-label='Dự án mới'],button[aria-label='New project'],"
        "a[aria-label='Dự án mới'],a[aria-label='New project'],"
        "button:has-text('Dự án mới'),button:has-text('New project'),"
        "a:has-text('Dự án mới'),a:has-text('New project')"
    ).first
    if launch.count() <= 0 or not launch.is_visible():
        raise RuntimeError("flow_new_project_button_not_found")
    _PROJECT_LAUNCH_ATTEMPTED = True
    try:
        launch.click(timeout=5000)
    except Exception:
        launch.click(timeout=5000, force=True)
    try:
        page.locator("flow-prompt-box.prompt-box-container, flow-prompt-box").first.wait_for(state="visible", timeout=20000)
    except Exception:
        raise RuntimeError("flow_project_prompt_not_ready_after_single_click")
    return page

def capture_startup_screenshot(page):
    try:
        out_dir = Path.home() / ".openclaw" / "workspace" / "flow-auto" / "debug"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"startup-flow-{int(time.time())}.png"
        page.screenshot(path=str(out), full_page=True)
        log_line(f"[flow] startup screenshot: {out}")
    except Exception as e:
        log_line(f"[flow] startup screenshot warning: {e}")


def _try_click_new_project(page):
    """Best-effort New Project click across Flow UI variants."""
    try:
        patterns = [
            r"new\s*project", r"new\s*chat", r"new\s*creation", r"create\s*new",
            r"dự\s*án\s*mới", r"tạo\s*dự\s*án", r"tạo\s*mới", r"làm\s*mới",
        ]
        rx = re.compile("|".join(patterns), re.I)
        locs = [
            page.get_by_text(rx),
            page.locator("button,[role='button'],a,[role='link'],div[role='button']").filter(has_text=rx),
            page.locator("[aria-label*='New' i], [title*='New' i], [aria-label*='mới' i], [title*='mới' i]"),
        ]
        for loc in locs:
            try:
                if loc.count() > 0:
                    el = loc.first
                    try:
                        el.click(timeout=4000)
                    except Exception:
                        el.click(timeout=4000, force=True)
                    time.sleep(1.5)
                    log_line("[flow] clicked New Project")
                    return True
            except Exception:
                continue
    except Exception as e:
        log_line(f"[flow] New Project click skipped: {e}")
    return False


def find_input_box(page):
    """Return only the rendered ProseMirror inside Flow's prompt composer."""
    deadline = time.time() + 30
    retried_new_project = False
    selector = 'flow-prompt-box.prompt-box-container div.ProseMirror[contenteditable="true"]'

    while time.time() < deadline:
        try:
            boxes = page.locator(selector)
            for i in range(boxes.count()):
                box = boxes.nth(i)
                if box.is_visible() and box.is_enabled():
                    return box
        except Exception:
            pass

        if not retried_new_project:
            ensure_project_page(page)
            retried_new_project = True
        time.sleep(0.5)

    raise RuntimeError("flow_prompt_editor_not_found")

def focus_prompt_box(page, box):
    """Click the exact editor once and preserve Flow's native blue caret."""
    close_open_menus(page)
    try:
        page.locator('.cdk-overlay-pane').wait_for(state='hidden', timeout=5000)
    except Exception:
        pass

    try:
        # Avoid scroll and wrapper clicks: both caused the composer to jump.
        box.click(timeout=5000, position={'x': 20, 'y': 18})
        try:
            page.wait_for_function(
                "el => document.activeElement === el && el.classList.contains('ProseMirror-focused')",
                arg=box.element_handle(), timeout=1800,
            )
        except Exception:
            pass
        state = box.evaluate(
            """el => ({active:document.activeElement===el,
              focused:el.classList.contains('ProseMirror-focused'),
              editable:el.isContentEditable})"""
        )
        log_line(f"[flow] native prompt focus state: {state}")
        if state and state.get('active') and state.get('focused') and state.get('editable'):
            return True
    except Exception as e:
        log_line(f"[flow] native prompt click failed: {e}")

    # One non-visual fallback only. Do not click/scroll repeatedly.
    try:
        state = box.evaluate(
            """el => {
              el.focus({preventScroll:true});
              const range=document.createRange(); range.selectNodeContents(el); range.collapse(false);
              const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
              return {active:document.activeElement===el,range:sel.rangeCount,editable:el.isContentEditable};
            }"""
        )
        log_line(f"[flow] prompt focus fallback state: {state}")
        return bool(state and state.get('active') and state.get('range') == 1 and state.get('editable'))
    except Exception as e:
        log_line(f"[flow] prompt focus fallback failed: {e}")
        return False

MODEL_LABELS = {
    "default": "Veo 3.1 - Fast",
    "veo3_lite_low_priority": "Veo 3.1 - Lite [Lower Priority]",
    "veo3_lite": "Veo 3.1 - Lite",
    "veo3_fast": "Veo 3.1 - Fast",
    "veo3_quality": "Veo 3.1 - Quality",
    "nano_banana_pro": "Nano Banana Pro",
    "nano_banana2": "Nano Banana 2",
    "nano_banana2_lite": "Nano Banana 2 Lite",
    "nano_banana": "Nano Banana 2",
    "imagen4": "Imagen 4",
    "omni_flash": "Omni 1.1 Flash",
}


def apply_task_mode(page, task_mode: str):
    task_mode = (task_mode or "createvideo").strip().lower()
    want = "image" if task_mode == "createimage" else "video"
    want_icon = "image" if want == "image" else "videocam"
    want_labels = ["image", "ảnh", "hình ảnh", "tạo ảnh", "create image"] if want == "image" else ["video", "tạo video", "create video"]
    try:
        res = page.evaluate("""
        async ({want, wantIcon, wantLabels}) => {
          const sleep=ms=>new Promise(r=>setTimeout(r,ms));
          const norm=s=>String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();
          const visible=el=>{ if(!el)return false; const st=getComputedStyle(el); if(st.display==='none'||st.visibility==='hidden')return false; const r=el.getBoundingClientRect(); return r.width>12&&r.height>12; };
          const click=el=>{ const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2; el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:1})); el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1})); el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:0})); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); };
          let panel=document.querySelector('[role="menu"][data-state="open"]');
          if(!panel){ const ts=Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).filter(visible); const t=ts.find(b=>/veo|banana|imagen|omni|fast|lite|quality|video|image|ảnh|hình/i.test(b.innerText||b.textContent||''))||ts[0]; if(t){click(t); await sleep(700);} panel=document.querySelector('[role="menu"][data-state="open"]')||document; }
          const labels=wantLabels.map(norm);
          const bad=want==='image' ? ['video','tao video','create video','upload','tai len','reference'] : ['image','anh','hinh anh','tao anh','create image','upload','tai len','reference'];
          const nodes=Array.from(panel.querySelectorAll('button[role="tab"],[role="tab"],button')).filter(visible);
          let scored=[];
          for(const b of nodes){ const txt=norm((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')); const icon=norm(b.querySelector('i')?.textContent||''); let score=0; if(b.getAttribute('role')==='tab')score+=1000; if(icon===wantIcon)score+=900; if(labels.some(x=>txt===x||txt.includes(x)))score+=700; if(bad.some(x=>txt.includes(x)))score-=2500; if(score>0) scored.push({b,score,txt,icon,active:b.getAttribute('data-state')==='active'||b.getAttribute('aria-selected')==='true'}); }
          scored.sort((a,b)=>b.score-a.score); const best=scored[0];
          if(!best||best.score<700) return {ok:false,reason:'mode_target_missing',want,candidates:scored.slice(0,8).map(x=>({score:x.score,txt:x.txt,icon:x.icon,active:x.active}))};
          if(!best.active){ click(best.b); await sleep(650); }
          const active=Array.from(panel.querySelectorAll('button[role="tab"],[role="tab"],button')).filter(visible).filter(b=>b.getAttribute('data-state')==='active'||b.getAttribute('aria-selected')==='true').map(b=>({txt:norm((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')),icon:norm(b.querySelector('i')?.textContent||'')}));
          const exact=active.some(a=>a.icon===wantIcon||labels.some(x=>a.txt===x||a.txt.includes(x)));
          return {ok:exact,want,clicked:{txt:best.txt,icon:best.icon,score:best.score},active};
        }
        """, {"want": want, "wantIcon": want_icon, "wantLabels": want_labels})
        log_line(f"[flow] task mode select result: {res}")
        if res and res.get("ok"):
            time.sleep(0.45)
            return True
    except Exception as e:
        log_line(f"[flow] task mode select exception: {e}")
    return False

def apply_video_sub_mode(page, sub_mode: str):
    mode = (sub_mode or "frames").strip().lower()
    want_icon = "chrome_extension" if mode == "ingredients" else "crop_free"
    want_labels = ["video thành phần", "thành phần", "ingredients", "ingredient"] if mode == "ingredients" else ["khung hình", "frames", "frame"]
    try:
        res = page.evaluate("""
        async ({wantIcon,wantLabels}) => {
          const sleep=ms=>new Promise(r=>setTimeout(r,ms));
          const norm=s=>String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();
          const visible=el=>{ if(!el)return false; const st=getComputedStyle(el); if(st.display==='none'||st.visibility==='hidden')return false; const r=el.getBoundingClientRect(); return r.width>10&&r.height>10; };
          const click=el=>{ const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2; el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0})); };
          const panel=document.querySelector('[role="menu"][data-state="open"]')||document;
          const labels=wantLabels.map(norm);
          const nodes=Array.from(panel.querySelectorAll('button[role="tab"],[role="tab"],button')).filter(visible);
          let scored=[];
          for(const b of nodes){ const txt=norm((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')); const icon=norm(b.querySelector('i')?.textContent||''); let score=0; if(b.getAttribute('role')==='tab')score+=800; if(icon===wantIcon)score+=900; if(labels.some(x=>txt===x||txt.includes(x)))score+=700; if(score>0)scored.push({b,score,txt,icon,active:b.getAttribute('data-state')==='active'||b.getAttribute('aria-selected')==='true'}); }
          scored.sort((a,b)=>b.score-a.score); const best=scored[0];
          if(!best||best.score<700) return {ok:false,reason:'submode_target_missing',candidates:scored.slice(0,8).map(x=>({score:x.score,txt:x.txt,icon:x.icon,active:x.active}))};
          if(!best.active){ click(best.b); await sleep(450); }
          const active=Array.from(panel.querySelectorAll('button[role="tab"],[role="tab"],button')).filter(visible).filter(b=>b.getAttribute('data-state')==='active'||b.getAttribute('aria-selected')==='true').map(b=>({txt:norm((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')),icon:norm(b.querySelector('i')?.textContent||'')}));
          const exact=active.some(a=>a.icon===wantIcon||labels.some(x=>a.txt===x||a.txt.includes(x)));
          return {ok:exact,clicked:{txt:best.txt,icon:best.icon,score:best.score},active};
        }
        """, {"wantIcon": want_icon, "wantLabels": want_labels})
        log_line(f"[flow] video sub-mode select result: {res}")
        if res and res.get("ok"):
            time.sleep(0.25)
            return True
    except Exception as e:
        log_line(f"[flow] video sub-mode exception: {e}")
    return False

def apply_output_count(page, count: str):
    c = str(count or "1").strip()
    if not c.isdigit():
        return False
    target = f"x{c}"

    try:
        btn = page.locator("button[role='tab'],button").filter(has_text=re.compile(rf"^{re.escape(target)}$", re.I))
        if btn.count() > 0:
            try:
                btn.first.click(timeout=2500)
            except Exception:
                btn.first.click(timeout=2500, force=True)
            time.sleep(0.2)
            return True
    except Exception:
        pass
    return False


def apply_model(page, model_key: str):
    key = (model_key or "default").strip().lower()
    if key == "custom":
        return True
    label = MODEL_LABELS.get(key, MODEL_LABELS["default"])

    try:
        # mở dropdown model bên trong settings panel giống extension
        opened = page.evaluate("""
        () => {
          const visible = (el) => {
            if (!el) return false;
            const st = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 8 && r.height > 8;
          };
          const menu = document.querySelector('div[role="menu"][data-state="open"], [role="menu"][data-state="open"]');
          const scope = menu || document;
          const triggers = Array.from(scope.querySelectorAll("button[aria-haspopup='menu']")).filter(visible);
          const trigger = triggers.find(b => b.querySelector('div[data-type="button-overlay"]')) || triggers[triggers.length - 1];
          if (!trigger) return false;
          trigger.click();
          return true;
        }
        """)
        if opened:
            time.sleep(0.35)

        if key == "veo3_lite_low_priority":
            clicked = page.evaluate(
                """
                (label) => {
                  const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
                  const visible=el=>{const st=getComputedStyle(el),r=el.getBoundingClientRect();return st.display!=='none'&&st.visibility!=='hidden'&&r.width>8&&r.height>8;};
                  const exact=Array.from(document.querySelectorAll("[role='menuitem'],button,[role='option']")).filter(visible).find(el=>norm(el.innerText||el.textContent)===norm(label));
                  if(!exact)return false; exact.click(); return true;
                }
                """,
                label,
            )
            if not clicked:
                return False
            time.sleep(0.8)
            # Exact post-click verification. Never accept ordinary Lite.
            verified = page.evaluate(
                """
                (label) => { const n=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase(); return Array.from(document.querySelectorAll("button[aria-haspopup='menu']")).some(b=>n(b.innerText||b.textContent)===n(label)); }
                """,
                label,
            )
            return bool(verified)
        opt = page.locator("[role='menuitem'],button,[role='option']").filter(has_text=re.compile(re.escape(label), re.I))
        if opt.count() > 0:
            try:
                opt.first.click(timeout=2500)
            except Exception:
                opt.first.click(timeout=2500, force=True)
            time.sleep(0.25)
            return True
    except Exception:
        pass

    return False


def apply_aspect_ratio(page, ratio: str):
    ratio = (ratio or "").strip()
    # Chỉ hỗ trợ 2 mode chính
    if ratio not in {"16:9", "9:16"}:
        return

    # 1) Ưu tiên tab tỉ lệ trong panel (UI Flow mới)
    try:
        if ratio == "9:16":
            portrait = page.locator("button[id*='trigger-PORTRAIT'],button").filter(
                has_text=re.compile(r"9:16|crop_9_16", re.I)
            )
            if portrait.count() > 0:
                try:
                    portrait.first.click(timeout=3000)
                except Exception:
                    portrait.first.click(timeout=3000, force=True)
                time.sleep(0.35)
                return
        elif ratio == "16:9":
            landscape = page.locator("button[id*='trigger-LANDSCAPE'],button").filter(
                has_text=re.compile(r"16:9|crop_16_9", re.I)
            )
            if landscape.count() > 0:
                try:
                    landscape.first.click(timeout=3000)
                except Exception:
                    landscape.first.click(timeout=3000, force=True)
                time.sleep(0.35)
                return
    except Exception:
        pass

    # 2) Mở chip Video+ratio (button menu thứ 6) rồi chọn lại tab
    try:
        ratio_chip = page.locator("button[aria-haspopup='menu']").nth(5)
        try:
            ratio_chip.click(timeout=3000)
        except Exception:
            ratio_chip.click(timeout=3000, force=True)
        time.sleep(0.25)

        target = None
        if ratio == "9:16":
            target = page.locator("button[id*='trigger-PORTRAIT'],button").filter(has_text=re.compile(r"9:16|crop_9_16", re.I))
        elif ratio == "16:9":
            target = page.locator("button[id*='trigger-LANDSCAPE'],button").filter(has_text=re.compile(r"16:9|crop_16_9", re.I))

        if target and target.count() > 0:
            try:
                target.first.click(timeout=3000)
            except Exception:
                target.first.click(timeout=3000, force=True)
            time.sleep(0.35)
            return
    except Exception:
        pass

    # 3) Fallback cũ: dò theo text/icon
    try:
        ratio_btn = page.locator("button,[role='button'],[role='tab'],[role='option'],[role='menuitem']").filter(
            has_text=re.compile(rf"(^|\s){re.escape(ratio)}($|\s)|crop_{ratio.replace(':','_')}", re.I)
        )
        if ratio_btn.count() > 0:
            try:
                ratio_btn.first.click(timeout=3000)
            except Exception:
                ratio_btn.first.click(timeout=3000, force=True)
            time.sleep(0.35)
    except Exception:
        pass


def settings_summary_matches(page, args):
    """Accept the current composer configuration when its rendered summary is exact."""
    model_key = (args.flow_model or "default").strip().lower()
    task_mode = (args.task_mode or "createvideo").strip().lower()
    if model_key == "default":
        model_key = "nano_banana_pro" if task_mode == "createimage" else "veo3_fast"
    model = MODEL_LABELS.get(model_key, "")
    ratio_icon = "crop_9_16" if args.flow_aspect_ratio == "9:16" else "crop_16_9"
    count = f"x{str(args.flow_count or '1').strip()}"
    try:
        summary = page.locator(
            'flow-prompt-box.prompt-box-container button.settings-trigger-button '
            '.settings-summary'
        )
        if summary.count() != 1 or not summary.is_visible():
            return False
        raw = summary.inner_text(timeout=3000) or ""
        normalized = " ".join(raw.split()).lower()
        ok = model.lower() in normalized and ratio_icon.lower() in normalized and count.lower() in normalized
        log_line(f"[flow] settings summary check: ok={ok} model={model_key} ratio={ratio_icon} count={count}")
        return ok
    except Exception as e:
        log_line(f"[flow] settings summary check failed: {e}")
        return False

def apply_flow_settings(page, args):
    if settings_summary_matches(page, args):
        log_line("[flow] settings already exact in composer summary; skip panel")
        return True
    task_mode = (args.task_mode or "createvideo").strip().lower()
    model_key = (args.flow_model or "default").strip().lower()
    if task_mode == "createimage" and model_key == "default":
        model_key = "nano_banana_pro"
    elif task_mode == "createvideo" and model_key == "default":
        model_key = "veo3_fast"

    payload = {
        "taskMode": task_mode,
        "model": model_key,
        "aspectRatio": args.flow_aspect_ratio,
        "count": str(args.flow_count or "1"),
        "videoSubMode": args.video_sub_mode,
    }
    try:
        ok = page.evaluate(
            """
            async (cfg) => {
              const p = (ms) => new Promise(r => setTimeout(r, ms));
              const v = (xp, root=document) => document.evaluate(xp, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el); const r = el.getBoundingClientRect();
                return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 8 && r.height > 8;
              };
              const clickExt = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect(); const x = r.left + r.width/2, y = r.top + r.height/2;
                const base = {bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,screenX:window.screenX+x,screenY:window.screenY+y,button:0};
                el.dispatchEvent(new PointerEvent('pointerdown', {...base,isPrimary:true,buttons:1,pointerId:1,pointerType:'mouse'}));
                el.dispatchEvent(new MouseEvent('mousedown', {...base,buttons:1}));
                el.dispatchEvent(new PointerEvent('pointerup', {...base,isPrimary:true,buttons:0,pointerId:1,pointerType:'mouse'}));
                el.dispatchEvent(new MouseEvent('mouseup', {...base,buttons:0}));
                el.dispatchEvent(new MouseEvent('click', base));
                return true;
              };
              const closeMenus = () => document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true,cancelable:true,composed:true}));
              const norm = (x) => String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
              const tabIcon = (tab) => (tab?.querySelector('mat-icon,i')?.textContent || '').trim();
              const tabText = (tab) => (tab?.innerText || tab?.textContent || '').trim();
              const isActive = (tab) => {
                if (!tab) return false;
                const state = (tab.getAttribute('aria-checked') || tab.getAttribute('data-state') || tab.getAttribute('aria-selected') || '').toLowerCase();
                const cls = (tab.className || '').toString().toLowerCase();
                return state === 'active' || state === 'true' || cls.includes('active');
              };
              const openPanel = async () => {
                let panel = document.querySelector('.cdk-overlay-pane flow-prompt-box-settings.settings-content-overlay, .cdk-overlay-pane flow-prompt-box-settings');
                if (panel && visible(panel)) return panel;
                const trigger = document.querySelector('flow-prompt-box button.settings-trigger-button[aria-label="Điều kiện kích hoạt cài đặt"], flow-prompt-box button.settings-trigger-button');
                if (!trigger || !visible(trigger)) return null;
                clickExt(trigger); await p(900);
                panel = document.querySelector('.cdk-overlay-pane flow-prompt-box-settings.settings-content-overlay, .cdk-overlay-pane flow-prompt-box-settings');
                return panel && visible(panel) ? panel : null;
              };
              const panel = await openPanel();
              if (!panel) return {ok:false, step:'panel_missing'};
              const allTabs = () => Array.from(panel.querySelectorAll("flow-toggles button[role='radio'], button[role='tab']")).filter(visible);
              const sameGroup = (a,b) => {
                // Current Flow wraps every radio button in its own element.
                // The functional group boundary is flow-toggles, not parentElement.
                const pa = a.closest('flow-toggles,[role="radiogroup"],[role="tablist"]');
                const pb = b.closest('flow-toggles,[role="radiogroup"],[role="tablist"]');
                return pa && pa === pb;
              };
              const groupBy = (icons=[], texts=[]) => {
                const tabs = allTabs();
                const seed = tabs.find(t => icons.includes(tabIcon(t)) || texts.includes(tabText(t)));
                return seed ? tabs.filter(t => sameGroup(seed,t)) : [];
              };
              const clickGroup = async (group, pred, label) => {
                const tab = group.find(pred);
                if (!tab) return {ok:false,label,reason:'missing',group:group.map(t=>({icon:tabIcon(t),text:tabText(t),active:isActive(t)}))};
                if (!isActive(tab)) { clickExt(tab); await p(600); }
                const active = group.find(isActive) || tab;
                return {ok:isActive(tab),label,clicked:{icon:tabIcon(tab),text:tabText(tab)},active:{icon:tabIcon(active),text:tabText(active)},group:group.map(t=>({icon:tabIcon(t),text:tabText(t),active:isActive(t)}))};
              };
              const isImage = cfg.taskMode === 'createimage';
              const typeIcon = isImage ? 'image' : 'videocam';
              const typeRes = await clickGroup(groupBy(['image','videocam']), t => tabIcon(t) === typeIcon, 'type');
              await p(isImage ? 350 : 850);
              let subRes = {ok:true, skipped:true};
              if (!isImage) {
                const subIcon = cfg.videoSubMode === 'ingredients' ? 'chrome_extension' : 'crop_free';
                subRes = await clickGroup(groupBy(['chrome_extension','crop_free'], ['Video thành phần','Khung hình','Ingredients','Frames']), t => tabIcon(t) === subIcon || norm(tabText(t)).includes(cfg.videoSubMode === 'ingredients' ? 'ingredient' : 'frame') || norm(tabText(t)).includes(cfg.videoSubMode === 'ingredients' ? 'thanh phan' : 'khung hinh'), 'videoSubMode');
                await p(350);
              }
              const ratioMap = {landscape:'crop_16_9','16:9':'crop_16_9',landscape_4_3:'crop_landscape',square:'crop_square',portrait_3_4:'crop_portrait',portrait:'crop_9_16','9:16':'crop_9_16'};
              const ratioIcon = ratioMap[cfg.aspectRatio] || 'crop_16_9';
              const ratioRes = await clickGroup(groupBy(['crop_16_9','crop_9_16','crop_square','crop_landscape','crop_portrait']), t => tabIcon(t) === ratioIcon, 'ratio');
              const countRes = await clickGroup(groupBy([], ['x1','x2','x3','x4','1x','2x','3x','4x']), t => tabText(t) === `x${cfg.count}` || tabText(t) === `${cfg.count}x`, 'count');
              const models = {
                default:'Veo 3.1 - Fast',
                omni_flash:'Omni 1.1 Flash',
                veo3_lite:'Veo 3.1 - Lite',
                veo3_fast:'Veo 3.1 - Fast',
                veo3_quality:'Veo 3.1 - Quality',
                veo3_lite_low_priority:'Veo 3.1 - Lite [Lower Priority]',
                nano_banana_pro:'Nano Banana Pro', nano_banana2:'Nano Banana 2', nano_banana2_lite:'Nano Banana 2 Lite', nano_banana:'Nano Banana 2', imagen4:'Imagen 4'
              };
              const exactModel = models[cfg.model] || (isImage ? models.nano_banana_pro : models.veo3_fast);
              const modelText = (el) => {
                if (!el) return '';
                const clone=el.cloneNode(true);
                clone.querySelectorAll('mat-icon,i,.mat-icon').forEach(x=>x.remove());
                return (clone.innerText || clone.textContent || '').trim();
              };
              const matchAlias = (value) => norm(value).trim() === norm(exactModel).trim();
              const matchesModelButton = (el) => matchAlias(modelText(el));
              const aliases = [exactModel];
              let modelRes = {ok:true, skipped: cfg.model === 'custom'};
              if (cfg.model !== 'custom') {
                await openPanel();
                const buttons = () => Array.from(panel.querySelectorAll('button')).filter(visible);
                let trigger = panel.querySelector('button[aria-label="Chọn nhóm mô hình"][aria-haspopup="menu"]');
                const before = trigger ? modelText(trigger) : '';
                if (trigger && matchesModelButton(trigger)) {
                  modelRes = {ok:true, already:true, before, aliases};
                } else if (trigger) {
                  clickExt(trigger); await p(750);
                  const modelPanel=document.querySelector('.cdk-overlay-pane .flow-model-picker-panel'); const opts = Array.from((modelPanel||document.createElement('div')).querySelectorAll('[role="menuitem"], [role="option"], button')).filter(visible);
                  const btn = opts.find(b => matchesModelButton(b));
                  if (btn) { clickExt(btn); await p(1500); }
                  await openPanel();
                  const afterBtn = panel.querySelector('button[aria-label="Chọn nhóm mô hình"][aria-haspopup="menu"]');
                  const after = afterBtn ? modelText(afterBtn) : '';
                  modelRes = {ok:!!btn && !!afterBtn && matchesModelButton(afterBtn), before, after, clicked:btn ? modelText(btn) : '', aliases};
                } else {
                  modelRes = {ok:false, reason:'model_trigger_missing', aliases};
                }
              }
              let durationRes = {ok:true, skipped: cfg.model !== 'omni_flash' || !cfg.omniDuration};
              if (cfg.model === 'omni_flash' && cfg.omniDuration) {
                await openPanel();
                durationRes = await clickGroup(groupBy([], ['4s','6s','8s','10s','4 s','6 s','8 s','10 s']), t => norm(tabText(t)).replace(/\s+/g,'') === norm(cfg.omniDuration).replace(/\s+/g,''), 'omniDuration');
              }
              closeMenus(); await p(300);
              const ok = !!(typeRes.ok && subRes.ok && ratioRes.ok && countRes.ok && modelRes.ok && durationRes.ok);
              return {ok, step:ok?'done':'verify_failed', typeRes, subRes, ratioRes, countRes, modelRes, durationRes, cfg};
            }
            """,
            payload,
        )
        if ok and ok.get("ok"):
            log_line(f"[flow] settings applied: {payload}")
            return True
        log_line(f"[flow] settings apply failed/fallback: {ok}")
    except Exception as e:
        log_line(f"[flow] settings apply exception/fallback: {e}")

    # Không dùng fallback selector toàn trang: có thể bấm nhầm nút ba chấm header.
    log_line("[flow] exact prompt settings mapping failed; stopping without ambiguous clicks")
    return False

def get_box_text(box):
    try:
        return (box.inner_text(timeout=1200) or "").strip()
    except Exception:
        return ""


def clear_attached_references(page, timeout_sec=8):
    """Remove only attachments inside the prompt composer and confirm it is empty."""
    composer = page.locator('flow-prompt-box.prompt-box-container')
    try:
        buttons = composer.locator(
            'button[aria-label*="Xóa" i],button[aria-label*="Remove" i],'
            'button[title*="Xóa" i],button[title*="Remove" i]'
        )
        for i in range(buttons.count() - 1, -1, -1):
            button = buttons.nth(i)
            if button.is_visible():
                button.click(timeout=3000)
                time.sleep(0.25)
        deadline=time.time()+timeout_sec
        while time.time()<deadline:
            media=composer.locator('[data-media-id],img:not([class*="icon"]),video')
            if media.count()==0:
                return True
            time.sleep(0.3)
        log_line(f"[flow] stale composer attachments remain: {media.count()}")
        return False
    except Exception as e:
        log_line(f"[flow] clear composer attachments failed: {e}")
        return False


def close_open_menus(page):
    try:
        page.keyboard.press("Escape")
        time.sleep(0.15)
        page.keyboard.press("Escape")
    except Exception:
        pass
    time.sleep(0.2)


def clear_prompt_box(page, box):
    # Prompt input rule v1.0.2:
    # - Exactly one clear pass: Ctrl+A -> Delete
    # - No multi-pass clear
    # - No JS fallback clear
    try:
        box.click(timeout=3000)
    except Exception:
        pass
    try:
        page.keyboard.press("Control+A")
        page.keyboard.press("Delete")
    except Exception:
        pass
    time.sleep(0.12)


def ensure_virtual_cursor(page):
    try:
        page.evaluate(
            """
            () => {
              if (document.getElementById('flow-auto-virtual-cursor')) return true;
              const cur=document.createElement('div');
              cur.id='flow-auto-virtual-cursor';
              cur.style.cssText='position:fixed;left:0;top:0;width:18px;height:18px;border:2px solid #38bdf8;border-radius:999px;background:rgba(56,189,248,.22);box-shadow:0 0 18px #38bdf8;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:left .18s ease,top .18s ease,opacity .18s ease;opacity:.95';
              const dot=document.createElement('div'); dot.style.cssText='position:absolute;left:50%;top:50%;width:4px;height:4px;background:#fff;border-radius:999px;transform:translate(-50%,-50%)'; cur.appendChild(dot);
              document.documentElement.appendChild(cur); return true;
            }
            """
        )
    except Exception:
        pass


def move_virtual_cursor_to_box(page, box):
    try:
        ensure_virtual_cursor(page)
        rect = box.bounding_box()
        if not rect:
            return False
        x = rect["x"] + min(max(rect["width"] * 0.18, 18), max(rect["width"] - 10, 18))
        y = rect["y"] + rect["height"] / 2
        page.evaluate(
            """([x,y]) => { const cur=document.getElementById('flow-auto-virtual-cursor'); if(cur){cur.style.left=x+'px';cur.style.top=y+'px';cur.style.opacity='1';} }""",
            [x, y],
        )
        try:
            page.mouse.move(x - 12, y - 10, steps=6)
            page.mouse.move(x, y, steps=8)
            page.mouse.click(x, y)
        except Exception:
            pass
        time.sleep(0.18)
        return True
    except Exception:
        return False

def human_type_text(page, text: str, base_delay_ms: float = 12.0):
    """Type with variable speed: short bursts, pauses, punctuation slowdowns."""
    text = text or ""
    base = max(1.0, float(base_delay_ms or 12.0))
    for i, ch in enumerate(text):
        # Random speed zones: sometimes fast, sometimes slow.
        if random.random() < 0.18:
            delay = random.uniform(base * 0.35, base * 0.9)
        elif random.random() < 0.18:
            delay = random.uniform(base * 1.6, base * 3.8)
        else:
            delay = random.uniform(base * 0.8, base * 1.7)

        if ch in ".,;:!?…":
            delay += random.uniform(25, 110)
        elif ch in "\n\r":
            delay += random.uniform(80, 220)
        elif ch == " ":
            delay += random.uniform(3, 35)

        try:
            page.keyboard.type(ch, delay=delay)
        except Exception:
            page.keyboard.insert_text(ch)

        # Occasional thinking pause after words/sentences.
        if i > 0 and i % random.randint(35, 85) == 0:
            time.sleep(random.uniform(0.08, 0.45))
        if ch in ".!?" and random.random() < 0.35:
            time.sleep(random.uniform(0.12, 0.65))

def type_prompt_with_verify(page, prompt: str, type_delay_ms: float = 12.0, retries: int = 3):
    prompt = (prompt or "").strip()
    if not prompt:
        return True
    expected = " ".join(prompt.split())

    for attempt in range(1, retries + 1):
        try:
            box = find_input_box(page)
            focused = focus_prompt_box(page, box)
            if focused:
                modifier = "Meta" if sys.platform == "darwin" else "Control"
                page.keyboard.press(f"{modifier}+A")
                page.keyboard.press("Backspace")
                # Paste the complete prompt in one ProseMirror transaction.
                # This behaves like Ctrl+V without replacing the user's OS clipboard.
                pasted = box.evaluate(
                    """(el, text) => {
                      try {
                        const dt=new DataTransfer(); dt.setData('text/plain', text);
                        return el.dispatchEvent(new ClipboardEvent('paste', {
                          bubbles:true, cancelable:true, composed:true, clipboardData:dt
                        }));
                      } catch { return false; }
                    }""",
                    prompt,
                )
                time.sleep(0.25)
                current = box.evaluate("el => (el.innerText || el.textContent || '').trim()") or ""
                if " ".join(str(current).split())[:40] != expected[:40]:
                    page.keyboard.insert_text(prompt)
                log_line(f"[flow] prompt pasted in one operation: event={pasted} length={len(prompt)}")
                time.sleep(0.25)

            text = box.evaluate("el => (el.innerText || el.textContent || '').trim()") or ""
            normalized = " ".join(str(text).split())
            if normalized[:40] != expected[:40]:
                # Focus-independent contenteditable fallback. execCommand emits
                # the browser editing transaction that ProseMirror observes.
                result = box.evaluate(
                    """(el, text) => {
                      el.focus({preventScroll:true});
                      const sel=window.getSelection();
                      const all=document.createRange(); all.selectNodeContents(el);
                      sel.removeAllRanges(); sel.addRange(all);
                      let deleted=false, inserted=false;
                      try { deleted=document.execCommand('delete', false); } catch {}
                      const caret=document.createRange(); caret.selectNodeContents(el); caret.collapse(false);
                      sel.removeAllRanges(); sel.addRange(caret);
                      try { inserted=document.execCommand('insertText', false, text); } catch {}
                      if (!inserted) {
                        el.replaceChildren(document.createTextNode(text));
                        const end=document.createRange(); end.selectNodeContents(el); end.collapse(false);
                        sel.removeAllRanges(); sel.addRange(end);
                        el.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true,
                          inputType:'insertText', data:text}));
                      }
                      el.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
                      return {deleted,inserted,text:(el.innerText||el.textContent||'').trim(),active:document.activeElement===el};
                    }""",
                    prompt,
                )
                log_line(f"[flow] prompt DOM-edit fallback attempt {attempt}: {result}")
                time.sleep(0.5)
                normalized = " ".join(str(box.evaluate("el => (el.innerText || el.textContent || '').trim()") or "").split())

            if len(normalized) >= min(5, len(expected)) and normalized[:40] == expected[:40]:
                # Flow must also enable its exact submit button; text in DOM
                # alone is not enough to prove ProseMirror accepted the edit.
                submit = page.locator(
                    'flow-prompt-box.prompt-box-container flow-generate-icon-button '
                    'button.generate-icon-button[type="submit"][aria-label="Bắt đầu tạo"]'
                )
                enabled = submit.count() == 1 and submit.is_visible() and submit.is_enabled()
                log_line(f"[flow] prompt verified attempt {attempt}: enabled={enabled} length={len(normalized)}")
                if enabled:
                    return True
            else:
                log_line(f"[flow] prompt verify failed attempt {attempt}: length={len(normalized)}")
        except Exception as e:
            log_line(f"[flow] prompt input attempt {attempt} failed: {e}")
        time.sleep(0.6)
    return False

def _open_plus_menu(page, prompt_box=None):
    # Exact add button recorded inside the current Flow prompt composer.
    try:
        button = page.locator(
            'flow-prompt-box.prompt-box-container flow-add-menu '
            'button.add-menu-trigger[aria-label="Thêm thành phần vào ô nhập câu lệnh"]'
        )
        if button.count() == 1 and button.is_visible():
            button.click(timeout=4000)
            page.locator('.cdk-overlay-pane flow-add-menu-popover-content').wait_for(
                state='visible', timeout=5000
            )
            return True
    except Exception:
        pass

    # Legacy fallback retained only inside the prompt composer.
    try:
        ok = page.evaluate(
            """
            () => {
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 8 && r.height > 8;
              };

              const boxes = Array.from(document.querySelectorAll('div[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea, input[type="text"]'))
                .filter(visible);
              if (!boxes.length) return false;

              const box = boxes[boxes.length - 1];
              const br = box.getBoundingClientRect();

              const btns = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
              let best = null;
              let bestScore = 1e9;

              for (const b of btns) {
                const txt = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
                const svg = (b.querySelector('svg')?.outerHTML || '').toLowerCase();
                const cls = String(b.className || '').toLowerCase();
                const isPlus = txt.includes('+') || txt.includes('add') || txt.includes('thêm') || txt.includes('upload') || txt.includes('attach') || txt.includes('tệp') || txt.includes('file') || svg.includes('plus') || cls.includes('plus') || cls.includes('add') || cls.includes('upload');
                if (!isPlus) continue;

                const r = b.getBoundingClientRect();
                // bắt buộc ở bên trái ô prompt và gần theo trục dọc
                if (r.right > br.left + 80 && r.left > br.right + 80) continue;
                const dy = Math.abs((r.top + r.height / 2) - (br.top + br.height / 2));
                const dx = Math.abs(br.left - r.right);
                const score = dx + dy * 2;
                if (score < bestScore) {
                  bestScore = score;
                  best = b;
                }
              }

              if (!best) return false;
              best.click();
              return true;
            }
            """
        )
        if ok:
            time.sleep(0.4)
            return True
    except Exception:
        pass

    plus_selectors = [
        "button[aria-label*='Add' i]",
        "button[aria-label*='Thêm' i]",
        "button:has-text('add')",
        "button:has-text('+')",
        "[role='button'][aria-label*='add' i]",
    ]
    for sel in plus_selectors:
        try:
            loc = page.locator(sel)
            if loc.count() > 0 and loc.first.is_visible():
                try:
                    loc.first.click(timeout=2500)
                except Exception:
                    loc.first.click(timeout=2500, force=True)
                time.sleep(0.35)
                return True
        except Exception:
            pass

    return False


def _choose_uploaded_image_from_menu(page, image_path: Path):
    # Chọn ảnh bằng cách click trực tiếp vùng có chứa text '1.jpg' (hoặc filename tương ứng)
    # sau đó fallback mapping theo id/data-*.
    stem = image_path.stem.strip()
    m = re.search(r"(\d+)", stem)
    number = m.group(1) if m else stem
    idx = int(number) if str(number).isdigit() else None

    # Step 1: tìm element hiển thị text filename và click vào chính vùng đó bằng tọa độ
    try:
        click_point = page.evaluate(
            """
            ({fileName, stem, number}) => {
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 10 && r.height > 10;
              };

              const norm = (s) => String(s || '').toLowerCase().trim();
              const targets = [fileName, stem, number].filter(Boolean).map(norm);

              const els = Array.from(document.querySelectorAll('body *')).filter(visible);
              let best = null;
              let bestScore = Number.POSITIVE_INFINITY;

              for (const el of els) {
                const txt = norm(el.innerText || el.textContent || '');
                if (!txt) continue;
                if (!targets.some(t => t && txt.includes(t))) continue;

                const r = el.getBoundingClientRect();
                // ưu tiên element nhỏ/vừa (label/card) hơn các container lớn
                const area = r.width * r.height;
                if (area < 30 || area > 500000) continue;

                // nếu element nằm trong popup có ảnh thì ưu tiên
                let score = area;
                const host = el.closest('[role="menu"],[role="listbox"],[role="dialog"],.MuiPopover-root,.MuiPopper-root,.cdk-overlay-pane,[data-radix-popper-content-wrapper]');
                if (!host) score += 200000;

                if (score < bestScore) {
                  bestScore = score;
                  best = r;
                }
              }

              if (!best) return null;
              return {
                x: Math.floor(best.left + best.width / 2),
                y: Math.floor(best.top + best.height / 2),
              };
            }
            """,
            {"fileName": image_path.name, "stem": stem, "number": number},
        )
        if click_point and isinstance(click_point, dict):
            x = float(click_point.get("x", 0))
            y = float(click_point.get("y", 0))
            if x > 0 and y > 0:
                page.mouse.click(x, y)
                time.sleep(0.7)
                return True
    except Exception:
        pass

    # Step 2: fallback mapping id/data-* trong popup
    try:
        picked = page.evaluate(
            """
            ({fileName, stem, number, idx}) => {
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 10 && r.height > 10;
              };

              const clickEl = (el) => {
                if (!el) return false;
                const target = el.closest('button,[role="button"],[role="option"],[role="menuitem"],[role="gridcell"],li,div') || el;
                target.click();
                return true;
              };

              const zNum = (el) => {
                try {
                  const n = parseInt(getComputedStyle(el).zIndex || '0', 10);
                  return Number.isFinite(n) ? n : 0;
                } catch { return 0; }
              };

              const allNodes = Array.from(document.querySelectorAll('body *')).filter(visible);
              const overlayCandidates = allNodes.filter(el => el.querySelector('img'));
              let root = null;
              let best = -1;
              for (const el of overlayCandidates) {
                const score = zNum(el) * 1000 + el.querySelectorAll('img').length;
                if (score > best) { best = score; root = el; }
              }
              if (!root) return false;

              const norm = (s) => String(s || '').toLowerCase();
              const targets = [fileName, stem, number].filter(Boolean).map(norm);
              const numberRe = number ? new RegExp(`(^|[^0-9])${number}([^0-9]|$)`) : null;

              const cards = Array.from(root.querySelectorAll('*')).filter(el => {
                if (!visible(el)) return false;
                if (el.tagName === 'IMG') return true;
                return !!el.querySelector('img');
              });

              const metaOf = (el) => {
                const img = el.tagName === 'IMG' ? el : el.querySelector('img');
                return [
                  el.id,
                  el.getAttribute('data-id'),
                  el.getAttribute('data-key'),
                  el.getAttribute('data-testid'),
                  el.getAttribute('aria-label'),
                  el.getAttribute('title'),
                  el.textContent,
                  img?.getAttribute('alt'),
                  img?.getAttribute('src'),
                  img?.id,
                  img?.getAttribute('data-id'),
                  img?.getAttribute('data-key'),
                  img?.getAttribute('data-testid')
                ].map(norm).join(' ');
              };

              for (const el of cards) {
                const meta = metaOf(el);
                if (targets.some(t => t && meta.includes(t))) {
                  return clickEl(el);
                }
              }

              if (numberRe) {
                for (const el of cards) {
                  const meta = metaOf(el);
                  if (numberRe.test(meta)) {
                    return clickEl(el);
                  }
                }
              }

              const thumbs = Array.from(root.querySelectorAll('img')).filter(visible);
              if (!thumbs.length) return false;
              thumbs.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const dy = ra.top - rb.top;
                if (Math.abs(dy) > 6) return dy;
                return ra.left - rb.left;
              });
              let pick = 0;
              if (Number.isInteger(idx) && idx > 0) pick = Math.min(idx - 1, thumbs.length - 1);
              return clickEl(thumbs[pick]);
            }
            """,
            {"fileName": image_path.name, "stem": stem, "number": number, "idx": idx},
        )
        if picked:
            time.sleep(0.7)
            return True
    except Exception:
        pass

    return False


def _upload_media_without_native_dialog(page, image_path: Path):
    """Intercept Flow's chooser so Windows never opens a second window."""
    selector = (
        '.cdk-overlay-pane flow-add-menu-popover-content '
        'button.sidebar-upload-btn:has-text("Tải nội dung nghe nhìn lên")'
    )
    try:
        button = page.locator(selector)
        button.wait_for(state='visible', timeout=5000)
        with page.expect_file_chooser(timeout=5000) as chooser_info:
            button.click(timeout=5000)
        chooser_info.value.set_files(str(image_path))
        return True
    except Exception as e:
        log_line(f"[flow] intercepted reference upload failed: {e}")
        return False

def _add_uploaded_media_to_prompt(page, timeout_sec=90):
    """Attach uploaded media and verify it appears inside the composer."""
    selector = (
        'flow-add-menu-detail-pane button.detail-add-to-prompt-btn:has-text("Thêm vào câu lệnh"),'
        'flow-add-menu-detail-pane button[aria-label="Thêm vào câu lệnh"]'
    )
    try:
        button = page.locator(selector).first
        button.wait_for(state='visible', timeout=int(timeout_sec * 1000))
        button.click(timeout=7000)
        deadline = time.time() + 15
        while time.time() < deadline:
            attached = page.locator(
                'flow-prompt-box.prompt-box-container img,'
                'flow-prompt-box.prompt-box-container video,'
                'flow-prompt-box.prompt-box-container [data-media-id]'
            )
            if attached.count() > 0:
                close_open_menus(page)
                return True
            time.sleep(0.4)
        log_line('[flow] add-to-prompt clicked but composer media was not confirmed')
    except Exception as e:
        log_line(f"[flow] add uploaded media to prompt failed: {e}")
    close_open_menus(page)
    return False

def upload_reference_image(page, image_path: Path, prompt_box=None, upload_file=True):
    """Extension-style image pipeline: upload to Flow library, then search by filename and attach.

    This replaces the old UI-position based uploader. It follows extension 2.0.6 logic:
    add_2 trigger -> file input inject -> wait settle -> add_2 trigger -> search filename -> click result row.
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise RuntimeError(f"missing_ref_image:{image_path}")

    fname = image_path.name

    if upload_file:
        # Phase 1: open add/upload picker beside prompt composer, then inject file.
        plus_opened = _open_plus_menu(page, prompt_box=prompt_box)
        if not plus_opened:
            raise RuntimeError(f"extension_upload:add_menu_not_opened:{fname}")
        log_line("[flow] plus menu opened for reference upload")
        file_set = _upload_media_without_native_dialog(page, image_path)
        if not file_set:
            raise RuntimeError(f"extension_upload:filechooser_not_intercepted:{fname}")

        log_line(f"[flow] extension-upload injected file: {fname}")
        if not _add_uploaded_media_to_prompt(page, timeout_sec=60):
            raise RuntimeError(f"extension_upload:add_to_prompt_failed:{fname}")
        log_line(f"[flow] uploaded media added to prompt: {fname}")
        time.sleep(1.0)
        return
    else:
        log_line(f"[flow] reuse uploaded ref from library: {fname}")

    # Reuse path only: reopen the library and attach an already uploaded file.
    attached = False
    for attempt in range(1, 6):
        try:
            if not _open_plus_menu(page, prompt_box=prompt_box):
                if _choose_uploaded_image_from_menu(page, image_path):
                    attached = True
                    break
                time.sleep(0.8)
                continue

            # search input inside asset picker/dialog
            found = page.evaluate(
                """
                (fname) => {
                  const visible = (el) => {
                    if (!el) return false;
                    const st = getComputedStyle(el);
                    if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 8 && r.height > 8;
                  };
                  const inputs = Array.from(document.querySelectorAll('[role="dialog"] input[type="text"], input[type="text"]')).filter(visible);
                  const input = inputs[inputs.length - 1];
                  if (!input) return {ok:false, step:'no_search_input'};
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                  if (setter) setter.call(input, fname); else input.value = fname;
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                  input.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:'Enter'}));
                  return {ok:true, step:'searched'};
                }
                """,
                fname,
            )
            if not found or not found.get("ok"):
                time.sleep(0.8)
                continue

            # wait for virtuoso/list result exact filename and click its row
            deadline = time.time() + 12
            while time.time() < deadline:
                clicked = page.evaluate(
                    """
                    (fname) => {
                      const visible = (el) => {
                        if (!el) return false;
                        const st = getComputedStyle(el);
                        if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 8 && r.height > 8;
                      };
                      const norm = s => String(s || '').trim().toLowerCase();
                      const target = norm(fname);
                      const imgs = Array.from(document.querySelectorAll('[data-testid="virtuoso-item-list"] img[alt], [role="dialog"] img[alt], img[alt]')).filter(visible);
                      let img = imgs.find(i => norm(i.getAttribute('alt')) === target) || imgs.find(i => norm(i.getAttribute('alt')).endsWith('/' + target));
                      if (!img) return false;
                      const row = img.closest('button,[role="button"],[role="option"],[role="menuitem"],[role="gridcell"],li,div') || img.parentElement || img;
                      row.click();
                      return true;
                    }
                    """,
                    fname,
                )
                if clicked:
                    attached = True
                    break
                time.sleep(0.35)

            if attached:
                break
        except Exception:
            pass
        time.sleep(1.0)

    if not attached:
        raise RuntimeError(f"extension_upload:cannot_attach_by_filename:{fname}")

    # close any remaining popover and wait for attach chip/reference to settle
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    time.sleep(1.0)


def find_create_button(page):
    # Exact selector recorded on the current Flow prompt composer.
    selector = (
        'flow-prompt-box.prompt-box-container '
        'flow-generate-icon-button button.generate-icon-button[type="submit"]'
        '[aria-label="Bắt đầu tạo"]'
    )
    try:
        buttons = page.locator(selector)
        for i in range(buttons.count()):
            btn = buttons.nth(i)
            if btn.is_visible() and btn.is_enabled():
                return btn
    except Exception:
        pass
    raise RuntimeError("flow_generate_button_not_ready")


def classify_flow_error(page):
    try:
        txt = (page.locator("body").inner_text(timeout=2000) or "").lower()
        if "daily" in txt and ("limit" in txt or "quota" in txt):
            return "daily_limit"
        if "queue" in txt and ("full" in txt or "đầy" in txt):
            return "queue_full"
        if "policy" in txt or "chính sách" in txt:
            return "policy"
        if "oops, something went wrong" in txt:
            return "oops"
    except Exception:
        pass
    return ""


def has_failure(page):
    # Conservative check: only treat explicit global Oops banner as failure.
    # Per-item "Failed/Retry" cards may exist from older jobs and should not stop the loop.
    body = page.locator("body")
    txt = body.inner_text(timeout=2000)
    return "Oops, something went wrong" in txt


def wait_reference_upload_settled(page, timeout_sec=45):
    """Wait until reference picker/upload mutations stop before output baseline."""
    deadline = time.time() + timeout_sec
    previous = None
    stable = 0
    while time.time() < deadline:
        try:
            state = page.evaluate(
                """
                () => {
                  const visible=el=>{if(!el)return false;const st=getComputedStyle(el),r=el.getBoundingClientRect();return st.display!=='none'&&st.visibility!=='hidden'&&r.width>8&&r.height>8;};
                  const dialogs=Array.from(document.querySelectorAll('[role="dialog"],[data-radix-popper-content-wrapper]')).filter(visible).length;
                  const uploadBusy=Array.from(document.querySelectorAll('[role="progressbar"],[aria-busy="true"]')).filter(visible).length;
                  const composer=document.querySelector('textarea,[contenteditable="true"]')?.closest('form') || null;
                  const refs=composer ? Array.from(composer.querySelectorAll('img,video,[data-tile-id]')).map((el,i)=>el.getAttribute('data-tile-id')||el.currentSrc||el.src||el.getAttribute('src')||`ref-${i}`).filter(Boolean).sort() : [];
                  return {dialogs,uploadBusy,refs};
                }
                """
            ) or {}
            signature = json.dumps(state, sort_keys=True)
            if state.get("dialogs", 0) == 0 and state.get("uploadBusy", 0) == 0 and signature == previous:
                stable += 1
                if stable >= 3:
                    return True
            else:
                stable = 0
            previous = signature
        except Exception:
            stable = 0
        time.sleep(1.0)
    return False

def snapshot_media_tiles(page):
    """Snapshot output result tiles only; exclude reference picker/composer media."""
    try:
        return set(page.evaluate(
            """
            () => {
              const visible=el=>{if(!el)return false;const st=getComputedStyle(el),r=el.getBoundingClientRect();return st.display!=='none'&&st.visibility!=='hidden'&&r.width>20&&r.height>20;};
              const isOutput=tile=>{
                if(!visible(tile) || tile.closest('[role="dialog"],[data-radix-popper-content-wrapper],form')) return false;
                const r=tile.getBoundingClientRect();
                const hasResult=!!tile.querySelector('video,canvas,img[src*="media.getMediaUrlRedirect"],button,[role="button"]');
                return hasResult && r.width>120 && r.height>80;
              };
              return Array.from(document.querySelectorAll('flow-grid-tile-container')).filter(isOutput).map(t=>t.querySelector('[data-media-id]')?.getAttribute('data-media-id')).filter(Boolean);
            }
            """
        ) or [])
    except Exception:
        return set()

def capture_submitted_tile_ids(page, before_ids=None, expected_count=1, timeout_sec=45):
    """Capture stable Flow tile IDs created by this submit before later prompts can overlap."""
    before_ids = set(before_ids or [])
    deadline = time.time() + timeout_sec
    last = []
    while time.time() < deadline:
        try:
            ids = page.evaluate(
                """
                (before) => {
                  const old = new Set(before || []);
                  const out=[];
                  const visible=el=>{if(!el)return false;const st=getComputedStyle(el),r=el.getBoundingClientRect();return st.display!=='none'&&st.visibility!=='hidden'&&r.width>40&&r.height>30;};
                  for (const tile of document.querySelectorAll('flow-grid-tile-container')) {
                    const id=tile.querySelector('[data-media-id]')?.getAttribute('data-media-id');
                    if(tile.closest('[role="dialog"],[data-radix-popper-content-wrapper],form')) continue;
                    if(!visible(tile)) continue;
                    if(id && !old.has(id) && !out.includes(id)) out.push(id);
                  }
                  return out;
                }
                """,
                list(before_ids),
            ) or []
            last = [x for x in ids if x]
            if len(last) >= max(1, int(expected_count or 1)):
                return last[:max(1, int(expected_count or 1))]
        except Exception:
            pass
        time.sleep(1.0)
    return last[:max(1, int(expected_count or 1))]

def wait_new_completed_media(page, before_ids=None, expected_count=1, timeout_sec=480):
    before_ids = set(before_ids or [])
    deadline = time.time() + timeout_sec
    last_count = 0
    while time.time() < deadline:
        try:
            data = page.evaluate(
                """
                (before) => {
                  const visible = (el) => {
                    if (!el) return false;
                    const st = getComputedStyle(el);
                    if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 20 && r.height > 20;
                  };
                  const beforeSet = new Set(before || []);
                  const nodes = Array.from(document.querySelectorAll('flow-grid-tile-container')).filter(visible);
                  const ready = [];
                  for (const el of nodes) {
                    const media=el.querySelector('[data-media-id]');
                    const id=media?.getAttribute('data-media-id');
                    const hasMedia=!!media && !el.querySelector('flow-pending-tile');
                    if (id && !beforeSet.has(id) && hasMedia) ready.push(id);
                  }
                  const txt = (document.body?.innerText || '').toLowerCase();
                  const queueFull = txt.includes('queue') && (txt.includes('full') || txt.includes('đầy'));
                  const policy = txt.includes('policy') || txt.includes('chính sách');
                  const generating = txt.includes('generating') || txt.includes('đang tạo') || txt.includes('%');
                  return {count: ready.length, queueFull, policy, generating};
                }
                """,
                list(before_ids),
            ) or {}
            last_count = int(data.get("count") or 0)
            if data.get("policy"):
                return False, "policy"
            if data.get("queueFull"):
                return False, "queue_full"
            if last_count >= int(expected_count or 1):
                return True, "ready"
        except Exception:
            pass
        time.sleep(3.0)
    return False, f"timeout_media_count_{last_count}"



def ordered_new_media_ids(page, before_ids=None):
    before_ids = set(before_ids or [])
    try:
        rows = page.evaluate(
            """
            (before) => {
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 20 && r.height > 20;
              };
              const beforeSet = new Set(before || []);
              const out=[];
              const nodes = Array.from(document.querySelectorAll('flow-grid-tile-container')).filter(visible);
              for (let i=0;i<nodes.length;i++){
                const tile=nodes[i];
                const media=tile.querySelector('[data-media-id]');
                const id=media?.getAttribute('data-media-id');
                if(id && !beforeSet.has(id) && media){
                  const r=tile.getBoundingClientRect();
                  out.push({id, top:r.top, left:r.left, idx:i});
                }
              }
              // Flow commonly puts newest result near the top. For prompt order, use older/newer order by screen position: bottom/later list first.
              out.sort((a,b)=> (b.top-a.top) || (a.left-b.left) || (a.idx-b.idx));
              return out.map(x=>x.id);
            }
            """,
            list(before_ids),
        )
        return [x for x in (rows or []) if x]
    except Exception:
        return []

def download_prompt_queue_item(page, item, args, expected_count=1, claimed_ids=None):
    claimed_ids = claimed_ids if claimed_ids is not None else set()
    expected = max(1, int(item.get("count") or expected_count or "1"))
    assigned_ids = [x for x in (item.get("assigned_ids") or []) if x]
    # Prefer stable tile IDs captured immediately after Create. This removes all
    # dependence on Flow's newest-first visual order.
    excluded = set(item["before_ids"]) | set(claimed_ids)
    if assigned_ids:
        current_ids = snapshot_media_tiles(page)
        excluded |= (set(current_ids) - set(assigned_ids))
    media_ok, media_reason = wait_new_completed_media(page, before_ids=excluded, expected_count=expected, timeout_sec=args.download_wait_sec)
    if not media_ok:
        done_wait = wait_generation_complete(page, timeout_sec=120)
        if not done_wait:
            return False, f"generation_not_completed:{media_reason}"
    # Allow the result grid to settle; image src/tile order can change briefly
    # while Flow replaces placeholders with final media.
    time.sleep(3.0)
    ordered_ids = [x for x in ordered_new_media_ids(page, before_ids=excluded) if x not in claimed_ids]
    target_ids = [x for x in assigned_ids if x in ordered_ids][:expected] if assigned_ids else ordered_ids[:expected]
    if len(target_ids) < expected:
        # Flow can replace the submitted placeholder tile ID with final output
        # tile IDs. Reacquire from this prompt's pre-submit baseline while still
        # excluding outputs claimed by earlier prompts.
        rebased_before = set(item["before_ids"]) | set(claimed_ids)
        rebased = [x for x in ordered_new_media_ids(page, before_ids=rebased_before) if x not in claimed_ids]
        target_ids = rebased[:expected]
    if len(target_ids) < expected:
        return False, f"missing_prompt_outputs:{len(target_ids)}/{expected}"
    # Verify locked tiles contain the requested media type. Reference images or
    # image placeholders must never satisfy a video queue item.
    kind_ok = page.evaluate(
        """
        ({ids,kind}) => ids.every(id => {
          const tile=Array.from(document.querySelectorAll('flow-grid-tile-container')).find(t=>t.querySelector('[data-media-id]')?.getAttribute('data-media-id')===id);
          if(!tile)return false;
          if(kind==='video'){
            const v=tile.querySelector('video');
            return !!v && (v.readyState>=1 || !!v.currentSrc || !!v.src || !!v.querySelector('source[src]'));
          }
          return !!tile.querySelector('img[src],canvas');
        })
        """,
        {"ids": target_ids, "kind": item.get("media_kind") or ("image" if item["task_mode"] == "createimage" else "video")},
    )
    if not kind_ok:
        return False, f"locked_tiles_not_ready_as_{item.get('media_kind') or item['task_mode']}"
    download_resolution = "1K" if item["task_mode"] == "createimage" else args.download_resolution
    downloaded = 0
    # Download each expected output separately. The old implementation called
    # the downloader once, so count=2..4 commonly saved only one file.
    all_visible = set(ordered_new_media_ids(page, before_ids=item["before_ids"])) | set(snapshot_media_tiles(page))
    for output_idx, target_id in enumerate(target_ids, 1):
        scoped_before = set(item["before_ids"]) | set(claimed_ids) | (all_visible - {target_id})
        ok, step = auto_download_with_retry(
            page,
            resolution=download_resolution,
            timeout_sec=240,
            before_ids=scoped_before,
            output_prefix=f"{item.get('output_prefix') or ('prompt_' + str(item['prompt_no']))}_{output_idx}",
            output_dir=args.output_dir,
        )
        if not ok:
            return False, f"output_{output_idx}/{expected}:{step}"
        claimed_ids.add(target_id)
        downloaded += 1
    return True, f"downloaded_{downloaded}/{expected}"

def wait_generation_complete(page, timeout_sec=360):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            state = page.evaluate(
                """
                () => {
                  const txt = (document.body?.innerText || '').toLowerCase();
                  const hasGenerating = txt.includes('generating') || txt.includes('đang tạo') || txt.includes('rendering');

                  const hasKebab = Array.from(document.querySelectorAll('button,[role="button"]')).some(b => {
                    const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
                    return t.includes('more') || t.includes('more_vert') || t.includes('more_horiz') || t.includes('menu') || t.includes('tùy chọn');
                  });

                  const hasDownloadText = txt.includes('download') || txt.includes('tải xuống');
                  const hasReady = hasKebab || hasDownloadText;
                  return {hasGenerating, hasReady};
                }
                """
            )
            if state and state.get("hasReady") and not state.get("hasGenerating"):
                return True
        except Exception:
            pass
        time.sleep(2.0)
    return False


def _detect_ext_from_bytes(head: bytes):
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"RIFF") and b"WEBP" in head[:16]:
        return ".webp"
    if len(head) > 12 and b"ftyp" in head[:16]:
        return ".mp4"
    if head.startswith(b"\x1aE\xdf\xa3"):
        return ".webm"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return None



def _download_manifest_path(output_dir=None):
    out_dir = Path(output_dir).expanduser() if output_dir else Path.home() / "Downloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / ".flow_auto_download_hashes.json"

def _load_download_manifest(output_dir=None):
    path = _download_manifest_path(output_dir)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("items", [])
            return data
    except Exception:
        pass
    return {"items": []}

def _media_sha256(data: bytes):
    return hashlib.sha256(data or b"").hexdigest()

def _is_duplicate_media(data: bytes, output_dir=None):
    h = _media_sha256(data)
    manifest = _load_download_manifest(output_dir)
    recent = list(manifest.get("items") or [])[-80:]
    for item in recent:
        if item.get("sha256") == h:
            return True, h, item
    return False, h, None

def _remember_media_hash(data: bytes, saved_name: str, output_dir=None):
    manifest = _load_download_manifest(output_dir)
    items = list(manifest.get("items") or [])
    items.append({"sha256": _media_sha256(data), "file": saved_name, "ts": datetime.now(timezone.utc).isoformat()})
    manifest["items"] = items[-300:]
    try:
        _download_manifest_path(output_dir).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

def _next_numbered_media_target(output_dir=None, ext=".mp4"):
    """Return next sequential media filename: 1.ext, 2.ext, ... in output_dir.

    The sequence is shared across image/video extensions so auto-download order is
    preserved when mixed media is downloaded. Existing files with pure numeric
    stems are respected to avoid overwrites.
    """
    out_dir = Path(output_dir).expanduser() if output_dir else Path.home() / "Downloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = ext if str(ext).startswith(".") else f".{ext}"
    max_n = 0
    try:
        for item in out_dir.iterdir():
            if item.is_file() and item.stem.isdigit():
                max_n = max(max_n, int(item.stem))
    except Exception:
        max_n = 0
    n = max_n + 1
    target = out_dir / f"{n}{ext}"
    while target.exists():
        n += 1
        target = out_dir / f"{n}{ext}"
    return target

def _prompt_numbered_target(output_dir, output_prefix, ext):
    out_dir = Path(output_dir).expanduser() if output_dir else Path.home() / "Downloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = str(output_prefix or "1")
    m = re.match(r"^(\d+)(?:_(\d+))?$", raw)
    stem = raw if m else "1"
    target = out_dir / f"{stem}{ext}"
    if not target.exists():
        return target
    n = 2
    while (out_dir / f"{stem}_{n}{ext}").exists(): n += 1
    return out_dir / f"{stem}_{n}{ext}"

def _save_media_bytes(data: bytes, output_prefix="flow-auto", output_dir=None):
    ext = _detect_ext_from_bytes(data[:64])
    if not ext:
        return False, "direct_invalid_media_bytes"
    dup, h, item = _is_duplicate_media(data, output_dir=output_dir)
    if dup:
        return True, f"duplicate_skipped:{item.get('file','existing')}"
    target = _next_numbered_media_target(output_dir=output_dir, ext=ext)
    target.write_bytes(data)
    _remember_media_hash(data, target.name, output_dir=output_dir)
    return True, f"direct_saved:{target.name}"


def direct_download_media_from_tile(page, before_ids=None, output_prefix="flow-auto", output_dir=None):
    try:
        media = page.evaluate(
            """
            async ({beforeIds}) => {
              const before = new Set(beforeIds || []);
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 10 && r.height > 10;
              };
              const toB64 = async (url) => {
                const res = await fetch(url, {credentials:'include'});
                const buf = await res.arrayBuffer();
                let bin = '';
                const bytes = new Uint8Array(buf);
                for (let i=0; i<bytes.length; i+=0x8000) bin += String.fromCharCode(...bytes.subarray(i, i+0x8000));
                return btoa(bin);
              };
              const tiles = [];
              document.querySelectorAll('flow-grid-tile-container').forEach(tile => {
                const media = tile.querySelector('[data-media-id],video,video source[src],img,canvas');
                const id = media?.getAttribute?.('data-media-id');
                if (!id || (before.size && before.has(id))) return;
                if (media && visible(tile)) tiles.push({tile, media, top: tile.getBoundingClientRect().top});
              });
              if (!tiles.length) return null;
              tiles.sort((a,b) => b.top - a.top);
              const m = tiles[0].media;
              if (m.tagName === 'CANVAS') return {kind:'base64', data:m.toDataURL('image/png').split(',')[1] || ''};
              const host = m.tagName === 'SOURCE' ? m.closest('video') : m;
              const url = host?.currentSrc || m.currentSrc || m.src || m.getAttribute('src') || host?.querySelector?.('source[src]')?.src || '';
              if (!url) return null;
              if (url.startsWith('blob:') || url.startsWith('data:')) {
                if (url.startsWith('data:')) return {kind:'base64', data:url.split(',')[1] || ''};
                return {kind:'base64', data:await toB64(url)};
              }
              return {kind:'url', url};
            }
            """,
            {"beforeIds": list(before_ids or [])},
        )
        if not media:
            return False, "direct_no_media_url"
        if media.get("kind") == "base64":
            data = base64.b64decode(media.get("data") or "")
            return _save_media_bytes(data, output_prefix=output_prefix, output_dir=output_dir)
        media_url = media.get("url") or ""
        if not media_url:
            return False, "direct_no_media_url"
        resp = page.context.request.get(media_url, timeout=60000)
        if not resp.ok:
            return False, f"direct_http_{resp.status}"
        return _save_media_bytes(resp.body(), output_prefix=output_prefix, output_dir=output_dir)
    except Exception as e:
        return False, f"direct_exception:{e}"


def current_flow_download_tile_via_ui(page, resolution="720p", before_ids=None, output_prefix="1", output_dir=None):
    """Download through current Flow tile hotbar mapping."""
    before = list(before_ids or [])
    try:
        tile_id = page.evaluate(
            """before => {
              const old=new Set(before||[]), visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>80&&r.height>60&&s.display!=='none'&&s.visibility!=='hidden'};
              const tiles=[...document.querySelectorAll('flow-grid-tile-container')]
                .filter(t=>{const id=t.querySelector('[data-media-id]')?.getAttribute('data-media-id');return id&&!old.has(id)&&visible(t)&&(t.querySelector('flow-image-hotbar,flow-video-hotbar')||t.matches('flow-image-tile,flow-video-tile'))});
              tiles.sort((a,b)=>b.getBoundingClientRect().top-a.getBoundingClientRect().top);
              return tiles[0]?.querySelector('[data-media-id]')?.getAttribute('data-media-id')||null;
            }""", before)
        if not tile_id: return False, 'current_no_target_tile'
        tile = page.locator(f'flow-grid-tile-container:has([data-media-id="{tile_id}"])').first
        tile.hover(timeout=5000)
        menu = tile.locator('flow-image-hotbar button[aria-label="Tuỳ chọn khác"],flow-video-hotbar button[aria-label="Tuỳ chọn khác"],button[aria-label="Tuỳ chọn khác"]')
        if menu.count() < 1: return False, 'current_more_options_missing'
        menu.first.click(timeout=5000)
        quality = '1K' if str(resolution).upper() == '1K' else ('720p' if str(resolution) in ('720','720p') else str(resolution))
        option = page.locator('.cdk-overlay-pane button,.cdk-overlay-pane [role="menuitem"]').filter(has_text=quality)
        option.first.wait_for(state='visible', timeout=5000)
        with page.expect_download(timeout=30000) as info:
            option.first.click(timeout=5000)
        dl=info.value
        tmp=Path(dl.path())
        data=tmp.read_bytes(); ext=_detect_ext_from_bytes(data[:64])
        if not ext: return False, 'current_invalid_download_bytes'
        target=_next_numbered_media_target(output_dir=output_dir, ext=ext)
        dl.save_as(str(target)); _remember_media_hash(data,target.name,output_dir=output_dir)
        return True, f'current_saved_as:{target.name}'
    except Exception as e:
        return False, f'current_exception:{e}'

def extension_download_tile_via_ui(page, resolution="720p", before_ids=None, output_prefix="flow-auto", output_dir=None):
    """Downloader ported from extension 2.0.6 (yr + Un): tile media -> context menu -> download -> quality."""
    try:
        download_obj = None
        with page.expect_download(timeout=30000) as download_info:
            step = page.evaluate(
            """
            async ({resolution, beforeIds}) => {
              const p = (ms) => new Promise(r => setTimeout(r, ms));
              const before = new Set(beforeIds || []);
              const visible = (el) => {
                if (!el) return false;
                const st = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 10 && r.height > 10;
              };

              // Extension helpers: On(tile), Dn(tile), $n(snapshot)
              const videoReady = (v) => !!v && (v.readyState >= 1 || !!v.currentSrc || !!v.src || !!v.querySelector('source[src]'));
              const On = (tile) => {
                const v=tile.querySelector('video');
                const img=tile.querySelector('img[src]');
                return videoReady(v) || !!img;
              };
              const Dn = (tile) => !!tile.querySelector('video');
              const collectNewTiles = (snapshot) => {
                const out = [], seen = new Set();
                document.querySelectorAll('[data-tile-id]').forEach(tile => {
                  const id = tile.getAttribute('data-tile-id');
                  if (!id || seen.has(id)) return;
                  seen.add(id);
                  if (snapshot && snapshot.has(id)) return;
                  if (On(tile) && visible(tile)) out.push({tileId:id, tileEl:tile, isVideo:Dn(tile)});
                });
                return out;
              };

              // Extension yr(e,t): choose requested quality, fallback best enabled.
              const yr = (menu, targetQuality) => {
                const btns = [...menu.querySelectorAll('button[role="menuitem"], button')];
                if (btns.length === 0) return null;
                const items = btns.map(btn => {
                  const label = btn.querySelectorAll('span')[0]?.textContent.trim() || btn.textContent.trim();
                  const enabled = btn.getAttribute('aria-disabled') !== 'true';
                  return {btn, label, enabled};
                });
                const enabled = items.filter(x => x.enabled);
                if (targetQuality) {
                  const exact = items.find(x => x.label === targetQuality);
                  if (exact) {
                    if (exact.enabled) return exact.btn;
                  }
                  const partial = items.find(x => x.enabled && x.label.includes(targetQuality));
                  if (partial) return partial.btn;
                }
                if (enabled.length > 0) return enabled[enabled.length - 1].btn;
                return btns[0];
              };

              // Extension Un(tile, quality): right-click tile media and download via UI.
              const Un = async (tile, targetQuality=null) => {
                try {
                  const media = tile.querySelector('video') || tile.querySelector('img[src*="media.getMediaUrlRedirect"]') || tile.querySelector('img[src]');
                  if (!media) return {ok:false, step:'no_media_in_tile'};
                  const r = media.getBoundingClientRect();
                  const x = r.left + r.width / 2, y = r.top + r.height / 2;
                  media.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true, clientX:x, clientY:y}));
                  media.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX:x, clientY:y}));
                  await p(400);
                  media.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:x, clientY:y, button:2}));
                  await p(600);
                  const contextMenu = document.querySelector('[data-radix-menu-content][data-state="open"]');
                  if (!contextMenu) return {ok:false, step:'no_context_menu'};
                  const downloadItem = [...contextMenu.querySelectorAll('[role="menuitem"]')].find(item => item.querySelector('i')?.textContent.trim() === 'download');
                  if (!downloadItem) {
                    document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                    return {ok:false, step:'no_download_item'};
                  }
                  downloadItem.click();
                  await p(600);
                  const menus = [...document.querySelectorAll('[data-radix-menu-content][data-state="open"]')];
                  let qualityMenu = menus.find(m => m !== contextMenu) || menus[menus.length - 1];
                  if ((!qualityMenu || qualityMenu === contextMenu) && !([...document.querySelectorAll('[data-radix-popper-content-wrapper]')].flatMap(w => [...w.querySelectorAll('[role="menuitem"]')]).length > 0 ? document.querySelector('[data-radix-popper-content-wrapper]:last-of-type') : null)) {
                    document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                    return {ok:false, step:'no_quality_menu'};
                  }
                  if (!qualityMenu || qualityMenu === contextMenu) {
                    qualityMenu = document.querySelector('[data-radix-popper-content-wrapper]:last-of-type') || qualityMenu;
                  }
                  const qualityBtn = yr(qualityMenu, targetQuality);
                  if (!qualityBtn) {
                    document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                    return {ok:false, step:'no_quality_button'};
                  }
                  qualityBtn.click();
                  await p(300);
                  return {ok:true, step:'done'};
                } catch (err) {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                  return {ok:false, step:'exception:' + (err && err.message || err)};
                }
              };

              let tiles = collectNewTiles(before);
              if (!tiles.length) {
                // Khi có snapshot beforeIds, tuyệt đối không fallback sang tile khác để tránh tải nhầm file khi auto đang chạy.
                if (before.size > 0) return {ok:false, step:'no_new_tile_from_snapshot'};
                tiles = collectNewTiles(new Set());
              }
              if (!tiles.length) return {ok:false, step:'no_tiles'};
              tiles.sort((a,b) => {
                const ar = a.tileEl.getBoundingClientRect(), br = b.tileEl.getBoundingClientRect();
                // Khi tải trễ nhiều prompt, tile cũ hơn thường nằm thấp hơn; ưu tiên tile cũ nhất để không tải nhầm prompt mới.
                return br.top - ar.top;
              });
              const targetTile = tiles[0].tileEl;
              targetTile.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
              await p(350);
              return await Un(targetTile, resolution || null);
            }
            """,
            {"resolution": str(resolution), "beforeIds": list(before_ids or [])},
        )
        if not (step and step.get("ok")):
            return False, (step or {}).get("step", "unknown")
        download_obj = download_info.value
        filename = (download_obj.suggested_filename or "").lower()
        valid_exts = (".mp4", ".mov", ".webm", ".mkv", ".jpg", ".jpeg", ".png", ".webp", ".gif")
        download_path = None
        try:
            pth = download_obj.path()
            download_path = Path(pth) if pth else None
        except Exception:
            download_path = None

        detected_ext = None
        try:
            if download_path and download_path.exists():
                head = download_path.read_bytes()[:64]
                if head.startswith(b"\xff\xd8\xff"):
                    detected_ext = ".jpg"
                elif head.startswith(b"\x89PNG\r\n\x1a\n"):
                    detected_ext = ".png"
                elif head.startswith(b"RIFF") and b"WEBP" in head[:16]:
                    detected_ext = ".webp"
                elif len(head) > 12 and b"ftyp" in head[:16]:
                    detected_ext = ".mp4"
                elif head.startswith(b"\x1aE\xdf\xa3"):
                    detected_ext = ".webm"
                elif head[:6] in (b"GIF87a", b"GIF89a"):
                    detected_ext = ".gif"
        except Exception:
            detected_ext = None

        uuidish = bool(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?", filename or ""))
        # Never trust filename/extension. Only accept if magic bytes prove it is image/video.
        if detected_ext and download_path and download_path.exists():
            out_dir = Path(output_dir).expanduser() if output_dir else Path.home() / "Downloads"
            try:
                out_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            data = download_path.read_bytes()
            dup, h, item = _is_duplicate_media(data, output_dir=out_dir)
            if dup:
                try:
                    download_path.unlink(missing_ok=True)
                except Exception:
                    pass
                return True, f"duplicate_skipped:{item.get('file','existing')}"
            target = _next_numbered_media_target(output_dir=out_dir, ext=detected_ext)
            try:
                download_obj.save_as(str(target))
            except Exception:
                try:
                    target.write_bytes(data)
                except Exception:
                    pass
            if target.exists():
                _remember_media_hash(target.read_bytes(), target.name, output_dir=out_dir)
            else:
                _remember_media_hash(data, target.name, output_dir=out_dir)
            return True, f"done_saved_as:{target.name}"

        try:
            if download_path and download_path.exists():
                download_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            download_obj.cancel()
        except Exception:
            pass
        return False, f"invalid_download_file:{filename or 'unknown'}"
    except Exception as e:
        return False, f"exception:{e}"

def auto_download_with_retry(page, resolution="720p", timeout_sec=480, before_ids=None, output_prefix="flow-auto", output_dir=None):
    deadline = time.time() + timeout_sec
    last = "unknown"
    res = str(resolution)
    if res == "720":
        res = "720p"
    while time.time() < deadline:
        # Prefer direct media bytes while browser is busy; UI download can sometimes save an HTML/redirect placeholder.
        ok, step = direct_download_media_from_tile(page, before_ids=before_ids, output_prefix=output_prefix, output_dir=output_dir)
        last = step
        if ok:
            return True, step
        # If direct media is unavailable, use Flow's own UI download after the page is idle.
        # Validate actual bytes after download; bad preview/placeholder files are deleted by
        # extension_download_tile_via_ui() and retried instead of being kept.
        try:
            page.wait_for_timeout(1200)
        except Exception:
            pass
        ok, step = extension_download_tile_via_ui(page, resolution=res, before_ids=before_ids, output_prefix=output_prefix, output_dir=output_dir)
        last = step
        if ok:
            return True, step
        time.sleep(4.0)
    return False, last


LICENSE_CONFIG_FILE = Path(os.environ.get("FLOW_LICENSE_ONLINE_CONFIG", str(Path(os.environ.get("FLOW_WORKSPACE", str(Path.home() / ".openclaw" / "workspace"))) / "keys" / "license-online.json")))
LICENSE_APP_VERSION = os.environ.get("FLOW_APP_VERSION", "3.4.5")
LICENSE_TIMEOUT_SEC = int(os.environ.get("FLOW_LICENSE_TIMEOUT_SEC", "10"))
LICENSE_STRICT_ONLINE = os.environ.get("FLOW_LICENSE_STRICT_ONLINE", "1").strip() == "1"
_LICENSE_LAST_OK = 0.0
_LICENSE_LAST_REASON = "never"

def _license_now_utc():
    return datetime.now(timezone.utc)

def _license_iso_now():
    return _license_now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")

def _license_read_machine_id():
    for candidate in (Path("/etc/machine-id"), Path.home() / ".flow-machine-id"):
        try:
            if candidate.exists():
                v = candidate.read_text(encoding="utf-8").strip()
                if v:
                    return v
        except Exception:
            pass
    return socket.gethostname()

def _license_load_cfg():
    cfg = {}
    try:
        if LICENSE_CONFIG_FILE.exists():
            cfg = json.loads(LICENSE_CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        cfg = {}
    # Protected Electron passes decrypted values only in the child process environment.
    # The on-disk config keeps DPAPI-protected blobs and no plaintext license key.
    if os.environ.get("FLOW_LICENSE_KEY_RUNTIME"):
        cfg["license_key"] = os.environ.get("FLOW_LICENSE_KEY_RUNTIME", "")
    if os.environ.get("FLOW_LICENSE_API_BASE_RUNTIME"):
        cfg["api_base"] = os.environ.get("FLOW_LICENSE_API_BASE_RUNTIME", "")
    if os.environ.get("FLOW_LICENSE_SIGNED_TOKEN_RUNTIME"):
        cfg["signed_token"] = os.environ.get("FLOW_LICENSE_SIGNED_TOKEN_RUNTIME", "")
    return cfg

def _license_save_cfg(cfg):
    try:
        LICENSE_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        LICENSE_CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

def _license_normalize_base(base):
    b = (base or "").strip().rstrip("/")
    if b.endswith("/activate") or b.endswith("/verify"):
        b = b.rsplit("/", 1)[0]
    return b

def _license_post_json(url, payload, timeout=LICENSE_TIMEOUT_SEC):
    req = request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type":"application/json"}, method="POST")
    try:
        ctx = ssl.create_default_context()
        with request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8")
            return resp.getcode(), json.loads(body) if body else {}
    except error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
            data = json.loads(body) if body else {}
        except Exception:
            data = {"reason": f"http_{e.code}"}
        return e.code, data

def _license_verify_online():
    cfg = _license_load_cfg()
    base = _license_normalize_base(cfg.get("api_base", ""))
    key = (cfg.get("license_key", "") or "").strip()
    if not base:
        return False, "missing_api_base"
    if not key:
        return False, "missing_license_key"
    machine_id = cfg.get("machine_id") or _license_read_machine_id()
    cfg["machine_id"] = machine_id
    payload = {
        "license_key": key,
        "machine_id": machine_id,
        "app_version": LICENSE_APP_VERSION,
        "nonce": uuid.uuid4().hex,
        "timestamp": _license_iso_now(),
    }
    if cfg.get("signed_token"):
        payload["signed_token"] = cfg.get("signed_token")
    try:
        code, data = _license_post_json(f"{base}/verify", payload)
    except Exception as e:
        return False, f"network_error_strict:{e}"
    if code == 200 and isinstance(data, dict) and bool(data.get("valid", False)):
        for k in ("signed_token", "expires_at", "grace_until", "next_check_at"):
            if data.get(k):
                cfg[k] = data[k]
        cfg["last_verified_at"] = _license_iso_now()
        if not os.environ.get("FLOW_LICENSE_KEY_RUNTIME"):
            _license_save_cfg(cfg)
        return True, "ok"
    reason = data.get("reason") if isinstance(data, dict) else f"http_{code}"
    return False, str(reason or f"http_{code}")

def license_guard_or_raise(force=False):
    global _LICENSE_LAST_OK, _LICENSE_LAST_REASON
    # In protected runner, this online check is compiled into the binary. Do not
    # depend on the external checker script, because protected payload ships no .py.
    interval = int(os.environ.get("FLOW_LICENSE_RECHECK_SEC", "90"))
    if not force and _LICENSE_LAST_OK and (time.time() - _LICENSE_LAST_OK) < interval:
        return
    ok, reason = _license_verify_online()
    _LICENSE_LAST_REASON = reason
    if ok:
        _LICENSE_LAST_OK = time.time()
        return
    raise RuntimeError(f"license_invalid:{reason}")


def _runner_parent_guard():
    if os.environ.get("FLOW_LICENSE_KEY_RUNTIME"):
        parent = int(os.environ.get("FLOW_PARENT_PID", "0") or 0)
        binding = (os.environ.get("FLOW_RUNNER_BINDING", "") or "").strip()
        if parent <= 0 or len(binding) != 64:
            raise RuntimeError("runner_parent_binding_invalid")
        try:
            if os.name == "nt":
                # Never use os.kill(pid, 0) on Windows: Python maps it to
                # TerminateProcess and can close the Electron parent immediately.
                import ctypes
                PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
                handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, parent)
                if not handle:
                    raise RuntimeError("runner_parent_not_running")
                ctypes.windll.kernel32.CloseHandle(handle)
            else:
                os.kill(parent, 0)
        except RuntimeError:
            raise
        except Exception:
            raise RuntimeError("runner_parent_not_running")

def run(args):
    _runner_parent_guard()
    # Electron resets old workers before launch; runner must not kill sibling threads.


    prompts = load_prompts(args.prompts)
    total = len(prompts)

    state = {} if getattr(args, "fresh_run", False) else load_state(args.state)
    done = 0 if getattr(args, "fresh_run", False) else int(state.get("done", 0))
    settings_applied = False
    if args.start_from is not None:
        done = max(0, args.start_from - 1)

    log_line(f"[flow] total prompts: {total}")
    log_line(f"[flow] starting from prompt #{done + 1} (RUN ID: {args.run_id})")

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(args.cdp)
        page = find_flow_page(browser)
        if not page:
            raise RuntimeError("flow_tab_not_ready_after_electron_launch")

        page = ensure_project_page(page)
        # Do not force the Flow browser window to front. Users may intentionally keep it hidden/minimized.
        time.sleep(1.0)
        capture_startup_screenshot(page)
        # Critical: do not apply mode/model until the project composer is actually ready.
        # Otherwise one Start only opens Flow, next Start clicks New Project, next Start types prompt.
        try:
            find_input_box(page)
            log_line('[flow] project composer ready after New Project')
        except Exception as e:
            log_line(f'[flow] composer not ready after New Project: {e}; retry ensure_project_page')
            page = ensure_project_page(page)
            find_input_box(page)
            log_line('[flow] project composer ready after retry')
        try:
            log_line('[flow] applying GUI settings once after composer ready')
            settings_applied = bool(apply_flow_settings(page, args))
            log_line(f'[flow] settings applied once: {settings_applied}')
            if not settings_applied:
                raise RuntimeError('settings_not_applied_exactly')
            time.sleep(0.7)
        except Exception as e:
            settings_applied = False
            log_line(f'[flow] apply settings after New Project failed: {e}')
            raise

        needs_clear_before_insert = True

        refs_dir = args.refs_dir
        delayed_downloads = []
        claimed_media_ids = set()
        last_submit_at = None
        for idx in range(done, total):
            # "Giãn cách prompt" is measured between Generate clicks, not
            # added after housekeeping/DOM checks. Wait only the remainder.
            if last_submit_at is not None:
                spacing_sec = max(0.0, float(args.between_prompts_sec or 0))
                remaining = spacing_sec - (time.monotonic() - last_submit_at)
                if remaining > 0:
                    log_line(f"[flow] prompt spacing: wait remaining {remaining:.2f}s of configured {spacing_sec:.2f}s")
                    time.sleep(remaining)
            while PAUSE_FILE_DEFAULT.exists():
                log_line("[flow] paused")
                time.sleep(2.0)
            prompt = prompts[idx]
            prompt_no = idx + 1
            ok = False
            submitted = False
            flow_rejected = False

            for attempt in range(1, args.max_retries + 2):
                try:
                    license_guard_or_raise(force=True)
                    
                    # Do not force the Flow browser window to front between prompts.

                    # Settings are applied only once per run. Do not re-select model/ratio/count for later prompts.
                    if not settings_applied:
                        log_line(f'[flow] apply settings once before typing: task={args.task_mode}, sub={args.video_sub_mode}, model={args.flow_model}, ratio={args.flow_aspect_ratio}, count={args.flow_count}')
                        settings_applied = bool(apply_flow_settings(page, args))
                        log_line(f'[flow] settings applied once: {settings_applied}')
                        if not settings_applied:
                            raise RuntimeError('settings_not_applied_exactly')
                        time.sleep(0.5)
                    else:
                        log_line('[flow] skip settings: already applied once in this run')

                    box = find_input_box(page)

                    # Always clear before typing, especially for AI Studio/Continuous runs
                    clear_prompt_box(page, box)
                    if not clear_attached_references(page):
                        raise RuntimeError("stale_reference_not_cleared")

                    prompt_to_type = prompt
                    matched_refs = []
                    if refs_dir is not None:
                        if args.paired_mode:
                            # Normal Flow tabs: paired image mapping only (1.jpg -> prompt #1, 2.jpg -> prompt #2).
                            # Dance wardrobe batches may provide one folder per prompt containing
                            # the model image followed by every garment/accessory reference.
                            prompt_ref_dir = refs_dir / str(prompt_no)
                            if prompt_ref_dir.is_dir() and args.allow_multi_refs:
                                exts = {".jpg", ".jpeg", ".png", ".webp"}
                                matched_refs.extend([p for p in sorted(prompt_ref_dir.iterdir(), key=natural_file_key) if p.is_file() and p.suffix.lower() in exts])
                            elif prompt_ref_dir.is_dir():
                                exts = {".jpg", ".jpeg", ".png", ".webp"}
                                files = [p for p in sorted(prompt_ref_dir.iterdir(), key=natural_file_key) if p.is_file() and p.suffix.lower() in exts]
                                if files:
                                    matched_refs.append(files[0])
                            else:
                                ref_img = resolve_ref_image(refs_dir, prompt_no)
                                if ref_img is not None:
                                    matched_refs.append(ref_img)
                        elif args.ref_mode == "all":
                            # Explicit all-reference mode: upload every image for every prompt.
                            exts = {".jpg", ".jpeg", ".png", ".webp"}
                            matched_refs.extend([
                                p for p in sorted(refs_dir.iterdir(), key=natural_file_key)
                                if p.is_file() and p.suffix.lower() in exts
                            ])
                        else:
                            ref_img = resolve_ref_image(refs_dir, prompt_no)
                            if ref_img is not None:
                                matched_refs.append(ref_img)

                    # Only paired mode is limited to one numbered image. Explicit
                    # all mode and wardrobe subfolders intentionally keep all refs.
                    if args.ref_mode != "all" and not args.allow_multi_refs:
                        matched_refs = matched_refs[:1]

                    for ref_file in matched_refs:
                        log_line(f"[flow] prompt #{prompt_no} use ref image: {ref_file.name}")
                        # Always upload the exact local file selected for this prompt.
                        # Reusing Flow library entries by filename can attach stale media.
                        upload_reference_image(page, ref_file, prompt_box=box, upload_file=True)

                    if matched_refs:
                        settled = wait_reference_upload_settled(page, timeout_sec=45)
                        log_line(f"[flow] prompt #{prompt_no} reference upload settled: {settled}")
                        if not settled:
                            raise RuntimeError("reference_upload_not_settled")

                    time.sleep(random.uniform(args.pre_paste_min, args.pre_paste_max))

                    # Quy trình nhập prompt mới với verify
                    typed_ok = type_prompt_with_verify(page, prompt_to_type, type_delay_ms=args.type_delay_ms, retries=3)
                    if not typed_ok:
                        raise RuntimeError("prompt_not_typed_after_image_upload")

                    # Snapshot media tiles trước submit để monitor output mới giống extension
                    pre_submit_tiles = snapshot_media_tiles(page)

                    # Bỏ chọn tỉ lệ theo yêu cầu: giữ nguyên tỉ lệ hiện tại trên UI
                    time.sleep(args.before_create_sec)
                    btn = find_create_button(page)
                    btn.click(timeout=5000)
                    submitted = True
                    last_submit_at = time.monotonic()
                    log_line(f"[flow] prompt #{prompt_no} submitted; spacing clock started")
                    continuous_batch = int(args.download_delay_prompts or 0) > 0 or bool(args.continuous_download)
                    submitted_tile_ids = capture_submitted_tile_ids(
                        page,
                        before_ids=pre_submit_tiles,
                        expected_count=1,
                        timeout_sec=1 if continuous_batch else 180,
                    )
                    log_line(f"[flow] prompt #{prompt_no} locked tile IDs: {submitted_tile_ids}")
                    if not submitted_tile_ids and not continuous_batch:
                        raise RuntimeError("submitted_job_tile_not_created")
                    if not submitted_tile_ids:
                        log_line(f"[flow] prompt #{prompt_no} tile pending; continuous mode will resolve it from pre-submit baseline during FIFO download")

                    if not continuous_batch:
                        time.sleep(2)
                    fail_reason = classify_flow_error(page)
                    if fail_reason:
                        flow_rejected = True
                        if fail_reason == "daily_limit" and args.flow_model != "default":
                            log_line("[flow] daily limit detected, fallback model=default and retry")
                            args.flow_model = "default"
                        raise RuntimeError(f"flow_error:{fail_reason}")

                    if not args.auto_download:
                        ok = True
                        break

                    if args.auto_download:
                        if int(args.download_delay_prompts or 0) > 0:
                            delayed_downloads.append({
                                "prompt_no": prompt_no,
                                "before_ids": pre_submit_tiles,
                                "assigned_ids": submitted_tile_ids,
                                "task_mode": args.task_mode,
                                "media_kind": "image" if args.task_mode == "createimage" else "video",
                                "count": args.flow_count,
                                "output_prefix": prompt_file_prefix(prompt, prompt_no),
                            })
                            batch_size = max(1, int(args.download_delay_prompts or 0))
                            if len(delayed_downloads) >= batch_size:
                                # Submit exactly one batch, then pause submissions
                                # and download that complete batch in FIFO order.
                                # For delay=3: submit 1,2,3; download 1,2,3; then 4.
                                batch = delayed_downloads[:batch_size]
                                log_line(f"[flow] completed submit batch of {batch_size}; FIFO download now: {[x['prompt_no'] for x in batch]}")
                                for item in batch:
                                    license_guard_or_raise(force=True)
                                    log_line(f"[flow] batch download prompt #{item['prompt_no']} of {batch_size}")
                                    dl_ok, dl_step = download_prompt_queue_item(page, item, args, claimed_ids=claimed_media_ids)
                                    if not dl_ok:
                                        raise RuntimeError(f"auto_download_failed_prompt_{item['prompt_no']}:{dl_step}")
                                    # Remove only after successful complete download.
                                    if delayed_downloads and delayed_downloads[0] is item:
                                        delayed_downloads.pop(0)
                                    else:
                                        delayed_downloads.remove(item)
                        elif args.continuous_download:
                            delayed_downloads.append({
                                "prompt_no": prompt_no,
                                "before_ids": pre_submit_tiles,
                                "assigned_ids": submitted_tile_ids,
                                "task_mode": args.task_mode,
                                "media_kind": "image" if args.task_mode == "createimage" else "video",
                                "count": args.flow_count,
                                "output_prefix": prompt_file_prefix(prompt, prompt_no),
                            })
                            log_line(f"[flow] continuous queued download after all prompts: prompt #{prompt_no}")
                        else:
                            media_ok, media_reason = wait_new_completed_media(
                                page,
                                before_ids=pre_submit_tiles,
                                expected_count=max(1, int(args.flow_count or "1")),
                                timeout_sec=args.download_wait_sec,
                            )
                            if not media_ok:
                                done_wait = wait_generation_complete(page, timeout_sec=90)
                                if not done_wait:
                                    raise RuntimeError(f"generation_not_completed:{media_reason}")
                            license_guard_or_raise(force=True)
                            download_resolution = "1K" if args.task_mode == "createimage" else args.download_resolution
                            dl_ok, dl_step = auto_download_with_retry(page, resolution=download_resolution, timeout_sec=220, before_ids=pre_submit_tiles, output_prefix=prompt_file_prefix(prompt, prompt_no), output_dir=args.output_dir)
                            if not dl_ok:
                                raise RuntimeError(f"auto_download_failed:{dl_step}")

                    ok = True
                    break
                except (PWTimeout, Exception) as e:
                    needs_clear_before_insert = True
                    log_line(f"[flow] prompt #{prompt_no} attempt {attempt} error: {e}")
                    if submitted:
                        if flow_rejected or "flow_error:" in str(e):
                            # Flow rejected this exact original prompt number. Do
                            # not queue/download it and do not reuse its number.
                            log_line(f"[flow] prompt #{prompt_no} rejected by Flow; mark failed and continue with prompt #{prompt_no + 1}")
                            ok = False
                            break
                        log_line(f"[flow] prompt #{prompt_no} was already submitted; skip retry to avoid duplicate prompt")
                        ok = True
                        break
                    if attempt <= args.max_retries:
                        time.sleep(2)

            # Sau khi tạo/download thành công: reset UI để prompt kế tiếp upload ảnh mới đúng paired-mode
            if ok and prompt_no < total:
                try:
                    
                    # Do not force the Flow browser window to front after each prompt.
                    close_open_menus(page)
                    clear_attached_references(page)

                    # In delayed/continuous mode, keep the same Flow project:
                    # previous result tiles must remain visible until their FIFO
                    # download turn. Opening New Project here made only the final
                    # prompt downloadable. Single mode may still isolate projects.
                    delayed_mode = int(args.download_delay_prompts or 0) > 0 or bool(args.continuous_download)
                    if refs_dir is not None and not delayed_mode:
                        try:
                            _try_click_new_project(page)
                            time.sleep(1.2)
                        except Exception:
                            pass
                    elif refs_dir is not None:
                        log_line(f"[flow] keep current project for delayed FIFO; clearing reference before prompt #{prompt_no + 1}")

                    next_box = find_input_box(page)
                    clear_prompt_box(page, next_box)
                    clear_attached_references(page)
                    needs_clear_before_insert = False
                except Exception as e:
                    log_line(f"[flow] clear-after-success prompt #{prompt_no} error: {e}")
                    needs_clear_before_insert = True

            if not ok:
                log_line(f"[flow] prompt #{prompt_no} failed after retries, skip and continue")
                failed = state.get("failed_prompts", []) if isinstance(state, dict) else []
                if prompt_no not in failed:
                    failed.append(prompt_no)
                state = {
                    "done": idx,
                    "total": total,
                    "failed_prompts": failed,
                    "last_failed": prompt_no,
                    "ts": int(time.time()),
                }
                save_state(args.state, state)
                continue

            prior_failed = state.get("failed_prompts", []) if isinstance(state, dict) else []
            state = {
                "done": prompt_no,
                "total": total,
                "failed_prompts": prior_failed,
                "last_prompt_no": prompt_no,
                "ts": int(time.time()),
            }
            save_state(args.state, state)

            if prompt_no % args.batch_size == 0 or prompt_no == total:
                log_line(f"[flow] progress: {prompt_no}/{total}")

        if args.auto_download and (args.continuous_download or int(args.download_delay_prompts or 0) > 0):
            # Final prompts have no later submissions providing a natural delay.
            # Keep the head item queued until every expected output is downloaded;
            # never pop-and-forget the last prompt on a transient incomplete tile.
            final_idle_deadline = time.time() + max(900, int(args.download_wait_sec or 480) * 2)
            while delayed_downloads:
                item = delayed_downloads[0]
                attempts = int(item.get("final_attempts") or 0) + 1
                item["final_attempts"] = attempts
                license_guard_or_raise(force=True)
                log_line(f"[flow] final FIFO download prompt #{item['prompt_no']} attempt {attempts}")
                dl_ok, dl_step = download_prompt_queue_item(page, item, args, claimed_ids=claimed_media_ids)
                if dl_ok:
                    delayed_downloads.pop(0)
                    final_idle_deadline = time.time() + max(900, int(args.download_wait_sec or 480) * 2)
                    log_line(f"[flow] final FIFO downloaded prompt #{item['prompt_no']}: {dl_step}")
                    continue
                log_line(f"[flow] final FIFO waiting prompt #{item['prompt_no']}: {dl_step}")
                if time.time() >= final_idle_deadline:
                    raise RuntimeError(f"final_download_incomplete_prompt_{item['prompt_no']}:{dl_step}")
                # Flow may still be rendering or replacing placeholder tiles.
                wait_generation_complete(page, timeout_sec=120)
                time.sleep(min(30, 5 + attempts * 3))

        log_line("[flow] done all prompts")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default="manual")
    ap.add_argument("--prompts", type=Path, required=True)
    default_state = Path.home() / ".openclaw" / "workspace" / ".flow_state.json"
    ap.add_argument("--state", type=Path, default=default_state)
    ap.add_argument("--fresh-run", action="store_true", help="Ignore previous worker state and force fresh settings")
    ap.add_argument("--cdp", default="http://127.0.0.1:18800")
    ap.add_argument("--batch-size", type=int, default=10)
    ap.add_argument("--max-retries", type=int, default=2)
    ap.add_argument("--pre-paste-min", type=float, default=0.5)
    ap.add_argument("--pre-paste-max", type=float, default=1.5)
    ap.add_argument("--before-create-sec", type=float, default=5.0)
    ap.add_argument("--type-delay-ms", type=float, default=12.0, help="Độ trễ mỗi ký tự khi gõ prompt")
    ap.add_argument("--between-prompts-sec", type=float, default=10.0)
    ap.add_argument("--aspect-ratio", default="9:16", help="Tỉ lệ video: 16:9 | 9:16")
    ap.add_argument("--start-from", type=int, default=None, help="1-based prompt index")
    ap.add_argument("--refs-dir", type=Path, default=None, help="Thư mục ảnh tham chiếu (1.jpg/1.png map prompt #1)")
    ap.add_argument("--character-images", default="", help="Danh sách ảnh nhân vật upload từ AI Prompt Studio, phân tách bằng dấu phẩy")
    ap.add_argument("--auto-download", action="store_true", help="Tự động tải video sau khi render xong")
    ap.add_argument("--submit-only", action="store_true", help="Chỉ submit prompt rồi chuyển prompt tiếp theo, không chờ render và không auto-download")
    ap.add_argument("--continuous-download", action="store_true", help="Chạy liên tục: submit prompt tiếp ngay, prompt nào xong thì tải sau")
    ap.add_argument("--download-resolution", default="720", help="Độ phân giải tải về, mặc định 720")
    ap.add_argument("--output-dir", default="", help="Thư mục lưu ảnh/video tải về")
    ap.add_argument("--download-wait-sec", type=int, default=420, help="Thời gian chờ render hoàn tất trước khi tải")
    ap.add_argument("--download-delay-prompts", type=int, default=0, help="Chế độ chạy liên tục: chờ N prompt sau mới tải prompt cũ")

    # Flow settings (đồng bộ với extension)
    ap.add_argument("--task-mode", default="createvideo", choices=["createvideo", "createimage"], help="Chế độ tạo: video hoặc image")
    ap.add_argument("--flow-model", default="default", help="Model key: default|veo3_lite|veo3_fast|veo3_quality|nano_banana_pro|nano_banana2|imagen4|omni_flash")
    ap.add_argument("--flow-aspect-ratio", default="16:9", help="Tỉ lệ: 16:9 | 9:16 | square | landscape_4_3 | portrait_3_4")
    ap.add_argument("--flow-count", default="1", help="Số lượng output x1/x2/x3/x4")
    ap.add_argument("--omni-duration", default="", choices=["", "4s", "6s", "8s", "10s"], help="Thời lượng chỉ áp dụng cho omni_flash")
    ap.add_argument("--video-sub-mode", default="frames", choices=["frames", "ingredients"], help="Video sub mode")
    ap.add_argument("--ref-mode", choices=["paired", "all"], default="paired", help="paired: N.jpg cho prompt N; all: toàn bộ ảnh cho mỗi prompt")
    ap.add_argument("--allow-multi-refs", action="store_true", help="Chỉ dành cho job nhiều ảnh rõ ràng như Dance Wardrobe")
    ap.add_argument("--paired-mode", dest="paired_mode", action="store_true", help="Map ảnh theo số prompt (1.jpg->prompt1)")
    ap.add_argument("--no-paired-mode", dest="paired_mode", action="store_false", help="Không map theo số prompt")
    ap.set_defaults(paired_mode=True)

    args = ap.parse_args()
    # Auto download switch has priority over run mode. If ON, never run submit-only.
    if args.auto_download:
        args.submit_only = False
    elif args.submit_only:
        args.auto_download = False
    log_line(f'[flow] auto_download={args.auto_download}, submit_only={args.submit_only}, continuous_download={args.continuous_download}, download_delay_prompts={args.download_delay_prompts}')
    run(args)


if __name__ == "__main__":
    main()
