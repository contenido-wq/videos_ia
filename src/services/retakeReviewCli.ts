import readline from "readline/promises";
import type { RetakeCandidate } from "./retakeDetectionService";
import type { CutRange } from "./videoTrimService";

export async function reviewRetakeCandidates(candidates: RetakeCandidate[]): Promise<CutRange[]> {
  if (candidates.length === 0) return [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const approved: CutRange[] = [];
  let approveRest = false;
  let rejectRest = false;

  try {
    for (const [i, c] of candidates.entries()) {
      console.log(`\n[${i + 1}/${candidates.length}] (${c.type}) ${c.start.toFixed(1)}s - ${c.end.toFixed(1)}s`);
      console.log(`  "${c.quote}"`);
      console.log(`  motivo: ${c.reason}`);

      if (approveRest) {
        approved.push({ start: c.start, end: c.end });
        continue;
      }
      if (rejectRest) {
        continue;
      }

      const answer = (await rl.question("  ¿cortar este tramo? [s/n/a=aprobar el resto/r=rechazar el resto]: "))
        .trim()
        .toLowerCase();

      if (answer === "a") {
        approveRest = true;
        approved.push({ start: c.start, end: c.end });
      } else if (answer === "r") {
        rejectRest = true;
      } else if (answer === "s") {
        approved.push({ start: c.start, end: c.end });
      }
      // cualquier otra respuesta (incluido "n") = no se corta
    }
  } finally {
    rl.close();
  }

  return approved;
}
