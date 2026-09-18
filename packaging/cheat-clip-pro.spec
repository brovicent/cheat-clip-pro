# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect data files for libraries that ship model/assets
whisper_datas = collect_data_files('whisper') if 'whisper' in sys.modules or True else []
yt_dlp_datas = collect_data_files('yt_dlp') if 'yt_dlp' in sys.modules or True else []

hidden_imports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespans',
    'uvicorn.lifespans.on',
    'fastapi',
    'fastapi.staticfiles',
    'starlette',
    'starlette.staticfiles',
    'starlette.routing',
    'torch',
    'cv2',
    'whisper',
    'yt_dlp',
    'youtube_transcript_api',
    'google.genai',
    'pydantic',
    'dotenv',
    'python_multipart',
    'multipart',
]

spec_dir = os.path.dirname(os.path.abspath(SPEC))
project_root = os.path.dirname(spec_dir)
backend_dir = os.path.join(project_root, 'backend')
dist_dir = os.path.join(project_root, 'dist')

extra_datas = []
if os.path.exists(os.path.join(backend_dir, 'fonts')):
    extra_datas.append((os.path.join(backend_dir, 'fonts'), 'fonts'))
if os.path.exists(os.path.join(backend_dir, 'haarcascade_frontalface_default.xml')):
    extra_datas.append((os.path.join(backend_dir, 'haarcascade_frontalface_default.xml'), '.'))
if os.path.exists(dist_dir):
    extra_datas.append((dist_dir, 'dist'))

a = Analysis(
    [os.path.join(backend_dir, 'main.py')],
    pathex=[backend_dir, project_root],
    binaries=[],
    datas=whisper_datas + yt_dlp_datas + extra_datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'unittest', 'test'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='cheat-clip-pro',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(spec_dir, 'app.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='cheat-clip-pro',
)
