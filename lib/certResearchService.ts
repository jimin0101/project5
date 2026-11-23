import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { GroundingSource, LearnerLevel, StudyAreaId } from '../src/types/cert.js';
import { runKeylessCertAsk, runKeylessCertResearch } from './keylessCertResearch.js';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error(
        'GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 또는 Vercel Environment Variables에서 API 키를 확인해 주세요.'
      ),
      { status: 500 }
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// In-memory cache (30 minutes TTL) & search grounding 429 cooldown (5 minutes)
const researchCache = new Map<string, { timestamp: number; data: unknown }>();
const inFlightResearch = new Map<string, Promise<unknown>>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_RESEARCH_CACHE_SIZE = 120;

const wikiCache = new Map<
  string,
  { timestamp: number; value: { summaryText: string; sources: GroundingSource[] } }
>();
const wikiInFlight = new Map<
  string,
  Promise<{ summaryText: string; sources: GroundingSource[] }>
>();
const WIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let searchGroundingCooldownUntil = 0;

function extractGroundingSources(response: unknown): GroundingSource[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri?.trim();
    const title = chunk?.web?.title?.trim() || uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title: title || uri, uri });
    }
  }
  return sources;
}

function parseJsonFromModelText(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('JSON_PARSE_ERROR: 모델 응답에서 JSON 구조를 찾지 못했습니다.');
  }

  const jsonSlice = withoutFences
    .slice(firstBrace, lastBrace + 1)
    // Remove trailing commas before closing brackets/braces if any
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(jsonSlice) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`JSON_PARSE_ERROR: ${(e as Error).message}`);
  }
}

export function isQuotaOrRateError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e?.status === 429) return true;
  const msg = String(e?.message || '');
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
}

export function isTransientOrQuotaError(err: unknown): boolean {
  if (isQuotaOrRateError(err)) return true;
  const e = err as { status?: number; message?: string };
  const msg = String(e?.message || '');
  // Auth/key errors should fail fast with clear guidance
  if (e?.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return false;
  }
  if (
    e?.status === 503 ||
    e?.status === 502 ||
    e?.status === 500 ||
    e?.status === 504 ||
    e?.status === 404
  ) {
    return true;
  }
  return (
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('JSON_PARSE_ERROR') ||
    msg.includes('TIMEOUT') ||
    msg.includes('fetch failed')
  );
}

export function formatFriendlyError(err: unknown): { status: number; message: string } {
  const e = err as { status?: number; message?: string };
  const rawMsg = String(e?.message || '');

  if (isQuotaOrRateError(err)) {
    return {
      status: 429,
      message:
        '현재 Gemini API 무료 사용량(분당/일일 할당량)이 일시 초과되었습니다. 10~20초 후 다시 조회하시거나, AI Studio [Settings > Secrets] 또는 Vercel 환경 변수에 결제(Billing)가 연결된 API 키를 등록해 주세요.',
    };
  }
  if (
    e?.status === 503 ||
    rawMsg.includes('503') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('overloaded')
  ) {
    return {
      status: 503,
      message:
        '현재 AI 모델 서버 접속량이 일시적으로 많습니다(503). 잠시 후 다시 조회 버튼을 눌러 주세요.',
    };
  }
  if (e?.status === 403 || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Gemini API 키 권한 또는 유효성을 확인할 수 없습니다. 환경 변수(GEMINI_API_KEY) 설정을 확인해 주세요.',
    };
  }

  const status = typeof e?.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500;
  return {
    status,
    message:
      rawMsg && !rawMsg.startsWith('{') && !rawMsg.startsWith('JSON_PARSE_ERROR')
        ? rawMsg
        : '자격증 자료를 조회하는 중 일시적인 오류가 발생했습니다. 다시 조회 버튼을 눌러 주세요.',
  };
}

