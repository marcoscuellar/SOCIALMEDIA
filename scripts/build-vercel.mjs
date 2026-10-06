import fs from 'node:fs';
// All app pages are served by the password-protected function, so public/ stays empty on purpose.
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/.keep', '');
console.log('Launch Room: nothing to bundle; the private function serves web/.');
