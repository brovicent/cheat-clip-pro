#!/usr/bin/env python3
"""
Master One-Click Installer Builder for Cheat Clip Pro.
Orchestrates:
  1. Frontend build (npm run build)
  2. Backend freezing with PyInstaller (cheat-clip-pro.spec)
  3. Bundling FFmpeg & static assets into dist_app/
  4. Inno Setup compilation (CheatClipPro-Setup-vX.X.X.exe)
"""

import os
import sys
import shutil
import subprocess
import glob
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
PACKAGING_DIR = PROJECT_ROOT / "packaging"
DIST_APP = PROJECT_ROOT / "dist_app"
DIST_INSTALLER = PROJECT_ROOT / "dist_installer"
VENV_PYTHON = PROJECT_ROOT / "venv" / "Scripts" / "python.exe"
VENV_PYINSTALLER = PROJECT_ROOT / "venv" / "Scripts" / "pyinstaller.exe"

# If venv python not found, fallback to sys.executable
PYTHON_EXE = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
PYINSTALLER_EXE = str(VENV_PYINSTALLER) if VENV_PYINSTALLER.exists() else "pyinstaller"


def log(msg: str):
    print(f"\n[BUILD] >>> {msg}")


def find_iscc() -> str:
    """Locate Inno Setup compiler (ISCC.exe)."""
    which_iscc = shutil.which("iscc")
    if which_iscc:
        return which_iscc

    local_app_data = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(local_app_data, "Programs", "Inno Setup 6", "ISCC.exe"),
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    # Search LocalAppData Programs
    found = glob.glob(os.path.join(local_app_data, "Programs", "**", "ISCC.exe"), recursive=True)
    if found:
        return found[0]

    return ""


def find_ffmpeg_binaries():
    """Find ffmpeg.exe and ffprobe.exe on the system."""
    ffmpeg_exe = shutil.which("ffmpeg")
    ffprobe_exe = shutil.which("ffprobe")

    if not ffmpeg_exe or not ffprobe_exe:
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        # Check WinGet packages
        pattern = os.path.join(local_app_data, "Microsoft", "WinGet", "Packages", "**", "ffmpeg.exe")
        matches = glob.glob(pattern, recursive=True)
        if matches:
            ffmpeg_exe = matches[0]
            bin_dir = Path(ffmpeg_exe).parent
            candidate_ffprobe = bin_dir / "ffprobe.exe"
            if candidate_ffprobe.exists():
                ffprobe_exe = str(candidate_ffprobe)

    return ffmpeg_exe, ffprobe_exe


