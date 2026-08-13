import { createHash } from "node:crypto";

import { publishedPostDetailSchema } from "../src/contracts";

const projectUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (process.env.REVISE_AUGUST_FIRST_THOUGHT_PIECE_CONFIRM !== "2026-08-01") {
  throw new Error("AUGUST_FIRST_THOUGHT_PIECE_CONFIRMATION_REQUIRED");
}
if (projectUrl !== "https://vrjuvozmnaufzvrzzbnd.supabase.co" || !secretKey) {
  throw new Error("AUGUST_FIRST_THOUGHT_PIECE_PROJECT_MISMATCH");
}

const postId = "post-20260801-b6304b7464231a2f1d10";
const slug = "ai-digital-education-2026-08-01-b6304b74";
const expectedActiveRevisionId = "revision-20260801-domestic-dbd2d33fbd8c";
const newRevisionId = "revision-20260801-thought-" +
  createHash("sha256").update("thought-piece-v1:2026-07-30").digest("hex").slice(0, 12);
const first = "aug01-evidence-hangyo-20260730";
const second = "aug01-evidence-news1-20260730";

const body = [
  { claims: [{
    text: "7월 30일, 서로 다른 두 뉴스가 같은 방향을 가리켰습니다. 한국교육신문은 교사들이 AI 활용 경험과 정책을 나누는 콘퍼런스를 알렸고, 뉴스1은 피지컬 AI·실제 데이터 프로젝트·생성형 AI 윤리 교육 등을 운영한 교사들의 정보교육상 수상 소식을 전했습니다. AI·디지털 교육이 개인의 실험을 넘어 ‘좋은 사례’로 모이고 퍼지는 장면입니다.",
    sourceIds: [first, second],
  }] },
  { claims: [{
    text: "사례 공유는 필요합니다. 다만 전달되는 순간, 복잡했던 과정은 대개 성공의 줄거리로 정리됩니다. 학생의 반응이 달랐던 순간, 도구를 쓰지 않기로 한 판단, 기대만큼 되지 않았던 시도는 제목 밖으로 밀려나기 쉽습니다. 정돈된 사례가 반복되면 우리는 어느새 AI 교육에도 모범답안이 있다고 믿게 되지 않을까요. 무엇을 했는지는 보이지만, 왜 그 선택이 그곳에서 의미 있었는지는 희미해질 수 있습니다.",
    sourceIds: [first, second],
  }] },
  { claims: [{
    text: "인사이트는 좋은 사례의 복제에 있지 않습니다. 사례가 보여주는 것과 감추는 것을 함께 읽는 태도에 있습니다. AI가 맞춤형 교육을 돕는다고 말하면서 모든 학교가 비슷한 성공 사례를 좁는다면, 기술은 개인화를 약속하고 교육은 다시 표준화되는 역설이 생깁니다. 중요한 것은 같은 도구를 쓰는가보다 각 학교가 무엇을 교육의 문제로 보고 어떤 기준으로 기술을 선택했는가일 것입니다. 좋은 사례를 알리는 일과 교육의 다양한 가능성을 지키는 일은 어떻게 함께 갈 수 있을까요?",
    sourceIds: [first, second],
  }] },
];

const post = publishedPostDetailSchema.parse({
  id: postId, slug, publicationDateKst: "2026-08-01",
  publishedAt: "2026-08-01T07:00:00+09:00", modifiedAt: new Date().toISOString(),
  title: "AI 교육에도 모범답안이 있을까",
  summary: "AI 교육의 좋은 사례가 퍼질수록 맞춤형 교육이 오히려 하나의 표준으로 좁아지는 역설을 생각해 봅니다.",
  visual: { kind: "pattern", seed: "thought-piece-20260801", templateVersion: "gallery-pattern-v1" },
  oneLineSummary: { text: "기술은 개인화를 약속하지만, 성공 사례의 복제는 교육을 다시 표준화할 수 있습니다.", sourceIds: [first, second] },
  body,
  questions: ["맞춤형을 말하는 AI 교육에서 우리는 어떻게 서로 다른 성공을 인정할 수 있을까요?"],
  sources: [
    { id: first, title: "KERIS, AI 활용 교육 콘퍼런스 개최", publisher: "한국교육신문", publishedDate: "2026-07-30", originalUrl: "https://www.hangyo.com/news/article.html?no=108663" },
    { id: second, title: "서울교육청, 대한민국 정보교육상 수상 교사 3명 배출…전국 최다", publisher: "뉴스1", publishedDate: "2026-07-30", originalUrl: "https://www.news1.kr/society/education/6243467" },
  ],
});
const bodyLength = post.body.reduce((total, paragraph) =>
  total + [...paragraph.claims.map((claim) => claim.text).join("")].length, 0);
if (bodyLength < 600 || bodyLength > 700 || post.body.length !== 3) {
  throw new Error("AUGUST_FIRST_THOUGHT_PIECE_LENGTH_INVALID");
}

const response = await fetch(projectUrl + "/rest/v1/rpc/revise_august_first_thought_piece", {
  method: "POST",
  headers: { apikey: secretKey, authorization: "Bearer " + secretKey, "content-type": "application/json" },
  body: JSON.stringify({ p_expected_post_id: postId, p_expected_active_revision_id: expectedActiveRevisionId, p_new_revision_id: newRevisionId, p_post: post }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) throw new Error("AUGUST_FIRST_THOUGHT_PIECE_RPC_FAILED:" + response.status);
const revised = publishedPostDetailSchema.parse(await response.json());
console.log(JSON.stringify({ event: "august_first_thought_piece_revised", postId: revised.id, slug: revised.slug, bodyLength, paragraphCount: revised.body.length, revisionId: newRevisionId }));
