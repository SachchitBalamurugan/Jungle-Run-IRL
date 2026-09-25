// Starts the Python body tracker and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const procs = [
  ['tracker', python, ['tracker/server.py', ...process.argv.slice(2)]],
  ['game', 'npx', ['vite']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'tracker' ? '\x1b[33m[tracker]\x1b[0m ' : '\x1b[36m[game]\x1b[0m    ';
  const pipe = (s) => (d) => s.write(d.toString().replace(/^(?=.)/gm, tag));
  p.stdout.on('data', pipe(process.stdout));
  p.stderr.on('data', pipe(process.stderr));
  p.on('exit', (code) => {
    console.log(`${tag}exited (${code})`);
    shutdown();
  });
  return p;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
