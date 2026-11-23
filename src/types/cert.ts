export type StudyAreaId =
  | 'concepts'
  | 'past_exams'
  | 'lectures'
  | 'workbooks'
  | 'interview'
  | 'stats';

export type LearnerLevel = '비전공자·입문' | '전공자·기본기 보유' | '단기합격·실전집중';

export type CertCategory =
  | '전체'
  | 'IT · 데이터 · 클라우드'
  | '전기 · 전자 · 에너지'
  | '안전 · 위험물 · 기계'
  | '건축 · 토목 · 환경'
  | '경영 · 회계 · 세무 · 물류'
  | '금융 · 투자 · 부동산'
  | '법률 · 행정 · 전문자격'
  | '어학 · 한국사 · 사무'
  | '디자인 · 드론 · 모빌리티'
  | '보건 · 복지 · 조리 · 기능';

export interface CertCatalogItem {
  id: string;
  name: string;
  aliases: string[];
  category: Exclude<CertCategory, '전체'>;
  certType: string;
  organizer: string;
  examFormat: string;
  officialUrl: string;
  summary: string;
  isPopular?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ConceptSubject {
  name: string;
  weight: string;
  keyTopics: string[];
  memorizationTips: string;
}

export interface PastExamSource {
  name: string;
  url: string;
  description: string;
}

export interface SampleQuestion {
  yearRound: string;
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
}

export interface InstructorAnalysis {
  name: string;
  platform: string;
  courseName: string;
  textbookUsed: string;
  textbookPublisher: string;
  passRateInfo: string;
  teachingStyle: string;
  pros: string[];
  cautions: string[];
  bestFor: string;
  officialUrl: string;
}

export interface WorkbookAnalysis {
  title: string;
  publisher: string;
  editionInfo: string;
  conceptVsProblemRatio: string;
  keyCharacteristic: string;
  pros: string[];
  cons: string[];
  bestFor: string;
}

export interface InterviewQA {
  category: string;
  question: string;
  keyPoints: string[];
  modelAnswer: string;
}

export interface YearlyPassRate {
  year: string;
  writtenRate: string;
  practicalRate: string;
  applicantsNote: string;
}

export interface CertResearchResult {
  certName: string;
  researchedAt: string;
  selectedAreas: StudyAreaId[];
  learnerLevel: LearnerLevel;
  overview: {
    officialOrganizer: string;
    officialPortalUrl: string;
    certType: string;
    examSchedule2026: string;
    eligibility: string;
    feeInfo: string;
    latestChanges: string;
  };
  concepts?: {
    subjects: ConceptSubject[];
    coreTakeaways: string[];
    studyOrderTip: string;
  };
  past_exams?: {
    cbtSources: PastExamSource[];
    recentTrend: string;
    repeatRateNote: string;
    sampleQuestions: SampleQuestion[];
  };
  lectures?: {
    selectionCriteria: string;
    instructors: InstructorAnalysis[];
  };
  workbooks?: {
    buyingGuide: string;
    books: WorkbookAnalysis[];
  };
  interview?: {
    hasOfficialInterview: boolean;
    interviewFormatNote: string;
    qaList: InterviewQA[];
  };
  stats?: {
    passRates: YearlyPassRate[];
    competitionContext: string;
    employmentRateInfo: string;
    salaryAndBenefits: string[];
  };
  verificationNote: string;
  sources: GroundingSource[];
  mode?: 'gemini' | 'keyless';
  fallbackReason?: string;
}

export interface SavedCertReport {
  id: string;
  certName: string;
  category: string;
  savedAt: string;
  result: CertResearchResult;
}

export interface AskAnswer {
  question: string;
  answer: string;
  sources: GroundingSource[];
  askedAt: string;
  mode?: 'gemini' | 'keyless';
  fallbackReason?: string;
}

