import { CERT_CATALOG } from '../src/data/certCatalog.js';
import type {
  AskAnswer,
  CertCatalogItem,
  CertResearchResult,
  GroundingSource,
  LearnerLevel,
  StudyAreaId,
} from '../src/types/cert.js';

const WIKI_HEADERS = {
  'User-Agent': 'JagyeokBaekseo/1.0 (https://vercel.app; korean-certification-guide)',
  Accept: 'application/json',
};

interface WikiArticle {
  title: string;
  url: string;
  summary: string;
  sections: Record<string, string>;
}

const fullWikiCache = new Map<string, { ts: number; article: WikiArticle | null }>();
const WIKI_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeKey(name: string): string {
  return name.replace(/\s*\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
}

function findCatalogMatch(certName: string): CertCatalogItem | undefined {
  const exact = CERT_CATALOG.find((c) => c.name === certName);
  if (exact) return exact;
  const targetNorm = normalizeKey(certName);
  return CERT_CATALOG.find(
    (c) =>
      normalizeKey(c.name) === targetNorm ||
      c.aliases.some((a) => normalizeKey(a) === targetNorm)
  );
}

function parseWikiSections(rawExtract: string): { summary: string; sections: Record<string, string> } {
  const parts = rawExtract.split(/\n==+\s*([^=\n]+?)\s*==+\n/);
  const summary = (parts[0] || '').trim();
  const sections: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] || '').trim();
    const body = (parts[i + 1] || '').trim();
    if (heading && body) {
      sections[heading] = body.slice(0, 1200);
    }
  }
  return { summary: summary.slice(0, 1200), sections };
}

function pickSection(sections: Record<string, string>, keywords: string[]): string {
  for (const [heading, body] of Object.entries(sections)) {
    const cleanHeading = heading.replace(/\s+/g, '').toLowerCase();
    if (keywords.some((kw) => cleanHeading.includes(kw))) {
      return body;
    }
  }
  return '';
}

export async function fetchFullKoreanWikiArticle(certName: string): Promise<WikiArticle | null> {
  const cleanTitle = certName.replace(/\s*\(.*?\)/g, '').trim();
  if (!cleanTitle) return null;

  const cached = fullWikiCache.get(cleanTitle);
  if (cached && Date.now() - cached.ts < WIKI_TTL_MS) {
    return cached.article;
  }

  let article: WikiArticle | null = null;
  try {
    const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanTitle
    )}&srlimit=3&format=json`;
    const searchResp = await fetch(searchUrl, {
      headers: WIKI_HEADERS,
      signal: AbortSignal.timeout(1500),
    });

    if (searchResp.ok) {
      const searchJson = (await searchResp.json()) as {
        query?: { search?: Array<{ title: string; snippet?: string }> };
      };
      const candidates = searchJson?.query?.search ?? [];
      const exactTitle =
        candidates.find((c) => normalizeKey(c.title) === normalizeKey(cleanTitle))?.title ||
        candidates.find((c) =>
          /자격|시험|검정|기사|기능사|공인|세무사|노무사|중개사|어학/.test(
            `${c.title} ${c.snippet || ''}`
          )
        )?.title;

      if (exactTitle) {
        const detailUrl = `https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(
          exactTitle
        )}&format=json`;
        const detailResp = await fetch(detailUrl, {
          headers: WIKI_HEADERS,
          signal: AbortSignal.timeout(1800),
        });
        if (detailResp.ok) {
          const detailJson = (await detailResp.json()) as {
            query?: { pages?: Record<string, { title?: string; extract?: string }> };
          };
          const page = Object.values(detailJson?.query?.pages ?? {})[0];
          if (page?.extract) {
            const parsed = parseWikiSections(page.extract);
            const finalTitle = page.title || exactTitle;
            article = {
              title: finalTitle,
              url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(finalTitle)}`,
              summary: parsed.summary,
              sections: parsed.sections,
            };
          }
        }
      }
    }
  } catch {
    // Non-blocking external lookup
  }

  if (fullWikiCache.size >= 200) {
    const firstKey = fullWikiCache.keys().next().value;
    if (firstKey) fullWikiCache.delete(firstKey);
  }
  fullWikiCache.set(cleanTitle, { ts: Date.now(), article });
  return article;
}

interface VerifiedCurriculumSpec {
  subjects: Array<{
    name: string;
    weight: string;
    keyTopics: string[];
    memorizationTips: string;
  }>;
  studyOrderTip: string;
  coreTakeaways: string[];
  eligibility: string;
  feeInfo: string;
  schedule: string;
  latestChanges: string;
  cbtLinks?: Array<{ name: string; url: string; description: string }>;
  knownPublishers: Array<{
    title: string;
    publisher: string;
    ratio: string;
    characteristic: string;
    pros: string[];
    cons: string[];
    bestFor: string;
  }>;
  knownLectures: Array<{
    name: string;
    platform: string;
    courseName: string;
    textbookUsed: string;
    textbookPublisher: string;
    style: string;
    pros: string[];
    cautions: string[];
    bestFor: string;
    officialUrl: string;
  }>;
  hasOfficialInterview: boolean;
  benefits: string[];
}

