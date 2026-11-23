import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, X, BookMarked, ArrowRight, Search } from 'lucide-react';
import type { SavedCertReport } from '../types/cert';

interface SavedReportsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  savedReports: SavedCertReport[];
  onLoadReport: (report: SavedCertReport) => void;
  onDeleteReport: (id: string) => void;
  onClearAll?: () => void;
}

export const SavedReportsDrawer: React.FC<SavedReportsDrawerProps> = React.memo(
  ({ isOpen, onClose, savedReports, onLoadReport, onDeleteReport, onClearAll }) => {
    const [filterText, setFilterText] = useState('');
    const [confirmClearAll, setConfirmClearAll] = useState(false);

    useEffect(() => {
      if (!isOpen) {
        setConfirmClearAll(false);
        return;
      }
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [isOpen, onClose]);

    const filteredReports = useMemo(() => {
      const q = filterText.trim().toLowerCase();
      if (!q) return savedReports;
      return savedReports.filter(
        (item) =>
          item.certName.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.result.learnerLevel.toLowerCase().includes(q)
      );
    }, [savedReports, filterText]);

    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 no-print"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="내 학습 보관함"
      >
        <div
          className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-blue-700" />
              <h2 className="text-lg font-bold text-slate-900">
                내 학습 보관함{' '}
                <span className="text-sm font-normal text-slate-500 font-mono-num">
                  ({savedReports.length})
                </span>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="보관함 닫기 (ESC)"
              title="닫기 (ESC)"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {savedReports.length > 0 && (
            <div className="px-6 py-3 border-b border-slate-100 space-y-2.5 bg-slate-50/70">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="보관된 자격증 이름 검색..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText('')}
                    aria-label="검색어 지우기"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {onClearAll && savedReports.length > 1 && (
                <div className="flex items-center justify-end">
                  {!confirmClearAll ? (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="text-xs text-slate-500 hover:text-red-600 transition-colors"
                    >
                      전체 비우기
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-red-700 font-medium">모두 삭제할까요?</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClearAll();
                          setConfirmClearAll(false);
                        }}
                        className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                      >
                        취소
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {savedReports.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <p className="text-sm font-medium text-slate-700">저장된 자격증 리포트가 아직 없습니다.</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  원하는 자격증과 영역을 조회한 뒤 &apos;보관함에 저장&apos; 버튼을 누르면 언제든 0초 만에 다시 열어볼 수 있습니다.
                </p>
              </div>
            ) : filteredReports.length === 0 ? (
              <div className="text-center py-12 text-xs text-slate-500">
                &apos;{filterText}&apos;와 일치하는 보관 리포트가 없습니다.
              </div>
            ) : (
              filteredReports.map((item) => (
                <div
                  key={item.id}
                  className="border border-slate-200 rounded-lg p-4 space-y-3 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500">
                        {item.category} · <span className="font-mono-num">{item.savedAt}</span>
                      </div>
                      <h3 className="font-bold text-base text-slate-900">{item.certName}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteReport(item.id)}
                      aria-label={`${item.certName} 삭제`}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-600">
                    포함 영역: {item.result.selectedAreas.length}개 · {item.result.learnerLevel}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onLoadReport(item);
                      onClose();
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <span>저장된 리포트 열기</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
);
