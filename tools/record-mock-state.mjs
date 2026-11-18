// Records every change of the mock's GET /__test/state to a JSONL file, so a manual
// device run leaves an exact trail of counters and job states (before/after evidence).
// Usage: node tools/record-mock-state.mjs [baseUrl] [outFile]
// Read-only: it only calls GET /__test/state.
import { appendFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const out = process.argv[3] ?? 'docs/evidence/mock-state-log.jsonl';
let last = '';

async function tick() {
  try {
    const response = await fetch(`${base}/__test/state`);
    const state = await response.json();
    const signature = JSON.stringify(state);
    if (signature !== last) {
      last = signature;
      appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), ...state })}\n`);
      const s = state.stats;
      const jobs = state.jobs.map((job) => `${job.jobId}:${job.status}/${job.revision}`).join(' ');
      console.log(
        `${new Date().toLocaleTimeString()} mode=${state.mode} create=${s.createRequests} new=${s.newJobs} dup=${s.duplicateHits} bytes=${s.acceptedBytes} del=${s.deleteRequests} ${jobs}`,
      );
    }
  } catch (error) {
    console.error(`unreachable: ${error.message}`);
  }
}

console.log(`Recording ${base}/__test/state -> ${out}`);
setInterval(tick, 300);
void tick();
