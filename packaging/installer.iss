; Inno Setup Script for Cheat Clip Pro
; Compiles a standalone, one-click Windows installer (no Python or Node required on client machine)

#define MyAppName "Cheat Clip Pro"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Cheat Clip Pro"
#define MyAppURL "https://github.com/galihjuansaputra/cheat-clip-pro"
#define MyAppExeName "cheat-clip-pro.exe"

[Setup]
AppId={{D37E745A-8EFA-4654-94F4-13B2E9AA5590}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\CheatClipPro
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Installs for current user without requiring Administrator / UAC prompt
PrivilegesRequired=lowest
OutputDir=..\dist_installer
OutputBaseFilename=CheatClipPro-Setup-v{#MyAppVersion}
SetupIconFile=app.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Dist_app contains all pre-packaged backend, frontend dist, python runtime, and ffmpeg
Source: "..\dist_app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