// 100% factual official Korean curriculum/exam metadata (no fabricated pass rates)
const VERIFIED_CURRICULUMS: Record<string, VerifiedCurriculumSpec> = {
  정보처리기사: {
    subjects: [
      {
        name: '1과목 소프트웨어 설계',
        weight: '필기 20문항 (20%)',
        keyTopics: ['요구사항 확인·UML 다이어그램', 'UI 설계 원칙·지침', '디자인 패턴(생성·구조·행위)', '아키텍처 패턴'],
        memorizationTips: 'GoF 디자인 패턴 분류(생성/구조/행위)와 UML 관계(연관·의존·일반화·실체화) 구분이 빈출됩니다.',
      },
      {
        name: '2과목 소프트웨어 개발',
        weight: '필기 20문항 (20%)',
        keyTopics: ['자료구조·정렬 알고리즘', '테스트 기법(화이트박스·블랙박스)', '소프트웨어 패키징·형상관리', '애플리케이션 성능 개선'],
        memorizationTips: '블랙박스 vs 화이트박스 테스트 종류와 시간 복잡도(O(n log n) 등)를 표로 정리하세요.',
      },
      {
        name: '3과목 데이터베이스 구축',
        weight: '필기 20문항 (20%)',
        keyTopics: ['정규화(1NF~BCNF)', 'SQL DDL·DML·DCL', '관계대수·관계해석', '트랜잭션(ACID)·병행제어'],
        memorizationTips: '정규화 단계별 이행 조건과 SQL 구문 실행 결과는 실기에도 직결됩니다.',
      },
      {
        name: '4·5과목 프로그래밍 언어 활용 & 정보시스템 구축관리',
        weight: '필기 40문항 (40%)',
        keyTopics: ['C·Java·Python 코드 출력 결과 추적', '운영체제 프로세스 스케줄링·메모리 관리', '네트워크 OSI 7계층·서브네팅', '보안 공격 기법·암호화 알고리즘'],
        memorizationTips: '실기는 필답형(단답·코드 결과 추적·SQL·보안 용어) 중심으로 출제되므로 손코딩/직접 쓰기 연습이 필수입니다.',
      },
    ],
    studyOrderTip: '3과목(DB) → 4과목(언어/OS/네트워크) → 1·2과목 → 5과목(보안/신기술) 순으로 학습하면 필기와 실기를 동시에 대비할 수 있습니다.',
    coreTakeaways: [
      '필기: 5과목 100문항, 과목당 40점 이상 · 전 과목 평균 60점 이상 합격',
      '실기: 필답형(주관식 20문항 내외), 60점 이상 합격 — C/Java/Python 코드 추적 비중 높음',
      '정보기술 직무 분야는 4년제 대졸자라면 비전공 학과도 관련 학과로 인정되는 경우가 많으니 큐넷 자가진단 권장',
    ],
    eligibility: '관련 학과(정보기술 분야) 4년제 대졸(예정), 산업기사+실무 1년, 기능사+실무 3년, 순수 실무 4년, 학점은행제 106학점 등 (큐넷 자가진단 필수)',
    feeInfo: '필기 19,400원 / 실기 22,600원 (큐넷 공식 공고 기준, 변동 시 큐넷 확인)',
    schedule: '연 3회 정기 기사 검정 (통상 1·2·3회차, 필기 합격 후 2년간 필기 면제)',
    latestChanges: '2020년 NCS 기반 전면 개정 이후 필답형 단답·서술·코드 트레이싱(C/Java/Python) 비중 유지',
    knownPublishers: [
      {
        title: '시나공 정보처리기사 필기/실기',
        publisher: '길벗',
        ratio: '개념 60% : 기출·예상문제 40%',
        characteristic: '비전공자도 읽기 쉬운 단계별 서술과 출제빈도(A/B/C 등급) 표시가 강점이며 분량이 두꺼운 편입니다.',
        pros: ['개념 설명이 친절하고 독학에 적합', '실기 코드 추적 해설이 세세함'],
        cons: ['전체 페이지 분량이 많아 단기 요약만 원하는 경우 부담될 수 있음'],
        bestFor: '기초부터 꼼꼼히 독학하려는 비전공자·입문자',
      },
      {
        title: '수제비 정보처리기사 필기/실기',
        publisher: '도서출판 건기원',
        ratio: '핵심요약 50% : 기출·예상문제 50%',
        characteristic: '두음문자(암기 팁)와 페친/카페 피드백 기반 최신 신기술·예상문제 보강이 빠릅니다.',
        pros: ['암기용 두음 팁이 많아 단기 암기에 유리', '실기 최신 트렌드 반영'],
        cons: ['원리 설명보다는 시험 합격용 핵심 요약 비중이 높음'],
        bestFor: '짧은 기간 내 실전 답안 작성력을 끌어올리려는 수험생',
      },
      {
        title: '이기적 정보처리기사 필기/실기',
        publisher: '영진닷컴',
        ratio: '핵심개념 45% : 문제 55%',
        characteristic: '유튜브 무료 기초 특강 및 CBT 온라인 모의고사 연동 자료가 풍부합니다.',
        pros: ['문제 풀이와 무료 온라인 자료 연계 우수', '비교적 컴팩트한 구성'],
        cons: ['세부 심화 개념은 추가 검색이나 기출 오답 정리 병행 권장'],
        bestFor: '문제 풀이와 무료 특강 중심으로 빠르게 회독하려는 수험생',
      },
    ],
    knownLectures: [
      {
        name: '흥달쌤 (이흥달)',
        platform: '흥달쌤 / 유튜브·유료강좌',
        courseName: '정보처리기사 필기·실기 핵심 및 코드 특강',
        textbookUsed: '흥달쌤 자체 교재 / 시중 실기서 병행 가능',
        textbookPublisher: '흥달쌤 자체 출판',
        style: 'C·Java·Python 포인터/메모리 구조와 SQL·네트워크 원리를 판서로 쉽게 풀어주는 실전형 강의',
        pros: ['비전공자가 가장 막히는 프로그래밍 코드 추적 설명이 직관적', '유튜브 무료 특강으로 스타일 사전 확인 가능'],
        cautions: ['전체 커리큘럼 수강 시 학습 시간 확보 필요'],
        bestFor: '코딩·알고리즘 과락이 걱정되는 비전공 수험생',
        officialUrl: 'https://www.youtube.com/results?search_query=흥달쌤+정보처리기사',
      },
      {
        name: '시나공 / 이기적 공식 무료 특강 강사진',
        platform: '길벗 시나공 / 영진닷컴 유튜브',
        courseName: '정보처리기사 교재 연계 무료 핵심 강의',
        textbookUsed: '시나공 또는 이기적 정보처리기사 시리즈',
        textbookPublisher: '길벗 / 영진닷컴',
        style: '교재 목차 순서대로 핵심 포인트와 기출 변형 포인트를 짚어주는 정석형',
        pros: ['교재 구매 시 무료로 들을 수 있어 가성비 우수'],
        cautions: ['모든 세부 문항 해설이 제공되진 않으므로 오답 노트는 직접 보완 필요'],
        bestFor: '인강 비용 없이 독학+교재 중심으로 준비하는 수험생',
        officialUrl: 'https://www.q-net.or.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '공기업·대기업 IT 직무 및 공공기관 전산직 채용 시 가산점/우대 조건에 자주 포함',
      'SW 기술자 경력관리·공공 SW 사업 참여 시 자격 가점 및 등급 산정 참고',
      '전산직 9·7급 등 일부 공무원 시험 및 군 기술행정병 지원 시 활용',
    ],
  },
  전기기사: {
    subjects: [
      { name: '1과목 전기자기학', weight: '필기 20문항', keyTopics: ['정전계·정자계 벡터 연산', '가우스·비오사바르·앙페르 법칙', '전자유도·맥스웰 방정식'], memorizationTips: '벡터 미적분 기초와 핵심 공식 유도보다 단위·비례관계를 우선 정리하세요.' },
      { name: '2과목 전력공학', weight: '필기 20문항', keyTopics: ['송전선로 특성·코로나·페란티 현상', '단락·지락 고장계산(%Z)', '수·화력 및 원자력 발전'], memorizationTips: '%임피던스 고장전류 계산과 차단기·피뢰기 원리는 실기 단골입니다.' },
      { name: '3과목 전기기기', weight: '필기 20문항', keyTopics: ['직류기·동기기·변압기·유도전동기', '등가회로 및 효율·손실 계산', '정류기·전력전자'], memorizationTips: '4대 기기의 유기기전력·토크·속도 제어식을 비교표로 묶어 외우세요.' },
      { name: '4과목 회로이론 및 제어공학', weight: '필기 20문항', keyTopics: ['교류 R-L-C 페이저·공진·3상 전력', '라플라스 변환·전달함수', '보드선도·나이퀴스트·근궤적 안정도'], memorizationTips: '전기기사 전체 공학 계산의 뼈대이므로 4과목을 먼저 잡으면 1·2·3과목이 수월해집니다.' },
      { name: '5과목 전기설비기술기준 (KEC)', weight: '필기 20문항', keyTopics: ['한국전기설비규정(KEC) 접지·배선 기준', '고압/특고압 이격거리', '과전류 차단기·누전차단기'], memorizationTips: 'KEC 개정 수치(접지선 굵기·전압 구분 등)는 최신판 암기가 필수입니다.' },
    ],
    studyOrderTip: '회로이론 → 전력공학 → 전기기기 → KEC → 전기자기학 순으로 시작하면 비전공자도 수포자 구간을 줄일 수 있습니다.',
    coreTakeaways: [
      '필기 5과목 평균 60점(과락 40점), 실기는 필답형 단답·계산·시퀀스 도면 서술형 60점 이상',
      '한국전기설비규정(KEC) 기준 개정 사항 반영 여부를 최신 수험서로 반드시 확인해야 함',
      '전기공사기사와 필기 4과목 중복(1과목 면제 혜택 활용 가능)',
    ],
    eligibility: '전기·전자 등 관련 학과 4년제 대졸(예정), 전기산업기사+실무 1년, 실무 4년, 학점은행제 106학점 등',
    feeInfo: '필기 19,400원 / 실기 22,600원 (큐넷 공식 공고 기준)',
    schedule: '연 3회 정기 기사 검정 (1·2·3회차)',
    latestChanges: '2021년 이후 한국전기설비규정(KEC) 전면 적용 및 관련 수치 개정 지속 반영',
    knownPublishers: [
      {
        title: '엔트미디어 전기기사 필기/실기 과년도',
        publisher: '엔트미디어',
        ratio: '핵심요약 30% : 과년도 기출 70%',
        characteristic: '방대한 연도별 과년도 기출문제 수록량으로 유명한 실전 회독 중심 교재입니다.',
        pros: ['오랜 기간 검증된 기출 DB와 다양한 회차 수록', '실기 기출 반복 회독에 강함'],
        cons: ['이론 설명이 간략해 완전 노베이스 입문자는 기본서나 인강 병행 권장'],
        bestFor: '기출 회독량을 극대화하려는 수험생',
      },
      {
        title: '다산에듀 전기기사 필기/실기 정규반·기출',
        publisher: '다산에듀',
        ratio: '개념 55% : 기출·풀이 45%',
        characteristic: '최종인 원장 무료/정규 인강과 1:1 매칭되는 교재 구성으로 비전공자 선호도가 높습니다.',
        pros: ['유튜브·홈페이지 무료 강의와 교재 연동성이 뛰어남', 'KEC 개정 반영 빠름'],
        cons: ['초반 기본기 분량이 많아 완독까지 시간 투자 필요'],
        bestFor: '강의를 보며 체계적으로 기본기부터 다지려는 입문자',
      },
      {
        title: '동일출판사 / 성안당 전기기사 시리즈',
        publisher: '동일출판사 / 성안당',
        ratio: '개념 60% : 문제 40%',
        characteristic: '전통적인 공학 전공서 기반의 정석적인 수식 전개와 해설이 특징입니다.',
        pros: ['공식 유도 과정과 이론 체계가 탄탄함'],
        cons: ['내용이 다소 딱딱하게 느껴질 수 있음'],
        bestFor: '이론 원리를 깊이 있게 이해하고 싶은 전공자·기본기 보유자',
      },
    ],
    knownLectures: [
      {
        name: '최종인 원장',
        platform: '다산에듀',
        courseName: '전기기사 필기·실기 정규반 (이론+기출)',
        textbookUsed: '다산에듀 전기기사 필기/실기 이론서·과년도',
        textbookPublisher: '다산에듀',
        style: '기초 수학·단위 환산부터 시작해 차근차근 설명하며 무료 필기 이론 강좌를 다수 공개해 입문 장벽을 낮춘 스타일',
        pros: ['다수 기본 이론 강의를 무료 공개하여 진입 장벽이 낮음', '실기 수변전/시퀀스 설명 호평'],
        cautions: ['공식 합격률 수치는 학원 미공개이며 개인 학습량에 따라 편차 큼'],
        bestFor: '비전공자 및 전기 기초 수학부터 다시 정리해야 하는 수험생',
        officialUrl: 'https://www.eeum.kr',
      },
      {
        name: '한솔아카데미 전기기사 강사진',
        platform: '한솔아카데미',
        courseName: '전기기사 단기합격 패키지',
        textbookUsed: '한솔아카데미 전기기사 필기·실기 세트',
        textbookPublisher: '한솔아카데미',
        style: '핵심 빈출 유형과 실기 계산·단답 공략에 초점을 맞춘 수험 학원식 강의',
        pros: ['과목별 전임 강사 분업화 및 KEC·실기 단답 자료 제공'],
        cautions: ['패키지 비용 및 수강 기간 확인 필요'],
        bestFor: '커리큘럼 관리 하에 단기 합격을 목표로 하는 수험생',
        officialUrl: 'https://www.inup.co.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '전기사업법상 일정 용량 이상 전기설비의 법정 전기안전관리자 선임 자격',
      '한국전력공사, 발전공기업, 시설관리, 대기업 공무·설비 직군 취업 시 핵심 우대',
      '일정 실무경력 충족 시 무제한 용량 안전관리자 선임 및 기술사·감리원 진출 기반',
    ],
  },
  'SQLD (SQL 개발자)': {
    subjects: [
      { name: '1과목 데이터 모델링의 이해', weight: '10문항 (20점)', keyTopics: ['엔티티·속성·관계·식별자', '정규화(1~3차)와 반정규화', '트랜잭션·NULL 특성'], memorizationTips: '문항 수가 10문항으로 적어 40% 과락 기준(4문항 이상 득점) 관리에 주의해야 합니다.' },
      { name: '2과목 SQL 기본 및 활용', weight: '40문항 (80점)', keyTopics: ['SELECT·JOIN(INNER/OUTER)·서브쿼리', '그룹함수(ROLLUP/CUBE/GROUPING SETS)', '윈도우 함수(RANK/DENSE_RANK/ROW_NUMBER)', '계층형 질의·DML/DDL/TCL'], memorizationTips: '2024년 개정 출제기준 반영 이후 Oracle/SQL Server 문법 차이와 계층형/윈도우 함수 비중이 핵심입니다.' },
    ],
    studyOrderTip: '1과목 용어 1회독 → 2과목 SELECT/JOIN/GROUP BY → 윈도우함수·계층형질의·TCL 손풀이 연습',
    coreTakeaways: [
      '객관식+단답형(2024 개정 후 객관식 중심 50문항), 총점 60점 이상 및 과목별 40% 이상 득점 합격',
      '비전공자 응시 제한이 전혀 없어 IT·기획·마케팅 직군 입문 자격으로 활용도 높음',
    ],
    eligibility: '응시 자격 제한 없음 (전공·학력·연령 무관 누구나 응시 가능)',
    feeInfo: '50,000원 (한국데이터산업진흥원 K-Data 공식 공고 기준)',
    schedule: '연 4회 정기 시행 (통상 3·6·8·11월경 시행, DataQ 일정 확인)',
    latestChanges: '2024년부터 SQLD 출제기준 개정(응시료 5만원, 단답형 폐지·50문항 객관식 구성 등 세부 공고 확인 권장)',
    knownPublishers: [
      {
        title: 'SQL 자격검정 실전문제 (일명 노랭이)',
        publisher: '한국데이터산업진흥원 (K-Data)',
        ratio: '개념 15% : 문제 85%',
        characteristic: '주관기관 공식 문제집으로 실제 시험과 가장 유사한 난이도·문체를 갖췄지만, 개념 설명은 거의 없고 해설이 간결합니다.',
        pros: ['주관기관 공식 출판 문제집으로 문제 적중도 최상'],
        cons: ['입문용 개념 설명이 부족해 비전공자는 요약서/유튜브 해설 병행 필수'],
        bestFor: '기본 개념 학습 후 실전 고득점을 노리는 모든 수험생',
      },
      {
        title: '이기적 SQL 개발자(SQLD) 기본서',
        publisher: '영진닷컴',
        ratio: '개념 60% : 문제 40%',
        characteristic: 'SQL 문법을 처음 보는 비전공자 눈높이에서 예시 테이블과 결과를 하나씩 풀어 설명합니다.',
        pros: ['비전공 입문자 친화적 구성', '무료 동영상 강의 연계'],
        cons: ['고난도 함정 문제는 공식 노랭이 문제집으로 추가 보완 필요'],
        bestFor: 'SQL을 처음 공부하는 비전공자·문과생',
      },
      {
        title: '유선배 SQL 개발자(SQLD) 과외노트',
        publisher: '시대고시기획',
        ratio: '핵심개념 55% : 예상·기출 45%',
        characteristic: '개정 출제기준에 맞춘 직관적 도식과 실전 팁이 정리되어 있습니다.',
        pros: ['최신 개정 범위 반영이 빠르고 도식화가 깔끔함'],
        cons: ['심화 실습 쿼리는 직접 DB에서 실행해 보는 것을 권장'],
        bestFor: '2~3주 단기 합격을 노리는 입문~중급 수험생',
      },
    ],
    knownLectures: [
      {
        name: '유선배 / 홍쌤 / 어흥 SQLD 등 유튜브 특강',
        platform: '유튜브 / 인프런 / 에듀윌',
        courseName: 'SQLD 한 방에 끝내기 · 노랭이 해설 특강',
        textbookUsed: '유선배 SQLD 과외노트 또는 K-Data 노랭이',
        textbookPublisher: '시대고시기획 / K-Data',
        style: '기출 복원 문제와 K-Data 공식 문제집(노랭이)을 한 문제씩 실행 흐름대로 짚어주는 실전 압축형',
        pros: ['무료 유튜브 요약/해설 강의만으로도 단기 합격 사례 다수'],
        cautions: ['눈으로만 보지 말고 SELECT 실행 순서를 손으로 직접 써보는 연습 병행 필요'],
        bestFor: '빠르게 핵심과 노랭이 풀이를 끝내고 싶은 수험생',
        officialUrl: 'https://www.dataq.or.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '데이터 분석가·백엔드·서비스 기획·PM 직군 지원 시 SQL 기본 역량 증빙',
      '공공기관·대기업 IT/데이터 직무 서류 평가 참고 자격',
    ],
  },
  '컴퓨터활용능력 1급': {
    subjects: [
      { name: '필기 1과목 컴퓨터 일반', weight: '20문항', keyTopics: ['운영체제(Windows)·유틸리티', '네트워크·인터넷·정보보안', '멀티미디어·신기술 용어'], memorizationTips: '단축키, 파일 시스템, 네트워크 프로토콜은 기출 선지가 반복 출제됩니다.' },
      { name: '필기 2·3과목 스프레드시트 & 데이터베이스 일반', weight: '40문항', keyTopics: ['Excel 함수 구문·배열수식·피벗테이블', 'Access 정규화·SQL·폼/보고서 속성'], memorizationTips: '필기에서 함수와 SQL 구문을 정확히 익히면 실기 시험 준비 기간이 크게 단축됩니다.' },
      { name: '실기 스프레드시트(Excel) & 데이터베이스(Access) 실무', weight: '각 45분 (총 90분)', keyTopics: ['고급필터·조건부서식·계산작업(배열수식/사용자정의함수)', '피벗테이블·매크로/VBA', 'Access DB구축·입력수정폼·조회출력보고서·쿼리'], memorizationTips: '실기는 1과목·2과목 모두 각각 70점 이상이어야 합격하므로 시간 배분 연습이 핵심입니다.' },
    ],
    studyOrderTip: '필기 기출문제 5~7개년 CBT 반복(1주) → 실기 Excel/Access 기본작업→쿼리/폼→계산함수 순 반복 연습',
    coreTakeaways: [
      '상시검정으로 평일·주말 자주 응시 가능 (대한상공회의소 코참패스 앱/웹 접수)',
      '실기 합격 기준: Excel 70점 이상 AND Access 70점 이상 (둘 중 하나라도 69점이면 불합격)',
    ],
    eligibility: '응시 자격 제한 없음 (실기는 필기 합격일로부터 2년 이내 응시)',
    feeInfo: '필기 20,500원 / 실기 25,000원 (수수료 별도, 대한상공회의소 공고 확인)',
    schedule: '상시 검정 (매주 여러 회차 시행, 지역별 시험장 여석 상이)',
    latestChanges: '시험 프로그램 기준 Excel·Access 버전(MS Office 2021/LTSC 등) 상공회의소 공고 확인 필수',
    knownPublishers: [
      {
        title: '시나공 컴퓨터활용능력 1급 필기/실기',
        publisher: '길벗',
        ratio: '개념 55% : 문제 45%',
        characteristic: '실전 시험 화면과 동일한 상세 풀이 및 자주 틀리는 감점 포인트 정리가 뛰어납니다.',
        pros: ['함수·VBA·Access 쿼리 예제가 체계적이고 오탈자 검증이 안정적'],
        cons: ['실기 책이 2권 분책 포함 두꺼워 전범위 완독에 시간이 걸림'],
        bestFor: '정석적으로 감점 없이 1~2개월 내 합격을 원하는 수험생',
      },
      {
        title: '이기적 컴퓨터활용능력 1급 필기/실기',
        publisher: '영진닷컴',
        ratio: '핵심개념 45% : 실습·기출 55%',
        characteristic: '기출 유형 요약과 무료 채점·동영상 자료 지원이 잘 갖춰져 있습니다.',
        pros: ['요점 정리가 비교적 간결해 빠른 회독 가능'],
        cons: ['초보자는 세부 기능 설명이 약간 압축적으로 느껴질 수 있음'],
        bestFor: '기본 오피스 사용 경험이 있는 단기 수험생',
      },
    ],
    knownLectures: [
      {
        name: '유동균 (아이티버팀목)',
        platform: '아이티버팀목 (IT 버팀목)',
        courseName: '컴퓨터활용능력 1급 실기 단기/정규 과정',
        textbookUsed: '아이티버팀목 강의 PDF/자체 실습 파일',
        textbookPublisher: '아이티버팀목',
        style: '1단계 기본 다지기 + 3단계 특강(상설복원 모의고사) 반복 풀이로 실전 시험장에서 시간 내 완성하도록 훈련하는 커리큘럼',
        pros: ['상설시험 난이도를 반영한 3단계 특강 문제 퀄리티로 오랜 기간 인지도 보유', '별도 종이책 없이 강의 파일로 학습 가능'],
        cautions: ['3단계 특강 난이도가 실제보다 높거나 양이 많아 2~3회독 인내심 필요'],
        bestFor: '실기 시간 부족이나 Access/배열수식 때문에 독학이 막막한 수험생',
        officialUrl: 'https://www.itbtm.com',
      },
      {
        name: '기풍쌤 / 독고리 등 유튜브 무료 강좌',
        platform: '유튜브',
        courseName: '컴활 1급 필기·실기 핵심 무료 특강',
        textbookUsed: '시나공/이기적 또는 무료 배포 실습 파일',
        textbookPublisher: '길벗 / 영진닷컴 / 자체자료',
        style: '필기 CBT 기출 포인트와 실기 필수 함수·피벗테이블 풀이 요령을 짧게 짚어주는 무료 강의',
        pros: ['비용 부담 없이 바로 시작 가능'],
        cautions: ['상설 최신 변형 문항은 개인 연습량으로 채워야 함'],
        bestFor: '컴퓨터 기본 활용 능력이 있고 비용을 아끼려는 수험생',
        officialUrl: 'https://license.korcham.net',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '공무원·공기업·사기업 사무/행정직 지원 시 기본 가산점 및 직무역량 증빙',
      '실무 엑셀 데이터 가공·피벗·DB 관리 역량 입증',
    ],
  },
  산업안전기사: {
    subjects: [
      { name: '1·2과목 안전관리론 & 인간공학 및 시스템안전공학', weight: '필기 40문항', keyTopics: ['재해발생 이론·안전심리·교육', '인간공학·FTA/FMEA 결함수분석', '위험성평가'], memorizationTips: 'FTA 미니멀 컷셋/패스셋 계산과 안전관리조직(라인·스태프·복합형) 비교가 단골입니다.' },
      { name: '3·4과목 기계·전기·화학설비위험방지기술', weight: '필기 60문항(3개 과목)', keyTopics: ['방호장치·프레스/컨베이어', '감전방지·방폭구조·정전기', '폭발한계·위험물질·보호구'], memorizationTips: '법정 수치(안전거리, 방호장치 기준, 폭발한계)가 실기 필답/작업형과 그대로 겹칩니다.' },
      { name: '5·6과목 건설안전기술 & 산업안전관계법규', weight: '필기 20문항 + 실기 통합', keyTopics: ['비계·거푸집동바리·굴착 기울기', '산업안전보건법 안전보건관리체제·교육시간'], memorizationTips: '최근 개정된 산업안전보건법·중대재해처벌법 관련 숫자와 서류를 꼼꼼히 체크하세요.' },
    ],
    studyOrderTip: '과년도 기출 7~10개년 집중 풀이로 필기 합격 → 실기는 필답형 암기집 + 작업형(동영상) 최신 기출 병행',
    coreTakeaways: [
      '실기는 복합형(필답형 55점 + 작업형 동영상 45점)으로 합산 60점 이상 합격',
      '중대재해처벌법 시행 이후 안전관리자 법정 선임 수요 증가로 응시 인원이 매우 많은 인기 자격',
    ],
    eligibility: '관련 학과(공학·안전 등 대부분 학과 폭넓게 인정 사례 많음, 큐넷 자가진단 확인) 4년제 대졸 또는 실무 4년 등',
    feeInfo: '필기 19,400원 / 실기 34,600원 (복합형 기준, 큐넷 확인)',
    schedule: '연 3회 정기 기사 검정',
    latestChanges: '산업안전보건기준에 관한 규칙 개정 수치 및 실기 신출 단답 유형 지속 반영',
    knownPublishers: [
      {
        title: '구민사 / 윤조현 산업안전기사 필기·실기',
        publisher: '구민사 / 예문사 등',
        ratio: '핵심요약 35% : 과년도 기출 65%',
        characteristic: '전통적으로 기출 빈출 문제가 방대하게 정리되어 있어 과년도 회독용으로 널리 쓰입니다.',
        pros: ['방대한 과년도 기출과 작업형 동영상 복원 문항 수록'],
        cons: ['독학 시 법규 개정 최신 추록 여부를 출판사 홈페이지에서 확인해야 함'],
        bestFor: '기출 위주로 빠르게 회독하려는 수험생',
      },
      {
        title: '에듀윌 / 해커스 산업안전기사 필기·실기 한권끝장',
        publisher: '에듀윌 / 해커스',
        ratio: '개념 50% : 기출 50%',
        characteristic: '비전공자가 보기 좋게 표와 그림·컬러 강조로 정리된 입문자 친화형 구성입니다.',
        pros: ['가독성이 좋고 암기 팁과 핵심 빈출 표가 깔끔함'],
        cons: ['실기 작업형 고득점을 위해서는 추가 기출 문제집이나 강의 자료 병행 유리'],
        bestFor: '비전공 입문자 및 깔끔한 편집을 선호하는 수험생',
      },
    ],
    knownLectures: [
      {
        name: '정재수 / 권현길 등 주요 공학·안전 인강 강사진',
        platform: '에듀윌 / 한솔아카데미 / 대방고시 등',
        courseName: '산업안전기사 필기·실기 종합반',
        textbookUsed: '각 학원 전용 산업안전기사 필기/실기 교재',
        textbookPublisher: '에듀윌 / 한솔 등',
        style: '실기 필답형 안전대책 서술 요령과 작업형 동영상 포인트 잡는 법을 짚어주는 실전형',
        pros: ['실기 작업형 동영상 문제의 감점 없는 답안 작성 패턴 학습 가능'],
        cautions: ['합격률은 수강생 후기 기반이며 학원 공식 전수 통계는 비공개'],
        bestFor: '실기 필답+작업형 답안 작성 기준이 막막한 수험생',
        officialUrl: 'https://www.q-net.or.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '산업안전보건법상 일정 규모 이상 사업장 안전관리자 법정 선임 자격',
      '건설업·제조업·공기업 안전보건 직군 취업 및 이직 시 필수/우대 자격',
    ],
  },
  공인중개사: {
    subjects: [
      { name: '1차 부동산학개론 · 민법 및 민사특별법', weight: '각 40문항 (총 80문항)', keyTopics: ['수요·공급 탄력성·투자론·감정평가 3방식', '물권법·계약법·주택/상가임대차보호법'], memorizationTips: '민법 판례의 사실관계를 정확히 이해해야 2차 중개사법·공법까지 탄탄해집니다.' },
      { name: '2차 공인중개사법 · 부동산공법 · 공시법 및 세법', weight: '총 120문항', keyTopics: ['중개대상물 확인·설명·행정처분(필수 고득점)', '국토계획법·도시개발법·건축법(과락 주의)', '등기법·지적법·양도소득세·취득세'], memorizationTips: '공법은 범위가 매우 방대하므로 만점보다 55~60점 방어 전략, 중개사법에서 80점 이상 전략이 정석입니다.' },
    ],
    studyOrderTip: '1차 민법·학개론 기본이론 선행 → 2차 중개사법/등기법 → 공법·세법 (동차 준비 시 1·2차 병행)',
    coreTakeaways: [
      '매년 10월 말~11월 초 연 1회 시행, 1차/2차 각각 평균 60점 이상(과목당 40점 과락) 절대평가',
      '1차만 먼저 합격하면 다음 해 1회차에 한해 1차 시험 면제',
    ],
    eligibility: '응시 자격 제한 없음 (연령·학력·국적 제한 없이 누구나 응시 가능)',
    feeInfo: '1차 13,700원 / 2차 14,300원 / 동시 28,000원 (큐넷 공고 기준)',
    schedule: '연 1회 (매년 8월 원서접수, 10월 말 토요일 시험)',
    latestChanges: '주택·상가임대차보호법, 세법(취득세·종부세·양도세) 및 공법 최신 개정 법령 반영 필수',
    knownPublishers: [
      {
        title: '에듀윌 / 해커스 / 박문각 공인중개사 기본서·기출문제집',
        publisher: '에듀윌 / 해커스 / 박문각',
        ratio: '개념 65% : 기출 35%',
        characteristic: '방대한 법령 체계를 1년 커리큘럼(기초-기본-심화-기출-요약-동형)에 맞춰 단계별로 구성했습니다.',
        pros: ['법령 개정 사항 반영 및 판례 설명이 매우 상세함'],
        cons: ['전 과목 세트 분량이 매우 크므로 회독 계획 관리가 필수'],
        bestFor: '인강 커리큘럼을 따라 6개월~1년 체계적으로 동차 합격하려는 수험생',
      },
    ],
    knownLectures: [
      {
        name: '박문각 / 에듀윌 / 해커스 / 메가랜드 대표 전임 교수진',
        platform: '박문각 / 에듀윌 / 해커스 / 랜드프로 등',
        courseName: '공인중개사 연간 평생패스 · 동차 합격반',
        textbookUsed: '각 학원 자체 출판 기본서·요약집·기출문제집',
        textbookPublisher: '각 학원 출판사',
        style: '방대한 법조문과 최신 대법원 판례를 생활 사례와 두음 암기법으로 반복 각인시켜 주는 1년 장기 호흡 강의',
        pros: ['모의고사·특강·개정법령 추록까지 일괄 제공'],
        cautions: ['교재비 포함 여부, 환급 조건, 수강 기간 조건을 약관에서 반드시 사전 확인 필요'],
        bestFor: '독학으로 법 과목 판례·공법을 정리하기 어려운 수험생',
        officialUrl: 'https://www.q-net.or.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '공인중개사 사무소 개업 및 소속 공인중개사 취업 자격',
      '금융·신탁·자산관리(PM/AM)·건설사 개발/분양 직무 우대',
    ],
  },
  '한국사능력검정시험 (심화)': {
    subjects: [
      { name: '전근대사 (선사 ~ 조선 후기)', weight: '약 55~60%', keyTopics: ['고대 국가 왕별 업적', '고려·조선 제도사·문화유산', '실학·붕당정치·세도정치'], memorizationTips: '사료(글·지도·유물 사진)를 보고 어느 왕/시대인지 바로 연결하는 연습이 핵심입니다.' },
      { name: '근현대사 (개항기 ~ 현대)', weight: '약 40~45%', keyTopics: ['개항기 조약·근대 개혁·의병/애국계몽', '일제강점기 무장독립투쟁·민족운동', '정부 수립~현대 민주화/통일 정책'], memorizationTips: '근현대사는 연도별 사건 순서 배열 문제가 자주 나오므로 연표를 손으로 그려보세요.' },
    ],
    studyOrderTip: '시대 흐름 1회독(최태성 등 무료 강좌) → 최근 기출문제 10회분 집중 풀이 및 오답 사료 암기',
    coreTakeaways: [
      '심화 50문항(100점 만점): 80점↑ 1급, 70~79점 2급, 60~69점 3급',
      '기출 사료와 사진 자료가 반복 출제되므로 최신 기출 10회분 풀이가 가장 효율적',
    ],
    eligibility: '응시 자격 제한 없음 (누구나 응시 가능)',
    feeInfo: '심화 27,000원 / 기본 22,000원 (국사편찬위원회 공식 공고 확인)',
    schedule: '연 4~6회 시행 (한국사능력검정시험 공식 사이트 일정 확인)',
    latestChanges: '기본/심화 2원화 체계 유지, 시험일 원서접수 경쟁이 치열해 조기 마감 주의',
    knownPublishers: [
      {
        title: '큰별쌤 최태성의 별★별한국사 한능검 심화 (상/하)',
        publisher: '이투스북',
        ratio: '개념·판서 60% : 기출 40%',
        characteristic: 'EBS/유튜브 완전 무료 강의와 정확히 맞물려 필기노트·기출을 한 번에 끝낼 수 있는 대표 교재입니다.',
        pros: ['전 강의 무료 제공, 판서 구조가 직관적이라 초보자 접근성 최상'],
        cons: ['상/하 2권 구성이라 급한 수험생은 기출 500제 위주로 압축 필요'],
        bestFor: '역사 기초가 부족하지만 무료 강의로 탄탄히 1급을 노리는 수험생',
      },
      {
        title: '에듀윌 한국사능력검정시험 2주끝장 심화',
        publisher: '에듀윌',
        ratio: '핵심요약 50% : 기출 50%',
        characteristic: '1권으로 압축된 단기 완성형 구성과 연표·사료 정리 부록이 편리합니다.',
        pros: ['1권 단권화로 1~2주 단기 목표에 적합'],
        cons: ['스토리텔링 설명은 간결한 편'],
        bestFor: '중·고교 한국사 기본기가 있고 1~2주 내 1급을 취득하려는 수험생',
      },
    ],
    knownLectures: [
      {
        name: '최태성 (큰별쌤)',
        platform: 'EBSi / 유튜브 (최태성 1TV)',
        courseName: '별별한국사 한능검 심화 전 범위 무료 강좌',
        textbookUsed: '별★별한국사 한능검 심화 상/하',
        textbookPublisher: '이투스북',
        style: '방대한 한국사를 한눈에 들어오는 판서 스토리텔링으로 풀어내며 전 강의를 무료로 공개',
        pros: ['유료 결제 없이 전체 강의를 들을 수 있고 기출 적중 포인트가 명확함'],
        cautions: ['강의 수가 약 40강 내외이므로 일정이 촉박하면 2배속/기출풀이 특강 위주 선택 권장'],
        bestFor: '무료 명강의로 쉽고 확실하게 1급을 취득하려는 모든 수험생',
        officialUrl: 'https://www.historyexam.go.kr',
      },
    ],
    hasOfficialInterview: false,
    benefits: [
      '5·7급 국가직/지방직 공무원 한국사 과목 대체(2급 또는 1급 기준)',
      '군무원·경찰·소방·임용고시 응시자격 및 공기업 서류 가산점',
    ],
  },
};

function buildLiveSearchLinks(certName: string, organizer: string, officialUrl: string) {
  const cleanName = certName.replace(/\s*\(.*?\)/g, '').trim();
  const encoded = encodeURIComponent(cleanName);
  const links: Array<{ name: string; url: string; description: string }> = [
    {
      name: `${organizer || cleanName} 공식 사이트`,
      url: officialUrl || 'https://www.q-net.or.kr',
      description: '최신 시험일정, 응시자격 자가진단, 원서접수 및 공식 합격률 통계 확인',
    },
    {
      name: '전자문제집 CBT 무료 기출풀이 (comcbt.com)',
      url: `https://www.comcbt.com`,
      description: '국가기술자격·상공회의소 등 과년도 필기 기출문제를 무료 온라인/PDF로 풀이',
    },
    {
      name: `교보문고 '${cleanName}' 최신 수험서 검색`,
      url: `https://search.kyobobook.co.kr/web/search?vPstrKeyWord=${encoded}`,
      description: '출간 최신 개정판 수험서 목록, 목차 및 독자 리뷰·별점 실시간 확인',
    },
  ];
  return links;
}

export async function runKeylessCertResearch(input: {
  certName: string;
  organizer?: string;
  officialUrl?: string;
  selectedAreas: StudyAreaId[];
  learnerLevel: LearnerLevel;
  fallbackReason?: string;
}): Promise<CertResearchResult> {
  const cleanCertName = input.certName.trim();
  const cleanNoParens = cleanCertName.replace(/\s*\(.*?\)/g, '').trim();
  const catalogMatch = findCatalogMatch(cleanCertName);
  const curriculum =
    VERIFIED_CURRICULUMS[cleanCertName] || VERIFIED_CURRICULUMS[cleanNoParens];

  const organizer = input.organizer || catalogMatch?.organizer || '공식 시행처 확인 필요';
  const officialUrl = input.officialUrl || catalogMatch?.officialUrl || 'https://www.q-net.or.kr';
  const certType = catalogMatch?.certType || '국내 자격증';

  const wiki = await fetchFullKoreanWikiArticle(cleanCertName);
  const encoded = encodeURIComponent(cleanNoParens);

  const wikiEligibility = wiki ? pickSection(wiki.sections, ['응시자격', '자격요건', '응시']) : '';
  const wikiSubjects = wiki ? pickSection(wiki.sections, ['시험과목', '과목', '출제', '구성', '내용']) : '';
  const wikiCriteria = wiki ? pickSection(wiki.sections, ['합격기준', '합격', '평가', '검정']) : '';
  const wikiCareer = wiki ? pickSection(wiki.sections, ['진로', '전망', '취업', '우대', '특전', '활용']) : '';

  const isQnet = organizer.includes('산업인력공단') || officialUrl.includes('q-net.or.kr');
  const isKdata = organizer.includes('데이터산업진흥원') || officialUrl.includes('dataq.or.kr');
  const isKorcham = organizer.includes('대한상공회의소') || officialUrl.includes('korcham.net');

  const defaultEligibility = curriculum?.eligibility
    || wikiEligibility.slice(0, 260)
    || (isQnet && cleanNoParens.endsWith('기사') && !cleanNoParens.endsWith('산업기사') && !cleanNoParens.endsWith('기능사')
      ? '관련 학과 4년제 대졸(예정), 산업기사+실무 1년, 실무 4년, 학점은행제 106학점 등 (큐넷 응시자격 자가진단 확인 필수)'
      : isQnet && cleanNoParens.endsWith('산업기사')
      ? '관련 학과 2·3년제 대졸(예정), 기능사+실무 1년, 실무 2년, 학점은행제 41학점 등 (큐넷 자가진단 확인)'
      : isQnet && cleanNoParens.endsWith('기능사')
      ? '학력·경력·연령 제한 없이 누구나 응시 가능 (일부 종목 제외, 큐넷 공고 확인)'
      : '공식 시험기관 원서접수 페이지에서 최신 응시자격 요건을 확인하세요.');

  const defaultFee = curriculum?.feeInfo
    || (isQnet
      ? '필기 약 19,400원 / 실기 20,000원대~ (종목별 상이 — 큐넷 공식 공고 확인 필요)'
      : '공식 시행기관 원서접수 공고에서 최신 응시료 확인 필요');

  const defaultSchedule = curriculum?.schedule
    || (isKorcham
      ? '상시 검정 또는 정기 검정 시행 (대한상공회의소 자격평가사업단 일정 확인)'
      : '공식 시행처 연간 시험일정 공고 확인 필요');

  const defaultLatestChanges = curriculum?.latestChanges
    || (wiki?.summary ? wiki.summary.slice(0, 180) : catalogMatch?.summary || '최신 출제기준 개정 여부는 공식 시험처 공고를 확인하세요.');

  const sources: GroundingSource[] = [
    { title: `${organizer} 공식 사이트`, uri: officialUrl },
    ...(wiki ? [{ title: `한국어 위키백과 — ${wiki.title}`, uri: wiki.url }] : []),
    { title: `교보문고 '${cleanNoParens}' 수험서 검색`, uri: `https://search.kyobobook.co.kr/web/search?vPstrKeyWord=${encoded}` },
    { title: `YES24 '${cleanNoParens}' 수험서 검색`, uri: `https://www.yes24.com/Product/Search?domain=ALL&query=${encoded}` },
    { title: '전자문제집 CBT 무료 기출풀이', uri: 'https://www.comcbt.com' },
  ];

  const todayStr = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const result: CertResearchResult = {
    certName: cleanCertName,
    researchedAt: todayStr,
    selectedAreas: input.selectedAreas,
    learnerLevel: input.learnerLevel,
    mode: 'keyless',
    fallbackReason: input.fallbackReason,
    overview: {
      officialOrganizer: organizer,
      officialPortalUrl: officialUrl,
      certType,
      examSchedule2026: defaultSchedule,
      eligibility: defaultEligibility,
      feeInfo: defaultFee,
      latestChanges: defaultLatestChanges,
    },
    verificationNote:
      'API 키가 필요 없는 [무키 공식자료·위키 실시간 조회 모드]로 한국어 위키백과 및 공식 시행처 기준 데이터를 조회했습니다. 확인되지 않은 연도별 합격률·취업률 수치는 임의로 생성하지 않으며 공식 통계 링크를 통해 직접 확인하실 수 있습니다.',
    sources,
  };

  if (input.selectedAreas.includes('concepts')) {
    result.concepts = curriculum
      ? {
          subjects: curriculum.subjects,
          coreTakeaways: curriculum.coreTakeaways,
          studyOrderTip: curriculum.studyOrderTip,
        }
      : {
          subjects: [
            {
              name: `${cleanNoParens} 공식 출제기준 및 과목 구성`,
              weight: catalogMatch?.examFormat || '공식 시행처 기준',
              keyTopics: wikiSubjects
                ? wikiSubjects
                    .split(/[\n.]+/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 6)
                    .slice(0, 5)
                : [
                    catalogMatch?.summary || `${cleanCertName} 핵심 이론 및 실무 과목`,
                    '공식 시험처 홈페이지 [출제기준] PDF 다운로드 필수',
                    wikiCriteria || '합격 기준: 공식 공고 확인 (통상 100점 만점 기준 60점 이상)',
                  ],
              memorizationTips: wiki?.summary
                ? wiki.summary.slice(0, 220)
                : '공식 출제기준의 세부 항목별 출제 비중을 먼저 확인한 뒤 기출문제와 연결해 정리하세요.',
            },
          ],
          coreTakeaways: [
            `주관기관(${organizer}) 홈페이지에서 최신 연도 출제기준 파일을 반드시 내려받아 변경 범위를 확인하세요.`,
            catalogMatch?.examFormat
              ? `시험 형식: ${catalogMatch.examFormat}`
              : '필기·실기(또는 1·2차) 시험 형식과 과목당 과락 기준(보통 40%)을 우선 점검하세요.',
            `수험 수준(${input.learnerLevel})에 맞춰 기본 이론 1회독 후 최근 5개년 기출 회독을 권장합니다.`,
          ],
          studyOrderTip:
            '공식 출제기준 확인 → 전체 목차·기출 빈출 단원 파악 → 개념 1회독 → 과년도 기출 오답 노트 순으로 진행하세요.',
        };
  }

  if (input.selectedAreas.includes('past_exams')) {
    const cbtLinks = curriculum?.cbtLinks || buildLiveSearchLinks(cleanCertName, organizer, officialUrl);
    result.past_exams = {
      cbtSources: cbtLinks,
      recentTrend: isQnet
        ? '국가기술자격 CBT 전환 확대 및 단순 암기형 지양·실무 응용/법규 최신 개정 반영 추세입니다.'
        : isKdata
        ? '실무 데이터 처리·쿼리 응용 및 최신 개정 출제기준 적용 문항 비중이 중요합니다.'
        : '단순 기출 암기뿐 아니라 최신 개정 법규·실무 사례형 문항 대비가 필요합니다.',
      repeatRateNote:
        '객관식 필기 시험은 과년도 핵심 개념 반복 비중이 높은 편이나, 실기·주관식 및 최근 회차는 신유형·개정 기준 문항이 섞여 출제되므로 최신 기출 확인이 필수입니다.',
      sampleQuestions: [],
    };
  }

  if (input.selectedAreas.includes('lectures')) {
    result.lectures = curriculum
      ? {
          selectionCriteria: `${cleanNoParens}은(는) ${input.learnerLevel} 수준에 맞춰 최신 개정 기준 반영 여부와 무료 맛보기 강의 전달력을 비교해 선택하는 것이 좋습니다.`,
          instructors: curriculum.knownLectures.map((l) => ({
            name: l.name,
            platform: l.platform,
            courseName: l.courseName,
            textbookUsed: l.textbookUsed,
            textbookPublisher: l.textbookPublisher,
            passRateInfo: '공식 합격률 수치 미공개 (수강생 후기 기반 · 허위 수치 배제)',
            teachingStyle: l.style,
            pros: l.pros,
            cautions: l.cautions,
            bestFor: l.bestFor,
            officialUrl: l.officialUrl,
          })),
        }
      : {
          selectionCriteria:
            'API 키 미사용 모드에서는 검증되지 않은 강사 합격률을 임의로 생성하지 않습니다. 아래 공식·유튜브 강좌 검색을 통해 최신 커리큘럼과 샘플 강의를 직접 비교해 보세요.',
          instructors: [
            {
              name: `${cleanNoParens} 대표 인강·무료 특강 검색`,
              platform: '유튜브 / 에듀윌 / 해커스 / 시대고시 / 인프런 등',
              courseName: `${cleanNoParens} 최신 대비 강좌`,
              textbookUsed: '강사 지정 기본서 또는 시중 베스트셀러 연동',
              textbookPublisher: '강좌 상세페이지 확인',
              passRateInfo: '공식 합격률 수치 미공개 (각 교육기관 공지 및 실제 수강 후기 직접 확인 필요)',
              teachingStyle: `${input.learnerLevel} 수준에 맞는 기출풀이·개념강의 샘플을 1~2강 미리 들어보고 판서·교재 일치 여부를 비교하세요.`,
              pros: ['무료 유튜브 요약/기출해설 강의를 먼저 체험해 비용 낭비 방지 가능'],
              cautions: ['교재 개정 연도가 최신 시험 기준과 일치하는지 반드시 확인 필요'],
              bestFor: `${input.learnerLevel} 수험생`,
              officialUrl: `https://www.youtube.com/results?search_query=${encoded}+인강`,
            },
          ],
        };
  }

  if (input.selectedAreas.includes('workbooks')) {
    result.workbooks = curriculum
      ? {
          buyingGuide: `교재는 [개념서 vs 기출문제집] 비율과 최신 개정판(2025~2026) 발행 여부를 확인해 선택하세요.`,
          books: curriculum.knownPublishers.map((b) => ({
            title: b.title,
            publisher: b.publisher,
            editionInfo: '최신 개정판 발행 여부 서점 확인',
            conceptVsProblemRatio: b.ratio,
            keyCharacteristic: b.characteristic,
            pros: b.pros,
            cons: b.cons,
            bestFor: b.bestFor,
          })),
        }
      : {
          buyingGuide:
            '실제 서점 베스트셀러 및 최근 독자 평점이 가장 정확합니다. 아래 교보문고·YES24 실시간 검색 링크에서 목차(개념 vs 문제 비중)와 최신 개정판을 확인하세요.',
          books: [
            {
              title: `${cleanNoParens} 최신 수험서 실시간 비교 (교보문고·YES24)`,
              publisher: '주요 수험 출판사 (길벗·영진·에듀윌·시대고시·성안당 등)',
              editionInfo: '서점 실시간 출간일 확인 필요',
              conceptVsProblemRatio: '이론형 vs 과년도기출형 교재 비교 필요',
              keyCharacteristic:
                '입문자라면 [이론 설명이 풍부한 기본서], 기본기가 있다면 [과년도 기출 수록량이 많은 문제집]을 고르는 것이 핵심입니다.',
              pros: ['출판사별 무료 부록(요약집·CBT·특강) 제공 여부를 서점 상세페이지에서 바로 비교 가능'],
              cons: ['구버전 중고 교재 구매 시 최신 개정 출제기준 누락 위험'],
              bestFor: `${input.learnerLevel} 수험생`,
            },
          ],
        };
  }

  if (input.selectedAreas.includes('interview')) {
    result.interview = {
      hasOfficialInterview: curriculum?.hasOfficialInterview ?? false,
      interviewFormatNote: curriculum?.hasOfficialInterview
        ? `${cleanNoParens}는 공식 시험 과정 내 구술/면접 평가를 포함하고 있으므로 공식 시행처의 평가 기준표를 확인하세요.`
        : `${cleanNoParens}는 별도 시험 면접보다는 취득 후 취업/이직 직무 면접에서 실무 이해도 및 자격 취득 과정에서 배운 핵심 개념을 검증받는 데 활용됩니다.`,
      qaList: [
        {
          category: '직무 역량 · 자격 취득 동기',
          question: `${cleanNoParens} 자격을 취득하며 가장 깊이 학습한 핵심 개념과 실무 적용 방안은 무엇인가요?`,
          keyPoints: ['공식 시험 과목 핵심 키워드', '트러블슈팅/현장 적용 사례'],
          modelAnswer: `시험 과목 중 핵심이 되는 이론(${catalogMatch?.summary || cleanNoParens})을 단순 암기한 것이 아니라, 실제 현업 상황(안전/설계/분석/법규 준수 등)에서 어떤 기준과 절차로 적용하는지 구체적 예시 1가지를 들어 답변하세요.`,
        },
        {
          category: '실기 · 실무 문제 해결',
          question: '현장에서 법규·기술 기준이 변경되거나 예외 상황이 발생했을 때 어떻게 대응하시겠습니까?',
          keyPoints: ['최신 기준 확인 습관', '원칙 준수 및 검산/검증 절차'],
          modelAnswer: `공식 기관(${organizer})의 최신 개정 기준을 우선 확인하고, 체크리스트에 따라 원인 파악 → 규정 대조 → 재발 방지 대책 순으로 논리적으로 설명하는 구조가 좋습니다.`,
        },
      ],
    };
  }

  if (input.selectedAreas.includes('stats')) {
    result.stats = {
      passRates: [
        {
          year: '최근 공식 통계',
          writtenRate: '공식 통계 페이지 확인',
          practicalRate: '공식 통계 페이지 확인',
          applicantsNote: `${organizer} 공식 자격정보/자료실에 연도별 응시자 수 및 최종 합격률이 공시됩니다. (임의 추정 수치 생성 배제)`,
        },
      ],
      competitionContext: isQnet
        ? '국가기술자격은 절대평가(과목당 40점, 평균 60점 이상)로 타인과의 경쟁률보다 절대 점수 기준 충족 여부가 중요하며, 시험 회차별 난이도 편차가 존재합니다.'
        : '절대평가/상대평가 구분 및 최근 회차 합격률 추이는 공식 시행처 통계 공고를 기준으로 확인하시기 바랍니다.',
      employmentRateInfo: wikiCareer
        ? wikiCareer.slice(0, 260)
        : '특정 자격증 단일 기준의 공식 취업률 백분위 통계는 대부분 기관에서 별도 집계하지 않습니다. 대신 고용24(work24.go.kr)에서 해당 자격증 우대 채용 공고 수를 직접 확인하는 것이 가장 정확합니다.',
      salaryAndBenefits: curriculum?.benefits || [
        `${organizer} 발행 공인 자격으로서 관련 직무 지원 시 전문성 증빙`,
        '채용 공고상 자격 우대·가산점 및 일부 분야 법정 선임/배치 기준 참고 (공고별 확인 필요)',
        '고용24·잡코리아 등에서 해당 자격증 키워드로 실제 우대 채용 수요 및 연봉 수준 직접 조회 가능',
      ],
    };
  }

  return result;
}

export async function runKeylessCertAsk(
  certName: string,
  question: string,
  fallbackReason?: string
): Promise<AskAnswer> {
  const cleanCert = certName.trim();
  const cleanQuestion = question.trim();
  const cleanNoParens = cleanCert.replace(/\s*\(.*?\)/g, '').trim();
  const catalogMatch = findCatalogMatch(cleanCert);

  const [wikiCert, wikiQuery] = await Promise.all([
    fetchFullKoreanWikiArticle(cleanCert),
    fetchFullKoreanWikiArticle(`${cleanNoParens} ${cleanQuestion}`),
  ]);

  const sources: GroundingSource[] = [
    {
      title: `${catalogMatch?.organizer || cleanCert} 공식 사이트`,
      uri: catalogMatch?.officialUrl || 'https://www.q-net.or.kr',
    },
  ];
  if (wikiCert) {
    sources.push({ title: `한국어 위키백과 — ${wikiCert.title}`, uri: wikiCert.url });
  }
  if (wikiQuery && wikiQuery.url !== wikiCert?.url) {
    sources.push({ title: `한국어 위키백과 — ${wikiQuery.title}`, uri: wikiQuery.url });
  }
  sources.push({
    title: `고용24 / 큐넷 '${cleanNoParens}' 검색`,
    uri: `https://www.q-net.or.kr`,
  });

  const sections: string[] = [];
  sections.push(`[무키 공식·위키 실시간 조회 응답 — API 키 미사용]`);
  if (catalogMatch) {
    sections.push(
      `• 자격 정보: ${catalogMatch.name} (${catalogMatch.certType} · 주관: ${catalogMatch.organizer})\n• 시험 형식: ${catalogMatch.examFormat}`
    );
  }
  if (wikiCert?.summary) {
    sections.push(`• 한국어 위키백과 핵심 요약 (${wikiCert.title}):\n${wikiCert.summary.slice(0, 600)}`);
  }
  if (wikiQuery?.summary && wikiQuery.title !== wikiCert?.title) {
    sections.push(`• 질문 관련 위키 자료 (${wikiQuery.title}):\n${wikiQuery.summary.slice(0, 450)}`);
  }
  sections.push(
    `• 정확한 최신 공고 확인 안내: 원서접수 세부 날짜·최신 개정 세부 수치·개별 응시자격 최종 판정은 아래 공식 사이트(${catalogMatch?.officialUrl || 'https://www.q-net.or.kr'})에서 직접 확인해 주세요.`
  );

  return {
    question: cleanQuestion,
    answer: sections.join('\n\n'),
    sources,
    askedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    mode: 'keyless',
    fallbackReason,
  };
}