async function fetchKoreanWikiContext(certName: string): Promise<{
  summaryText: string;
  sources: GroundingSource[];
}> {
  const cleanTitle = certName.replace(/\s*\(.*?\)/g, '').trim();
  if (!cleanTitle) return { summaryText: '', sources: [] };

  const cached = wikiCache.get(cleanTitle);
  if (cached && Date.now() - cached.timestamp < WIKI_CACHE_TTL_MS) {
    return cached.value;
  }

  const existingFlight = wikiInFlight.get(cleanTitle);
  if (existingFlight) {
    return existingFlight;
  }

  const task = (async () => {
    const sources: GroundingSource[] = [];
    let summaryText = '';

    try {
      const restUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        cleanTitle
      )}`;
      const resp = await fetch(restUrl, {
        headers: {
          'User-Agent': 'JagyeokBaekseo/1.0 (https://vercel.app; study-guide)',
        },
        signal: AbortSignal.timeout(450),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          title?: string;
          extract?: string;
          content_urls?: { desktop?: { page?: string } };
        };
        if (data?.extract) {
          summaryText = data.extract.slice(0, 800);
          sources.push({
            title: `한국어 위키백과 — ${data.title || cleanTitle}`,
            uri:
              data.content_urls?.desktop?.page ||
              `https://ko.wikipedia.org/wiki/${encodeURIComponent(data.title || cleanTitle)}`,
          });
        }
      }
    } catch {
      // Non-blocking supplementary context
    }

    const value = { summaryText, sources };
    if (wikiCache.size >= 200) {
      const oldestKey = wikiCache.keys().next().value;
      if (oldestKey) wikiCache.delete(oldestKey);
    }
    wikiCache.set(cleanTitle, { timestamp: Date.now(), value });
    return value;
  })().finally(() => {
    wikiInFlight.delete(cleanTitle);
  });

  wikiInFlight.set(cleanTitle, task);
  return task;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const AREA_INSTRUCTIONS: Record<StudyAreaId, string> = {
  concepts: `"concepts": {
    "subjects": [
      {
        "name": "과목명",
        "weight": "문항 수/배점 비중",
        "keyTopics": ["빈출 핵심 개념/공식 3~4개"],
        "memorizationTips": "헷갈리기 쉬운 함정 및 암기 포인트"
      }
    ],
    "coreTakeaways": ["최빈출 핵심 포인트 3~4개"],
    "studyOrderTip": "추천 학습 순서"
  }`,
  past_exams: `"past_exams": {
    "cbtSources": [
      {
        "name": "공식 기출/무료 CBT 사이트명",
        "url": "확인된 실제 URL",
        "description": "제공 범위 및 활용 팁"
      }
    ],
    "recentTrend": "최신 출제경향 및 난이도 변화 요약",
    "repeatRateNote": "과년도 기출 반복 비중 분석",
    "sampleQuestions": [
      {
        "yearRound": "대표 출제유형",
        "question": "실제 유형 기반 문제 지문 (2문항)",
        "choices": ["① 보기1", "② 보기2", "③ 보기3", "④ 보기4"],
        "answer": "정답",
        "explanation": "오답 소거 포함 핵심 해설"
      }
    ]
  }`,
  lectures: `"lectures": {
    "selectionCriteria": "인강 선택 핵심 기준",
    "instructors": [
      {
        "name": "실존 유명 한국 강사명 (3명)",
        "platform": "학원/플랫폼명",
        "courseName": "대표 강좌명",
        "textbookUsed": "실제 사용 교재명",
        "textbookPublisher": "교재 출판사",
        "passRateInfo": "공식 공개 합격률 확인 시 수치 기재, 미공개 시 반드시 '공식 합격률 수치 미공개 (수강생 후기 기반)' 표기",
        "teachingStyle": "강의 진행 스타일 및 특징",
        "pros": ["장점 2개"],
        "cautions": ["주의점 1~2개"],
        "bestFor": "추천 수험생 유형",
        "officialUrl": "공식 학원/강좌 URL"
      }
    ]
  }`,
  workbooks: `"workbooks": {
    "buyingGuide": "교재 선택 기준",
    "books": [
      {
        "title": "실존 한국 대표 수험서 정식명 (3권)",
        "publisher": "출판사명",
        "editionInfo": "최신 개정판 정보",
        "conceptVsProblemRatio": "개념 vs 문제 비중 (예: 개념 65% : 문제 35%)",
        "keyCharacteristic": "이 책의 결정적 특징 한 줄 요약 (예: 개념 설명은 방대하나 수록 문제가 적음)",
        "pros": ["구체적 장점 2개"],
        "cons": ["솔직한 단점/보완점 2개"],
        "bestFor": "추천 수험생"
      }
    ]
  }`,
  interview: `"interview": {
    "hasOfficialInterview": true 또는 false,
    "interviewFormatNote": "공식 면접 전형 유무 및 직무 면접 활용 가이드",
    "qaList": [
      {
        "category": "질문 영역",
        "question": "핵심 면접/구술 질문 (3개)",
        "keyPoints": ["핵심 키워드 2~3개"],
        "modelAnswer": "구체적 모범 답변 구조"
      }
    ]
  }`,
  stats: `"stats": {
    "passRates": [
      {
        "year": "연도 (최근 3개년)",
        "writtenRate": "필기 합격률 (미확인 시 '자료 미공개')",
        "practicalRate": "실기 합격률 (단일시험이면 '해당없음')",
        "applicantsNote": "응시 규모·난이도 특이사항"
      }
    ],
    "competitionContext": "응시 규모, 절대/상대평가 구분 및 체감 난이도",
    "employmentRateInfo": "공식 취업률 통계 유무 및 채용 수요·우대 현황 (허위 수치 금지)",
    "salaryAndBenefits": ["법정 선임·가산점·취업 우대 혜택 3개"]
  }`,
};

