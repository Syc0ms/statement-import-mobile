// Starts the unmodified kit mock on a random loopback port with a temp state file.
// Usage: node start-mock.mjs <statePath>. Prints {"port":N} once listening.
import { createMockServer } from '../../../kit/mock-server.mjs';

const statePath = process.argv[2];
if (!statePath) {
  console.error('statePath argument is required');
  process.exit(2);
}
const server = createMockServer({ statePath });
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
