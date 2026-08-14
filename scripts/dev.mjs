import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const electronBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'electron.cmd')
  : path.join(root, 'node_modules', '.bin', 'electron');
const tscBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(root, 'node_modules', '.bin', 'tsc');
const viteBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'vite.cmd')
  : path.join(root, 'node_modules', '.bin', 'vite');

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://localhost:5173'
};

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
    ...options
  });

  child.on('exit', (code, signal) => {
    if (signal || code) {
      process.exitCode = code ?? 1;
    }
  });

  return child;
}

function runAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
      ...options
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

await runAndWait(tscBin, ['-p', 'tsconfig.main.json'], { cwd: root });

const typecheck = run(tscBin, ['-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'], {
  cwd: root
});
const renderer = run(viteBin, ['--host', '127.0.0.1'], { cwd: root });

setTimeout(() => {
  run(electronBin, ['.'], { cwd: root });
}, 1500);

function shutdown() {
  typecheck.kill('SIGINT');
  renderer.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
