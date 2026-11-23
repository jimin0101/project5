import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  BookOpenCheck,
  Check,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CERT_CATALOG, CERT_CATEGORIES, STUDY_AREAS } from './data/certCatalog';
import type {
  CertCatalogItem,
  CertCategory,
  CertResearchResult,
  LearnerLevel,
  SavedCertReport,
  StudyAreaId,
} from './types/cert';
import { ResearchReportView } from './components/ResearchReportView';
import { SavedReportsDrawer } from './components/SavedReportsDrawer';
import {
  extractChoseong,
  isChoseongQuery,
  normalizeForSearch,
} from './utils/koreanSearch';

const HERO_IMAGE_PATH = '/src/assets/images/study_desk_editorial_1795397869785.jpg';
const STORAGE_KEY = 'jagyeok_baekseo_saved_reports_v1';
const RECENT_CERTS_KEY = 'jagyeok_baekseo_recent_certs_v1';
const AREA_CACHE_PREFIX = 'jagyeok_area_cache_v2::';
const CACHE_TTL_MS = 60 * 60 * 1000;
const INITIAL_VISIBLE_COUNT = 12;

const LEARNER_LEVELS: LearnerLevel[] = [
  '비전공자·입문',
  '전공자·기본기 보유',
  '단기합격·실전집중',
];

// Precompute search indexes once outside React to eliminate keystroke lag
interface IndexedCert {
  item: CertCatalogItem;
  normText: string;
  choseongText: string;
}

const PREINDEXED_CATALOG: IndexedCert[] = CERT_CATALOG.map((item) => {
  const combined = [item.name, item.category, item.organizer, item.summary, ...item.aliases].join(' ');
  return {
    item,
    normText: normalizeForSearch(combined),
    choseongText: extractChoseong(`${item.name} ${item.aliases.join(' ')}`),
  };
});

const CATEGORY_COUNTS: Record<CertCategory, number> = CERT_CATEGORIES.reduce(
  (acc, cat) => {
    acc[cat] =
      cat === '전체'
        ? CERT_CATALOG.length
        : CERT_CATALOG.filter((c) => c.category === cat).length;
    return acc;
  },
  {} as Record<CertCategory, number>
);

interface AreaCacheRecord {
  ts: number;
  mode?: 'gemini' | 'keyless';
  fallbackReason?: string;
  overview?: CertResearchResult['overview'];
  verificationNote?: string;
  sources?: CertResearchResult['sources'];
  areas: Partial<Record<StudyAreaId, unknown>>;
}

type CacheMode = 'auto' | 'keyless';

