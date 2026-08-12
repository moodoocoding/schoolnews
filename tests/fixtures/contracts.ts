import type {
  EvidenceItem,
  GeneratedPost,
  PipelineRunState,
  PublishedPostDetail,
  TopicCandidate,
} from "../../src/contracts";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

export const evidenceItemsFixture: EvidenceItem[] = [
  {
    evidenceId: "evidence-1",
    articleId: "article-1",
    passageId: "passage-1",
    passageHash: hashA,
    sourceId: "source-keris",
    publisherGroupId: "publisher-keris",
    provenanceGroupKey: "origin-policy-2026",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    sourceName: "한국교육학술정보원",
    title: "학교 AI 활용 안내 자료 공개",
    url: "https://example.edu/policy/ai-guide",
    publishedAt: "2026-08-11T09:00:00+09:00",
    publishedAtPrecision: "instant",
    passage: "학생의 발달 단계에 맞춘 AI 활용 원칙과 교사의 확인 절차를 안내했다.",
    locator: "본문 2절",
  },
  {
    evidenceId: "evidence-2",
    articleId: "article-2",
    passageId: "passage-2",
    passageHash: hashB,
    sourceId: "source-news",
    publisherGroupId: "publisher-news",
    provenanceGroupKey: "origin-report-2026",
    sourceRole: "independent",
    sourceType: "news",
    authority: "none",
    sourceName: "교육뉴스",
    title: "초등학교의 AI 활용 원칙을 살펴보다",
    url: "https://example.com/news/elementary-ai",
    publishedAt: "2026-08-11T13:00:00+09:00",
    publishedAtPrecision: "instant",
    passage: "학교는 AI가 만든 결과를 그대로 쓰지 않고 출처와 오류를 확인하는 활동을 강조했다.",
    locator: "5번째 문단",
  },
];

export const topicCandidateFixture: TopicCandidate = {
  topicId: "topic-20260812-ai-guide",
  articleIds: ["article-1", "article-2"],
  evidenceIds: ["evidence-1", "evidence-2"],
  score: {
    total: 82,
    elementaryRelevance: 26,
    aiDigitalSpecificity: 18,
    reliability: 16,
    novelty: 14,
    socialMeaning: 8,
    version: "topic-score-v1",
  },
  independence: {
    qualifyingGroupCount: 2,
    hasPrimaryAndIndependent: true,
    passed: true,
    reasons: ["independent"],
  },
  evidencePolicy: "primary_plus_independent",
  evidencePolicyReason: "공식 안내 자료와 독립적인 교육 보도가 함께 확인되었습니다.",
  newFactEvidenceIds: ["evidence-1"],
  selectionReason: "초등학교의 AI 활용 원칙을 구체적으로 다룬 새로운 공식 안내입니다.",
};

export const generatedPostFixture: GeneratedPost = {
  title: "AI를 쓰기 전에 확인할 것들",
  oneLineSummary: {
    sentenceId: "sentence-summary",
    text: "학교에서 AI를 사용할 때는 결과보다 확인하고 질문하는 과정이 중요해졌습니다.",
    claimIds: ["claim-summary"],
  },
  body: [
    {
      sentences: [
        {
          sentenceId: "sentence-1",
          text: "새 안내 자료는 학생의 발달 단계에 맞춰 AI를 사용해야 한다고 설명합니다.",
          claimIds: ["claim-1"],
        },
      ],
    },
    {
      sentences: [
        {
          sentenceId: "sentence-2",
          text: "AI가 만든 답은 교사와 학생이 출처와 오류를 다시 확인하는 과정이 필요합니다.",
          claimIds: ["claim-2"],
        },
      ],
    },
    {
      sentences: [
        {
          sentenceId: "sentence-3",
          text: "수업에서는 정답을 빠르게 얻는 것보다 어떤 질문을 하고 어떻게 검토했는지 돌아볼 수 있습니다.",
          claimIds: ["claim-3"],
        },
      ],
    },
  ],
  questions: ["AI가 준 답을 믿기 전에 우리는 무엇을 확인하면 좋을까요?"],
  claims: [
    {
      claimId: "claim-summary",
      text: "학교 AI 활용에서 확인하고 질문하는 과정이 중요하다.",
      kind: "context",
      importance: "key",
      displayCitation: true,
      evidenceRefs: [
        { evidenceId: "evidence-1", support: "direct" },
        { evidenceId: "evidence-2", support: "context" },
      ],
    },
    {
      claimId: "claim-1",
      text: "안내 자료는 발달 단계에 맞춘 AI 활용을 설명한다.",
      kind: "fact",
      importance: "key",
      displayCitation: true,
      evidenceRefs: [{ evidenceId: "evidence-1", support: "direct" }],
    },
    {
      claimId: "claim-2",
      text: "AI 결과는 출처와 오류를 다시 확인해야 한다.",
      kind: "context",
      importance: "key",
      displayCitation: true,
      evidenceRefs: [{ evidenceId: "evidence-2", support: "direct" }],
    },
    {
      claimId: "claim-3",
      text: "수업에서 질문과 검토 과정을 돌아볼 수 있다.",
      kind: "interpretation",
      importance: "supporting",
      displayCitation: false,
      evidenceRefs: [{ evidenceId: "evidence-2", support: "context" }],
    },
  ],
  usedEvidenceIds: ["evidence-1", "evidence-2"],
};

