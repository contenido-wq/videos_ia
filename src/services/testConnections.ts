import { getAccountCredits } from "./kieAiService";
import { getAccountInfo } from "./apifyService";
import { listVoices } from "./elevenlabsService";

async function main() {
  console.log("== ElevenLabs ==");
  const voices = await listVoices();
  console.log(`OK - ${voices.length} voces disponibles`);

  console.log("== kie.ai ==");
  const credits = await getAccountCredits();
  console.log(`OK - ${credits} créditos disponibles`);

  console.log("== Apify ==");
  const account = await getAccountInfo();
  console.log(`OK - usuario ${account.username}, plan ${account.plan}`);
}

main().catch((err) => {
  console.error("FALLÓ:", err.message);
  process.exit(1);
});
