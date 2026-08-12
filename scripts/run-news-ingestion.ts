import { MemoryArticleRepository } from "../src/repositories/article-memory.repository";
import { runNewsIngestion } from "../src/pipeline/orchestrator";

const repository = new MemoryArticleRepository();
const result = await runNewsIngestion({ articleRepository: repository });

console.log(
  JSON.stringify(
    {
      event: "news_ingestion_completed",
      status: result.status,
      sourceOutcomes: result.outcomes.map((outcome) => ({
        sourceId: outcome.sourceId,
        status: outcome.status,
        itemCount: outcome.items.length,
        issueCodes: outcome.issues.map((issue) => issue.code),
      })),
      collectedCount: result.collectedCount,
      deduplicatedCount: result.deduplicatedCount,
      insertedCount: result.storage.insertedCount,
      candidateCount: result.candidates.length,
      eligibleByScoreCount: result.candidates.filter(
        (candidate) => candidate.threshold.passed,
      ).length,
      evidenceCandidateCount: result.candidates.filter(
        (candidate) => candidate.evidenceIds.length > 0,
      ).length,
      publishingAttempted: false,
      runIssueCodes: result.runIssues.map((issue) => issue.code),
    },
    null,
    2,
  ),
);

if (result.status === "failed") {
  process.exitCode = 1;
}
