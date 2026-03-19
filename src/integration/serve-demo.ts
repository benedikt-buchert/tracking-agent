import { startFixtureSiteServer } from "./site-fixture.js";

const server = await startFixtureSiteServer();

process.stderr.write(`Demo fixture running at ${server.baseUrl}\n`);
process.stderr.write(`${server.baseUrl}/deterministic/\n`);
process.stderr.write(`${server.baseUrl}/mutated/\n`);
process.stderr.write("Press Ctrl+C to stop.\n");

async function shutdown() {
  await server.close().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
