// Windows Hello через встроенный в Windows PowerShell (UserConsentVerifier). Сторонние программы не нужны.
const { execFile } = require('node:child_process');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(-1); $t.Result }
$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier]
if ('__MODE__' -eq 'check') {
  $r = Await ($verifier::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
} else {
  $r = Await ($verifier::RequestVerificationAsync('__MESSAGE__')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
}
[Console]::Out.Write($r.ToString())
`;

function run(mode, message = '', timeoutMs = 15000) {
  const script = SCRIPT.replace('__MODE__', mode).replace('__MESSAGE__', message.replace(/'/g, "''"));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout) => resolve(error ? '' : String(stdout).trim()),
    );
  });
}

let availability = null;

// На Mac вместо Windows Hello — Touch ID (встроен в Electron).
async function isAvailable() {
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    return systemPreferences.canPromptTouchID();
  }
  if (process.platform !== 'win32') return false;
  if (availability === null) availability = (await run('check')) === 'Available';
  return availability;
}

async function verify(message) {
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    try {
      await systemPreferences.promptTouchID(message.replace(/^Horizon:\s*/, ''));
      return true;
    } catch {
      return false;
    }
  }
  return (await run('verify', message, 120000)) === 'Verified';
}

module.exports = { isAvailable, verify };
