import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileQuestion,
  GraduationCap,
  HelpCircle,
  Loader2,
  MessageSquare,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { AskAnswer, CertResearchResult, StudyAreaId } from '../types/cert';
import { STUDY_AREAS } from '../data/certCatalog';

interface ResearchReportViewProps {
  result: CertResearchResult;
  isSaved: boolean;
  onToggleSave: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  pendingAreas?: StudyAreaId[];
  failedAreas?: StudyAreaId[];
  onRetryAreas?: (areas: StudyAreaId[]) => void;
}

function parsePercentNumber(str: string): number | null {
  const match = str.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (Number.isNaN(val) || val < 0 || val > 100) return null;
  return val;
}

function isChoiceMatchingAnswer(choice: string, idx: number, answer: string): boolean {
  const cleanAnswer = answer.trim().toLowerCase();
  const cleanChoice = choice.trim().toLowerCase();
  if (!cleanAnswer) return false;
  if (cleanChoice === cleanAnswer || cleanChoice.includes(cleanAnswer) || cleanAnswer.includes(cleanChoice)) {
    return true;
  }
  const circleNums = ['①', '②', '③', '④', '⑤'];
  const marker = circleNums[idx];
  if (marker && cleanAnswer.includes(marker)) return true;
  const numStr = String(idx + 1);
  if (
    cleanAnswer === numStr ||
    cleanAnswer.startsWith(`${numStr}번`) ||
    cleanAnswer.startsWith(`${numStr}.`) ||
    cleanAnswer.startsWith(`${numStr})`)
  ) {
    return true;
  }
  return false;
}

function formatReportAsMarkdown(result: CertResearchResult): string {
  const lines: string[] = [
    `# ${result.certName} 맞춤 수험 분석 리포트`,
    `- 구분/주관: ${result.overview.certType} · ${result.overview.officialOrganizer}`,
    `- 수험 수준: ${result.learnerLevel} (조회일 ${result.researchedAt})`,
    `- 시험 일정: ${result.overview.examSchedule2026}`,
    `- 응시 자격: ${result.overview.eligibility}`,
    `- 검정료: ${result.overview.feeInfo}`,
    `- 최신 변경: ${result.overview.latestChanges}`,
    '',
  ];

  if (result.concepts) {
    lines.push('## 1. 핵심 개념 및 출제기준');
    lines.push(`- 추천 학습 순서: ${result.concepts.studyOrderTip}`);
    result.concepts.subjects?.forEach((s) => {
      lines.push(`### ${s.name} (${s.weight})`);
      s.keyTopics?.forEach((t) => lines.push(`  - ${t}`));
      lines.push(`  - 암기 포인트: ${s.memorizationTips}`);
    });
    lines.push('');
  }

  if (result.past_exams) {
    lines.push('## 2. 기출문제 및 출제경향');
    lines.push(`- 최신 경향: ${result.past_exams.recentTrend}`);
    lines.push(`- 반복 비중: ${result.past_exams.repeatRateNote}`);
    result.past_exams.cbtSources?.forEach((c) => lines.push(`- CBT/기출: ${c.name} (${c.url})`));
    lines.push('');
  }

  if (result.lectures) {
    lines.push('## 3. 추천 인강 · 강사');
    result.lectures.instructors?.forEach((inst) => {
      lines.push(`- ${inst.name} (${inst.platform} · ${inst.courseName})`);
      lines.push(`  - 사용 교재: ${inst.textbookUsed} (${inst.textbookPublisher})`);
      lines.push(`  - 합격률 확인: ${inst.passRateInfo}`);
    });
    lines.push('');
  }

  if (result.workbooks) {
    lines.push('## 4. 문제집 · 교재 비교');
    result.workbooks.books?.forEach((b) => {
      lines.push(`- ${b.title} (${b.publisher}) — ${b.conceptVsProblemRatio}`);
      lines.push(`  - 특징: ${b.keyCharacteristic}`);
    });
    lines.push('');
  }

  if (result.interview) {
    lines.push('## 5. 면접 · 구술 Q&A');
    result.interview.qaList?.forEach((q, i) => {
      lines.push(`- Q${i + 1}. ${q.question}`);
      lines.push(`  - 답변 구조: ${q.modelAnswer}`);
    });
    lines.push('');
  }

  if (result.stats) {
    lines.push('## 6. 합격률 · 경쟁률 · 취업률');
    result.stats.passRates?.forEach((r) => {
      lines.push(`- ${r.year}: 필기 ${r.writtenRate} / 실기 ${r.practicalRate} (${r.applicantsNote})`);
    });
    lines.push(`- 경쟁률/난이도: ${result.stats.competitionContext}`);
    lines.push(`- 취업/수요: ${result.stats.employmentRateInfo}`);
    lines.push('');
  }

  return lines.join('\n');
}

