/*
 * 科研总览卡的两份文案：manifest 的 `text` 有就用它，组件单独打开时用这里的一份。
 */
;(function (root) {
  'use strict'

  root.OverviewCopy = {
    title: { zh: '科研总览', en: 'Research overview' },
    kicker: { zh: '近期推进与来源', en: 'Recent progress and sources' },
    refresh: { zh: '刷新', en: 'Refresh' },
    quickAdd: { zh: '快速记录', en: 'Quick note' },
    actions: { zh: '近期行动项', en: 'Recent action items' },
    actionsEmpty: { zh: '没有待处理的行动项。', en: 'No open action items.' },
    actionsMore: { zh: '还有 {n} 项没列出。', en: '{n} more not shown.' },
    meetings: { zh: '最近组会', en: 'Latest meetings' },
    meetingsEmpty: { zh: '还没有组会记录。', en: 'No meetings yet.' },
    manuscripts: { zh: '活跃稿件', en: 'Active manuscripts' },
    manuscriptsEmpty: { zh: '还没有在推进的稿件。', en: 'No manuscripts in progress.' },
    stageIdea: { zh: '构思', en: 'Idea' },
    stageExperiment: { zh: '实验', en: 'Experiment' },
    stageWriting: { zh: '写作', en: 'Writing' },
    stageInternalReview: { zh: '内审', en: 'Internal review' },
    stageSubmitted: { zh: '已投稿', en: 'Submitted' },
    stageRevision: { zh: '修回', en: 'Revision' },
    stageAccepted: { zh: '已接收', en: 'Accepted' },
    stageArchived: { zh: '阶段归档', en: 'Stage archived' },
    dueNone: { zh: '无期限', en: 'No due' },
    overdue: { zh: '已逾期', en: 'Overdue' },
    dueToday: { zh: '今天到期', en: 'Due today' },
    dateUnknown: { zh: '日期未定', en: 'No date' },
    quickDone: { zh: '完成', en: 'Done' },
    quickFailed: { zh: '更新失败，已刷新：{reason}', en: 'Update failed, refreshed: {reason}' },
    source: { zh: '来源', en: 'Source' },
    sourceTitle: { zh: '来源会议', en: 'Source meeting' },
    sourceMissing: { zh: '来源缺失', en: 'Source missing' },
    sourceTrashed: { zh: '来源已在回收站', en: 'Source in trash' },
    feedback: { zh: '讨论反馈', en: 'Feedback' },
    openQuestions: { zh: '未决问题', en: 'Open questions' },
    close: { zh: '关闭', en: 'Close' },
    actionTitle: { zh: '行动项标题', en: 'Action title' },
    actionDue: { zh: '期限（可选）', en: 'Due date (optional)' },
    create: { zh: '生成', en: 'Create' },
    cancel: { zh: '取消', en: 'Cancel' },
    titleRequired: { zh: '标题不能是空的。', en: 'The title is required.' },
    created: { zh: '已记下行动项', en: 'Action item recorded' },
    createFailed: { zh: '记录失败', en: 'Could not record it' },
    loading: { zh: '正在读取记录…', en: 'Reading records…' },
    failed: { zh: '读取失败', en: 'Records unavailable' },
    retry: { zh: '重试', en: 'Retry' }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
