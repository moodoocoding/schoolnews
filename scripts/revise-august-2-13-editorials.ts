import { createHash } from "node:crypto";

import {
  publishedPostDetailSchema,
  type PublishedPostDetail,
} from "../src/contracts";

type EditorialSource = Readonly<{
  id: string;
  sourceId: string;
  articleId: string;
  publisher: string;
  publisherGroupId: string;
  provenanceGroupKey: string;
  publisherType: "official" | "news" | "research";
  sourceRole: "primary" | "independent";
  sourceType: "primary" | "news" | "research";
  originType: "primary_document" | "original_reporting";
  title: string;
  url: string;
  publishedAt: string;
  passage: string;
}>;

type EditorialDraft = Readonly<{
  date: string;
  title: string;
  summary: string;
  oneLineSummary: string;
  paragraphs: readonly [string, string, string];
  question: string;
  sourceIds: readonly [string, string];
}>;

const SOURCES: readonly EditorialSource[] = [
  {
    id: "editorial-evidence-kedi-ai-classroom-20260625",
    sourceId: "editorial-source-kedi",
    articleId: "editorial-article-kedi-ai-classroom-20260625",
    publisher: "한국교육개발원",
    publisherGroupId: "kedi",
    provenanceGroupKey: "kedi-primary",
    publisherType: "research",
    sourceRole: "primary",
    sourceType: "research",
    originType: "primary_document",
    title: "초·중등 교실에서 AI 활용, 무엇이 어려운가",
    url: "https://www.kedi.re.kr/khome/main/announce/selectBroadAnnounceForm.do?article_sq_no=36409&board_sq_no=3&selectTp=0",
    publishedAt: "2026-06-25T00:00:00+09:00",
    passage:
      "한국교육개발원은 장학사와 교사 면담을 토대로 학생, 교사, 인프라, 교육과정, 제도·거버넌스의 다섯 측면에서 교실 AI 활용의 어려움을 정리하고 현장 중심 지원을 제안했다.",
  },
  {
    id: "editorial-evidence-keris-generative-guide-2023",
    sourceId: "editorial-source-keris",
    articleId: "editorial-article-keris-generative-guide-2023",
    publisher: "한국교육학술정보원",
    publisherGroupId: "keris",
    provenanceGroupKey: "keris-primary",
    publisherType: "official",
    sourceRole: "primary",
    sourceType: "primary",
    originType: "primary_document",
    title: "교과별 생성형 AI 활용 길라잡이",
    url: "https://keris.or.kr/main/ad/pblcte/selectPblcteETCInfo.do?mi=1142&pblcteSeq=13747",
    publishedAt: "2023-01-01T00:00:00+09:00",
    passage:
      "한국교육학술정보원 길라잡이는 생성형 AI의 이해와 주의 사항을 설명하고 여러 교과에서 활용할 수 있는 예시를 제시해, 활용과 검토를 함께 다루는 출발 자료를 제공한다.",
  },
  {
    id: "editorial-evidence-moe-software-20251229",
    sourceId: "editorial-source-moe",
    articleId: "editorial-article-moe-software-20251229",
    publisher: "교육부",
    publisherGroupId: "moe",
    provenanceGroupKey: "moe-primary",
    publisherType: "official",
    sourceRole: "primary",
    sourceType: "primary",
    originType: "primary_document",
    title: "학교의 안전하고 효과적인 학습지원 소프트웨어 선정을 위한 기준 안내",
    url: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105007&lev=0&m=020",
    publishedAt: "2025-12-29T00:00:00+09:00",
    passage:
      "교육부는 학습지원 소프트웨어를 고를 때 개인정보 최소 수집과 아동 보호, 교육목표와 학생 특성, 학교의 기기·네트워크 환경, 접근성과 지원 체계를 함께 확인하도록 안내했다.",
  },
  {
    id: "editorial-evidence-pipc-deepfake-20260312",
    sourceId: "editorial-source-pipc",
    articleId: "editorial-article-pipc-deepfake-20260312",
    publisher: "개인정보보호위원회",
    publisherGroupId: "pipc",
    provenanceGroupKey: "pipc-primary",
    publisherType: "official",
    sourceRole: "primary",
    sourceType: "primary",
    originType: "primary_document",
    title: "AI 생성 콘텐츠 오남용 및 프라이버시 침해 대응 공동선언문",
    url: "https://m.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS105&mCode=D060010000&nttId=11883",
    publishedAt: "2026-03-12T00:00:00+09:00",
    passage:
      "개인정보보호위원회가 소개한 공동선언은 AI 생성 이미지와 영상의 프라이버시 위협, 아동 보호, 투명성, 개인정보 최소화, 신고와 삭제 절차의 필요성을 강조한다.",
  },
  {
    id: "editorial-evidence-hangyo-direction-20260810",
    sourceId: "editorial-source-hangyo",
    articleId: "editorial-article-hangyo-direction-20260810",
    publisher: "한국교육신문",
    publisherGroupId: "hangyo",
    provenanceGroupKey: "hangyo-original",
    publisherType: "news",
    sourceRole: "independent",
    sourceType: "news",
    originType: "original_reporting",
    title: "학교 AI교육이 지향해야 할 방향은",
    url: "https://www.hangyo.com/news/article.html?no=108774",
    publishedAt: "2026-08-10T00:00:00+09:00",
    passage:
      "한국교육신문은 학교 AI 교육이 빠른 정답 획득보다 문제를 정의하고 결과를 고쳐 보며 협력하는 경험을 지향해야 한다는 교육 현장의 논의를 전했다.",
  },
  {
    id: "editorial-evidence-hangyo-contest-20260811",
    sourceId: "editorial-source-hangyo",
    articleId: "editorial-article-hangyo-contest-20260811",
    publisher: "한국교육신문",
    publisherGroupId: "hangyo",
    provenanceGroupKey: "hangyo-original",
    publisherType: "news",
    sourceRole: "independent",
    sourceType: "news",
    originType: "original_reporting",
    title: "KERIS 공공데이터·AI 활용대회, 학생 아이디어 주목",
    url: "https://www.hangyo.com/news/article.html?no=108819",
    publishedAt: "2026-08-11T00:00:00+09:00",
    passage:
      "한국교육신문은 KERIS 공공데이터·AI 활용대회에서 학생들이 AI 의존과 사고 과정을 돌아보는 아이디어를 포함해 교육 문제를 데이터와 AI로 탐색한 사례를 전했다.",
  },
  {
    id: "editorial-evidence-hangyo-smartphone-20260811",
    sourceId: "editorial-source-hangyo",
    articleId: "editorial-article-hangyo-smartphone-20260811",
    publisher: "한국교육신문",
    publisherGroupId: "hangyo",
    provenanceGroupKey: "hangyo-original",
    publisherType: "news",
    sourceRole: "independent",
    sourceType: "news",
    originType: "original_reporting",
    title: "스마트폰 없는 교실을 둘러싼 교육적 질문",
    url: "https://www.hangyo.com/news/article.html?no=108821",
    publishedAt: "2026-08-11T00:00:00+09:00",
    passage:
      "한국교육신문은 학교의 스마트폰 사용 제한 논의를 전하며 집중과 관계 회복이라는 기대와 디지털 기기를 교육적으로 다루는 역량 사이의 질문을 제기했다.",
  },
  {
    id: "editorial-evidence-hangyo-rural-20260812",
    sourceId: "editorial-source-hangyo",
    articleId: "editorial-article-hangyo-rural-20260812",
    publisher: "한국교육신문",
    publisherGroupId: "hangyo",
    provenanceGroupKey: "hangyo-original",
    publisherType: "news",
    sourceRole: "independent",
    sourceType: "news",
    originType: "original_reporting",
    title: "농산어촌·소규모 학교의 AI 교육 접근성",
    url: "https://www.hangyo.com/news/article.html?no=108824",
    publishedAt: "2026-08-12T00:00:00+09:00",
    passage:
      "한국교육신문은 농산어촌과 소규모 학교의 AI 교육 기회를 다루며 연결망과 기기뿐 아니라 사람과 지속적인 지원 체계가 접근성을 좌우한다고 전했다.",
  },
];

