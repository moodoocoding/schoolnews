import { createHash } from "node:crypto";

import { publishedPostDetailSchema } from "../src/contracts";

const projectUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (process.env.REVISE_AUGUST_FIRST_CONFIRM !== "2026-08-01") {
  throw new Error("AUGUST_FIRST_REVISION_CONFIRMATION_REQUIRED");
}
if (projectUrl !== "https://vrjuvozmnaufzvrzzbnd.supabase.co" || !secretKey) {
  throw new Error("AUGUST_FIRST_REVISION_PROJECT_MISMATCH");
}

const postId = "post-20260801-b6304b7464231a2f1d10";
const slug = "ai-digital-education-2026-08-01-b6304b74";
const expectedActiveRevisionId = "revision-20260801-b6304b7464231a2f1d10";
const newRevisionId =
  "revision-20260801-editorial-" +
  createHash("sha256").update("editorial-source-date-v1:generated-post-v4").digest("hex").slice(0, 12);
const first = "aug01-evidence-govtech-20260730";
const second = "aug01-evidence-monterey-20260730";

const body = [
  {
    claims: [
      {
        text: "7월 30일 Government Technology는 교육기술 도입의 첫 질문이 ‘무엇을 살 것인가’가 아니라 ‘교사가 어떤 학습 문제를 해결하려 하는가’여야 한다고 전했습니다. 기사 속 학교들은 교육과정 담당자와 기술 담당자가 도입 전부터 같은 회의에 참여해 수업 목표와 지원이 필요한 학생을 함께 살폈습니다.",
        sourceIds: [first],
      },
      {
        text: "이 관점에서 AI는 수업의 출발점이 아니라 이미 정한 교육과정을 보완하는 선택지입니다. 다언어 학습자를 돕고 참여를 높인다는 필요를 먼저 찾은 뒤 목표에 맞는 AI 자료를 제공했습니다. 중요한 기준은 기술 사용 여부가 아니라 학생이 더 적극적으로 생각하고 대화했는지였습니다.",
        sourceIds: [first],
      },
    ],
  },
  {
    claims: [
      {
        text: "같은 날 Monterey County NOW가 소개한 교육구들은 ‘규칙을 먼저 세운다’는 접근을 택했습니다. 계획에는 디지털 안전, AI 활용 범위, 나이에 따른 화면 사용 기준이 포함됐고, 교사는 과제나 채점에 AI를 썼는지 알리도록 했습니다. 어린 학생에게는 학교 기기의 AI 도구를 제한하는 선택도 담겼습니다.",
        sourceIds: [second],
      },
      {
        text: "또 다른 교육구의 교사는 도구 배포보다 정책과 교직원 훈련이 먼저라고 강조했습니다. 초등학교에서도 입력해도 되는 정보, AI 답을 확인하는 방법, 사용 사실을 표시하는 방식, 문제가 생겼을 때 도움을 요청할 사람을 먼저 정해야 교사와 학부모가 같은 기준으로 아이를 안내할 수 있습니다.",
        sourceIds: [second],
      },
    ],
  },
  {
    claims: [
      {
        text: "두 기사를 함께 읽으면 학교의 AI 준비는 제품 목록보다 질문 목록에 가깝습니다. 이 활동이 학습 목표에 필요한가, 학생의 발달에 맞는가, 개인정보는 어디로 가는가, 교사는 결과를 어떻게 확인할 것인가를 물어야 합니다. 답이 분명하지 않다면 더 단순한 방법을 택하는 것도 수업을 지키는 판단입니다.",
        sourceIds: [first, second],
      },
      {
        text: "가정에서는 ‘AI를 썼니?’에서 나아가 어떤 과제를 해결하려 했는지, 어떤 정보를 입력했는지, 답을 무엇과 비교했는지 물어볼 수 있습니다. 학교도 도입 목적과 규칙을 설명하고 학생·교사·가족의 의견을 정책에 반영해야 합니다. 좋은 AI 수업은 아이가 생각하고 설명하며 안전하게 배우는 수업입니다.",
        sourceIds: [first, second],
      },
    ],
  },
];

const now = new Date().toISOString();
const post = publishedPostDetailSchema.parse({
  id: postId,
  slug,
  publicationDateKst: "2026-08-01",
  publishedAt: "2026-08-01T07:00:00+09:00",
  modifiedAt: now,
  title: "AI 도입보다 먼저 세울 학교의 질문",
  summary: "7월 30일 두 보도는 학교의 AI 준비가 제품보다 수업 목표와 안전 규칙에서 시작해야 한다고 보여 줍니다.",
  visual: {
    kind: "pattern",
    seed: "editorial-20260801-20260730",
    templateVersion: "gallery-pattern-v1",
  },
  oneLineSummary: {
    text: "AI를 들이기 전에 수업 목표, 학생의 나이, 개인정보와 확인 절차를 먼저 정해야 합니다.",
    sourceIds: [first, second],
  },
  body,
  questions: ["우리 반이 AI를 사용하기 전에 학생·교사·학부모가 함께 답해야 할 질문은 무엇일까요?"],
  sources: [
    {
      id: first,
      title: "School Districts Rethink Relationship Between Curriculum, IT",
      publisher: "Government Technology",
      publishedDate: "2026-07-30",
      originalUrl: "https://www.govtech.com/education/k-12/school-districts-rethink-relationship-between-curriculum-it",
    },
    {
      id: second,
      title: "Monterey County school districts to roll out AI policies for the upcoming school year",
      publisher: "Monterey County NOW",
      publishedDate: "2026-07-30",
      originalUrl: "https://www.montereycountynow.com/news/local_news/monterey-county-school-districts-to-roll-out-ai-policies-for-the-upcoming-school-year/article_b4b3bc77-c854-482c-a373-f906e532ab26.html",
    },
  ],
});

const bodyLength = post.body.reduce(
  (total, paragraph) =>
    total + [...paragraph.claims.map((claim) => claim.text).join(" ")].length,
  0,
);
if (bodyLength < 600 || bodyLength > 1_000 || post.body.length < 3) {
  throw new Error("AUGUST_FIRST_REVISION_LENGTH_INVALID");
}

const response = await fetch(projectUrl + "/rest/v1/rpc/revise_august_first_editorial", {
  method: "POST",
  headers: {
    apikey: secretKey,
    authorization: "Bearer " + secretKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    p_expected_post_id: postId,
    p_expected_active_revision_id: expectedActiveRevisionId,
    p_new_revision_id: newRevisionId,
    p_post: post,
  }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  throw new Error("AUGUST_FIRST_REVISION_RPC_FAILED:" + response.status);
}
const revised = publishedPostDetailSchema.parse(await response.json());
console.log(JSON.stringify({
  event: "august_first_editorial_revised",
  postId: revised.id,
  slug: revised.slug,
  bodyLength,
  paragraphCount: revised.body.length,
  sourceDates: revised.sources.map((source) => source.publishedDate),
  revisionId: newRevisionId,
}));