def ensure_ico():
    """Ensure packaging/app.ico exists."""
    ico_path = PACKAGING_DIR / "app.ico"
    if ico_path.exists():
        return
    log("Generating default application icon...")
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle([10, 10, 246, 246], radius=48, fill=(134, 59, 255, 255))
    draw.polygon([(80, 50), (190, 128), (80, 206)], fill=(255, 255, 255, 255))
    PACKAGING_DIR.mkdir(parents=True, exist_ok=True)
    im.save(str(ico_path), format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    log(f"Icon generated at {ico_path}")


def step_build_frontend():
    log("Step 1/5: Building production frontend with Vite...")
    cmd = ["npm.cmd" if os.name == "nt" else "npm", "run", "build"]
    res = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if res.returncode != 0:
        raise RuntimeError("Frontend build failed!")
    index_html = PROJECT_ROOT / "dist" / "index.html"
    if not index_html.exists():
        raise RuntimeError("dist/index.html not generated!")
    log("Frontend build successful.")


def step_pyinstaller():
    log("Step 2/5: Freezing Python backend with PyInstaller...")
    spec_file = PACKAGING_DIR / "cheat-clip-pro.spec"
    cmd = [
        PYINSTALLER_EXE,
        "--noconfirm",
        "--distpath", str(PROJECT_ROOT / "dist_pyinstaller"),
        "--workpath", str(PROJECT_ROOT / "build"),
        str(spec_file)
    ]
    res = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if res.returncode != 0:
        raise RuntimeError("PyInstaller build failed!")
    log("PyInstaller backend build successful.")


def step_stage_dist_app():
    log("Step 3/5: Staging files into dist_app/...")
    if DIST_APP.exists():
        shutil.rmtree(DIST_APP, ignore_errors=True)
    DIST_APP.mkdir(parents=True, exist_ok=True)

    # 1. Copy PyInstaller output
    pyinstaller_out = PROJECT_ROOT / "dist_pyinstaller" / "cheat-clip-pro"
    if not pyinstaller_out.exists():
        raise RuntimeError(f"Expected PyInstaller output at {pyinstaller_out} not found!")

    log("Copying PyInstaller binaries...")
    for item in pyinstaller_out.iterdir():
        dest = DIST_APP / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest)

    # 2. Copy bundled FFmpeg and FFprobe into dist_app/bin/
    ffmpeg_exe, ffprobe_exe = find_ffmpeg_binaries()
    bin_dir = DIST_APP / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    if ffmpeg_exe and os.path.exists(ffmpeg_exe):
        log(f"Bundling FFmpeg: {ffmpeg_exe}")
        shutil.copy2(ffmpeg_exe, bin_dir / "ffmpeg.exe")
    else:
        log("WARNING: ffmpeg.exe not found on system! End user will need system FFmpeg.")

    if ffprobe_exe and os.path.exists(ffprobe_exe):
        log(f"Bundling FFprobe: {ffprobe_exe}")
        shutil.copy2(ffprobe_exe, bin_dir / "ffprobe.exe")

    # 3. Copy Icon
    shutil.copy2(PACKAGING_DIR / "app.ico", DIST_APP / "app.ico")

    # 4. Copy templates & static configs
    env_template = BACKEND_DIR / ".env.template"
    if env_template.exists():
        shutil.copy2(env_template, DIST_APP / ".env.template")

    # 5. Ensure frontend dist is inside dist_app
    frontend_dist = PROJECT_ROOT / "dist"
    if frontend_dist.exists():
        shutil.copytree(frontend_dist, DIST_APP / "dist", dirs_exist_ok=True)

    log(f"Staged {len(list(DIST_APP.iterdir()))} top-level items into dist_app/")


def step_compile_installer():
    log("Step 4/5: Compiling Windows Installer with Inno Setup...")
    iscc = find_iscc()
    if not iscc:
        raise RuntimeError(
            "ISCC.exe (Inno Setup Compiler) not found! "
            "Install it via: winget install JRSoftware.InnoSetup"
        )

    iss_file = PACKAGING_DIR / "installer.iss"
    cmd = [iscc, str(iss_file)]
    log(f"Running: {iscc} {iss_file}")
    res = subprocess.run(cmd, cwd=str(PACKAGING_DIR))
    if res.returncode != 0:
        raise RuntimeError("Inno Setup compilation failed!")


def main():
    log("Starting Cheat Clip Pro Installer Build Process...")
    DIST_INSTALLER.mkdir(parents=True, exist_ok=True)

    ensure_ico()
    step_build_frontend()
    step_pyinstaller()
    step_stage_dist_app()
    step_compile_installer()

    # Find resulting installer
    installers = list(DIST_INSTALLER.glob("CheatClipPro-Setup*.exe"))
    if installers:
        latest = max(installers, key=os.path.getmtime)
        size_mb = latest.stat().st_size / (1024 * 1024)
        log("==========================================================")
        log("            BUILD FINISHED SUCCESSFULLY!                  ")
        log("==========================================================")
        print(f"\nInstaller created: {latest}")
        print(f"File Size: {size_mb:.2f} MB")
        print("\nTo test, simply double-click the .exe installer!")
        print("It will install Cheat Clip Pro to your PC with zero dependencies.\n")
    else:
        log("Build completed, but could not find output .exe in dist_installer/")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[BUILD ERROR]: {e}", file=sys.stderr)
        sys.exit(1)