export const ResearchReportView: React.FC<ResearchReportViewProps> = React.memo(
  ({
    result,
    isSaved,
    onToggleSave,
    onRefresh,
    isRefreshing,
    pendingAreas = [],
    failedAreas = [],
    onRetryAreas,
  }) => {
    const [activeTab, setActiveTab] = useState<'all' | StudyAreaId>('all');
    const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
    const [selectedQuizChoices, setSelectedQuizChoices] = useState<Record<number, number>>({});
    const [revealedInterviews, setRevealedInterviews] = useState<Record<number, boolean>>({ 0: true });
    const [copied, setCopied] = useState(false);

    // Follow-up verification Q&A state
    const [followUpInput, setFollowUpInput] = useState('');
    const [followUpLoading, setFollowUpLoading] = useState(false);
    const [followUpError, setFollowUpError] = useState<string | null>(null);
    const [askHistory, setAskHistory] = useState<AskAnswer[]>([]);

    // Reset transient interaction state cleanly when switching certifications
    useEffect(() => {
      setActiveTab('all');
      setRevealedAnswers({});
      setSelectedQuizChoices({});
      setRevealedInterviews({ 0: true });
      setFollowUpInput('');
      setFollowUpError(null);
      setAskHistory([]);
      setCopied(false);
    }, [result.certName, result.learnerLevel]);

    const toggleAnswer = (idx: number) => {
      setRevealedAnswers((prev) => ({ ...prev, [idx]: !prev[idx] }));
    };

    const handleSelectQuizChoice = (qIdx: number, cIdx: number) => {
      setSelectedQuizChoices((prev) => ({ ...prev, [qIdx]: cIdx }));
      setRevealedAnswers((prev) => ({ ...prev, [qIdx]: true }));
    };

    const toggleAllAnswers = (total: number) => {
      const allOpen = total > 0 && Array.from({ length: total }).every((_, i) => revealedAnswers[i]);
      const next: Record<number, boolean> = {};
      for (let i = 0; i < total; i++) {
        next[i] = !allOpen;
      }
      setRevealedAnswers(next);
    };

    const toggleInterview = (idx: number) => {
      setRevealedInterviews((prev) => ({ ...prev, [idx]: !prev[idx] }));
    };

    const toggleAllInterviews = (total: number) => {
      const allOpen = total > 0 && Array.from({ length: total }).every((_, i) => revealedInterviews[i]);
      const next: Record<number, boolean> = {};
      for (let i = 0; i < total; i++) {
        next[i] = !allOpen;
      }
      setRevealedInterviews(next);
    };

    const handleCopyMarkdown = async () => {
      try {
        await navigator.clipboard.writeText(formatReportAsMarkdown(result));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback ignored if clipboard blocked
      }
    };

    const submitFollowUpQuestion = async (questionText: string) => {
      const q = questionText.trim();
      if (!q || followUpLoading) return;

      setFollowUpLoading(true);
      setFollowUpError(null);
      try {
        const resp = await fetch('/api/cert-ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            certName: result.certName,
            question: q,
            useKeyless: result.mode === 'keyless',
          }),
        });
        const rawText = await resp.text();
        let data: Record<string, unknown> = {};
        try {
          data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        } catch {
          throw new Error('서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
        if (!resp.ok) {
          throw new Error(
            typeof data.error === 'string' && data.error
              ? data.error
              : '추가 질문을 조회하지 못했습니다.'
          );
        }
        setAskHistory((prev) => [data as unknown as AskAnswer, ...prev]);
        setFollowUpInput('');
      } catch (err: unknown) {
        setFollowUpError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      } finally {
        setFollowUpLoading(false);
      }
    };

    const handleAskFollowUp = async (e: React.FormEvent) => {
      e.preventDefault();
      await submitFollowUpQuestion(followUpInput);
    };

    const showSection = (id: StudyAreaId) => {
      if (!result.selectedAreas.includes(id)) return false;
      return activeTab === 'all' || activeTab === id;
    };

    const availableAreaMeta = useMemo(
      () => STUDY_AREAS.filter((a) => result.selectedAreas.includes(a.id)),
      [result.selectedAreas]
    );

    const chartRows = useMemo(
      () =>
        (result.stats?.passRates ?? []).map((row) => ({
          year: row.year,
          written: parsePercentNumber(row.writtenRate),
          practical: parsePercentNumber(row.practicalRate),
          writtenRaw: row.writtenRate,
          practicalRaw: row.practicalRate,
        })),
      [result.stats?.passRates]
    );
    const hasChartablePassRates = chartRows.some(
      (r) => r.written !== null || r.practical !== null
    );

    const quickFollowUpQuestions = [
      '올해 최신 원서접수 및 시험 일정은?',
      '비전공자 응시자격 맞추는 가장 빠른 방법은?',
      '독학 vs 인강 추천 조합과 평균 준비 기간은?',
      '합격 후 실제 취업 우대·법정 선임 혜택은?',
    ];

    const renderPendingOrFailedBanner = (areaId: StudyAreaId, title: string) => {
      if (failedAreas.includes(areaId)) {
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-2.5 text-amber-900">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <div className="text-sm font-bold">{title} 영역 일시 지연</div>
                <p className="text-xs text-amber-800 mt-0.5">
                  네트워크 또는 모델 응답 지연으로 이 영역만 누락되었습니다. 다른 영역은 유지되며 이 영역만 재조회할 수 있습니다.
                </p>
              </div>
            </div>
            {onRetryAreas && (
              <button
                type="button"
                onClick={() => onRetryAreas([areaId])}
                className="px-3.5 py-2 text-xs font-semibold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                이 영역만 다시 조회
              </button>
            )}
          </div>
        );
      }

      if (pendingAreas.includes(areaId)) {
        return (
          <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-blue-700 animate-spin" />
                <span className="text-sm font-bold text-slate-800">{title} 정리 중...</span>
              </div>
              <span className="text-xs text-slate-400">잠시 후 자동 표시됩니다</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
              <div className="h-20 bg-slate-100 rounded-lg" />
              <div className="h-20 bg-slate-100 rounded-lg" />
            </div>
          </div>
        );
      }

      return null;
    };

    return (
      <section id="report-section" className="space-y-8">
        {/* Report Header & Official Overview */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 print-reset">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 pb-6 border-b border-slate-200">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{result.overview.certType}</span>
                <span aria-hidden="true">·</span>
                <span>{result.overview.officialOrganizer}</span>
                <span aria-hidden="true">·</span>
                <span>수험 수준: {result.learnerLevel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">조회일 {result.researchedAt}</span>
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                {result.certName} 맞춤 수험 분석 리포트
              </h2>
              <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
                한국 공식 시행처 및 수험 데이터를 교차 검증하여 선택한 {result.selectedAreas.length}개 영역을 정리했습니다.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 no-print">
              {result.overview.officialPortalUrl && (
                <a
                  href={result.overview.officialPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>공식 시험처</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                title="리포트 요약 텍스트 복사"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700 font-semibold">복사됨</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>텍스트 복사</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                title="인쇄 또는 PDF로 저장"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>인쇄·PDF</span>
              </button>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? '재조회 중...' : '최신 재조회'}</span>
              </button>
              <button
                type="button"
                onClick={onToggleSave}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isSaved
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-blue-700 text-white hover:bg-blue-800'
                }`}
              >
                {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                <span>{isSaved ? '보관됨' : '보관함에 저장'}</span>
              </button>
            </div>
          </div>

          {result.mode === 'keyless' && (
            <div
              className={`mt-5 rounded-lg border px-4 py-3 text-xs leading-relaxed flex items-start gap-2.5 ${
                result.fallbackReason
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-blue-50/70 border-blue-200 text-blue-900'
              }`}
            >
              <AlertCircle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  result.fallbackReason ? 'text-amber-700' : 'text-blue-700'
                }`}
              />
              <div className="space-y-0.5">
                {result.fallbackReason ? (
                  <>
                    <div className="font-semibold">
                      Gemini API 키 오류/제한으로 API 키 없는 공식·위키 실시간 조회 모드로 자동 전환했습니다
                    </div>
                    <p className="opacity-90">{result.fallbackReason}</p>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">
                      무키 공식자료·위키 실시간 조회 모드 (API 키 미사용)
                    </div>
                    <p className="opacity-90">
                      API 키 없이 한국어 위키백과와 공식 시험처·서점·무료 CBT 원문 링크 기준으로 즉시 정리되었습니다.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Essential Fact Strip (4 columns) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-6">
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">최신 시험 일정</div>
              <p className="text-sm text-slate-900 leading-relaxed">{result.overview.examSchedule2026}</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">응시 자격 요건</div>
              <p className="text-sm text-slate-900 leading-relaxed">{result.overview.eligibility}</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">검정료 · 응시료</div>
              <p className="text-sm text-slate-900 leading-relaxed font-mono-num">{result.overview.feeInfo}</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">2025~2026 최신 개정·변경사항</div>
              <p className="text-sm text-slate-900 leading-relaxed">{result.overview.latestChanges}</p>
            </div>
          </div>
        </div>

        {/* Area Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-print">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            선택 영역 전체 보기 ({availableAreaMeta.length})
          </button>
          {availableAreaMeta.map((area) => {
            const isPending = pendingAreas.includes(area.id);
            return (
              <button
                key={area.id}
                type="button"
                onClick={() => setActiveTab(area.id)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === area.id
                    ? 'bg-blue-700 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{area.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* 1. 핵심 개념 & 출제기준 */}
        {showSection('concepts') &&
          (result.concepts ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">01. 핵심 개념 및 출제기준</h3>
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  총 {result.concepts.subjects?.length ?? 0}개 과목 분석
                </span>
              </div>

              {result.concepts.studyOrderTip && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-semibold text-slate-700 mb-1">추천 학습 순서 및 공략 전략</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{result.concepts.studyOrderTip}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {(result.concepts.subjects ?? []).map((subj, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-lg p-5 space-y-3 bg-white">
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="font-bold text-base text-slate-900">{subj.name}</h4>
                      <span className="text-xs font-mono-num text-blue-700 font-medium whitespace-nowrap shrink-0">
                        {subj.weight}
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {(subj.keyTopics ?? []).map((topic, tIdx) => (
                        <li key={tIdx} className="flex items-start gap-2">
                          <span className="text-slate-400 mt-1 text-xs">•</span>
                          <span>{topic}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-800">암기·출제 포인트: </span>
                      {subj.memorizationTips}
                    </div>
                  </div>
                ))}
              </div>

              {(result.concepts.coreTakeaways ?? []).length > 0 && (
                <div className="pt-2 space-y-2">
                  <h4 className="text-sm font-bold text-slate-900">반드시 챙겨야 할 최빈출 핵심 포인트</h4>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {result.concepts.coreTakeaways.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 p-3 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            renderPendingOrFailedBanner('concepts', '01. 핵심 개념 및 출제기준')
          ))}

        {/* 2. 기출문제 & 출제경향 */}
        {showSection('past_exams') &&
          (result.past_exams ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <FileQuestion className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">02. 기출문제 출처 및 최신 출제경향</h3>
                </div>
                {(result.past_exams.sampleQuestions ?? []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleAllAnswers(result.past_exams?.sampleQuestions?.length ?? 0)}
                    className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap no-print"
                  >
                    전체 정답 펼치기·접기
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">최신 출제경향 및 난이도 변화</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{result.past_exams.recentTrend}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">과년도 기출 반복 비중 분석</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{result.past_exams.repeatRateNote}</p>
                </div>
              </div>

              {(result.past_exams.cbtSources ?? []).length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-900">공식 기출문제 · 무료 CBT 풀이 사이트</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {result.past_exams.cbtSources.map((src, idx) => (
                      <a
                        key={idx}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group border border-slate-200 hover:border-blue-500 rounded-lg p-4 transition-colors block"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-semibold text-sm text-slate-900 group-hover:text-blue-700">
                            {src.name}
                          </span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-700 shrink-0" />
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{src.description}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {(result.past_exams.sampleQuestions ?? []).length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      대표 출제유형 실전 확인 문제 <span className="text-xs font-normal text-slate-500">(보기를 클릭해 바로 풀어보세요)</span>
                    </h4>
                  </div>
                  <div className="space-y-4">
                    {result.past_exams.sampleQuestions.map((q, idx) => {
                      const isOpen = !!revealedAnswers[idx];
                      const chosenIdx = selectedQuizChoices[idx];
                      const hasChosen = chosenIdx !== undefined;
                      const chosenCorrect =
                        hasChosen && q.choices?.[chosenIdx]
                          ? isChoiceMatchingAnswer(q.choices[chosenIdx], chosenIdx, q.answer)
                          : false;

                      return (
                        <div key={idx} className="border border-slate-200 rounded-lg p-5 space-y-3">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span>{q.yearRound}</span>
                            <span className="font-mono-num">문항 {idx + 1}</span>
                          </div>
                          <p className="text-sm font-medium text-slate-900 leading-relaxed">{q.question}</p>
                          {(q.choices ?? []).length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                              {q.choices.map((ch, cIdx) => {
                                const isPicked = chosenIdx === cIdx;
                                const isRightChoice = isChoiceMatchingAnswer(ch, cIdx, q.answer);
                                let btnStyle = 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100';
                                if (hasChosen) {
                                  if (isRightChoice) {
                                    btnStyle = 'bg-emerald-50 border-emerald-500 text-emerald-900 font-medium';
                                  } else if (isPicked) {
                                    btnStyle = 'bg-red-50 border-red-400 text-red-900';
                                  } else {
                                    btnStyle = 'bg-slate-50 border-slate-200 text-slate-500';
                                  }
                                }
                                return (
                                  <button
                                    key={cIdx}
                                    type="button"
                                    onClick={() => handleSelectQuizChoice(idx, cIdx)}
                                    className={`text-left px-3.5 py-2.5 rounded-md border transition-colors ${btnStyle}`}
                                  >
                                    {ch}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => toggleAnswer(idx)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors no-print"
                            >
                              <span>{isOpen ? '정답 및 해설 숨기기' : '정답 및 해설 확인'}</span>
                              {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            {hasChosen && (
                              <span
                                className={`text-xs font-semibold ${
                                  chosenCorrect ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {chosenCorrect ? '정답입니다!' : '오답입니다. 아래 해설을 확인하세요.'}
                              </span>
                            )}
                          </div>
                          {isOpen && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5 text-sm">
                              <div className="font-bold text-emerald-800">정답: {q.answer}</div>
                              <p className="text-slate-700 leading-relaxed">{q.explanation}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            renderPendingOrFailedBanner('past_exams', '02. 기출문제 출처 및 최신 출제경향')
          ))}

        {/* 3. 추천 인강 · 강사 분석 */}
        {showSection('lectures') &&
          (result.lectures ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <GraduationCap className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">03. 추천 인강 · 강사 상세 분석 (사용 교재·합격률 팩트체크)</h3>
                </div>
              </div>

              {result.lectures.selectionCriteria && (
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 leading-relaxed">
                  <span className="font-semibold text-slate-900">인강 선택 기준: </span>
                  {result.lectures.selectionCriteria}
                </p>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {(result.lectures.instructors ?? []).map((inst, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-lg p-5 space-y-4 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 mb-0.5">{inst.platform}</div>
                          <h4 className="text-lg font-bold text-slate-900">
                            {inst.name} <span className="text-sm font-medium text-slate-600">· {inst.courseName}</span>
                          </h4>
                        </div>
                        {inst.officialUrl && (
                          <a
                            href={inst.officialUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <span>공식 강좌</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="bg-slate-50 rounded-lg p-3.5 space-y-2 text-sm">
                        <div>
                          <span className="text-xs font-semibold text-slate-500 block">사용 교재</span>
                          <span className="font-semibold text-slate-900">{inst.textbookUsed}</span>
                          {inst.textbookPublisher && (
                            <span className="text-slate-600 text-xs"> ({inst.textbookPublisher})</span>
                          )}
                        </div>
                        <div className="pt-1.5 border-t border-slate-200">
                          <span className="text-xs font-semibold text-slate-500 block">합격률 검증 정보</span>
                          <span className="text-slate-800 text-xs leading-relaxed">{inst.passRateInfo}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-500 mb-1">강의 스타일 및 특징</div>
                        <p className="text-sm text-slate-700 leading-relaxed">{inst.teachingStyle}</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="font-semibold text-emerald-800">강점</div>
                          <ul className="space-y-1 text-slate-700">
                            {(inst.pros ?? []).map((p, pIdx) => (
                              <li key={pIdx}>+ {p}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-1">
                          <div className="font-semibold text-amber-800">수강 전 참고사항</div>
                          <ul className="space-y-1 text-slate-700">
                            {(inst.cautions ?? []).map((c, cIdx) => (
                              <li key={cIdx}>- {c}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">추천 대상: </span>
                      {inst.bestFor}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            renderPendingOrFailedBanner('lectures', '03. 추천 인강 · 강사 상세 분석')
          ))}

        {/* 4. 문제집 · 교재 상세 비교 */}
        {showSection('workbooks') &&
          (result.workbooks ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">04. 문제집 · 수험서 특징 심층 비교</h3>
                </div>
              </div>

              {result.workbooks.buyingGuide && (
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 leading-relaxed">
                  <span className="font-semibold text-slate-900">교재 선택 가이드: </span>
                  {result.workbooks.buyingGuide}
                </p>
              )}

              <div className="space-y-4">
                {(result.workbooks.books ?? []).map((book, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-lg p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500">
                          {book.publisher} · {book.editionInfo}
                        </div>
                        <h4 className="text-lg font-bold text-slate-900">{book.title}</h4>
                      </div>
                      <div className="text-xs font-mono-num font-semibold text-blue-800 bg-blue-50 px-3 py-1.5 rounded-md whitespace-nowrap self-start">
                        {book.conceptVsProblemRatio}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3.5 rounded-lg text-sm text-slate-800 leading-relaxed">
                      <span className="font-bold text-slate-900">이 책의 결정적 특징: </span>
                      {book.keyCharacteristic}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-emerald-800">장점</div>
                        <ul className="space-y-1 text-slate-700 text-xs leading-relaxed">
                          {(book.pros ?? []).map((p, pIdx) => (
                            <li key={pIdx} className="flex items-start gap-1.5">
                              <span className="text-emerald-700 font-bold">+</span>
                              <span>{p}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-amber-800">단점 및 보완 필요사항</div>
                        <ul className="space-y-1 text-slate-700 text-xs leading-relaxed">
                          {(book.cons ?? []).map((c, cIdx) => (
                            <li key={cIdx} className="flex items-start gap-1.5">
                              <span className="text-amber-700 font-bold">-</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">추천 수험생: </span>
                      {book.bestFor}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            renderPendingOrFailedBanner('workbooks', '04. 문제집 · 수험서 특징 심층 비교')
          ))}

        {/* 5. 면접 · 구술 · 실무 Q&A */}
        {showSection('interview') &&
          (result.interview ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">05. 면접 · 구술 · 직무 검증 Q&A</h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    {result.interview.hasOfficialInterview ? '공식 시험 내 면접/구술 포함' : '실기·취업 직무 면접 대비'}
                  </span>
                  {(result.interview.qaList ?? []).length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleAllInterviews(result.interview?.qaList?.length ?? 0)}
                      className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap no-print"
                    >
                      모두 펼치기·접기
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 leading-relaxed">
                {result.interview.interviewFormatNote}
              </p>

              <div className="space-y-3">
                {(result.interview.qaList ?? []).map((qa, idx) => {
                  const isOpen = !!revealedInterviews[idx];
                  return (
                    <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleInterview(idx)}
                        className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                      >
                        <div className="space-y-1">
                          <span className="text-xs text-slate-500 block">{qa.category}</span>
                          <span className="text-sm font-bold text-slate-900 block">Q. {qa.question}</span>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-3 bg-slate-50/50">
                          {(qa.keyPoints ?? []).length > 0 && (
                            <div className="text-xs text-slate-600">
                              <span className="font-semibold text-slate-900">핵심 키워드: </span>
                              {qa.keyPoints.join(' · ')}
                            </div>
                          )}
                          <div className="text-sm text-slate-800 leading-relaxed bg-white border border-slate-200 rounded-lg p-4">
                            <span className="text-xs font-bold text-blue-700 block mb-1">모범 답변 구조</span>
                            {qa.modelAnswer}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            renderPendingOrFailedBanner('interview', '05. 면접 · 구술 · 직무 검증 Q&A')
          ))}

        {/* 6. 합격률 · 경쟁률 · 취업률 통계 */}
        {showSection('stats') &&
          (result.stats ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 cv-auto print-reset">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-5 h-5 text-blue-700 shrink-0" />
                  <h3 className="text-xl font-bold text-slate-900">06. 시험 합격률 · 경쟁률 · 취업률 통계</h3>
                </div>
              </div>

              {(result.stats.passRates ?? []).length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-7 overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="bg-slate-50 text-xs text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4 font-semibold">연도</th>
                          <th className="py-3 px-4 font-semibold text-right">필기/1차 합격률</th>
                          <th className="py-3 px-4 font-semibold text-right">실기/2차 합격률</th>
                          <th className="py-3 px-4 font-semibold">응시 규모·특이사항</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {result.stats.passRates.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                              {row.year}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-right text-blue-700 font-medium whitespace-nowrap">
                              {row.writtenRate}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-right text-emerald-700 font-medium whitespace-nowrap">
                              {row.practicalRate}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600">{row.applicantsNote}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {hasChartablePassRates && (
                    <div className="lg:col-span-5 border border-slate-200 rounded-lg p-5 space-y-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">연도별 합격률 추이 (%)</span>
                        <div className="flex items-center gap-3 text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 bg-blue-600 inline-block rounded-xs" /> 필기/1차
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 bg-emerald-600 inline-block rounded-xs" /> 실기/2차
                          </span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {chartRows.map((row, idx) => (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-mono-num">
                              <span className="font-semibold text-slate-800">{row.year}</span>
                              <span className="text-slate-500">
                                필기 {row.writtenRaw} / 실기 {row.practicalRaw}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {row.written !== null && (
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-600 rounded-full"
                                    style={{ width: `${Math.min(100, Math.max(2, row.written))}%` }}
                                  />
                                </div>
                              )}
                              {row.practical !== null && (
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-600 rounded-full"
                                    style={{ width: `${Math.min(100, Math.max(2, row.practical))}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">경쟁률 · 평가방식 · 체감 난이도</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{result.stats.competitionContext}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">취업률 및 채용 시장 수요 현황</div>
                  <p className="text-sm text-slate-700 leading-relaxed">{result.stats.employmentRateInfo}</p>
                </div>
              </div>

              {(result.stats.salaryAndBenefits ?? []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-slate-900">취득 후 실제 혜택 · 가산점 · 법정 선임 활용</h4>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {result.stats.salaryAndBenefits.map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 p-3 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            renderPendingOrFailedBanner('stats', '06. 시험 합격률 · 경쟁률 · 취업률 통계')
          ))}

        {/* 추가 궁금한 점 실시간 팩트체크 검색 */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-5 no-print">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-blue-700" />
              <h3 className="text-lg font-bold text-slate-900">
                {result.certName} 관련 추가 팩트체크 질문하기
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              특정 회차 시험일정, 두 교재 간 상세 비교, 비전공자 응시자격 조건 등 더 궁금한 점을 바로 물어보세요.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickFollowUpQuestions.map((presetQ) => (
              <button
                key={presetQ}
                type="button"
                disabled={followUpLoading}
                onClick={() => {
                  setFollowUpInput(presetQ);
                  submitFollowUpQuestion(presetQ);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {presetQ}
              </button>
            ))}
          </div>

          <form onSubmit={handleAskFollowUp} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                placeholder={`예: ${result.certName} 비전공자 응시자격 맞추는 가장 빠른 방법은?`}
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={followUpLoading || !followUpInput.trim()}
              className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {followUpLoading ? '검색 확인 중...' : '최신 자료로 확인'}
            </button>
          </form>

          {followUpError && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{followUpError}</span>
            </div>
          )}

          {askHistory.length > 0 && (
            <div className="space-y-4 pt-2">
              {askHistory.map((item, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm text-slate-900">Q. {item.question}</div>
                    <span className="text-xs font-mono-num text-slate-500">{item.askedAt}</span>
                  </div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {item.answer}
                  </div>
                  {item.sources.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-3 text-xs">
                      <span className="text-slate-500 font-medium">참고 출처:</span>
                      {item.sources.map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          <span className="truncate max-w-[220px]">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 검증 출처 및 주의사항 푸터 */}
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-6 space-y-4 print-reset">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900">검색 검증 안내 및 실제 참고 출처</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{result.verificationNote}</p>
          </div>
          {result.sources && result.sources.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {result.sources.map((src, idx) => (
                <a
                  key={idx}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 bg-white border border-slate-200 hover:border-blue-500 rounded-lg px-3.5 py-2.5 text-xs text-slate-700 hover:text-blue-700 transition-colors"
                >
                  <span className="truncate font-medium">{src.title}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              원서접수 및 최종 공고는 반드시 위 공식 시험처 웹사이트에서 직접 한 번 더 확인해 주세요.
            </p>
          )}
        </div>
      </section>
    );
  }
);
