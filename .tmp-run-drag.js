// Tiny wrapper: read payload file and invoke playwright-cli run-code via spawnSync.
var fs = require('fs');
var cp = require('child_process');
var payload = fs.readFileSync('.tmp-drag-payload.js', 'utf8');
var res = cp.spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright-cli', 'run-code', payload], {
  encoding: 'utf8',
  shell: false,
});
process.stdout.write('=== STDOUT ===\n' + (res.stdout || '') + '\n');
process.stdout.write('=== STDERR ===\n' + (res.stderr || '') + '\n');
process.stdout.write('=== EXIT: ' + res.status + ' ===\n');
process.stdout.write('=== ERROR: ' + (res.error ? res.error.message : 'none') + ' ===\n');
process.exit(res.status || 0);