export const publishedPostDetailFixture: PublishedPostDetail = {
  id: "post-20260812",
  slug: "ai-check-before-use",
  publicationDateKst: "2026-08-12",
  publishedAt: "2026-08-12T07:00:00+09:00",
  modifiedAt: "2026-08-12T07:00:00+09:00",
  title: generatedPostFixture.title,
  summary: generatedPostFixture.oneLineSummary.text,
  visual: {
    kind: "pattern",
    seed: "post-20260812-visual-seed",
    templateVersion: "gallery-v1",
  },
  oneLineSummary: {
    text: generatedPostFixture.oneLineSummary.text,
    sourceIds: ["source-1", "source-2"],
  },
  body: [
    {
      claims: [
        {
          text: generatedPostFixture.body[0].sentences[0].text,
          sourceIds: ["source-1"],
        },
      ],
    },
    {
      claims: [
        {
          text: generatedPostFixture.body[1].sentences[0].text,
          sourceIds: ["source-2"],
        },
      ],
    },
    {
      claims: [
        {
          text: generatedPostFixture.body[2].sentences[0].text,
          sourceIds: ["source-2"],
        },
      ],
    },
  ],
  questions: generatedPostFixture.questions,
  sources: [
    {
      id: "source-1",
      title: evidenceItemsFixture[0].title,
      publisher: evidenceItemsFixture[0].sourceName,
      publishedDate: "2026-08-11",
      originalUrl: evidenceItemsFixture[0].url,
    },
    {
      id: "source-2",
      title: evidenceItemsFixture[1].title,
      publisher: evidenceItemsFixture[1].sourceName,
      publishedDate: "2026-08-11",
      originalUrl: evidenceItemsFixture[1].url,
    },
  ],
};

export const pipelineRunStateFixture: PipelineRunState = {
  runId: "run-20260812",
  runDate: "2026-08-12",
  status: "running",
  pipelineVersion: "pipeline-v1",
  currentStage: "validate",
  steps: [
    {
      stage: "collect",
      status: "succeeded",
      attemptNumber: 1,
      inputFingerprint: hashA,
      outputReference: "collector-run-1",
      startedAt: "2026-08-12T06:00:00+09:00",
      finishedAt: "2026-08-12T06:01:00+09:00",
      errorCode: null,
    },
    {
      stage: "validate",
      status: "running",
      attemptNumber: 1,
      inputFingerprint: hashB,
      outputReference: null,
      startedAt: "2026-08-12T06:02:00+09:00",
      finishedAt: null,
      errorCode: null,
    },
  ],
  limits: {
    maxModelCalls: 4,
    maxInputTokens: 12_000,
    maxOutputTokens: 4_000,
    maxEstimatedCostUsd: 1,
    maxRunSeconds: 900,
  },
  usage: {
    modelCalls: 2,
    inputTokens: 4_000,
    outputTokens: 900,
    estimatedCostUsd: 0.12,
    hasUnpricedCalls: false,
  },
};
