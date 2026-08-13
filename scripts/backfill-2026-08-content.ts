export type BackfillSource = Readonly<{
  publisher: string;
  publisherType: "official" | "research";
  sourceType: "primary" | "research";
  sourceRole: "primary" | "independent";
  originType: "primary_document" | "original_reporting";
  documentTitle: string;
  url: string;
  publishedAt: string;
  passage: string;
  policyUrl: string;
}>;

export type BackfillTopic = Readonly<{
  runDate: string;
  title: string;
  summary: string;
  primaryText: string;
  independentText: string;
  synthesisText: string;
  question: string;
  sources: readonly [BackfillSource, BackfillSource];
}>;

export const AUGUST_2026_BACKFILL_TOPICS: readonly BackfillTopic[] = [
  {
    runDate: "2026-08-01",
    title: "AI 교과서보다 먼저 볼 교사의 역할",
    summary:
      "AI 학습 도구는 학생의 속도를 살필 수 있지만 수업의 방향과 관계는 교사가 설계합니다.",
    primaryText:
      "교육부의 당시 도입 계획은 초등 영어와 수학 활용뿐 아니라 교원 연수와 학교 기반 준비를 함께 제시했습니다.",
    independentText:
      "세계은행은 한국 교실 사례를 소개하며 AI가 피드백을 돕더라도 협력과 문제 해결을 이끄는 일은 교사의 역할이라고 설명했습니다.",
    synthesisText:
      "두 자료를 함께 보면 AI는 수업의 주인이 아니라 교사가 학생을 더 세심하게 돕기 위해 선택하는 도구로 이해할 수 있습니다.",
    question: "우리 반에서 AI가 맡을 일과 교사가 꼭 맡아야 할 일은 무엇일까요?",
    sources: [
      {
        publisher: "교육부",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "교실에서 마주할 인공지능 디지털교과서",
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=101774&lev=0",
        publishedAt: "2024-11-29T00:00:00+09:00",
        passage:
          "교육부는 당시 초등학교 일부 학년의 영어와 수학에서 AI 디지털교과서를 활용할 계획을 밝히고, 교원 역량 강화와 디지털 기반 시설 준비를 함께 추진한다고 설명했다.",
        policyUrl: "https://www.kogl.or.kr/info/license.do",
      },
      {
        publisher: "World Bank",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "original_reporting",
        documentTitle: "Teachers are leading an AI revolution in Korean classrooms",
        url: "https://blogs.worldbank.org/en/education/teachers-are-leading-an-ai-revolution-in-korean-classrooms",
        publishedAt: "2024-10-30T00:00:00Z",
        passage:
          "세계은행은 한국 교실 사례에서 AI가 개인화와 피드백을 도울 수 있다고 소개하면서도 프로젝트, 문제 해결, 협력과 멘토링을 설계하는 교사의 역할을 강조했다.",
        policyUrl: "https://www.worldbank.org/ext/en/legal/terms-conditions",
      },
    ],
  },
  {
    runDate: "2026-08-02",
    title: "AI 사용법보다 판단과 윤리를 먼저",
    summary:
      "AI를 잘 배우는 일은 명령어를 외우는 데서 끝나지 않고 답을 판단하고 책임 있게 만드는 데까지 이어집니다.",
    primaryText:
      "유네스코는 학생 AI 역량을 인간 중심 관점, 윤리, 기술 이해, 시스템 설계라는 영역으로 나누어 제시합니다.",
    independentText:
      "국내 초등 AI 교육 연구를 모은 메타분석은 긍정적 결과와 함께 프로그램의 질과 연구 결과의 차이도 살펴야 한다고 보고했습니다.",
    synthesisText:
      "따라서 수업에서는 AI 답을 그대로 받는 활동보다 이유를 묻고 고치며 자신의 선택을 설명하는 경험이 중요합니다.",
    question: "AI의 답을 믿어도 되는지 확인하려면 어떤 질문을 던져야 할까요?",
    sources: [
      {
        publisher: "UNESCO",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "AI competency framework for students",
        url: "https://www.unesco.org/en/articles/ai-competency-framework-students",
        publishedAt: "2024-08-08T00:00:00Z",
        passage:
          "유네스코 학생 AI 역량 틀은 인간 중심 관점, AI 윤리, 기술과 응용, AI 시스템 설계를 제시하고 이해에서 적용과 창작으로 이어지는 학습 단계를 설명한다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
      {
        publisher: "학교와 수업 연구",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "original_reporting",
        documentTitle: "초등학생 대상 인공지능 교육 프로그램 효과 메타분석",
        url: "https://journal.kci.go.kr/JSST/archive/articleView?artiId=ART003231674",
        publishedAt: "2025-07-30T00:00:00+09:00",
        passage:
          "국내 초등학생 대상 AI 교육 프로그램 연구를 종합한 메타분석은 역량과 인지, 태도의 긍정적 결과를 보고하면서도 연구 사이의 차이와 프로그램 질을 함께 고려해야 한다고 밝혔다.",
        policyUrl: "https://www.kci.go.kr/kciportal/ci/sereInfo.kci",
      },
    ],
  },
  {
    runDate: "2026-08-03",
    title: "어린이 생성형 AI의 안전선 세우기",
    summary:
      "어린이가 생성형 AI를 사용할 때는 개인정보를 넣지 않고 성인과 함께 확인하는 규칙이 먼저 필요합니다.",
    primaryText:
      "유네스코 지침은 개인정보 보호와 나이에 맞는 인간 중심 설계를 교육용 생성형 AI의 중요한 조건으로 제시합니다.",
    independentText:
      "유니세프 지침은 아동의 발달과 안전, 공정성, 사생활, 설명 가능성을 아동 중심 AI의 요구로 다룹니다.",
    synthesisText:
      "가정과 학교는 전면 금지에 머물기보다 입력하지 않을 정보와 이상한 답을 만났을 때 도움을 요청하는 방법을 함께 정할 수 있습니다.",
    question: "AI에게 절대 알려 주지 않아야 할 나와 친구의 정보는 무엇일까요?",
    sources: [
      {
        publisher: "UNESCO",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "Guidance for generative AI in education and research",
        url: "https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research",
        publishedAt: "2023-09-07T00:00:00Z",
        passage:
          "유네스코의 교육용 생성형 AI 지침은 개인정보 보호, 나이에 맞는 사용 기준, 인간의 판단을 중심에 둔 윤리적 교육 설계를 주요 과제로 제시한다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
      {
        publisher: "UNICEF",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Policy guidance on AI for children",
        url: "https://www.unicef.org/globalinsight/reports/policy-guidance-ai-children",
        publishedAt: "2021-11-01T00:00:00Z",
        passage:
          "유니세프의 아동 AI 정책 지침은 아동의 발달과 웰빙, 포용과 공정성, 데이터와 사생활 보호, 안전, 투명성과 설명 가능성을 함께 다뤄야 한다고 설명한다.",
        policyUrl: "https://www.unicef.org/legal",
      },
    ],
  },
  {
    runDate: "2026-08-04",
    title: "화면 시간보다 먼저 물을 네 가지",
    summary:
      "디지털 활동은 시간만 세기보다 무엇을 누구와 왜 하는지, 잠과 놀이를 방해하는지 함께 살펴야 합니다.",
    primaryText:
      "경제협력개발기구 보고서는 디지털 환경의 학습 기회와 과도한 사용, 유해 콘텐츠, 안전 위험을 함께 살펴야 한다고 설명합니다.",
    independentText:
      "유네스코 교육 보고서는 기술이 학습자와 사람 사이의 상호작용을 대신하지 않고 지원해야 한다고 제시합니다.",
    synthesisText:
      "학교와 가정은 화면을 본 시간뿐 아니라 창작과 협력인지 수동 시청인지, 수면과 대화를 지키는지 함께 관찰할 수 있습니다.",
    question: "오늘 한 디지털 활동 가운데 나를 가장 많이 생각하게 한 것은 무엇인가요?",
    sources: [
      {
        publisher: "OECD",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "How's Life for Children in the Digital Age?",
        url: "https://www.oecd.org/en/publications/how-s-life-for-children-in-the-digital-age_0854b900-en.html",
        publishedAt: "2025-05-15T00:00:00Z",
        passage:
          "OECD 보고서는 아동의 디지털 활동이 학습과 관계의 기회를 주는 동시에 과도한 사용과 유해 콘텐츠, 안전 위험도 가져오므로 활동의 종류와 맥락을 함께 봐야 한다고 설명한다.",
        policyUrl: "https://www.oecd.org/en/about/terms-conditions.html",
      },
      {
        publisher: "UNESCO GEM Report",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Technology in education: A tool on whose terms?",
        url: "https://www.unesco.org/en/articles/global-education-monitoring-report-2023-technology-education-tool-whose-terms",
        publishedAt: "2023-01-08T00:00:00Z",
        passage:
          "유네스코 세계교육현황 보고서는 교육기술의 관련성과 형평성, 지속가능성을 따져야 하며 기술은 사람 사이의 상호작용을 대체하지 않고 지원해야 한다고 제시한다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
    ],
  },
  {
    runDate: "2026-08-05",
    title: "AI에게 질문하기 전 배울 것",
    summary:
      "좋은 AI 질문은 답을 빨리 얻는 기술이 아니라 목적을 세우고 결과를 검토하는 판단에서 시작합니다.",
    primaryText:
      "경제협력개발기구와 유럽연합 집행위원회의 틀은 AI 활용을 참여, 창작, 관리, 변화의 관점에서 다룹니다.",
    independentText:
      "유네스코 학생 역량 틀은 인간 중심 관점과 윤리, 기술 이해, 시스템 설계를 함께 배우도록 제안합니다.",
    synthesisText:
      "학생은 질문을 입력한 뒤 출처와 빠진 관점을 확인하고, 답을 자신의 말로 고치는 과정까지 경험할 필요가 있습니다.",
    question: "같은 문제를 AI와 친구에게 물으면 어떤 답의 차이를 살펴봐야 할까요?",
    sources: [
      {
        publisher: "OECD·European Commission",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "Empowering Learners for the Age of AI",
        url: "https://www.oecd.org/en/publications/empowering-learners-for-the-age-of-ai_65cd27d4-en.html",
        publishedAt: "2026-06-18T00:00:00Z",
        passage:
          "OECD와 유럽연합 집행위원회의 학생 AI 리터러시 틀은 지식과 기능뿐 아니라 태도를 포함하고, AI에 참여하고 창작하며 관리하고 방향을 바꾸는 역량을 제시한다.",
        policyUrl: "https://www.oecd.org/en/about/terms-conditions.html",
      },
      {
        publisher: "UNESCO",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "AI competency framework for students",
        url: "https://www.unesco.org/en/articles/ai-competency-framework-students?hub=66903",
        publishedAt: "2024-08-08T00:00:00Z",
        passage:
          "유네스코 학생 AI 역량 틀은 인간 중심 관점, 윤리, 기술과 응용, 시스템 설계를 함께 익히며 책임 있는 사용자와 공동 창작자로 성장하는 방향을 설명한다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
    ],
  },
  {
    runDate: "2026-08-06",
    title: "초등 교사는 AI를 어디에 쓸까",
    summary:
      "교사의 AI 활용은 자료 만들기만이 아니라 학생의 어려움을 살피고 수업을 다시 설계하는 일과 연결됩니다.",
    primaryText:
      "교육부의 교원 연수 계획은 AI 이해와 활용, 윤리, 교육과정 설계를 단계적으로 다루도록 구성됐습니다.",
    independentText:
      "경제협력개발기구의 교원 조사 보고서는 AI 활용 사례로 학습 어려움 지원과 피드백, 가정 소통 등을 소개합니다.",
    synthesisText:
      "도구 사용 횟수보다 학생에게 필요한 도움을 찾고 수업의 목표에 맞게 선택했는지를 살피는 것이 중요합니다.",
    question: "선생님이 AI의 도움을 받아도 마지막에 꼭 직접 확인해야 할 것은 무엇일까요?",
    sources: [
      {
        publisher: "교육부",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "교원의 AI 교육 역량을 높이는 연수 추진",
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105627&lev=0",
        publishedAt: "2026-03-16T00:00:00+09:00",
        passage:
          "교육부는 교원의 AI 교육 역량을 높이기 위해 AI 이해와 활용, 윤리, 교육과정과 수업 설계를 단계적으로 다루는 연수 방향을 제시했다.",
        policyUrl: "https://www.kogl.or.kr/info/license.do",
      },
      {
        publisher: "OECD",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "original_reporting",
        documentTitle: "Results from TALIS 2024",
        url: "https://www.oecd.org/en/publications/results-from-talis-2024_90df6235-en/full-report/teaching-for-today-s-world_eefb146b.html",
        publishedAt: "2025-10-07T00:00:00Z",
        passage:
          "OECD 교원 조사 보고서는 AI를 쓰는 교사들이 학습에 어려움을 겪는 학생 지원, 과제 조정과 피드백, 학부모 소통 등 여러 업무에 활용한다고 설명한다.",
        policyUrl: "https://www.oecd.org/en/about/terms-conditions.html",
      },
    ],
  },
  {
    runDate: "2026-08-07",
    title: "학습 앱에 아이 정보를 맡기기 전",
    summary:
      "학교가 AI 학습 앱을 고를 때는 기능보다 먼저 수집 정보와 보관 기간, 삭제 방법과 안전 설정을 확인해야 합니다.",
    primaryText:
      "교육부의 교육용 소프트웨어 기준은 개인정보 최소 수집과 보호, 권리 보장, 학교의 검토 절차를 제시합니다.",
    independentText:
      "유니세프 아동 AI 지침은 사생활과 안전, 공정성, 투명성을 제품 설계와 운영에서 함께 다루도록 권고합니다.",
    synthesisText:
      "교사와 학부모는 편리한 기능만 보지 않고 누가 어떤 정보를 왜 가지고 언제 지우는지 구체적으로 물을 수 있습니다.",
    question: "학습 앱을 시작하기 전에 어른과 함께 확인하고 싶은 정보는 무엇인가요?",
    sources: [
      {
        publisher: "교육부",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "교육용 소프트웨어 선정 기준",
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105007&lev=0&m=020402&opType=N&page=1&s=moe&searchType=null&statusYN=W&temp=Y",
        publishedAt: "2025-12-29T00:00:00+09:00",
        passage:
          "교육부의 교육용 소프트웨어 선정 기준은 개인정보를 필요한 만큼만 수집하고 안전하게 보호하며, 이용자의 권리와 삭제 요구, 학교의 검토 절차를 확인하도록 제시한다.",
        policyUrl: "https://www.kogl.or.kr/info/license.do",
      },
      {
        publisher: "UNICEF Innocenti",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Guidance on AI and children",
        url: "https://www.unicef.org/innocenti/reports/policy-guidance-ai-children",
        publishedAt: "2025-12-01T00:00:00Z",
        passage:
          "유니세프의 아동 AI 지침은 아동의 안전과 사생활, 공정성, 투명성, 책임성을 AI 제품의 설계와 운영 전 과정에서 함께 고려해야 한다고 제시한다.",
        policyUrl: "https://www.unicef.org/legal",
      },
    ],
  },
  {
    runDate: "2026-08-08",
    title: "딥페이크를 알아보는 초등 수업",
    summary:
      "딥페이크 교육은 가짜를 맞히는 퀴즈를 넘어 출처를 확인하고 피해를 막는 행동을 연습하는 수업이어야 합니다.",
    primaryText:
      "교육부는 초등 고학년이 딥페이크의 위험과 예방 행동을 배울 수 있는 교육 자료를 학교에 안내했습니다.",
    independentText:
      "유럽연합의 디지털 문해 지침은 생성형 AI와 허위정보를 다루며 비판적 사고와 미리 대비하는 활동을 제안합니다.",
    synthesisText:
      "학생은 의심스러운 영상의 출처를 확인하고 퍼뜨리지 않으며 피해가 걱정될 때 믿을 만한 어른에게 알리는 절차를 익힐 수 있습니다.",
    question: "이상한 영상이나 사진을 받았을 때 공유하기 전에 무엇을 확인해야 할까요?",
    sources: [
      {
        publisher: "교육부",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "학교 딥페이크 예방 교육자료",
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=316&boardSeq=101892&lev=0&m=0302&opType=N&page=1&s=moe&searchType=null&statusYN=W",
        publishedAt: "2024-12-09T00:00:00+09:00",
        passage:
          "교육부는 초등학교 고학년을 포함한 학교급별 딥페이크 예방 교육자료를 안내하고, 위험을 이해하며 피해를 예방하는 행동을 수업에서 다루도록 했다.",
        policyUrl: "https://www.kogl.or.kr/info/license.do",
      },
      {
        publisher: "European Commission",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Guidelines on disinformation and digital literacy",
        url: "https://op.europa.eu/en/publication-detail/-/publication/60fddd7a-17dc-11f1-8870-01aa75ed71a1/",
        publishedAt: "2026-03-05T00:00:00Z",
        passage:
          "유럽연합 집행위원회의 교육 지침은 생성형 AI와 허위정보를 다루면서 출처 확인, 비판적 사고, 위험을 미리 알아차리는 활동과 사이버 괴롭힘 대응을 제안한다.",
        policyUrl: "https://commission.europa.eu/legal-notice_en",
      },
    ],
  },
  {
    runDate: "2026-08-09",
    title: "AI 답을 빨리 받는 것보다 중요한 일",
    summary:
      "AI를 잘 쓴다는 것은 빠른 답보다 목적을 정하고 결과를 확인하며 자신의 판단을 설명하는 일에 가깝습니다.",
    primaryText:
      "경제협력개발기구와 유럽연합 집행위원회의 틀은 학생이 AI를 사용하고 만들고 관리하며 방향을 바꾸는 역량을 제시합니다.",
    independentText:
      "유네스코는 AI 기술 이해와 함께 인간 중심 관점과 윤리, 책임 있는 창작을 학생 역량에 포함합니다.",
    synthesisText:
      "수업에서는 정답을 복사하는 대신 답의 근거와 빠진 관점을 찾고 다른 사람에게 설명하는 과정을 평가할 수 있습니다.",
    question: "AI의 답을 내 생각으로 바꾸려면 어떤 확인과 설명이 필요할까요?",
    sources: [
      {
        publisher: "OECD·European Commission",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "AI literacy framework for primary and secondary education",
        url: "https://www.oecd.org/en/publications/empowering-learners-for-the-age-of-ai_65cd27d4-en.html",
        publishedAt: "2026-06-18T00:00:00Z",
        passage:
          "학생 AI 리터러시 틀은 AI에 참여하고 창작하며 관리하고 방향을 바꾸는 역량을 지식과 기능, 태도의 결합으로 설명하고 초중등 교육에서 활용하도록 제안한다.",
        policyUrl: "https://www.oecd.org/en/about/terms-conditions.html",
      },
      {
        publisher: "UNESCO",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Student AI competency framework",
        url: "https://www.unesco.org/en/articles/ai-competency-framework-students",
        publishedAt: "2024-08-08T00:00:00Z",
        passage:
          "유네스코는 학생이 AI의 기술과 응용을 이해하는 것과 함께 인간 중심 관점, 윤리, 책임 있는 시스템 설계와 공동 창작을 배워야 한다고 제시한다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
    ],
  },
  {
    runDate: "2026-08-10",
    title: "AI가 제안해도 마지막 판단은 사람",
    summary:
      "AI가 자료와 의견을 제안할 수 있어도 학생을 이해하고 수업을 결정하는 책임은 교사와 사람에게 남습니다.",
    primaryText:
      "유네스코 교사 역량 틀은 인간 중심 사고와 윤리, AI 활용, 교수법, 전문성 개발을 함께 제시합니다.",
    independentText:
      "미국 교육부 보고서는 교사가 AI의 제안을 검토하고 문제를 제기하며 핵심 교육 결정을 유지해야 한다고 설명합니다.",
    synthesisText:
      "교사는 AI의 추천을 출발점으로 삼되 학생의 상황과 수업 목표를 살펴 받아들이거나 고치거나 거절할 수 있습니다.",
    question: "AI의 추천과 선생님의 판단이 다를 때 무엇을 살펴봐야 할까요?",
    sources: [
      {
        publisher: "UNESCO",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "AI competency framework for teachers",
        url: "https://www.unesco.org/en/articles/ai-competency-framework-teachers",
        publishedAt: "2024-08-08T00:00:00Z",
        passage:
          "유네스코 교사 AI 역량 틀은 인간 중심 사고, AI 윤리, 기초와 응용, AI 교수법, 전문 학습을 함께 다루며 교사의 판단과 책임을 중심에 둔다.",
        policyUrl: "https://www.unesco.org/en/open-access/creative-commons",
      },
      {
        publisher: "U.S. Department of Education",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Artificial Intelligence and the Future of Teaching and Learning",
        url: "https://www.ed.gov/sites/ed/files/documents/ai-report/ai-report.pdf",
        publishedAt: "2023-05-01T00:00:00Z",
        passage:
          "미국 교육부 보고서는 교육용 AI에서 사람을 의사결정 과정에 두고, 교사가 시스템의 제안을 검토하고 이의를 제기하며 핵심 수업 결정을 유지해야 한다고 설명한다.",
        policyUrl: "https://www.ed.gov/notices/copyright-status",
      },
    ],
  },
  {
    runDate: "2026-08-11",
    title: "학교가 AI 앱에 먼저 물을 것",
    summary:
      "학교가 AI 학습 앱을 고를 때는 어떤 정보를 왜 모으고 어디에 보관하며 어떻게 지우는지 먼저 확인해야 합니다.",
    primaryText:
      "교육부 기준은 교육용 소프트웨어를 고를 때 개인정보와 안전, 교육적 적합성을 학교가 함께 검토하도록 제시합니다.",
    independentText:
      "영국 교육부 기준은 데이터의 목적과 위치, 보관 과정, 아동 중심 시험과 문제 해결 절차를 구체적으로 묻도록 합니다.",
    synthesisText:
      "화려한 기능 설명보다 정보의 흐름과 보호 방법, 문제가 생겼을 때 책임지고 고치는 절차를 확인하는 일이 먼저입니다.",
    question: "우리 학교가 새 학습 앱을 고를 때 가장 먼저 확인할 약속은 무엇일까요?",
    sources: [
      {
        publisher: "교육부",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "교육용 소프트웨어 선정 기준",
        url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105007&lev=0&m=020",
        publishedAt: "2025-12-29T00:00:00+09:00",
        passage:
          "교육부 기준은 학교가 교육용 소프트웨어의 교육적 적합성과 개인정보 보호, 안전성, 이용자 권리와 운영 절차를 함께 검토하도록 제시한다.",
        policyUrl: "https://www.kogl.or.kr/info/license.do",
      },
      {
        publisher: "UK Department for Education",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Generative AI product safety standards",
        url: "https://www.gov.uk/government/publications/generative-ai-product-safety-standards/generative-ai-product-safety-standards",
        publishedAt: "2026-01-19T00:00:00Z",
        passage:
          "영국 교육부의 생성형 AI 제품 안전 기준은 수집 데이터의 목적과 저장 위치, 보관 과정, 아동 중심 시험, 사용자 권한, 보안과 문제 해결 절차를 설명하도록 요구한다.",
        policyUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      },
    ],
  },
  {
    runDate: "2026-08-12",
    title: "좋은 AI 튜터는 힌트를 건넨다",
    summary:
      "좋은 AI 학습 도구는 정답을 바로 주기보다 학생이 먼저 생각하고 설명하도록 질문과 단계별 힌트를 건넵니다.",
    primaryText:
      "경제협력개발기구 보고서는 교육 목적에 맞춘 AI가 질문과 자기 설명을 통해 학습자의 사고를 지원하는 설계를 소개합니다.",
    independentText:
      "영국 교육부 안전 기준은 아동 사용자를 고려한 시험과 안전한 기본값, 적절한 도움과 문제 해결 절차를 요구합니다.",
    synthesisText:
      "초등 수업에서는 학생이 먼저 시도한 뒤 필요한 만큼 힌트를 받고 마지막에 자신의 말로 풀이를 설명하게 할 수 있습니다.",
    question: "정답 대신 어떤 힌트를 받으면 스스로 한 번 더 생각할 수 있을까요?",
    sources: [
      {
        publisher: "OECD",
        publisherType: "official",
        sourceType: "primary",
        sourceRole: "primary",
        originType: "primary_document",
        documentTitle: "OECD Digital Education Outlook 2026",
        url: "https://www.oecd.org/en/publications/2026/01/oecd-digital-education-outlook-2026_940e0dd8.html",
        publishedAt: "2026-01-19T00:00:00Z",
        passage:
          "OECD 디지털 교육 전망은 일반 생성형 AI의 답을 그대로 받는 것과 교육 목적에 맞춘 도구를 구분하고, 질문과 자기 설명, 단계적 도움으로 사고를 지원하는 설계를 소개한다.",
        policyUrl: "https://www.oecd.org/en/about/terms-conditions.html",
      },
      {
        publisher: "UK Department for Education",
        publisherType: "research",
        sourceType: "research",
        sourceRole: "independent",
        originType: "primary_document",
        documentTitle: "Generative AI product safety standards",
        url: "https://www.gov.uk/government/publications/generative-ai-product-safety-standards/generative-ai-product-safety-standards",
        publishedAt: "2026-01-19T00:00:00Z",
        passage:
          "영국 교육부의 생성형 AI 제품 기준은 아동 사용자를 고려한 시험, 안전한 기본 설정, 적절한 사용자 권한과 문제가 생겼을 때의 도움과 해결 절차를 요구한다.",
        policyUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      },
    ],
  },
] as const;

export function buildBackfillGeneratedPost(
  topic: BackfillTopic,
  items: readonly EvidenceItem[],
): GeneratedPost {
  const [primary, independent] = items;
  if (primary === undefined || independent === undefined) {
    throw new Error("BACKFILL_EVIDENCE_PAIR_REQUIRED");
  }
  const both = items.map((item) => ({
    evidenceId: item.evidenceId,
    support: "context" as const,
  }));
  return {
    title: topic.title,
    oneLineSummary: {
      sentenceId: "summary-sentence",
      text: topic.summary,
      claimIds: ["summary-claim"],
    },
    body: [
      {
        sentences: [
          {
            sentenceId: "primary-sentence",
            text: topic.primaryText,
            claimIds: ["primary-claim"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "independent-sentence",
            text: topic.independentText,
            claimIds: ["independent-claim"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "synthesis-sentence",
            text: topic.synthesisText,
            claimIds: ["synthesis-claim"],
          },
        ],
      },
    ],
    questions: [topic.question],
    claims: [
      {
        claimId: "summary-claim",
        text: topic.summary,
        kind: "context",
        importance: "key",
        displayCitation: true,
        evidenceRefs: both,
      },
      {
        claimId: "primary-claim",
        text: topic.primaryText,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [
          { evidenceId: primary.evidenceId, support: "direct" },
        ],
      },
      {
        claimId: "independent-claim",
        text: topic.independentText,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [
          { evidenceId: independent.evidenceId, support: "direct" },
        ],
      },
      {
        claimId: "synthesis-claim",
        text: topic.synthesisText,
        kind: "context",
        importance: "supporting",
        displayCitation: false,
        evidenceRefs: both,
      },
    ],
    usedEvidenceIds: items.map((item) => item.evidenceId),
  };
}
import type { EvidenceItem, GeneratedPost } from "../src/contracts";