export interface CertResearchInput {
  certName?: string;
  organizer?: string;
  officialUrl?: string;
  selectedAreas?: StudyAreaId[];
  learnerLevel?: LearnerLevel;
  forceRefresh?: boolean;
  includeOverview?: boolean;
  useKeyless?: boolean;
}

export async function runCertResearch(input: CertResearchInput) {
  const cleanCertName = (input.certName ?? '').trim();
  if (!cleanCertName) {
    throw Object.assign(new Error('자격증 이름을 입력하거나 선택해 주세요.'), { status: 400 });
  }

  const validAreas: StudyAreaId[] = (input.selectedAreas ?? []).filter((a): a is StudyAreaId =>
    ['concepts', 'past_exams', 'lectures', 'workbooks', 'interview', 'stats'].includes(a)
  );
  if (validAreas.length === 0) {
    throw Object.assign(new Error('조회할 학습 영역을 1개 이상 선택해 주세요.'), { status: 400 });
  }

  const includeOverview = input.includeOverview !== false;
  const learnerLevel: LearnerLevel = input.learnerLevel || '비전공자·입문';
  const sortedAreas = [...validAreas].sort();

  // Keyless mode: works with 0 API keys using Korean Wikipedia + official catalog/rules
  if (input.useKeyless || !process.env.GEMINI_API_KEY) {
    return runKeylessCertResearch({
      certName: cleanCertName,
      organizer: input.organizer,
      officialUrl: input.officialUrl,
      selectedAreas: sortedAreas,
      learnerLevel,
    });
  }

  const cacheKey = `${cleanCertName}::${sortedAreas.join(',')}::${learnerLevel}::${includeOverview ? 'ov' : 'noov'}`;

  const cached = researchCache.get(cacheKey);
  if (!input.forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (!input.forceRefresh) {
    const existingFlight = inFlightResearch.get(cacheKey);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const executionPromise = (async () => {
    try {
      const ai = getAiClient();
      const todayLabel = new Date().toISOString().slice(0, 10);
      const requestedJsonFields = sortedAreas
        .map((area) => AREA_INSTRUCTIONS[area])
        .join(',\n  ');

    // Fetch cached/deduplicated Korean Wikipedia context
    const wiki = await fetchKoreanWikiContext(cleanCertName);

    const overviewBlock = includeOverview
      ? `"overview": {
    "officialOrganizer": "정식 시행/주관기관명",
    "officialPortalUrl": "원서접수 공식 웹사이트 URL",
    "certType": "자격 구분",
    "examSchedule2026": "연간 시행 횟수 및 시험 시기 요약",
    "eligibility": "응시자격 요건 요약",
    "feeInfo": "검정료/응시료 정보",
    "latestChanges": "최근 출제기준 개정·CBT 전환 등 주요 변동사항"
  },
  `
      : '';

    const verificationBlock = includeOverview
      ? `,
  "verificationNote": "확인된 출처 기준 및 원서접수 전 공식 사이트 재확인 사항 요약"`
      : '';

    const buildPrompt = (extraContext = '') => `당신은 대한민국 국가자격·전문자격·어학·민간자격 수험 정보 검증 리서처입니다.
오늘 날짜는 ${todayLabel} (2026년 기준)입니다.
반드시 **가장 정확한 한국 공식 자료(큐넷 Q-Net, 대한상공회의소, K-Data, 국시원, 금융투자협회, 한국세무사회, 각 인강 공식 사이트, 교보문고/예스24, 고용24 등)**를 기준으로 간결하고 핵심 밀도 높게 답변하세요.

[절대 원칙 — 거짓 정보 금지]
1. 확실히 검증되지 않은 수치(특정 회차 세부 날짜, 미공개 합격률, 취업률, 강사별 합격률)는 절대 임의로 지어내지 마세요.
2. 확인되지 않은 수치는 반드시 "공식 미공개" 또는 "공식 사이트 일정 확인 필요"로 표기하고 확인된 사실만 적으세요.
3. 인강 강사의 합격률은 학원이 공식 공개한 수치만 적고, 미공개 시 반드시 "공식 합격률 수치 미공개 (수강생 후기 기반)"로 적으세요.
4. 문제집 분석 시 반드시 책의 구조적 특징(예: "개념 설명은 방대하나 수록 문제가 적음")과 장단점을 솔직히 구분하세요.
5. 모든 내용은 반드시 한국어로 작성하세요.
${extraContext ? `\n[참고 한국 위키 문맥]\n${extraContext}\n` : ''}
[조회 대상 자격증]
- 자격증명: ${cleanCertName}
${input.organizer ? `- 주관기관: ${input.organizer}` : ''}
${input.officialUrl ? `- 공식 사이트: ${input.officialUrl}` : ''}
- 수험생 수준: ${learnerLevel}
- 요청 영역: ${sortedAreas.join(', ')}

아래 스키마와 일치하는 **유효한 순수 JSON 객체만** 출력하세요.

{
  "certName": "${cleanCertName}",
  "researchedAt": "${todayLabel}",
  "selectedAreas": ${JSON.stringify(sortedAreas)},
  "learnerLevel": "${learnerLevel}",
  ${overviewBlock}${requestedJsonFields}${verificationBlock}
}`;

    const sources: GroundingSource[] = [];
    if (input.officialUrl) {
      sources.push({
        title: `${input.organizer || cleanCertName} 공식 사이트`,
        uri: input.officialUrl,
      });
    }
    sources.push(...wiki.sources);

    let parsed: Record<string, unknown> | null = null;
    let usedSearchGrounding = false;
    let lastErr: unknown;

    if (input.forceRefresh && Date.now() > searchGroundingCooldownUntil) {
      try {
        const resSearch = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: buildPrompt(wiki.summaryText),
            config: {
              tools: [{ googleSearch: {} }],
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }),
          6500,
          'googleSearch'
        );
        if (resSearch.text) {
          parsed = parseJsonFromModelText(resSearch.text);
          const searchSources = extractGroundingSources(resSearch);
          if (searchSources.length > 0) {
            sources.unshift(...searchSources);
          }
          usedSearchGrounding = true;
        }
      } catch (err) {
        lastErr = err;
        if (!isTransientOrQuotaError(err)) {
          throw err;
        }
        if (isQuotaOrRateError(err)) {
          searchGroundingCooldownUntil = Date.now() + 5 * 60 * 1000;
        }
      }
    }

    const fastAttempts: Array<{ model: string; useLowThinking?: boolean; delayMs?: number }> = [
      { model: 'gemini-3.1-flash-lite' },
      { model: 'gemini-4-hydrogen', useLowThinking: true },
      { model: 'gemini-2.5-flash' },
    ];

    for (const attempt of fastAttempts) {
      if (parsed) break;
      if (attempt.delayMs) {
        await new Promise((r) => setTimeout(r, attempt.delayMs));
      }
      try {
        const res = await withTimeout(
          ai.models.generateContent({
            model: attempt.model,
            contents: buildPrompt(wiki.summaryText),
            config: {
              responseMimeType: 'application/json',
              ...(attempt.useLowThinking
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          }),
          7500,
          attempt.model
        );
        if (!res.text) {
          throw new Error('JSON_PARSE_ERROR: 모델 응답이 비어 있습니다.');
        }
        parsed = parseJsonFromModelText(res.text);
      } catch (err) {
        lastErr = err;
        if (!isTransientOrQuotaError(err)) {
          throw err;
        }
      }
    }

    if (!parsed) {
      throw lastErr || new Error('자격증 자료를 조회하지 못했습니다.');
    }

    const baseNote = typeof parsed.verificationNote === 'string' ? parsed.verificationNote : '';
    const verificationNote = includeOverview
      ? usedSearchGrounding
        ? baseNote
        : `${baseNote ? baseNote + ' ' : ''}(안내: 빠른 응답 모드로 공식 기관·한국어 위키 검증 문맥을 기준으로 정리되었으며, 최신 세부 시험일정과 응시료는 아래 공식 시험처에서 최종 확인하세요.)`
      : '';

    const dedupedSources: GroundingSource[] = [];
    const seenUri = new Set<string>();
    for (const s of sources) {
      if (s.uri && !seenUri.has(s.uri)) {
        seenUri.add(s.uri);
        dedupedSources.push(s);
      }
    }

    const finalPayload = {
      ...parsed,
      certName: cleanCertName,
      selectedAreas: sortedAreas,
      learnerLevel,
      mode: 'gemini' as const,
      researchedAt: new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
      ...(includeOverview ? { verificationNote } : {}),
      sources: dedupedSources,
    };

    if (researchCache.size >= MAX_RESEARCH_CACHE_SIZE) {
      const oldestKey = researchCache.keys().next().value;
      if (oldestKey) researchCache.delete(oldestKey);
    }
    researchCache.set(cacheKey, { timestamp: Date.now(), data: finalPayload });
    return finalPayload;
    } catch (geminiErr: unknown) {
      const friendly = formatFriendlyError(geminiErr);
      console.warn('[runCertResearch] Falling back to keyless mode:', friendly.message);
      return runKeylessCertResearch({
        certName: cleanCertName,
        organizer: input.organizer,
        officialUrl: input.officialUrl,
        selectedAreas: sortedAreas,
        learnerLevel,
        fallbackReason: friendly.message,
      });
    }
  })().finally(() => {
    inFlightResearch.delete(cacheKey);
  });

  if (!input.forceRefresh) {
    inFlightResearch.set(cacheKey, executionPromise);
  }
  return executionPromise;
}

export async function runCertAsk(certName?: string, question?: string, useKeyless = false) {
  const cleanCert = (certName ?? '').trim();
  const cleanQuestion = (question ?? '').trim();

  if (!cleanCert || !cleanQuestion) {
    throw Object.assign(new Error('자격증명과 질문 내용을 모두 입력해 주세요.'), { status: 400 });
  }

  if (useKeyless || !process.env.GEMINI_API_KEY) {
    return runKeylessCertAsk(cleanCert, cleanQuestion);
  }

  try {
    const ai = getAiClient();
    const todayLabel = new Date().toISOString().slice(0, 10);
    const wiki = await fetchKoreanWikiContext(cleanCert);

    const promptText = `오늘 날짜는 ${todayLabel}입니다.
대한민국 자격증 [${cleanCert}]에 대해 수험생이 아래 질문을 했습니다.
확인된 한국 공식 자료 및 수험 자료를 기준으로 정확히 답변하세요.
확인되지 않은 수치나 사실은 절대 지어내지 말고, 확인 불가 시 솔직히 "공식 자료에서 확인되지 않음"을 밝히세요.
답변은 핵심 요약, 상세 근거, 수험생 실전 팁으로 간결하고 명확하게 한국어로 작성하세요.
${wiki.summaryText ? `\n[참고 자료]\n${wiki.summaryText}\n` : ''}
질문: ${cleanQuestion}`;

    let answerText: string | undefined;
    let sources: GroundingSource[] = [...wiki.sources];
    let lastErr: unknown;

    if (Date.now() > searchGroundingCooldownUntil) {
      try {
        const res1 = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              tools: [{ googleSearch: {} }],
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }),
          6500,
          'googleSearch-ask'
        );
        answerText = res1.text;
        const gSources = extractGroundingSources(res1);
        if (gSources.length > 0) sources = [...gSources, ...sources];
      } catch (err1) {
        lastErr = err1;
        if (!isTransientOrQuotaError(err1)) {
          throw err1;
        }
        if (isQuotaOrRateError(err1)) {
          searchGroundingCooldownUntil = Date.now() + 5 * 60 * 1000;
        }
      }
    }

    const fastModels: Array<{ model: string; useLowThinking?: boolean }> = [
      { model: 'gemini-3.1-flash-lite' },
      { model: 'gemini-4-hydrogen', useLowThinking: true },
      { model: 'gemini-2.5-flash' },
    ];

    for (const attempt of fastModels) {
      if (answerText) break;
      try {
        const res = await withTimeout(
          ai.models.generateContent({
            model: attempt.model,
            contents: promptText,
            config: attempt.useLowThinking
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : undefined,
          }),
          7500,
          attempt.model
        );
        answerText = res.text;
      } catch (err) {
        lastErr = err;
        if (!isTransientOrQuotaError(err)) {
          throw err;
        }
      }
    }

    if (!answerText) {
      throw lastErr || new Error('답변을 생성하지 못했습니다.');
    }

    return {
      question: cleanQuestion,
      answer: answerText.trim(),
      sources,
      askedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      mode: 'gemini' as const,
    };
  } catch (err: unknown) {
    const friendly = formatFriendlyError(err);
    console.warn('[runCertAsk] Falling back to keyless mode:', friendly.message);
    return runKeylessCertAsk(cleanCert, cleanQuestion, friendly.message);
  }
}
