import { parseEnvironment } from "../src/lib/config/env";

async function main(): Promise<void> {
  const environment = parseEnvironment(process.env);
  if (environment.DATASTORE_PROVIDER !== "firestore") {
    throw new Error(
      "샘플 시드를 실행하려면 DATASTORE_PROVIDER=firestore가 필요합니다.",
    );
  }
  if (environment.FIRESTORE_EMULATOR_HOST === undefined) {
    throw new Error(
      "개발용 샘플은 Firestore Emulator에만 넣을 수 있습니다. FIRESTORE_EMULATOR_HOST를 설정하세요.",
    );
  }

  const [{ getFirestoreClient }, { seedSamplePublishedPosts }] =
    await Promise.all([
      import("../src/db/firestore/client"),
      import("../src/db/firestore/seed-sample-published-posts"),
    ]);
  const firestore = getFirestoreClient(environment);
  const result = await seedSamplePublishedPosts(firestore);

  process.stdout.write(
    `Firestore 샘플 시드 완료: 게시물 ${result.postsProcessed}건, 생성 ${result.documentsCreated}개, 유지 ${result.documentsPreserved}개\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  process.stderr.write(`Firestore 샘플 시드 실패: ${message}\n`);
  process.exitCode = 1;
});
