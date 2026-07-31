#define MyAppName "Research OS"
#ifndef MyAppVersion
#define MyAppVersion "0.2.0-dev"
#endif
#define MyAppPublisher "Research OS"
#define RepoRoot "..\.."

[Setup]
AppId={{D8DA7917-B8F9-4C68-A0EB-0BCE21D86BD3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\ResearchOS
DefaultGroupName={#MyAppName}
OutputDir=dist
OutputBaseFilename=ResearchOS-Setup-{#MyAppVersion}-x64
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "installnode"; Description: "Download and install signed Node.js 22 LTS if it is missing or outdated"; GroupDescription: "Prerequisites:"; Flags: checkedonce

[Dirs]
Name: "{app}\projects"
Name: "{app}\artifacts"
Name: "{app}\runtime"

[Files]
Source: "{#RepoRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*,.env,projects\*,artifacts\*,runtime\*,node_modules\*,apps\mastra\.mastra\*,apps\server\dist\*,installer\windows\build\*,installer\windows\dist\*"

[Icons]
Name: "{group}\Research OS"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -StartOnly"; WorkingDir: "{app}"
Name: "{autodesktop}\Research OS"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -StartOnly"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" {code:NodeArgument}"; WorkingDir: "{app}"; Description: "Install prerequisites and start Research OS"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -Stop"; RunOnceId: "StopResearchOS"; Flags: runhidden

[Code]
function NodeArgument(Param: String): String;
begin
  if WizardIsTaskSelected('installnode') then
    Result := '-InstallNodeIfMissing'
  else
    Result := '';
end;
