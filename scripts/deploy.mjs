import { execSync, spawnSync } from 'node:child_process';

const message = process.argv[2] || `deploy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

function run(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function stdout(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

// 변경사항 확인
run('git add .');
const dirty = stdout('git status --porcelain');

if (dirty) {
  run(`git commit -m "${message}"`);
} else {
  console.log('변경사항 없음 — 현재 커밋 그대로 push합니다.');
}

run('git push');

const branch = stdout('git rev-parse --abbrev-ref HEAD');
const sha = stdout('git rev-parse --short HEAD');
console.log(`\nbranch: ${branch}  commit: ${sha}`);
console.log('Railway 빌드가 시작됩니다. 대시보드에서 진행 상황을 확인하세요.');
