import {
  publishedPostDetailSchema,
  type PublishedPostDetail,
} from "../contracts";

type SampleSeed = {
  id: string;
  slug: string;
  publicationDateKst: string;
  title: string;
  summary: string;
  officialFact: string;
  classroomContext: string;
  question: string;
};

const sampleSeeds: SampleSeed[] = [
  {
    id: "post-20260812",
    slug: "ai-answer-checking",
    publicationDateKst: "2026-08-12",
    title: "AI의 답을 확인하는 수업",
    summary: "AI가 만든 답을 그대로 쓰지 않고 출처와 오류를 살피는 과정이 중요해졌습니다.",
    officialFact: "새 안내 자료는 학생의 발달 단계에 맞춰 AI 결과를 확인하도록 설명합니다.",
    classroomContext: "수업에서는 정답을 빨리 얻는 것보다 질문하고 검토한 과정을 함께 돌아볼 수 있습니다.",
    question: "AI가 준 답을 믿기 전에 무엇을 확인하면 좋을까요?",
  },
  {
    id: "post-20260811",
    slug: "digital-textbook-data",
    publicationDateKst: "2026-08-11",
    title: "디지털 교과서와 학습 데이터",
    summary: "디지털 학습 기록은 수업을 돕되 필요한 범위에서 안전하게 다뤄야 합니다.",
    officialFact: "교육 자료는 학습 데이터를 수업 지원 목적에 맞게 최소한으로 활용해야 한다고 안내합니다.",
    classroomContext: "학교와 가정은 어떤 기록이 왜 쓰이는지 학생이 이해할 수 있는 말로 설명할 필요가 있습니다.",
    question: "나의 학습 기록은 어디까지 남기는 것이 적절할까요?",
  },
  {
    id: "post-20260810",
    slug: "coding-problem-solving",
    publicationDateKst: "2026-08-10",
    title: "코딩 수업은 문제 해결부터",
    summary: "코드를 외우기보다 문제를 나누고 해결 방법을 설명하는 활동이 주목받고 있습니다.",
    officialFact: "새 수업 사례는 생활 속 문제를 작은 단계로 나눈 뒤 코딩으로 표현하는 과정을 소개합니다.",
    classroomContext: "학생은 서로 다른 해결 방법을 비교하며 실패한 시도에서도 배울 점을 찾을 수 있습니다.",
    question: "같은 문제를 푸는 방법은 몇 가지나 있을까요?",
  },
  {
    id: "post-20260809",
    slug: "ai-translation-classroom",
    publicationDateKst: "2026-08-09",
    title: "교실에서 만나는 AI 번역",
    summary: "AI 번역은 소통을 도울 수 있지만 문맥과 문화에 맞는지 다시 살펴야 합니다.",
    officialFact: "교육 현장 자료는 AI 번역 결과에 빠진 뜻이나 어색한 표현이 없는지 확인하도록 권합니다.",
    classroomContext: "여러 언어를 쓰는 학생들은 번역 결과를 비교하며 말의 배경과 차이를 함께 배울 수 있습니다.",
    question: "번역된 문장이 원래 뜻을 잘 전하는지 어떻게 알 수 있을까요?",
  },
  {
    id: "post-20260808",
    slug: "deepfake-media-literacy",
    publicationDateKst: "2026-08-08",
    title: "딥페이크를 알아보는 미디어 수업",
    summary: "그럴듯한 영상도 만든 사람과 출처를 확인하는 디지털 읽기 습관이 필요합니다.",
    officialFact: "미디어 교육 자료는 영상의 출처와 게시 시점, 다른 보도를 함께 확인하라고 안내합니다.",
    classroomContext: "학생들은 의심스러운 장면을 단정하기보다 확인 질문을 만들며 안전하게 판단할 수 있습니다.",
    question: "진짜처럼 보이는 영상을 만났을 때 무엇부터 살펴볼까요?",
  },
  {
    id: "post-20260807",
    slug: "healthy-screen-breaks",
    publicationDateKst: "2026-08-07",
    title: "디지털 수업에도 쉬는 시간이 필요해요",
    summary: "화면을 활용한 수업 사이에 눈과 몸을 쉬게 하는 작은 습관이 중요합니다.",
    officialFact: "건강 안내 자료는 화면을 오래 볼 때 규칙적으로 먼 곳을 보고 몸을 움직이도록 권합니다.",
    classroomContext: "교사는 디지털 활동과 대화, 쓰기, 움직임을 섞어 수업의 리듬을 조절할 수 있습니다.",
    question: "우리 교실에는 어떤 화면 쉬기 약속이 필요할까요?",
  },
  {
    id: "post-20260806",
    slug: "family-ai-conversation",
    publicationDateKst: "2026-08-06",
    title: "가정에서 시작하는 AI 대화",
    summary: "아이의 AI 사용을 막연히 걱정하기보다 함께 보고 질문하는 대화가 도움이 됩니다.",
    officialFact: "가정 안내 자료는 보호자가 AI 사용 목적과 결과 확인 방법을 아이와 함께 정하도록 제안합니다.",
    classroomContext: "사용 시간만 묻기보다 무엇을 만들고 어떤 어려움이 있었는지 이야기하면 경험을 이해할 수 있습니다.",
    question: "가족과 AI 사용에 대해 어떤 질문을 나누고 싶나요?",
  },
  {
    id: "post-20260805",
    slug: "teacher-ai-question-design",
    publicationDateKst: "2026-08-05",
    title: "교사의 질문이 AI 활용을 바꿉니다",
    summary: "좋은 AI 활용은 자세한 명령보다 학습 목표가 분명한 질문에서 시작합니다.",
    officialFact: "교원 연수 자료는 도구를 선택하기 전에 수업 목표와 확인 기준을 먼저 세우도록 설명합니다.",
    classroomContext: "교사는 AI 결과를 보여주는 데 그치지 않고 학생이 이유와 근거를 말하도록 질문할 수 있습니다.",
    question: "AI에게 묻기 전에 우리가 먼저 정해야 할 것은 무엇일까요?",
  },
  {
    id: "post-20260804",
    slug: "digital-password-habits",
    publicationDateKst: "2026-08-04",
    title: "함께 지키는 비밀번호 습관",
    summary: "긴 비밀번호와 이중 확인은 학교 계정을 안전하게 지키는 기본 습관입니다.",
    officialFact: "보안 안내는 여러 서비스에 같은 비밀번호를 반복해 쓰지 않도록 권고합니다.",
    classroomContext: "학생은 비밀번호를 친구와 나누지 않고 의심스러운 로그인 알림을 어른에게 알리는 연습을 할 수 있습니다.",
    question: "계정을 안전하게 지키기 위해 오늘 바꿀 수 있는 습관은 무엇일까요?",
  },
  {
    id: "post-20260803",
    slug: "accessible-digital-learning",
    publicationDateKst: "2026-08-03",
    title: "모두를 위한 디지털 학습 도구",
    summary: "글자 읽기와 듣기, 입력을 돕는 기능은 더 많은 학생의 수업 참여를 넓힙니다.",
    officialFact: "접근성 자료는 자막, 화면 읽기, 키보드 조작을 학습 도구의 기본 조건으로 제시합니다.",
    classroomContext: "한 학생을 위한 편의 기능이 다른 학생에게도 내용을 이해하는 새로운 방법이 될 수 있습니다.",
    question: "우리 수업 자료를 더 쉽게 이용하려면 어떤 기능이 필요할까요?",
  },
  {
    id: "post-20260802",
    slug: "student-data-privacy",
    publicationDateKst: "2026-08-02",
    title: "학생 정보를 지키는 AI 사용법",
    summary: "AI 도구에는 이름과 사진처럼 개인을 알아볼 수 있는 정보를 넣지 않아야 합니다.",
    officialFact: "개인정보 안내는 공개형 AI 서비스에 학생의 식별 정보를 입력하지 않도록 강조합니다.",
    classroomContext: "수업 전 안전한 예시와 금지할 정보를 함께 정하면 학생이 스스로 위험을 알아차릴 수 있습니다.",
    question: "온라인 도구에 입력하면 안 되는 정보에는 무엇이 있을까요?",
  },
  {
    id: "post-20260801",
    slug: "classroom-chatbot-rules",
    publicationDateKst: "2026-08-01",
    title: "교실 챗봇 사용 약속 만들기",
    summary: "챗봇을 쓰는 목적과 확인 방법을 함께 정하면 수업에서 더 책임 있게 활용할 수 있습니다.",
    officialFact: "수업 사례는 챗봇 사용 전 허용 범위와 결과 검토 절차를 학생과 합의했습니다.",
    classroomContext: "학생이 직접 약속을 제안하고 이유를 설명하면 도구 사용의 책임도 함께 배울 수 있습니다.",
    question: "우리 반 챗봇 약속에 꼭 들어가야 할 내용은 무엇일까요?",
  },
  {
    id: "post-20260731",
    slug: "ai-creation-copyright",
    publicationDateKst: "2026-07-31",
    title: "AI로 만든 작품과 저작권",
    summary: "AI와 함께 만든 결과물도 사용한 자료와 사람의 기여를 투명하게 밝히는 태도가 필요합니다.",
    officialFact: "저작권 교육 자료는 다른 사람의 창작물을 AI 입력이나 결과물에 쓸 때 이용 조건을 확인하도록 설명합니다.",
    classroomContext: "학생은 참고 자료와 자신이 직접 고친 부분을 기록하며 창작 과정을 정직하게 소개할 수 있습니다.",
    question: "AI와 함께 만든 작품에서 나의 생각은 어떻게 드러낼 수 있을까요?",
  },
  {
    id: "post-20260730",
    slug: "rural-digital-access",
    publicationDateKst: "2026-07-30",
    title: "지역에 따른 디지털 학습 차이",
    summary: "기기와 연결 환경의 차이가 배움의 차이가 되지 않도록 세심한 지원이 필요합니다.",
    officialFact: "교육 지원 자료는 가정의 기기와 통신 환경을 살펴 필요한 대여와 연결 지원을 제공하도록 안내합니다.",
    classroomContext: "온라인 활동에는 학교에서도 참여할 수 있는 시간과 다른 방식의 과제를 함께 마련할 수 있습니다.",
    question: "모든 학생이 디지털 수업에 참여하려면 어떤 지원이 필요할까요?",
  },
  {
    id: "post-20260729",
    slug: "teacher-digital-learning",
    publicationDateKst: "2026-07-29",
    title: "교사가 함께 배우는 디지털 연수",
    summary: "짧은 도구 소개보다 실제 수업을 나누고 다시 고치는 교사 학습이 중요합니다.",
    officialFact: "교원 연수 사례는 수업 설계, 실행, 동료 피드백을 이어가는 학습 모임을 소개합니다.",
    classroomContext: "교사는 성공 사례뿐 아니라 잘되지 않은 경험도 나누며 학교에 맞는 활용 원칙을 만들 수 있습니다.",
    question: "새 도구를 수업에 쓰기 전에 교사들이 함께 확인할 것은 무엇일까요?",
  },
];

