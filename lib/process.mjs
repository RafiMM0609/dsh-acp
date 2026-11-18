import { spawn } from 'node:child_process';
import path from 'node:path';

/** Terminate only a process tree launched and owned by this adapter. */
export function stopAgentProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch {} }
  }, 2000);
  force.unref?.();
  child.once('exit', () => clearTimeout(force));
  if (process.platform === 'win32') {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    try {
      const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { try { child.kill(); } catch {} });
      killer.on('exit', code => { if (code !== 0) { try { child.kill(); } catch {} } });
      killer.unref();
    } catch { try { child.kill(); } catch {} }
  } else {
    // Agents are spawned as their own process group on Unix.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} }
  }
}
