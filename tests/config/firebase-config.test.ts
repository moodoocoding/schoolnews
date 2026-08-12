import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("Firebase 프로젝트 설정", () => {
  it("기본 Firestore 규칙과 인덱스 파일을 연결한다", () => {
    const firebaseConfig = JSON.parse(readProjectFile("firebase.json")) as {
      firestore: { rules: string; indexes: string };
    };

    expect(firebaseConfig.firestore).toEqual({
      rules: "firestore.rules",
      indexes: "firestore.indexes.json",
    });
  });

  it("브라우저와 모바일의 직접 읽기·쓰기를 모두 차단한다", () => {
    const rules = readProjectFile("firestore.rules");

    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain("allow read, write: if false;");
  });

  it("published 목록 정렬에 필요한 복합 인덱스를 선언한다", () => {
    const indexConfig = JSON.parse(
      readProjectFile("firestore.indexes.json"),
    ) as {
      indexes: Array<{
        collectionGroup: string;
        fields: Array<{ fieldPath: string; order: string }>;
      }>;
    };

    expect(indexConfig.indexes).toContainEqual({
      collectionGroup: "posts",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "publishedAt", order: "DESCENDING" },
        { fieldPath: "id", order: "DESCENDING" },
      ],
    });
  });
});
