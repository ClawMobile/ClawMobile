// Example remediation for Task 2 Finding F1.
// Goal: remove the public bash escape hatch and replace free-form shell commands
// with structured, allowlisted actions.

type SafeShellAction =
  | { kind: 'adb_ime_list' }
  | { kind: 'adb_ime_set'; imeId: string }
  | { kind: 'termux_toast'; text: string }
  | { kind: 'termux_battery_status' };

function minimalEnv() {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '/tmp',
  };
}

export async function android_shell_safe(action: SafeShellAction) {
  switch (action.kind) {
    case 'adb_ime_list':
      return runWithTimeout('adb', ['shell', 'ime', 'list', '-s'], 10_000, minimalEnv());
    case 'adb_ime_set':
      if (!/^[A-Za-z0-9._\/$:-]+$/.test(action.imeId)) {
        throw new Error('invalid IME identifier');
      }
      return runWithTimeout('adb', ['shell', 'ime', 'set', action.imeId], 10_000, minimalEnv());
    case 'termux_toast':
      return runWithTimeout('termux-toast', [action.text], 10_000, minimalEnv());
    case 'termux_battery_status':
      return runWithTimeout('termux-battery-status', [], 10_000, minimalEnv());
  }
}

// The public schema should expose `action`, not arbitrary { backend, cmd }.
