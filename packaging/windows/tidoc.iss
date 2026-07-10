#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\tidoc"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\release"
#endif

[Setup]
AppId={{C4B0DD63-6D7E-4D9E-A492-6925D73BE91A}
AppName=Tidoc
AppVersion={#MyAppVersion}
AppVerName=Tidoc {#MyAppVersion}
AppPublisher=totok22
AppPublisherURL=https://github.com/totok22/tidoc
AppSupportURL=https://github.com/totok22/tidoc/issues
AppUpdatesURL=https://github.com/totok22/tidoc/releases
DefaultDirName={localappdata}\Programs\Tidoc
DefaultGroupName=Tidoc
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=tidoc-core-windows-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\tidoc.exe
VersionInfoVersion={#MyAppVersion}.0

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Tidoc"; Filename: "{app}\tidoc.exe"
Name: "{autodesktop}\Tidoc"; Filename: "{app}\tidoc.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\tidoc.exe"; Description: "启动 Tidoc"; Flags: nowait postinstall skipifsilent unchecked
