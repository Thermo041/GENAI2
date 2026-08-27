#!/usr/bin/env node
/**
 * Local webhook relay for development.
 *
 * GitHub cannot reach localhost, so deliveries are relayed through smee.io —
 * a pure-Node proxy that forwards ONLY to the webhook path, unlike a tunnel that
 * exposes the whole backend to the internet.
 *
 * Usage:
 *   npm run webhook:proxy            # uses SMEE_URL from .env
 *   npm run webhook:proxy -- --new   # creates a fresh channel and prints it
 *
 * Then paste the printed channel URL into the GitHub App's "Webhook URL".
 */
import SmeeClient from 'smee-client';
import { config } from '../src/config/env.js';

const argv = process.argv.slice(2);
const wantsNew = argv.includes('--new');
const explicit = argv.find((arg) => arg.startsWith('https://smee.io/'));
const target = `${config.serverUrl}/api/github/webhook`;

let source = explicit || (wantsNew ? null : process.env.SMEE_URL);

if (!source) {
  if (!wantsNew && !process.env.SMEE_URL) {
    console.log('No SMEE_URL in .env — creating a new channel…\n');
  }
  source = await SmeeClient.createChannel();
  console.log('New smee channel created. Add this to backend/.env so it is reused:\n');
  console.log(`  SMEE_URL=${source}\n`);
}

console.log('='.repeat(70));
console.log('CodeWeave webhook relay');
console.log('='.repeat(70));
console.log(`  GitHub App "Webhook URL"  ->  ${source}`);
console.log(`  forwarding to             ->  ${target}`);
console.log(`  webhook secret            ->  the GITHUB_WEBHOOK_SECRET already in .env`);
console.log('');
console.log('  Also tick these events in the App settings (Permissions & events):');
console.log('    Push · Pull request · Installation · Installation repositories');
console.log('');
console.log('  Only the webhook path is exposed. Signature verification still applies,');
console.log('  so unsigned or mis-signed deliveries are rejected with 403.');
console.log('  Stop with Ctrl+C.');
console.log('='.repeat(70));

const smee = new SmeeClient({ source, target, logger: console });
await smee.start();

const shutdown = async () => {
  console.log('\nStopping webhook relay.');
  await smee.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
