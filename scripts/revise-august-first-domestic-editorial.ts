import { createHash } from "node:crypto";

import { publishedPostDetailSchema } from "../src/contracts";

const projectUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (process.env.REVISE_AUGUST_FIRST_DOMESTIC_CONFIRM !== "2026-08-01") {
  throw new Error("AUGUST_FIRST_DOMESTIC_REVISION_CONFIRMATION_REQUIRED");
}
if (projectUrl !== "https://vrjuvozmnaufzvrzzbnd.supabase.co" || !secretKey) {
  throw new Error("AUGUST_FIRST_DOMESTIC_REVISION_PROJECT_MISMATCH");
}

const postId = "post-20260801-b6304b7464231a2f1d10";
const slug = "ai-digital-education-2026-08-01-b6304b74";
const expectedActiveRevisionId = "revision-20260801-editorial-93519c216190";
const newRevisionId = "revision-20260801-domestic-" +
  createHash("sha256").update("domestic-editorial-v1:2026-07-30").digest("hex").slice(0, 12);
const first = "aug01-evidence-hangyo-20260730";
const second = "aug01-evidence-news1-20260730";

const body = [
  { claims: [
    { text: "7월 30일 한국교육신문은 교육부와 한국교육학술정보원이 8월 6~7일 부산에서 ‘2026 AI 활용 교육 콘퍼런스’를 연다고 보도했습니다. 전국 교원이 학교에서 적용한 AI 활용 수업 사례와 최신 정책을 공유하고, 실제 수업에 쓸 수 있는 에듀테크를 체험하며 교육 현장의 변화와 과제를 논의하는 자리입니다. 행사 참여 시간에 따라 교원 연수도 인정됩니다.", sourceIds: [first] },
    { text: "같은 날 뉴스1은 서울 지역 교사 3명이 대한민국 정보교육상을 받았다고 전했습니다. 수상 사례에는 마이크로비트와 로봇을 활용한 피지컬 AI 수업, 실제 데이터를 다루는 프로젝트, 학생 수준에 맞춘 정보교육, 반복 학습용 디지털 자료, 생성형 AI 윤리 수업이 포함됐습니다. 다만 수상자들은 중·고교 교사이므로 그 수업을 초등학교에 그대로 옮길 수 있다는 뜻은 아닙니다.", sourceIds: [second] },
  ] },
  { claims: [
    { text: "두 기사를 함께 보면 중요한 것은 새 도구의 수보다 교사가 사례를 나누고 학생 발달에 맞게 다시 설계하는 과정입니다. 초등 교실에서는 기능을 먼저 가르치기보다 안전한 입력, 결과 확인, 친구와의 설명과 협력을 수업 목표에 연결해야 합니다. 학교는 연수에서 본 사례를 그대로 복제하지 말고 우리 반 학생에게 필요한 문제를 먼저 정한 뒤 작은 활동으로 시험하고 관찰해야 합니다.", sourceIds: [first, second] },
  ] },
  { claims: [
    { text: "학부모에게도 ‘AI를 썼다’는 사실만 알리기보다 어떤 목표로 어떤 정보를 입력했고 교사가 결과를 어떻게 확인했는지 설명할 필요가 있습니다. 학생은 AI 답을 완성품으로 받기보다 자료를 비교하고 자신의 말로 고치는 경험을 해야 합니다. 국내 현장의 이번 두 소식은 AI 교육의 출발점이 기기 보급이 아니라 교사의 전문성, 공개된 수업 사례, 학생에게 맞춘 판단이라는 점을 보여 줍니다.", sourceIds: [first, second] },
  ] },
];

const now = new Date().toISOString();
const post = publishedPostDetailSchema.parse({
  id: postId, slug, publicationDateKst: "2026-08-01",
  publishedAt: "2026-08-01T07:00:00+09:00", modifiedAt: now,
  title: "AI 수업을 키우는 교사의 공유",
  summary: "7월 30일 국내 두 보도는 AI 교육의 성패가 도구보다 교사의 수업 설계와 사례 공유에 달렸음을 보여 줍니다.",
  visual: { kind: "pattern", seed: "domestic-editorial-20260801", templateVersion: "gallery-pattern-v1" },
  oneLineSummary: { text: "AI 교육은 새 기기보다 교사가 국내 수업 사례를 나누고 학생에게 맞게 다시 설계하는 과정에서 시작됩니다.", sourceIds: [first, second] },
  body,
  questions: ["우리 학교의 AI 수업 사례를 다른 교사와 공유하고 초등 학생에게 맞게 고치려면 무엇부터 기록해야 할까요?"],
  sources: [
    { id: first, title: "KERIS, AI 활용 교육 콘퍼런스 개최", publisher: "한국교육신문", publishedDate: "2026-07-30", originalUrl: "https://www.hangyo.com/news/article.html?no=108663" },
    { id: second, title: "서울교육청, 대한민국 정보교육상 수상 교사 3명 배출…전국 최다", publisher: "뉴스1", publishedDate: "2026-07-30", originalUrl: "https://www.news1.kr/society/education/6243467" },
  ],
});

const bodyLength = post.body.reduce((total, paragraph) =>
  total + [...paragraph.claims.map((claim) => claim.text).join("")].length, 0);
if (bodyLength < 600 || bodyLength > 1_000 || post.body.length < 3) {
  throw new Error("AUGUST_FIRST_DOMESTIC_REVISION_LENGTH_INVALID");
}

const response = await fetch(projectUrl + "/rest/v1/rpc/revise_august_first_domestic_editorial", {
  method: "POST",
  headers: { apikey: secretKey, authorization: "Bearer " + secretKey, "content-type": "application/json" },
  body: JSON.stringify({
    p_expected_post_id: postId,
    p_expected_active_revision_id: expectedActiveRevisionId,
    p_new_revision_id: newRevisionId,
    p_post: post,
  }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) throw new Error("AUGUST_FIRST_DOMESTIC_REVISION_RPC_FAILED:" + response.status);
const revised = publishedPostDetailSchema.parse(await response.json());
console.log(JSON.stringify({
  event: "august_first_domestic_editorial_revised", postId: revised.id, slug: revised.slug,
  bodyLength, paragraphCount: revised.body.length,
  publishers: revised.sources.map((source) => source.publisher), revisionId: newRevisionId,
}));
