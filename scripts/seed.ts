/**
 * CLI entry point for seeding: `npm run db:seed`.
 *
 * Runs with the `react-server` export condition so the `server-only` guards in
 * the data layer resolve to their no-op build instead of throwing — this script
 * is a server, it is just not a request.
 */
import { seedDemoBusiness } from "../src/db/seed";

async function main() {
  const { businessId, created } = await seedDemoBusiness();
  console.log(
    created
      ? `Created demo business ${businessId}`
      : `A business already exists (${businessId}) — nothing to do.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
