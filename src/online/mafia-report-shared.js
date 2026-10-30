export const MAFIA_REPORT_CATEGORIES = Object.freeze([
  { id: 'harassment', label: 'إساءة أو مضايقة' }, { id: 'cheating', label: 'غش أو تواطؤ' },
  { id: 'disruption', label: 'تعطيل اللعب' }, { id: 'inappropriate', label: 'محتوى غير مناسب' },
  { id: 'other', label: 'سبب آخر' },
].map(value => Object.freeze(value)));
export const mafiaReportCategoryLabel = id => MAFIA_REPORT_CATEGORIES.find(value => value.id === id)?.label || 'سبب آخر';
export const MAFIA_REPORT_STATUS_LABELS = Object.freeze({ queued: 'بانتظار المراجعة', reviewing: 'قيد المراجعة', reviewed: 'تمت المراجعة' });