const DRAFTS: readonly EditorialDraft[] = [
  {
    date: "2026-08-02",
    title: "도구 연수는 왜 현장에 남지 않을까",
    summary: "AI 연수가 많아질수록 교사에게 남는 것이 기능 목록인지 판단 기준인지 돌아봅니다.",
    oneLineSummary: "AI 연수의 성패는 몇 개의 도구를 배웠는지가 아니라 무엇을 선택하지 않을 이유까지 남겼는지에 달려 있습니다.",
    paragraphs: [
      "한국교육개발원은 교실 AI 활용이 넓어졌지만 현장의 어려움도 학생, 교사, 인프라, 교육과정, 제도라는 여러 층에 걸쳐 있다고 정리했습니다. 특히 도구 사용법을 빠르게 훑는 연수만으로는 실제 상황에 옮기기 어렵다는 목소리를 담았습니다. 한국교육학술정보원의 생성형 AI 길라잡이 역시 활용 예시와 함께 주의할 점을 놓지 않습니다. 기능을 아는 일과 교육적으로 판단하는 일은 같은 능력이 아니라는 뜻입니다.",
      "새 도구를 소개하는 연수는 당장 만족도가 높습니다. 내일 써 볼 화면과 문장이 손에 잡히기 때문입니다. 하지만 서비스는 바뀌고 기능은 사라집니다. 연수의 기억이 버튼 위치에 묶이면 교사는 다시 초보자가 됩니다. 반대로 어떤 정보를 넣지 않을지, AI 답을 어디까지 믿을지, 사용하지 않는 편이 나은 순간은 언제인지 판단하는 기준을 얻었다면 도구가 바뀌어도 경험은 남습니다. 빠른 활용을 약속하는 연수가 오히려 판단을 외주화할 위험도 있습니다.",
      "그래서 AI 연수의 결과물을 ‘만든 자료’가 아니라 ‘내린 결정’으로 보아야 하지 않을까요. 같은 도구를 두고 한 교사는 쓰고 다른 교사는 쓰지 않았을 때, 둘 중 하나를 뒤처졌다고 부르기보다 각 판단의 근거를 말하게 하는 것입니다. 교사에게 필요한 것은 정답 도구 목록이 아니라 학생, 맥락, 비용과 위험을 함께 저울질하는 언어일 수 있습니다. 우리에게 남은 연수 자료에는 사용법만큼 사용하지 않을 이유도 적혀 있는지 돌아볼 때입니다.",
    ],
    question: "AI 연수가 끝난 뒤 교사에게 남아야 할 가장 오래가는 판단 기준은 무엇일까요?",
    sourceIds: ["editorial-evidence-kedi-ai-classroom-20260625", "editorial-evidence-keris-generative-guide-2023"],
  },
  {
    date: "2026-08-03",
    title: "AI 윤리는 금지 목록으로 충분할까",
    summary: "하지 말아야 할 일을 외우는 윤리에서 결과에 책임지는 판단으로 넘어갈 방법을 생각합니다.",
    oneLineSummary: "AI 윤리는 위험한 행동을 금지하는 규칙을 넘어, 보이지 않는 사람에게 미칠 결과를 상상하는 능력이어야 합니다.",
    paragraphs: [
      "개인정보보호위원회가 소개한 공동선언은 AI로 만든 이미지와 영상이 동의 없는 노출과 아동의 프라이버시 침해로 이어질 수 있다고 경고합니다. 한국교육개발원의 현장 조사에서도 학생이 개인정보를 입력하거나 딥페이크를 오남용한 사례가 AI 윤리의 어려움으로 언급됐습니다. 두 자료는 윤리가 별도의 마지막 단원이 아니라, AI를 켜는 순간부터 작동해야 할 기본 조건임을 보여 줍니다.",
      "학교의 윤리 교육은 흔히 이름과 사진을 입력하지 말라는 금지 목록에서 시작합니다. 필요한 출발이지만 그것만으로는 부족합니다. 규칙을 피해 만든 합성 이미지가 누군가에게 수치와 불안을 남길 수 있다는 사실, 재미로 공유한 결과가 복제되어 돌아오지 않을 수 있다는 사실은 체크박스로 다 배우기 어렵습니다. 생성 버튼을 누른 사람만이 아니라 요청한 사람, 퍼뜨린 사람, 방관한 사람의 책임도 서로 다르게 남습니다.",
      "그렇다면 AI 윤리의 핵심은 ‘들키지 않는 사용법’이 아니라 결과를 미리 상상하는 연습일 것입니다. 화면에 없는 사람의 동의, 삭제해도 남을 흔적, 웃지 못하는 당사자의 자리를 질문하는 일입니다. 기술은 계속 새로워져 금지 목록보다 먼저 달아날 수 있지만, 타인의 권리와 나의 책임을 연결하는 질문은 쉽게 낡지 않습니다. 우리는 학생에게 규칙을 얼마나 많이 알려 주는가보다 멈춰야 할 순간을 스스로 알아차리게 하는가를 물어야 합니다.",
    ],
    question: "AI 결과물에 등장하지 않은 사람의 권리까지 생각하게 하려면 어떤 질문이 필요할까요?",
    sourceIds: ["editorial-evidence-pipc-deepfake-20260312", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-04",
    title: "화면 시간보다 학습의 밀도를 묻자",
    summary: "디지털 기기를 쓴 시간보다 그 시간에 무엇을 생각하고 누구와 연결됐는지를 살펴봅니다.",
    oneLineSummary: "같은 삼십 분의 화면도 소비, 창작, 대화에 따라 전혀 다른 경험이 되므로 시간만으로 교육의 질을 재기 어렵습니다.",
    paragraphs: [
      "한국교육개발원은 교실의 AI 활용이 로그인과 파일 공유 같은 기초 조작, 불안정한 연결망, 교육과정과 맞지 않는 문항 등 여러 조건에 걸려 있다고 전했습니다. 한국교육학술정보원의 길라잡이는 생성형 AI를 여러 교과에 연결하면서도 이해와 주의 사항을 함께 제시합니다. 화면을 켰다는 사실만으로 디지털 교육이 시작되는 것도, 화면을 오래 봤다는 이유만으로 같은 경험이 되는 것도 아닙니다.",
      "화면 시간은 세기 쉽습니다. 그래서 관리의 기준이 되기 쉽지만, 숫자는 그 안에서 벌어진 일을 지웁니다. 영상을 수동으로 넘긴 삼십 분과 친구의 주장을 검토하며 공동 문서를 고친 삼십 분, AI 답의 오류를 찾느라 출처를 비교한 삼십 분은 같은 칸에 기록됩니다. 반대로 종이를 사용했다고 해서 자동으로 깊은 생각이 생기지도 않습니다. 매체의 종류보다 그 매체가 학생에게 요구한 사고와 관계의 밀도가 더 중요한 이유입니다.",
      "디지털 웰빙을 ‘적게 쓰기’로만 설명하면 학교는 쉬운 제한과 어려운 설계 사이에서 늘 제한을 고르게 됩니다. 그러나 필요한 질문은 몇 분 사용했는가 다음에 시작됩니다. 그 시간에 학생은 선택했는가, 고쳤는가, 설명했는가, 다른 사람과 연결됐는가. AI·디지털 교육은 화면을 늘리는 정책도 줄이는 운동도 아니라, 제한된 시간 안에 어떤 경험을 남길지 결정하는 일일 수 있습니다. 우리 학교가 세고 있는 숫자는 정작 중요한 것을 보여 주고 있을까요.",
    ],
    question: "우리의 디지털 활동 기록에 시간 외에 어떤 경험의 흔적을 남겨야 할까요?",
    sourceIds: ["editorial-evidence-kedi-ai-classroom-20260625", "editorial-evidence-keris-generative-guide-2023"],
  },
  {
    date: "2026-08-05",
    title: "좋은 프롬프트가 좋은 질문은 아니다",
    summary: "정교한 명령문을 만드는 능력과 무엇을 물어야 하는지 알아차리는 능력의 차이를 생각합니다.",
    oneLineSummary: "프롬프트가 답의 모양을 다듬을 수는 있지만, 무엇이 문제인지 정하는 판단까지 대신해 주지는 못합니다.",
    paragraphs: [
      "한국교육학술정보원은 교과별 생성형 AI 활용 사례를 제시하며 질문하고 결과를 검토하는 과정을 안내합니다. 한국교육개발원은 현장에서 AI 도구가 교육과정의 성취기준과 맞지 않거나 특정 교과에 치우친 문제를 짚었습니다. 도구에 명확히 지시하는 기술이 필요하더라도, 그 지시가 교육적으로 중요한 문제를 향하고 있는지는 별도의 판단입니다. 잘 쓴 프롬프트와 잘 고른 질문은 닮아 보이지만 출발점이 다릅니다.",
      "프롬프트 교육은 조건, 역할, 형식을 넣으면 답이 좋아진다고 가르칩니다. 실제로 결과는 정돈됩니다. 하지만 정돈된 답은 질문의 빈틈까지 가려 줍니다. 누구의 관점이 빠졌는지, 왜 지금 이 문제를 풀어야 하는지, 답을 얻으면 무엇이 달라지는지는 문장 기술만으로 생기지 않습니다. 질문이 빈약한데 답만 매끄러워질 때 우리는 이해가 깊어졌다는 착각을 하기 쉽습니다. AI는 질문의 질을 확대하지만 방향을 보증하지는 않습니다.",
      "그래서 프롬프트를 평가할 때 결과물만 보지 않고 질문이 만들어진 과정을 보아야 합니다. 처음의 막연함이 어떤 관찰을 거쳐 문제로 좁혀졌는지, AI 답을 받은 뒤 질문이 어떻게 바뀌었는지, 끝내 답하지 못한 것은 무엇인지 말하게 하는 것입니다. 좋은 질문은 한 번에 좋은 답을 받는 문장이 아니라 답을 만날수록 더 정확해지는 생각일 수 있습니다. AI에게 무엇을 시킬지 배우기 전에 우리가 정말 알고 싶은 것이 무엇인지 묻는 시간이 남아 있는지 돌아봅니다.",
    ],
    question: "매끄러운 AI 답을 얻은 뒤에도 처음 질문을 다시 고쳐야 하는 이유는 무엇일까요?",
    sourceIds: ["editorial-evidence-keris-generative-guide-2023", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-06",
    title: "AI가 덜어 준 시간은 어디로 가는가",
    summary: "자동화로 절약한 시간이 다시 더 많은 생산을 요구하는 시간으로 돌아오는 역설을 살펴봅니다.",
    oneLineSummary: "AI가 업무 시간을 줄였다는 말보다 그 시간이 관찰, 대화, 숙고 중 어디로 이동했는지가 더 중요합니다.",
    paragraphs: [
      "한국교육개발원은 교사들이 AI 활용 여부의 차이, 도구 중심 연수, 인프라와 예산의 제약을 동시에 겪는다고 정리했습니다. 한국교육학술정보원의 길라잡이는 생성형 AI가 여러 교과의 자료와 아이디어를 만드는 데 쓰일 수 있음을 보여 줍니다. AI 도입을 설명할 때 가장 자주 등장하는 약속은 시간 절약입니다. 하지만 줄어든 시간이 무엇으로 채워졌는지는 보통 성과표에 적히지 않습니다.",
      "자료 한 장을 만드는 시간이 줄면 교사는 학생을 더 오래 볼 수 있을까요. 현실에서는 더 많은 자료, 더 빠른 피드백, 더 정교한 기록을 요구받을 수도 있습니다. 효율이 새 기준이 되면 어제의 충분함은 오늘의 부족함이 됩니다. AI가 일을 덜어 주는 동시에 가능한 일의 양을 늘리기 때문입니다. 절약된 시간을 비워 두지 못하면 기술의 편리함은 업무의 밀도만 높이고, 교사가 판단을 천천히 다듬을 여백은 오히려 줄어듭니다.",
      "AI의 효과를 생산량으로만 재면 사람에게 돌아온 시간은 보이지 않습니다. 학생의 말이 끝날 때까지 기다린 시간, 동료와 실패 이유를 나눈 시간, 하지 않아도 될 일을 골라낸 시간은 산출물 개수로 환산하기 어렵습니다. 그래서 도입 전에 ‘무엇을 더 할까’와 함께 ‘무엇을 덜 할까’를 정해야 합니다. AI가 만든 여백을 조직이 다시 가져가지 않도록 지키는 일도 디지털 전환의 설계입니다. 우리에게 효율은 더 많이 하는 능력일까요, 더 중요한 것에 머무는 능력일까요.",
    ],
    question: "AI가 아낀 시간을 교사와 학생에게 돌려주려면 무엇을 더 하지 않기로 해야 할까요?",
    sourceIds: ["editorial-evidence-kedi-ai-classroom-20260625", "editorial-evidence-keris-generative-guide-2023"],
  },
  {
    date: "2026-08-07",
    title: "편리한 학습 앱의 진짜 비용",
    summary: "무료와 편리함 뒤에서 학생의 정보, 학교의 선택권, 교사의 시간이 어떤 대가를 치르는지 묻습니다.",
    oneLineSummary: "학습 앱의 가격표에 학생 데이터와 전환 비용이 보이지 않는다면 무료라는 말만으로 가치를 판단할 수 없습니다.",
    paragraphs: [
      "교육부는 학습지원 소프트웨어를 고를 때 개인정보 최소 수집, 보유기간과 삭제 절차, 아동 보호, 교육목표와 학교 환경의 적합성을 함께 확인하도록 안내했습니다. 개인정보보호위원회가 소개한 AI 공동선언도 개인정보 최소화와 투명성, 신고와 삭제 경로를 강조합니다. 두 자료는 앱 선택이 기능 비교나 구독료 계산을 넘어 학생의 권리와 학교의 책임을 정하는 결정임을 보여 줍니다.",
      "무료 앱은 예산 부담을 낮추고 시작을 쉽게 만듭니다. 그러나 계정을 만들고 학습 흔적이 쌓이면 학교는 다른 비용을 치릅니다. 어떤 데이터가 어디에 남는지 확인하는 시간, 약관이 바뀔 때 다시 판단하는 시간, 서비스가 종료될 때 자료를 옮기는 시간입니다. 학생의 기록이 서비스를 편리하게 만드는 자원이 된다면 무료라는 표현도 다시 보아야 합니다. 비용이 없는 것이 아니라 돈이 아닌 형태로 흩어져 보이지 않을 수 있습니다.",
      "그래서 좋은 앱 선정표에는 기능 수만큼 떠나는 방법도 적혀 있어야 합니다. 계정을 지울 수 있는가, 자료를 가져올 수 있는가, 사용을 멈춰도 학생에게 불이익이 없는가, 교사가 이유를 설명할 수 있는가. 선택권은 설치 버튼을 누를 때보다 나중에 그만둘 수 있을 때 더 분명해집니다. AI·디지털 교육의 자율성은 많은 도구를 쓸 자유뿐 아니라 의존을 끝낼 자유까지 포함해야 합니다. 우리 학교가 선택한 앱에서 가장 비싼 것은 무엇일까요.",
    ],
    question: "학습 앱을 도입하기 전에 반드시 확인해야 할 ‘그만두는 방법’은 무엇일까요?",
    sourceIds: ["editorial-evidence-moe-software-20251229", "editorial-evidence-pipc-deepfake-20260312"],
  },
  {
    date: "2026-08-08",
    title: "딥페이크를 알아보면 충분할까",
    summary: "가짜를 판별하는 기술보다 만들고 퍼뜨리는 관계의 책임을 먼저 보아야 하는 이유를 생각합니다.",
    oneLineSummary: "딥페이크 교육은 진위를 맞히는 퀴즈를 넘어 동의와 유통, 피해 회복의 책임까지 다뤄야 합니다.",
    paragraphs: [
      "개인정보보호위원회가 소개한 공동선언은 동의 없이 만든 AI 이미지와 영상이 개인의 존엄과 사생활을 위협하며 특히 아동 보호가 필요하다고 강조합니다. 한국교육개발원의 현장 조사도 학생의 딥페이크 오남용을 AI 윤리 문제로 짚었습니다. 학교는 흔히 화면 속 흔적을 찾아 가짜를 판별하는 활동으로 대응하지만, 기술이 정교해질수록 판별의 정답은 오래 유지되기 어렵습니다.",
      "더 근본적인 문제는 가짜인지 진짜인지에만 있지 않습니다. 실제 사진을 허락 없이 공유해도 피해는 생기고, 완전히 가짜인 이미지도 특정인을 알아볼 수 있게 만들면 관계를 무너뜨릴 수 있습니다. 판별 훈련만 강조하면 학생은 들키지 않을 만큼 정교하게 만들면 된다는 잘못된 결론에 이를 수도 있습니다. 생성의 기술과 유통의 속도는 개인의 판단보다 빠르지만, 동의가 없었다는 사실은 기술 수준과 무관하게 남습니다.",
      "딥페이크 교육의 출발 질문을 ‘이것은 가짜인가’에서 ‘누가 이 결과의 영향을 받는가’로 옮겨 보면 어떨까요. 만들기 전 동의를 구했는지, 공유를 멈출 수 있는지, 피해자가 삭제와 도움을 요청할 길이 있는지 살피는 것입니다. 식별 능력은 필요하지만 그것이 책임을 대신하지는 않습니다. AI 시대의 미디어 리터러시는 눈썰미보다 관계를 지키는 판단에 가까울 수 있습니다. 우리는 정확히 맞힌 학생보다 멈출 줄 아는 학생을 어떻게 알아볼 수 있을까요.",
    ],
    question: "가짜를 잘 찾아내는 능력과 타인의 권리를 지키는 능력은 어떻게 다를까요?",
    sourceIds: ["editorial-evidence-pipc-deepfake-20260312", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-09",
    title: "빠른 답이 생각을 멈추게 할 때",
    summary: "AI의 즉답이 도움인지 방해인지 가르는 기준을 답의 정확도 밖에서 찾아봅니다.",
    oneLineSummary: "AI 답이 정확해도 학생의 예상과 망설임, 수정 과정이 사라진다면 배움은 더 빨라진 대신 더 얕아질 수 있습니다.",
    paragraphs: [
      "한국교육학술정보원의 생성형 AI 길라잡이는 여러 교과에서 질문과 초안 작성, 아이디어 탐색에 AI를 활용할 가능성을 보여 줍니다. 한국교육개발원은 반대로 교육과정과 맞지 않는 문항, 기초 디지털 역량의 차이, 도구 중심 연수 같은 현장의 마찰을 전합니다. AI의 빠른 답은 분명 유용하지만, 무엇을 돕는지 정하지 않으면 막혀 있어야 할 순간까지 지워 버릴 수 있습니다.",
      "배움에는 바로 해결되지 않아서 생기는 생각이 있습니다. 틀린 예상을 말해 보고, 친구의 설명과 충돌하고, 다시 시도할 이유를 찾는 시간입니다. AI가 시작과 동시에 완성된 구조를 내놓으면 학생은 내용을 고르는 사람은 될 수 있어도 구조를 발명한 사람은 되기 어렵습니다. 정답률이 높다는 이유만으로 좋은 도움이라고 부르면, 우리는 과정에서만 볼 수 있는 학생의 오해와 전략, 고집과 전환을 잃게 됩니다.",
      "그러므로 AI를 언제 보여 줄 것인지가 무엇을 보여 줄지보다 중요할 수 있습니다. 먼저 자신의 예상과 근거를 남긴 뒤 AI 답과 비교하게 할지, 막힌 지점을 설명한 뒤 힌트만 요청하게 할지에 따라 같은 도구가 다른 배움을 만듭니다. 도움은 어려움을 없애는 일이 아니라 넘어설 수 있는 크기로 바꾸는 일입니다. AI가 가장 빨리 답할 수 있는 순간에 일부러 기다리는 선택은 비효율이 아니라 사고의 자리를 보존하는 설계일 수 있습니다.",
    ],
    question: "AI의 답을 바로 보여 주지 않는 편이 더 도움이 되는 순간은 언제일까요?",
    sourceIds: ["editorial-evidence-keris-generative-guide-2023", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-10",
    title: "AI 교육의 출발점은 문제 정의다",
    summary: "도구를 먼저 정한 뒤 쓰임을 찾는 방식과 문제를 먼저 살핀 뒤 기술을 고르는 방식의 차이를 봅니다.",
    oneLineSummary: "AI 교육의 깊이는 어떤 모델을 썼는가보다 왜 그 문제를 AI와 함께 풀기로 했는가에서 드러납니다.",
    paragraphs: [
      "한국교육신문은 학교 AI 교육이 빠른 정답보다 문제를 정의하고 결과를 고치며 협력하는 경험을 향해야 한다는 논의를 전했습니다. 한국교육개발원 역시 교실에 들어온 도구가 교육과정과 맞지 않거나 학교 여건을 따라가지 못하는 문제를 확인했습니다. 두 소식은 기술을 먼저 고르고 사용할 장면을 찾는 순서가 현장에서 자주 어긋날 수 있음을 보여 줍니다.",
      "새로운 AI가 등장하면 학교는 활용 사례부터 찾습니다. 그러면 평범한 활동도 도구를 쓰기 위해 복잡해지고, 기술 없이도 잘 되던 일이 혁신이라는 이름을 얻습니다. 문제를 나중에 붙이면 성과는 사용 횟수와 결과물 개수로 측정되기 쉽습니다. 반대로 학생이 실제로 겪는 막힘, 교사가 반복해서 놓치는 정보, 학교가 해결하지 못한 불편에서 시작하면 AI를 쓰지 않는 결론도 정당한 설계가 됩니다.",
      "문제 정의는 거창한 연구 절차가 아닙니다. 누구의 어떤 어려움인지, 지금까지 무엇을 시도했는지, 해결되었다는 증거는 무엇인지 합의하는 일입니다. 이 질문을 통과한 뒤에야 AI의 속도와 패턴 찾기가 의미를 갖습니다. 기술 선택의 자유에는 기술을 거절할 근거도 포함됩니다. AI 교육이 도구 전시회가 되지 않으려면 사용법보다 문제를 발견하고 이름 붙이는 힘을 먼저 키워야 합니다. 우리 학교의 AI는 지금 어떤 문제의 답으로 존재하고 있을까요.",
    ],
    question: "지금 사용하는 AI 도구를 지워도 남아 있어야 할 교육의 문제는 무엇인가요?",
    sourceIds: ["editorial-evidence-hangyo-direction-20260810", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-11",
    title: "AI 의존도를 숫자로 볼 수 있을까",
    summary: "AI를 몇 번 썼는지보다 생각의 어느 부분을 넘겼는지 살펴야 의존의 모습을 볼 수 있습니다.",
    oneLineSummary: "AI 의존은 사용 횟수가 아니라 질문, 선택, 검토 중 어느 판단을 자신이 계속 맡고 있는가의 문제입니다.",
    paragraphs: [
      "한국교육신문은 공공데이터와 AI를 활용한 대회에서 학생들이 AI 의존과 사고 과정을 돌아보는 아이디어를 냈다고 전했습니다. 한국교육개발원은 학생의 디지털 기초 역량과 윤리적 판단, 교사의 활용 차이가 함께 나타난다고 분석했습니다. AI 사용이 일상이 되면 학교는 의존을 걱정하지만, 의존이라는 말은 사용 횟수만으로는 잘 보이지 않습니다.",
      "한 학생은 매일 AI를 쓰면서도 질문을 직접 만들고 답을 의심하며 최종 판단을 맡을 수 있습니다. 다른 학생은 한 번만 사용해도 과제의 방향과 문장을 모두 넘길 수 있습니다. 화면을 켠 횟수는 같지 않지만 생각을 맡긴 정도는 반대일 수 있습니다. 사용 시간을 줄이는 규칙만으로는 이 차이를 읽지 못합니다. 오히려 AI를 숨겨서 쓰게 만들면 교사는 과정의 흔적을 더 적게 보게 됩니다.",
      "의존을 살피려면 결과물에 ‘내가 한 일’의 지도를 남겨야 합니다. 질문을 만든 사람, 자료를 고른 기준, AI 제안을 버린 이유, 마지막 문장을 책임지는 사람이 누구였는지 적는 것입니다. 목적은 AI 사용을 고백하게 하는 감시가 아니라 판단의 주인이 어디에 있는지 스스로 보게 하는 데 있습니다. 도움을 받았다는 사실보다 도움 뒤에도 남은 생각이 무엇인지 말할 수 있다면, AI는 지팡이가 아니라 거울이 될 수 있습니다.",
    ],
    question: "AI를 사용한 결과물에서 학생 자신의 판단이 남아 있음을 무엇으로 확인할 수 있을까요?",
    sourceIds: ["editorial-evidence-hangyo-contest-20260811", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
  {
    date: "2026-08-12",
    title: "스마트폰 없는 교실과 AI의 역설",
    summary: "기기는 치우면서 디지털 역량은 키워야 하는 학교가 어떤 원칙을 세워야 하는지 묻습니다.",
    oneLineSummary: "스마트폰을 치우는 것과 디지털 교육을 포기하는 것은 같지 않으며, 핵심은 기기를 누가 어떤 목적으로 통제하는가입니다.",
    paragraphs: [
      "한국교육신문은 스마트폰 사용을 줄여 집중과 관계를 회복하려는 학교의 논의를 전했습니다. 교육부는 학습지원 소프트웨어를 고를 때 학생 특성과 교육목표, 학교의 기기와 연결망, 개인정보 보호를 함께 살피도록 안내했습니다. 한쪽에서는 기기를 멀리하자고 하고 다른 쪽에서는 AI·디지털 역량을 키우자고 말합니다. 겉으로는 모순처럼 보이지만 두 요구는 같은 질문을 향합니다.",
      "문제는 기기가 있느냐 없느냐보다 누가 주도권을 갖느냐입니다. 알림과 추천이 학생의 주의를 끌고 가는 스마트폰과, 목적을 정하고 필요한 시간에만 여는 학습 도구는 같은 화면이어도 관계가 다릅니다. 무조건 허용하면 상업적 설계가 학교의 시간을 결정하고, 무조건 금지하면 학생은 기술을 다루는 판단을 연습할 기회를 잃습니다. 제한과 교육은 반대말이 아니라 서로를 가능하게 하는 경계일 수 있습니다.",
      "학교가 세울 원칙은 ‘항상 켜기’와 ‘항상 끄기’ 사이에 있어야 합니다. 기기를 여는 이유를 말할 수 있는가, 목적이 끝나면 닫을 수 있는가, 사용하지 않는 학생도 불리하지 않은가, 화면 밖 대화가 다시 시작되는가를 묻는 것입니다. 디지털 자율성은 기기를 마음대로 쓰는 자유가 아니라 자신의 주의를 어디에 둘지 선택하는 힘입니다. 스마트폰 없는 시간이 AI 교육의 후퇴가 아니라 주도권을 배우는 시간이 되려면 무엇이 함께 가르쳐져야 할까요.",
    ],
    question: "기기를 끄는 규칙과 디지털 주도권을 배우는 경험을 어떻게 연결할 수 있을까요?",
    sourceIds: ["editorial-evidence-hangyo-smartphone-20260811", "editorial-evidence-moe-software-20251229"],
  },
  {
    date: "2026-08-13",
    title: "AI 교육의 격차는 접속 속도뿐일까",
    summary: "같은 기기와 연결망을 제공한 뒤에도 남는 사람, 시간, 선택의 격차를 들여다봅니다.",
    oneLineSummary: "AI 교육의 접근성은 접속 가능 여부를 넘어 질문할 사람과 실패해 볼 시간, 도구를 선택할 권리가 있는가에 달려 있습니다.",
    paragraphs: [
      "한국교육신문은 농산어촌과 소규모 학교의 AI 교육 기회를 다루며 연결망과 기기뿐 아니라 사람과 지속적인 지원이 중요하다고 전했습니다. 한국교육개발원도 현장의 어려움을 인프라 하나로 좁히지 않고 학생, 교사, 교육과정과 제도의 문제로 함께 정리했습니다. 모든 학교에 같은 기기를 보급하면 출발선은 가까워질 수 있지만 경험까지 같아지는 것은 아닙니다.",
      "접속이 된다는 사실과 활용할 수 있다는 사실 사이에는 보이지 않는 자원이 있습니다. 문제가 생겼을 때 물어볼 사람, 새 도구를 시험하고 실패해도 되는 시간, 학생에게 맞지 않으면 다른 선택을 할 예산과 권한입니다. 규모가 작은 학교는 의사결정이 빠를 수 있지만 한 사람이 떠나면 경험도 함께 사라질 수 있습니다. 지원이 행사와 장비로 끝나면 격차는 잠시 가려질 뿐 다시 돌아옵니다.",
      "그래서 AI 교육의 형평성을 동일한 보급률이 아니라 지속 가능한 선택권으로 보아야 합니다. 어느 학교든 필요할 때 도움을 받고, 맥락에 맞지 않는 도구는 거절하며, 쌓인 경험을 사람 한 명의 헌신이 아닌 공동의 자산으로 남길 수 있어야 합니다. 똑같이 주는 정책은 공정해 보이지만 서로 다른 조건을 견디게 만들 수도 있습니다. 우리는 접속한 학교의 수뿐 아니라 스스로 방향을 바꿀 수 있는 학교의 수를 세고 있는지 묻습니다.",
    ],
    question: "기기 보급률 밖에서 AI 교육의 형평성을 보여 줄 수 있는 지표는 무엇일까요?",
    sourceIds: ["editorial-evidence-hangyo-rural-20260812", "editorial-evidence-kedi-ai-classroom-20260625"],
  },
];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const sourceById = new Map(SOURCES.map((source) => [source.id, source]));

export const AUGUST_EDITORIAL_SOURCES = SOURCES.map((source) => ({
  ...source,
  canonicalUrlHash: hash(source.url),
  contentFingerprint: hash("editorial-article-v1:" + source.url),
  passageHash: hash(source.passage),
}));

export const AUGUST_EDITORIAL_POSTS = DRAFTS.map((draft) => {
  const sources = draft.sourceIds.map((id) => {
    const source = sourceById.get(id);
    if (source === undefined) throw new Error("UNKNOWN_EDITORIAL_SOURCE:" + id);
    return {
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      publishedDate: source.publishedAt.slice(0, 10),
      originalUrl: source.url,
    };
  });
  const dateToken = draft.date.replaceAll("-", "");
  const post: PublishedPostDetail = publishedPostDetailSchema.parse({
    id: "editorial-post-" + dateToken,
    slug: "ai-digital-education-" + draft.date + "-editorial",
    publicationDateKst: draft.date,
    publishedAt: draft.date + "T07:00:00+09:00",
    modifiedAt: "2026-08-13T00:00:00.000Z",
    title: draft.title,
    summary: draft.summary,
    visual: {
      kind: "pattern",
      seed: "editorial-thought-piece-" + dateToken,
      templateVersion: "gallery-pattern-v2-calm",
    },
    oneLineSummary: { text: draft.oneLineSummary, sourceIds: [...draft.sourceIds] },
    body: draft.paragraphs.map((text) => ({
      claims: [{ text, sourceIds: [...draft.sourceIds] }],
    })),
    questions: [draft.question],
    sources,
  });
  const bodyLength = post.body.reduce(
    (total, paragraph) =>
      total + paragraph.claims.reduce((sum, claim) => sum + [...claim.text].length, 0),
    0,
  );
  if (post.body.length !== 3 || bodyLength < 600 || bodyLength > 1_000) {
    throw new Error(`EDITORIAL_LENGTH_INVALID:${draft.date}:${bodyLength}`);
  }
  return {
    date: draft.date,
    revisionId: "editorial-revision-" + dateToken + "-" + hash(JSON.stringify(post)).slice(0, 12),
    bodyLength,
    post,
  };
});

async function runProductionRevision(): Promise<void> {
  const projectUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (
    projectUrl !== "https://vrjuvozmnaufzvrzzbnd.supabase.co" ||
    secretKey === undefined ||
    process.env.APPLY_AUGUST_EDITORIAL_CONFIRM !== "2026-08-02..13"
  ) {
    throw new Error("AUGUST_EDITORIAL_CONFIRMATION_REQUIRED");
  }
  const headers = {
    apikey: secretKey,
    authorization: "Bearer " + secretKey,
    "content-type": "application/json",
  };
  const currentResponse = await fetch(
    projectUrl + "/rest/v1/rpc/get_august_editorial_targets",
    { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(15_000) },
  );
  if (!currentResponse.ok) throw new Error("CURRENT_POSTS_READ_FAILED");
  const currentRows = (await currentResponse.json()) as Array<{
    post_id: string;
    slug: string;
    publication_date_kst: string;
    published_at: string;
    active_revision_id: string;
  }>;
  const currentByDate = new Map(
    currentRows.map((row) => [row.publication_date_kst, row]),
  );

  for (const definition of AUGUST_EDITORIAL_POSTS) {
    const current = currentByDate.get(definition.date);
    if (current?.active_revision_id === definition.revisionId) {
      console.log(
        JSON.stringify({ event: "editorial_already_revised", date: definition.date }),
      );
      continue;
    }
    const post = publishedPostDetailSchema.parse({
      ...definition.post,
      id: current?.post_id ?? definition.post.id,
      slug: current?.slug ?? definition.post.slug,
      publishedAt: current?.published_at ?? definition.post.publishedAt,
      modifiedAt: new Date().toISOString(),
    });
    const response = await fetch(
      projectUrl + "/rest/v1/rpc/apply_august_editorial_revision",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_run_date: definition.date,
          p_expected_post_id: current?.post_id ?? null,
          p_expected_active_revision_id: current?.active_revision_id ?? null,
          p_new_revision_id: definition.revisionId,
          p_post: post,
          p_sources: AUGUST_EDITORIAL_SOURCES.filter((source) =>
            post.sources.some((published) => published.id === source.id),
          ),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `EDITORIAL_REVISION_FAILED:${definition.date}:${response.status}:${await response.text()}`,
      );
    }
    const result = publishedPostDetailSchema.parse(await response.json());
    console.log(
      JSON.stringify({ event: "editorial_revised", date: definition.date, id: result.id }),
    );
  }
}

if (process.argv[1]?.endsWith("revise-august-2-13-editorials.ts")) {
  console.log(
    JSON.stringify(
      AUGUST_EDITORIAL_POSTS.map(({ date, bodyLength, post }) => ({
        date,
        title: post.title,
        bodyLength,
        sourcePublishers: post.sources.map((source) => source.publisher),
      })),
      null,
      2,
    ),
  );
  if (process.env.APPLY_AUGUST_EDITORIAL_CONFIRM !== undefined) {
    await runProductionRevision();
  }
}
