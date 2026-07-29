#define MyAppName "Research OS"
#define MyAppVersion "0.2.0-dev"
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
Name: "installdocker"; Description: "Download and install signed Docker Desktop if it is missing"; GroupDescription: "Prerequisites:"; Flags: checkedonce

[Dirs]
Name: "{app}\projects"
Name: "{app}\artifacts"

[Files]
Source: "{#RepoRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*,.env,projects\*,artifacts\*,postgres-data\*,minio-data\*,mlflow-data\*,n8n-data\*,installer\windows\build\*,installer\windows\dist\*,.venv-installer\*,__pycache__\*,*.pyc"

[Icons]
Name: "{group}\Research OS"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -StartOnly"; WorkingDir: "{app}"
Name: "{autodesktop}\Research OS"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -StartOnly"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\bootstrap.ps1"" -InstallRoot ""{app}"" {code:DockerArgument}"; WorkingDir: "{app}"; Description: "Install prerequisites and start Research OS"; Flags: postinstall nowait skipifsilent

[Code]
function DockerArgument(Param: String): String;
begin
  if WizardIsTaskSelected('installdocker') then
    Result := '-InstallDockerIfMissing'
  else
    Result := '';
end;