function readAreaCache(
  certName: string,
  learnerLevel: LearnerLevel,
  cacheMode: CacheMode
): AreaCacheRecord | null {
  try {
    const raw = localStorage.getItem(
      `${AREA_CACHE_PREFIX}${certName}::${learnerLevel}::${cacheMode}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AreaCacheRecord;
    if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAreaCache(
  certName: string,
  learnerLevel: LearnerLevel,
  cacheMode: CacheMode,
  patch: Partial<AreaCacheRecord> & { areas?: Partial<Record<StudyAreaId, unknown>> }
) {
  try {
    const key = `${AREA_CACHE_PREFIX}${certName}::${learnerLevel}::${cacheMode}`;
    const existing = readAreaCache(certName, learnerLevel, cacheMode);
    const next: AreaCacheRecord = {
      ts: Date.now(),
      mode: patch.mode ?? existing?.mode,
      fallbackReason:
        patch.fallbackReason !== undefined ? patch.fallbackReason : existing?.fallbackReason,
      overview: patch.overview ?? existing?.overview,
      verificationNote: patch.verificationNote ?? existing?.verificationNote,
      sources: patch.sources ?? existing?.sources,
      areas: {
        ...(existing?.areas ?? {}),
        ...(patch.areas ?? {}),
      },
    };
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<CertCategory>('전체');
  const [popularOnly, setPopularOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  const [selectedCert, setSelectedCert] = useState<CertCatalogItem | null>(CERT_CATALOG[0]);
  const [customCertName, setCustomCertName] = useState('');
  const [selectedAreas, setSelectedAreas] = useState<StudyAreaId[]>([
    'concepts',
    'past_exams',
    'lectures',
    'workbooks',
    'interview',
    'stats',
  ]);
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>('비전공자·입문');
  const [preferKeyless, setPreferKeyless] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pendingAreas, setPendingAreas] = useState<StudyAreaId[]>([]);
  const [failedAreas, setFailedAreas] = useState<StudyAreaId[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<CertResearchResult | null>(null);

  const [savedReports, setSavedReports] = useState<SavedCertReport[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SavedCertReport[]) : [];
    } catch {
      return [];
    }
  });
  const [recentCertNames, setRecentCertNames] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_CERTS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [zipAvailable, setZipAvailable] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const areasSectionRef = useRef<HTMLElement | null>(null);
  const reportContainerRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2400);
  }, []);

  useEffect(() => {
    fetch('/api/download-zip', { method: 'HEAD' })
      .then((res) => {
        if (res.ok) setZipAvailable(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const shouldShow = window.scrollY > 480;
      setShowScrollTop((prev) => (prev !== shouldShow ? shouldShow : prev));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedReports));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedReports]);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_CERTS_KEY, JSON.stringify(recentCertNames));
    } catch {
      // Ignore storage quota errors
    }
  }, [recentCertNames]);

  useEffect(() => {
    if (!isLoading) {
      setElapsedSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  // Reset pagination whenever filters change
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [deferredSearchQuery, selectedCategory, popularOnly]);

  const filteredCerts = useMemo(() => {
    const rawQ = deferredSearchQuery.trim();
    const normQ = normalizeForSearch(rawQ);
    const useChoseong = normQ ? isChoseongQuery(rawQ) : false;

    const results: CertCatalogItem[] = [];
    for (const entry of PREINDEXED_CATALOG) {
      const cert = entry.item;
      if (selectedCategory !== '전체' && cert.category !== selectedCategory) continue;
      if (popularOnly && !cert.isPopular) continue;
      if (!normQ) {
        results.push(cert);
        continue;
      }
      if (entry.normText.includes(normQ) || (useChoseong && entry.choseongText.includes(normQ))) {
        results.push(cert);
      }
    }
    return results;
  }, [deferredSearchQuery, selectedCategory, popularOnly]);

  const visibleCerts = useMemo(
    () => filteredCerts.slice(0, visibleCount),
    [filteredCerts, visibleCount]
  );

  const activeCertTitle = customCertName.trim() || selectedCert?.name || '';

  const pushRecentCert = useCallback((certName: string) => {
    if (!certName) return;
    setRecentCertNames((prev) => [certName, ...prev.filter((c) => c !== certName)].slice(0, 6));
  }, []);

  const handleSelectCatalogCert = (cert: CertCatalogItem) => {
    setSelectedCert(cert);
    setCustomCertName('');
    setErrorMsg(null);
  };

  const handleUseCustomCert = () => {
    const clean = searchQuery.trim();
    if (!clean) return;
    setCustomCertName(clean);
    setSelectedCert(null);
    setErrorMsg(null);
    areasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (filteredCerts.length > 0) {
      setSelectedCert(filteredCerts[0]);
      setCustomCertName('');
      setErrorMsg(null);
      showToast(`'${filteredCerts[0].name}' 선택됨 — 바로 조회할 수 있습니다.`);
    } else if (searchQuery.trim()) {
      handleUseCustomCert();
    }
  };

  const toggleArea = (id: StudyAreaId) => {
    setSelectedAreas((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const applyAreaPreset = (areas: StudyAreaId[]) => {
    setSelectedAreas(areas);
  };

  const cancelOngoingResearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setPendingAreas([]);
    showToast('조회를 중단했습니다.');
  };

  const executeResearch = async (
    areasToQuery: StudyAreaId[],
    forceRefresh = false,
    overrideCert?: { name: string; organizer?: string; officialUrl?: string },
    forceKeylessOverride?: boolean
  ) => {
    const targetName = overrideCert?.name ?? activeCertTitle;
    const targetOrganizer = overrideCert?.organizer ?? (selectedCert?.organizer || '');
    const targetOfficialUrl = overrideCert?.officialUrl ?? (selectedCert?.officialUrl || '');
    const effectiveUseKeyless = forceKeylessOverride ?? preferKeyless;
    const cacheMode: CacheMode = effectiveUseKeyless ? 'keyless' : 'auto';

    if (!targetName) {
      setErrorMsg('먼저 자격증을 선택하거나 직접 입력해 주세요.');
      return;
    }
    if (areasToQuery.length === 0) {
      setErrorMsg('조회할 학습 영역을 최소 1개 이상 선택해 주세요.');
      return;
    }

    // Cancel any previous in-flight research cleanly
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const sortedRequested = [...areasToQuery].sort();
    const cachedRecord = !forceRefresh
      ? readAreaCache(targetName, learnerLevel, cacheMode)
      : null;

    const cachedAreas: StudyAreaId[] = [];
    const missingAreas: StudyAreaId[] = [];

    for (const area of sortedRequested) {
      if (cachedRecord?.overview && cachedRecord.areas?.[area]) {
        cachedAreas.push(area);
      } else {
        missingAreas.push(area);
      }
    }

    const todayStr = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    // If all requested areas + overview are cached locally -> instant 0ms response!
    if (missingAreas.length === 0 && cachedRecord?.overview) {
      const instantResult: CertResearchResult = {
        certName: targetName,
        researchedAt: todayStr,
        selectedAreas: sortedRequested,
        learnerLevel,
        mode: cachedRecord.mode,
        fallbackReason: cachedRecord.fallbackReason,
        overview: cachedRecord.overview,
        verificationNote: cachedRecord.verificationNote || '',
        sources: cachedRecord.sources || [],
        ...cachedAreas.reduce((acc, area) => {
          (acc as Record<string, unknown>)[area] = cachedRecord.areas[area];
          return acc;
        }, {} as Partial<CertResearchResult>),
      };
      setErrorMsg(null);
      setFailedAreas([]);
      setPendingAreas([]);
      setResearchResult(instantResult);
      pushRecentCert(targetName);
      window.setTimeout(() => {
        reportContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setFailedAreas([]);
    setPendingAreas(missingAreas);
    pushRecentCert(targetName);

    // If some cached areas already exist, display partial report immediately!
    let hasScrolledToReport = false;
    const scrollToReportOnce = () => {
      if (hasScrolledToReport) return;
      hasScrolledToReport = true;
      window.setTimeout(() => {
        reportContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    };

    if (cachedAreas.length > 0 && cachedRecord?.overview && !forceRefresh) {
      setResearchResult({
        certName: targetName,
        researchedAt: todayStr,
        selectedAreas: sortedRequested,
        learnerLevel,
        mode: cachedRecord.mode,
        fallbackReason: cachedRecord.fallbackReason,
        overview: cachedRecord.overview,
        verificationNote: cachedRecord.verificationNote || '',
        sources: cachedRecord.sources || [],
        ...cachedAreas.reduce((acc, area) => {
          (acc as Record<string, unknown>)[area] = cachedRecord.areas[area];
          return acc;
        }, {} as Partial<CertResearchResult>),
      });
      scrollToReportOnce();
    }

    const needOverviewFromServer = forceRefresh || !cachedRecord?.overview;

    // When keyless is preferred, run all areas in a single fast request;
    // otherwise keep Batch 0 to 1 area so every Vercel serverless call stays well under 10s.
    const chunks: StudyAreaId[][] = [];
    if (effectiveUseKeyless) {
      chunks.push(missingAreas);
    } else if (needOverviewFromServer && missingAreas.length > 1) {
      chunks.push([missingAreas[0]]);
      for (let i = 1; i < missingAreas.length; i += 2) {
        chunks.push(missingAreas.slice(i, i + 2));
      }
    } else {
      for (let i = 0; i < missingAreas.length; i += 2) {
        chunks.push(missingAreas.slice(i, i + 2));
      }
    }

    const fetchBatch = async (
      areasBatch: StudyAreaId[],
      includeOverview: boolean
    ): Promise<CertResearchResult> => {
      let data: Record<string, unknown> = {};
      let lastRespStatus = 0;
      let lastRawSnippet = '';

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 700));
        }
        const resp = await fetch('/api/cert-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            certName: targetName,
            organizer: targetOrganizer,
            officialUrl: targetOfficialUrl,
            selectedAreas: areasBatch,
            learnerLevel,
            forceRefresh,
            includeOverview,
            useKeyless: effectiveUseKeyless,
          }),
        });

        lastRespStatus = resp.status;
        const rawText = await resp.text();
        lastRawSnippet = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        try {
          data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        } catch {
          data = {};
        }

        if (resp.ok && data && typeof data === 'object' && 'certName' in data) {
          return data as unknown as CertResearchResult;
        }

        const isRetryable = [429, 500, 502, 503, 504].includes(resp.status);
        if (!isRetryable || attempt === 1) {
          if (typeof data.error === 'string' && data.error) {
            throw new Error(`[HTTP ${lastRespStatus}] ${data.error}`);
          }

          // Check /api/health on Vercel to detect missing GEMINI_API_KEY or missing API route
          try {
            const healthResp = await fetch('/api/health', { signal: controller.signal });
            if (healthResp.ok) {
              const healthData = (await healthResp.json()) as { hasGeminiKey?: boolean };
              if (healthData.hasGeminiKey === false) {
                throw new Error(
                  'Vercel 서버에 GEMINI_API_KEY 환경 변수가 설정되지 않았습니다. Vercel Dashboard → Settings → Environment Variables에 GEMINI_API_KEY를 추가한 뒤 반드시 Redeploy 해 주세요.'
                );
              }
            }
          } catch (healthErr) {
            if (healthErr instanceof Error && healthErr.message.includes('GEMINI_API_KEY')) {
              throw healthErr;
            }
          }

          if (lastRespStatus === 504) {
            throw new Error(
              '[HTTP 504] 서버 응답 시간이 초과되었습니다. 잠시 후 해당 영역만 다시 조회해 주세요.'
            );
          }
          if (lastRespStatus === 404) {
            throw new Error(
              '[HTTP 404] API 서버리스 경로(/api/cert-research)를 찾지 못했습니다. Vercel Root Directory 및 api 폴더 배포 상태를 확인해 주세요.'
            );
          }
          throw new Error(
            `[HTTP ${lastRespStatus || 'ERR'}] 서버리스 함수 오류${
              lastRawSnippet ? ` (${lastRawSnippet})` : ''
            }. Vercel Logs 및 GEMINI_API_KEY 설정을 확인해 주세요.`
          );
        }
      }
      throw new Error('자격증 자료를 조회하지 못했습니다.');
    };

    let anySucceeded = cachedAreas.length > 0;
    let firstErrorMessage: string | null = null;

    await Promise.all(
      chunks.map(async (chunk, idx) => {
        const shouldIncludeOverview = needOverviewFromServer && idx === 0;
        try {
          const batchRes = await fetchBatch(chunk, shouldIncludeOverview);
          if (controller.signal.aborted) return;

          anySucceeded = true;

          // Update local granular cache
          const areaPatch: Partial<Record<StudyAreaId, unknown>> = {};
          for (const area of chunk) {
            if (batchRes[area] !== undefined) {
              areaPatch[area] = batchRes[area];
            }
          }
          writeAreaCache(targetName, learnerLevel, cacheMode, {
            mode: batchRes.mode,
            fallbackReason: batchRes.fallbackReason,
            overview: batchRes.overview,
            verificationNote: batchRes.verificationNote,
            sources: batchRes.sources,
            areas: areaPatch,
          });

          // Merge progressively into current researchResult immediately!
          setResearchResult((prev) => {
            const basePrev =
              prev && prev.certName === targetName && prev.learnerLevel === learnerLevel
                ? prev
                : null;

            const mergedSources = [
              ...(basePrev?.sources ?? []),
              ...(batchRes.sources ?? []),
            ].filter((src, sIdx, arr) => arr.findIndex((x) => x.uri === src.uri) === sIdx);

            const nextOverview =
              batchRes.overview ||
              basePrev?.overview || {
                officialOrganizer: targetOrganizer || '공식 시행기관',
                officialPortalUrl: targetOfficialUrl || '',
                certType: '자격증',
                examSchedule2026: '불러오는 중...',
                eligibility: '불러오는 중...',
                feeInfo: '불러오는 중...',
                latestChanges: '불러오는 중...',
              };

            return {
              ...(basePrev ?? {}),
              ...batchRes,
              certName: targetName,
              selectedAreas: sortedRequested,
              learnerLevel,
              mode: batchRes.mode ?? basePrev?.mode,
              fallbackReason: batchRes.fallbackReason ?? basePrev?.fallbackReason,
              researchedAt: batchRes.researchedAt || todayStr,
              overview: nextOverview,
              verificationNote:
                batchRes.verificationNote ||
                basePrev?.verificationNote ||
                '공식 기관 자료를 확인 중입니다.',
              sources: mergedSources,
            } as CertResearchResult;
          });

          setPendingAreas((prev) => prev.filter((a) => !chunk.includes(a)));
          scrollToReportOnce();
        } catch (err: unknown) {
          if (controller.signal.aborted) return;
          if (!firstErrorMessage) {
            firstErrorMessage =
              err instanceof Error
                ? err.message
                : '서버 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
          }
          setPendingAreas((prev) => prev.filter((a) => !chunk.includes(a)));
          setFailedAreas((prev) => Array.from(new Set([...prev, ...chunk])));
        }
      })
    );

    if (!controller.signal.aborted) {
      setIsLoading(false);
      if (!anySucceeded && firstErrorMessage) {
        setErrorMsg(firstErrorMessage);
      }
    }
  };

  const handleRetryAreas = (areas: StudyAreaId[]) => {
    executeResearch(areas, false);
  };

  const currentReportId = researchResult
    ? `${researchResult.certName}::${[...researchResult.selectedAreas].sort().join(',')}::${researchResult.learnerLevel}`
    : '';

  const isCurrentSaved = savedReports.some((r) => r.id === currentReportId);

  const handleToggleSaveCurrent = useCallback(() => {
    if (!researchResult) return;
    if (isCurrentSaved) {
      setSavedReports((prev) => prev.filter((r) => r.id !== currentReportId));
      showToast('보관함에서 삭제했습니다.');
    } else {
      const categoryLabel =
        selectedCert?.category || researchResult.overview.certType || '맞춤 조회';
      const newItem: SavedCertReport = {
        id: currentReportId,
        certName: researchResult.certName,
        category: categoryLabel,
        savedAt: researchResult.researchedAt,
        result: researchResult,
      };
      setSavedReports((prev) => [newItem, ...prev.filter((r) => r.id !== currentReportId)]);
      showToast(`'${researchResult.certName}' 리포트를 보관함에 저장했습니다.`);
    }
  }, [researchResult, isCurrentSaved, currentReportId, selectedCert?.category, showToast]);

  const handleLoadSaved = useCallback((saved: SavedCertReport) => {
    setResearchResult(saved.result);
    setSelectedAreas(saved.result.selectedAreas);
    setLearnerLevel(saved.result.learnerLevel);
    setFailedAreas([]);
    setPendingAreas([]);
    setErrorMsg(null);
    const matching = CERT_CATALOG.find((c) => c.name === saved.certName) || null;
    setSelectedCert(matching);
    setCustomCertName(matching ? '' : saved.certName);
    window.setTimeout(() => {
      reportContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

  const handleDeleteSaved = useCallback((id: string) => {
    setSavedReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleClearAllSaved = useCallback(() => {
    setSavedReports([]);
    showToast('보관함을 모두 비웠습니다.');
  }, [showToast]);

  const handleSelectRecentCert = (certName: string) => {
    const match = CERT_CATALOG.find((c) => c.name === certName) || null;
    if (match) {
      setSelectedCert(match);
      setCustomCertName('');
      executeResearch(selectedAreas, false, {
        name: match.name,
        organizer: match.organizer,
        officialUrl: match.officialUrl,
      });
    } else {
      setSelectedCert(null);
      setCustomCertName(certName);
      executeResearch(selectedAreas, false, { name: certName });
    }
  };

  const quickShortcuts = [
    '정보처리기사',
    '전기기사',
    '컴퓨터활용능력 1급',
    'SQLD (SQL 개발자)',
    '산업안전기사',
    '공인중개사',
    '한국사능력검정시험 (심화)',
    '투자자산운용사',
  ];

  // Show skeleton state only before any progressive partial data arrives
  const showFullLoadingCard = isLoading && (!researchResult || researchResult.certName !== activeCertTitle);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: crisp solid surface (no backdrop-blur compositing lag) */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            자격백서
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#catalog-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              자격증 탐색
            </a>
            <a
              href="#areas-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              영역 선택
            </a>
            <a
              href="#report-anchor"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              맞춤 리포트
            </a>
            <a
              href="#verification-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              공식 검증 원칙
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums"
            >
              내 보관함 ({savedReports.length})
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 space-y-12">
        {/* Hero Two-Column Split */}
        <section className="space-y-6 no-print">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-7 md:p-10 flex flex-col justify-between space-y-8">
              <div className="space-y-4">
                <div className="text-xs font-medium text-slate-500">
                  한국 공식 시험기관 · 최신 수험서 · 강사 검증 리서치 워크벤치
                </div>
                <h1 className="font-display text-3xl md:text-4xl font-bold text-slate-900 leading-tight [text-wrap:balance]">
                  하루 종일 검색하던 자격증 공부 준비, 필요한 영역만 빠르게 확인하세요
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                  기출문제와 면접 답변, 핵심 개념, 강사별 사용 교재·공개 합격률, 문제집의 장단점(개념 비중 vs 문제 수)과 연도별 합격률·취업률까지 최신 한국 공식 자료 기준으로 정리합니다.
                </p>
                {zipAvailable && (
                  <div className="pt-1">
                    <a
                      href="/api/download-zip"
                      download="jagyeok-baekseo-github.zip"
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>GitHub·Vercel 배포용 전체 소스 (.zip) 내려받기</span>
                    </a>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-500">많이 찾는 대표 자격증 바로 조회</div>
                <div className="flex flex-wrap gap-2">
                  {quickShortcuts.map((name) => {
                    const match = CERT_CATALOG.find((c) => c.name === name);
                    if (!match) return null;
                    const isActive = activeCertTitle === match.name;
                    return (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => handleSelectCatalogCert(match)}
                        className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                          isActive
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {match.name.replace(/\s*\(.*?\)/g, '')}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 relative rounded-xl border border-slate-200 overflow-hidden bg-slate-100 min-h-[260px]">
              {!imageError ? (
                <img
                  src={HERO_IMAGE_PATH}
                  alt="자격증 수험서와 통계 데이터를 정리하는 학습 책상"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  className="w-full h-full object-cover lg:h-full"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-slate-100 to-slate-200">
                  <BookOpenCheck className="w-12 h-12 text-blue-700 mb-3" />
                  <p className="text-sm font-semibold text-slate-800">한국 자격증 최신 수험 전략 아카이브</p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/85 via-slate-900/45 to-transparent p-6 text-white">
                <div className="text-xs text-slate-200 mb-1">실시간 한국 공식 자료 교차 검증</div>
                <div className="text-sm font-semibold">
                  확인되지 않은 수치는 &apos;공식 미공개&apos;로 표기하여 거짓 정보를 차단합니다
                </div>
              </div>
            </div>
          </div>

          {/* 4-column summary strip below hero */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 mb-1">수록 한국 자격증</div>
              <div className="font-mono-num text-2xl font-bold text-slate-900">
                {CERT_CATALOG.length}종+
              </div>
              <div className="text-xs text-slate-600 mt-1">목록 외 자격증도 직접 입력 조회</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 mb-1">맞춤 선택 영역</div>
              <div className="font-mono-num text-2xl font-bold text-slate-900">6개 핵심 영역</div>
              <div className="text-xs text-slate-600 mt-1">개념·기출·인강·문제집·면접·통계</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 mb-1">교재·인강 분석 기준</div>
              <div className="font-mono-num text-2xl font-bold text-slate-900">비중 &amp; 사용교재</div>
              <div className="text-xs text-slate-600 mt-1">개념/문제 비율 및 강사 교재 매칭</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500 mb-1">자료 신뢰성 원칙</div>
              <div className="font-mono-num text-2xl font-bold text-blue-700">100% 출처 표기</div>
              <div className="text-xs text-slate-600 mt-1">Q-Net·공식기관 한국 원문 링크 제공</div>
            </div>
          </div>
        </section>

        {/* Step 1: 자격증 탐색 & 선택 */}
        <section id="catalog-section" className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 no-print">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-blue-700">STEP 01</div>
              <h2 className="text-2xl font-bold text-slate-900">공부할 자격증을 선택하거나 직접 입력하세요</h2>
              <p className="text-sm text-slate-600">
                약칭(정처기, 컴활, 산안기)은 물론 초성(ㅈㅊㄱ, ㅋㅎ, ㅎㄴㄱ)으로도 즉시 검색할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPopularOnly(false)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  !popularOnly
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                전체 {CERT_CATALOG.length}종
              </button>
              <button
                type="button"
                onClick={() => setPopularOnly(true)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  popularOnly
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                주요 인기 자격증만
              </button>
            </div>
          </div>

          {/* Search Bar + Clear + Enter */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="자격증 이름, 약칭, 초성 검색 (예: 정보처리기사, ㅈㅊㄱ, 컴활, 물류관리사)"
                  className="w-full pl-10 pr-10 py-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="검색어 지우기"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={handleUseCustomCert}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>&apos;{searchQuery.trim()}&apos; 직접 조회 대상으로 지정</span>
                </button>
              )}
            </div>

            {/* Recent Queries Quick Jump */}
            {recentCertNames.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-slate-500 font-medium shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  최근 조회:
                </span>
                {recentCertNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleSelectRecentCert(name)}
                    className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors whitespace-nowrap"
                  >
                    {name.replace(/\s*\(.*?\)/g, '')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category Filter Bar with counts */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {CERT_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat}{' '}
                  <span className={`font-mono-num ${active ? 'text-blue-200' : 'text-slate-400'}`}>
                    ({CATEGORY_COUNTS[cat]})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selection Status + Quick Execute Bar inside Step 1 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-600">
              <span>
                현재 선택:{' '}
                <strong className="text-slate-900 text-sm">{activeCertTitle || '없음'}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                검색 결과 {filteredCerts.length}종
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  areasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
              >
                영역 조정 ({selectedAreas.length}개)
              </button>
              <button
                type="button"
                onClick={() => executeResearch(selectedAreas, false)}
                disabled={isLoading || !activeCertTitle || selectedAreas.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <span>바로 조회</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Paginated Catalog Grid (no nested scroll trap, light DOM) */}
          {visibleCerts.length > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleCerts.map((cert) => {
                  const isSelected = !customCertName && selectedCert?.id === cert.id;
                  return (
                    <div
                      key={cert.id}
                      onClick={() => handleSelectCatalogCert(cert)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectCatalogCert(cert);
                        }
                      }}
                      className={`cv-auto cursor-pointer rounded-lg border p-4 flex flex-col justify-between space-y-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">
                            {cert.certType} · {cert.organizer}
                          </span>
                          {isSelected && (
                            <span className="text-blue-700 font-semibold whitespace-nowrap shrink-0">
                              선택됨
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-base text-slate-900">{cert.name}</h3>
                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                          {cert.summary}
                        </p>
                      </div>

                      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 truncate">{cert.examFormat}</span>
                        <a
                          href={cert.officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <span>공식처</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {visibleCount < filteredCerts.length && (
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + INITIAL_VISIBLE_COUNT)}
                    className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    12종 더 보기 (남은 {filteredCerts.length - visibleCount}종)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filteredCerts.length)}
                    className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                  >
                    전체 {filteredCerts.length}종 모두 펼치기
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-8 text-center space-y-3 bg-slate-50">
              <p className="text-sm font-medium text-slate-800">
                목록에서 &apos;{searchQuery}&apos;와 일치하는 항목을 찾지 못했습니다.
              </p>
              <p className="text-xs text-slate-600">
                목록에 없는 자격증이라도 아래 버튼을 누르면 최신 한국 자료를 직접 조회할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={handleUseCustomCert}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>&apos;{searchQuery}&apos; 직접 선택하기</span>
              </button>
            </div>
          )}
        </section>

        {/* Step 2: 학습 영역 및 수험 수준 선택 */}
        <section
          ref={areasSectionRef}
          id="areas-section"
          className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 no-print"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-blue-700">STEP 02</div>
              <h2 className="text-2xl font-bold text-slate-900">
                필요한 정보 영역을 선택하세요
              </h2>
              <p className="text-sm text-slate-600">
                현재 선택된 자격증:{' '}
                <span className="font-bold text-slate-900">
                  {activeCertTitle || '선택되지 않음'}
                </span>
                {selectedCert && (
                  <span className="text-slate-500"> ({selectedCert.organizer})</span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  applyAreaPreset([
                    'concepts',
                    'past_exams',
                    'lectures',
                    'workbooks',
                    'interview',
                    'stats',
                  ])
                }
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                전체 6개 영역
              </button>
              <button
                type="button"
                onClick={() => applyAreaPreset(['lectures', 'workbooks'])}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                인강·문제집 비교만
              </button>
              <button
                type="button"
                onClick={() => applyAreaPreset(['concepts', 'past_exams', 'interview'])}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                개념·기출·면접 대비
              </button>
              <button
                type="button"
                onClick={() => applyAreaPreset(['stats'])}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                합격·경쟁·취업률만
              </button>
            </div>
          </div>

          {/* 6 Area Multi-Select Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {STUDY_AREAS.map((area) => {
              const checked = selectedAreas.includes(area.id);
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => toggleArea(area.id)}
                  className={`text-left rounded-lg border p-4 transition-colors flex items-start justify-between gap-3 ${
                    checked
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-slate-900">{area.label}</div>
                    <p className="text-xs text-slate-600 leading-relaxed">{area.description}</p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                      checked
                        ? 'bg-blue-700 border-blue-700 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Learner Level + Research Mode + Submit CTA + Cancel */}
          <div className="pt-4 border-t border-slate-100 flex flex-col gap-4">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  내 수험 수준:
                </span>
                <div className="flex flex-wrap gap-2">
                  {LEARNER_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLearnerLevel(lvl)}
                      className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        learnerLevel === lvl
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  조회 방식:
                </span>
                <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setPreferKeyless(false)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      !preferKeyless
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    자동 (AI+공식)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferKeyless(true)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      preferKeyless
                        ? 'bg-blue-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    API 키 없이 공식·위키 즉시조회
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {isLoading && (
                <button
                  type="button"
                  onClick={cancelOngoingResearch}
                  className="px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  조회 중단
                </button>
              )}
              <button
                type="button"
                onClick={() => executeResearch(selectedAreas, false)}
                disabled={isLoading || !activeCertTitle || selectedAreas.length === 0}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>영역별 순차 정리 중 ({elapsedSec}초)</span>
                  </>
                ) : (
                  <>
                    <span>선택한 {selectedAreas.length}개 영역 최신 자료 조회하기</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">조회 오류 안내</div>
                  <p className="text-xs mt-0.5 leading-relaxed">{errorMsg}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-center shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPreferKeyless(true);
                    executeResearch(selectedAreas, false, undefined, true);
                  }}
                  disabled={isLoading}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
                >
                  API 키 없이 공식·위키 모드로 조회
                </button>
                <button
                  type="button"
                  onClick={() => executeResearch(selectedAreas, false)}
                  disabled={isLoading}
                  className="px-3.5 py-2 text-xs font-semibold text-red-800 bg-white border border-red-300 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap"
                >
                  다시 조회하기
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Step 3: Research Report Output */}
        <div ref={reportContainerRef} id="report-anchor">
          {showFullLoadingCard ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
              <Loader2 className="w-8 h-8 text-blue-700 animate-spin mx-auto" />
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-slate-900">
                  &apos;{activeCertTitle}&apos; 최신 한국 공식 자료를 불러오고 있습니다
                </h3>
                <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
                  먼저 도착하는 영역부터 화면에 바로 표시됩니다.{' '}
                  <span className="font-mono-num font-semibold text-blue-700">({elapsedSec}초 경과)</span>
                </p>
              </div>
              <button
                type="button"
                onClick={cancelOngoingResearch}
                className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              >
                조회 중단하기
              </button>
            </div>
          ) : researchResult ? (
            <ResearchReportView
              result={researchResult}
              isSaved={isCurrentSaved}
              onToggleSave={handleToggleSaveCurrent}
              onRefresh={() => executeResearch(selectedAreas, true)}
              isRefreshing={isLoading}
              pendingAreas={pendingAreas}
              failedAreas={failedAreas}
              onRetryAreas={handleRetryAreas}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 md:p-10 text-center space-y-3 no-print">
              <ShieldCheck className="w-8 h-8 text-blue-700 mx-auto" />
              <h3 className="text-lg font-bold text-slate-900">
                자격증과 필요한 영역을 선택한 뒤 조회 버튼을 눌러주세요
              </h3>
              <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
                조회 버튼을 누르면 한국 공식 자료를 교차 확인하여 도착하는 영역부터 즉시 화면에 펼쳐 드리며, 확인되지 않은 수치는 &apos;공식 미공개&apos;로 구분해 안내합니다.
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Quiet Official Verification Footer */}
      <footer id="verification-section" className="bg-white border-t border-slate-200 mt-12 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-xs text-slate-600">
          <div className="space-y-1 max-w-2xl">
            <div className="font-semibold text-slate-900">
              자격백서 정보 검증 원칙
            </div>
            <p className="leading-relaxed">
              본 서비스는 한국 공식 시행처 및 수험 자료를 교차 조회합니다. 원서접수 일정·응시자격·합격기준의 최종 법적 효력은 반드시 각 시행기관 공식 공고를 기준으로 확인하시기 바랍니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <a
              href="https://www.q-net.or.kr"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-700 underline"
            >
              큐넷 (Q-Net)
            </a>
            <a
              href="https://license.korcham.net"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-700 underline"
            >
              대한상공회의소
            </a>
            <a
              href="https://www.dataq.or.kr"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-700 underline"
            >
              한국데이터산업진흥원
            </a>
            <a
              href="https://www.kuksiwon.or.kr"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-700 underline"
            >
              국시원
            </a>
            {zipAvailable && (
              <a
                href="/api/download-zip"
                download="jagyeok-baekseo-github.zip"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>GitHub 소스 (.zip) 다운로드</span>
              </a>
            )}
          </div>
        </div>
      </footer>

      {/* Scroll-to-Top Floating Button */}
      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="맨 위로 이동"
          title="맨 위로 이동"
          className="fixed bottom-6 right-6 z-30 p-3 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800 transition-colors no-print"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

      {/* Non-intrusive Feedback Toast */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-medium shadow-lg no-print"
        >
          {toastMsg}
        </div>
      )}

      <SavedReportsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        savedReports={savedReports}
        onLoadReport={handleLoadSaved}
        onDeleteReport={handleDeleteSaved}
        onClearAll={handleClearAllSaved}
      />
    </div>
  );
}