const parsedPublishedPosts = publishedPostDetailSchema.array().min(12).parse(
  sampleSeeds.map((seed) => {
    const sourceOfficialId = `${seed.id}-source-official`;
    const sourceNewsId = `${seed.id}-source-news`;
    const publishedAt = `${seed.publicationDateKst}T07:00:00+09:00`;

    return {
      id: seed.id,
      slug: seed.slug,
      publicationDateKst: seed.publicationDateKst,
      publishedAt,
      modifiedAt: publishedAt,
      title: seed.title,
      summary: seed.summary,
      visual: {
        kind: "pattern" as const,
        seed: `${seed.id}-gallery-visual`,
        templateVersion: "gallery-v1",
      },
      oneLineSummary: {
        text: seed.summary,
        sourceIds: [sourceOfficialId, sourceNewsId],
      },
      body: [
        { claims: [{ text: seed.officialFact, sourceIds: [sourceOfficialId] }] },
        { claims: [{ text: seed.classroomContext, sourceIds: [sourceNewsId] }] },
        {
          claims: [
            {
              text: "자료에 나온 원칙을 학교와 가정의 상황에 맞게 천천히 살펴볼 필요가 있습니다.",
              sourceIds: [sourceOfficialId, sourceNewsId],
            },
          ],
        },
      ],
      questions: [seed.question],
      sources: [
        {
          id: sourceOfficialId,
          title: `${seed.title} 관련 공식 안내`,
          publisher: "교육 디지털 연구원",
          publishedDate: seed.publicationDateKst,
          originalUrl: `https://example.edu/archive/${seed.slug}`,
        },
        {
          id: sourceNewsId,
          title: `${seed.title} 현장 해설`,
          publisher: "배움 뉴스",
          publishedDate: seed.publicationDateKst,
          originalUrl: `https://example.com/news/${seed.slug}`,
        },
      ],
    };
  }),
);

function comparePostsDescending(
  left: PublishedPostDetail,
  right: PublishedPostDetail,
): number {
  const timestampDifference =
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? 1 : -1;
}

const samplePublishedPosts: readonly PublishedPostDetail[] = Object.freeze(
  [...parsedPublishedPosts].sort(comparePostsDescending),
);

export function getSamplePublishedPosts(): PublishedPostDetail[] {
  return publishedPostDetailSchema.array().parse(samplePublishedPosts);
}
