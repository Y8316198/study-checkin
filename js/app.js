/**
 * app.js — 控制层
 * 连接 storage(数据)与 ui(渲染),处理路由、事件、表单、业务算法。
 * 通过 window.App 全局命名空间暴露。
 */
window.App = (function () {
  'use strict';

  var Storage = null;
  var UI = null;

  var VIEWS = ['today', 'calendar', 'stats', 'settings'];
  var currentView = 'today';

  // ============ 初始化 ============

  function init() {
    Storage = window.Storage;
    UI = window.UI;

    // 持久化降级提示
    UI.renderPersistenceWarning();

    // 绑定全局事件(导航、视图内事件委托、模态框)
    bindNav();
    bindGlobalClick();
    bindKeyboard();

    // 初始路由
    var hash = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(hash) === -1) hash = 'today';
    navigate(hash, true);

    console.log('[App] 初始化完成,数据持久化:', Storage.isPersistent() ? '可用' : '不可用(内存模式)');
  }

  // ============ 路由 ============

  function navigate(view, skipHash) {
    if (VIEWS.indexOf(view) === -1) view = 'today';
    currentView = view;
    if (!skipHash) {
      try { location.hash = view; } catch (e) {}
    }

    // 切换导航高亮
    var navItems = document.querySelectorAll('[data-nav]');
    Array.prototype.forEach.call(navItems, function (el) {
      el.classList.toggle('active', el.getAttribute('data-nav') === view);
    });

    // 切换视图容器显隐
    VIEWS.forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('active', v === view);
    });

    // 渲染对应视图
    renderCurrentView();

    // 滚动到顶
    var main = document.querySelector('.main-content');
    if (main) main.scrollTop = 0;
  }

  function renderCurrentView() {
    switch (currentView) {
      case 'today': UI.renderTodayView(); break;
      case 'calendar': UI.renderCalendarView(); break;
      case 'stats': UI.renderStatsView(); break;
      case 'settings': UI.renderSettingsView(); break;
    }
  }

  function bindNav() {
    // 监听 hash 变化(浏览器前进后退)
    window.addEventListener('hashchange', function () {
      var hash = (location.hash || '').replace('#', '');
      if (VIEWS.indexOf(hash) !== -1 && hash !== currentView) {
        navigate(hash, true);
      }
    });
  }

  // ============ 全局事件委托 ============

  function bindGlobalClick() {
    // 用事件委托处理所有 data-action 点击,避免重复绑定
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');

      // 模态框相关优先处理(无论当前视图)
      switch (action) {
        case 'close-modal':
          UI.closeModal();
          return;
        case 'close-modal-bg':
          // 仅当点击的是遮罩本身时关闭
          if (target.classList.contains('modal-overlay')) UI.closeModal();
          return;
        case 'confirm-yes':
          // confirm-yes 在 openConfirm 中已单独绑定 onclick,这里兜底
          return;
      }

      // 导航
      if (action === 'navigate') {
        var view = target.getAttribute('data-nav');
        if (view) { UI.closeModal(); navigate(view); }
        return;
      }

      // 按当前视图分发
      switch (currentView) {
        case 'today': handleTodayAction(action, target, e); break;
        case 'calendar': handleCalendarAction(action, target, e); break;
        case 'stats': handleStatsAction(action, target, e); break;
        case 'settings': handleSettingsAction(action, target, e); break;
      }
    });

    // 模态框内的颜色/图标选择、表单提交等需要 change/input 事件
    document.addEventListener('change', function (e) {
      var target = e.target;
      if (target.id === 'import-file-input') {
        handleImportFile(target);
      }
    });
  }

  // ============ 今日视图事件 ============

  function handleTodayAction(action, target, e) {
    switch (action) {
      case 'add-record':
        UI.openRecordModal({});
        break;
      case 'quick-checkin':
        handleQuickCheckin();
        break;
      case 'edit-record':
        UI.openRecordModal({ id: target.getAttribute('data-id') });
        break;
      case 'delete-record':
        handleDeleteRecord(target.getAttribute('data-id'));
        break;
      case 'submit-record':
        handleSubmitRecord(target.getAttribute('data-id'));
        break;
    }
  }

  function handleQuickCheckin() {
    var subjects = Storage.getSubjects();
    var defaultSubj = subjects.length ? subjects[0].id : null;
    var today = Storage.dateUtils.todayKey();
    var rec = Storage.addRecord({
      date: today,
      title: '快速打卡',
      subjectId: defaultSubj,
      duration: 30,
      notes: ''
    });
    UI.toast('已快速打卡 30 分钟', 'success');
    UI.renderTodayView();
  }

  function handleSubmitRecord(id) {
    var title = (document.getElementById('form-title').value || '').trim();
    var date = document.getElementById('form-date').value;
    var subjectId = document.getElementById('form-subject').value;
    var duration = parseInt(document.getElementById('form-duration').value, 10);
    var notes = (document.getElementById('form-notes').value || '').trim();

    // 校验
    if (!title) {
      UI.toast('请填写学习内容', 'error');
      document.getElementById('form-title').focus();
      return;
    }
    if (!date) {
      UI.toast('请选择学习日期', 'error');
      return;
    }
    if (!duration || duration <= 0) {
      UI.toast('学习时长需大于 0', 'error');
      document.getElementById('form-duration').focus();
      return;
    }
    if (duration > 1440) {
      UI.toast('学习时长不能超过 24 小时', 'error');
      return;
    }

    var payload = { title: title, date: date, subjectId: subjectId, duration: duration, notes: notes };
    if (id) {
      Storage.updateRecord(id, payload);
      UI.toast('记录已更新', 'success');
    } else {
      Storage.addRecord(payload);
      UI.toast('记录已添加', 'success');
    }
    UI.closeModal();
    renderCurrentView();
  }

  function handleDeleteRecord(id) {
    var record = Storage.getRecord(id);
    if (!record) return;
    UI.openConfirm('确定删除「' + record.title + '」这条记录吗?删除后无法恢复。', function () {
      Storage.deleteRecord(id);
      UI.toast('记录已删除', 'success');
      renderCurrentView();
    }, { danger: true, icon: '🗑️' });
  }

  // ============ 日历视图事件 ============

  function handleCalendarAction(action, target, e) {
    switch (action) {
      case 'cal-prev':
        UI.calendarPrev();
        break;
      case 'cal-next':
        UI.calendarNext();
        break;
      case 'cal-today':
        UI.calendarGoToday();
        break;
      case 'cal-select-date':
        var date = target.getAttribute('data-date');
        if (date) {
          // 高亮选中
          var cells = document.querySelectorAll('.cal-cell');
          Array.prototype.forEach.call(cells, function (c) { c.classList.remove('selected'); });
          target.classList.add('selected');
          UI.renderCalendarDetail(date);
        }
        break;
      case 'add-record-date':
        var d = target.getAttribute('data-date');
        UI.openRecordModal({ date: d });
        break;
      case 'edit-record':
        UI.openRecordModal({ id: target.getAttribute('data-id') });
        break;
      case 'delete-record':
        handleDeleteRecord(target.getAttribute('data-id'));
        break;
      case 'submit-record':
        handleSubmitRecord(target.getAttribute('data-id'));
        break;
    }
  }

  // ============ 统计视图事件 ============

  function handleStatsAction(action, target, e) {
    switch (action) {
      case 'stats-range':
        var range = target.getAttribute('data-range');
        UI.setStatsRange(range);
        UI.renderStatsView();
        break;
    }
  }

  // ============ 设置视图事件 ============

  function handleSettingsAction(action, target, e) {
    switch (action) {
      case 'add-subject':
        UI.openSubjectModal();
        break;
      case 'edit-subject':
        UI.openSubjectModal(target.getAttribute('data-id'));
        break;
      case 'delete-subject':
        handleDeleteSubject(target.getAttribute('data-id'));
        break;
      case 'submit-subject':
        handleSubmitSubject(target.getAttribute('data-id'));
        break;
      case 'pick-color':
        handlePickColor(target);
        break;
      case 'pick-icon':
        handlePickIcon(target);
        break;
      case 'save-goal':
        handleSaveGoal();
        break;
      case 'export-data':
        handleExport();
        break;
      case 'import-data':
        document.getElementById('import-file-input').click();
        break;
      case 'clear-data':
        handleClearData();
        break;
    }
  }

  // ---- 科目表单 ----

  function handlePickColor(target) {
    var overlay = document.querySelector('#modal-root .modal-overlay');
    if (!overlay) return;
    var dots = document.querySelectorAll('.color-dot');
    Array.prototype.forEach.call(dots, function (d) { d.classList.remove('selected'); });
    target.classList.add('selected');
    overlay._pickedColor = target.getAttribute('data-color');
  }

  function handlePickIcon(target) {
    var overlay = document.querySelector('#modal-root .modal-overlay');
    if (!overlay) return;
    var dots = document.querySelectorAll('.icon-dot');
    Array.prototype.forEach.call(dots, function (d) { d.classList.remove('selected'); });
    target.classList.add('selected');
    overlay._pickedIcon = target.getAttribute('data-icon');
  }

  function handleSubmitSubject(id) {
    var name = (document.getElementById('subj-name').value || '').trim();
    if (!name) {
      UI.toast('请填写科目名称', 'error');
      document.getElementById('subj-name').focus();
      return;
    }
    var overlay = document.querySelector('#modal-root .modal-overlay');
    var color = overlay._pickedColor || '#4CAF50';
    var icon = overlay._pickedIcon || '';

    if (id) {
      Storage.updateSubject(id, { name: name, color: color, icon: icon });
      UI.toast('科目已更新', 'success');
    } else {
      Storage.addSubject({ name: name, color: color, icon: icon });
      UI.toast('科目已创建', 'success');
    }
    UI.closeModal();
    UI.renderSettingsView();
  }

  function handleDeleteSubject(id) {
    var subj = Storage.getSubject(id);
    if (!subj) return;
    // 统计关联记录数
    var relatedRecords = Storage.getRecords({ subjectId: id });
    var msg = '确定删除科目「' + subj.name + '」吗?';
    if (relatedRecords.length > 0) {
      msg += '该科目下有 ' + relatedRecords.length + ' 条记录,删除后这些记录将变为「未分类」(不会被删除)。';
    }
    UI.openConfirm(msg, function () {
      Storage.deleteSubject(id);
      UI.toast('科目已删除', 'success');
      UI.renderSettingsView();
    }, { danger: true, icon: '🗑️' });
  }

  // ---- 每日目标 ----

  function handleSaveGoal() {
    var input = document.getElementById('setting-goal');
    var val = parseInt(input.value, 10);
    if (!val || val < 10) {
      UI.toast('目标时长至少 10 分钟', 'error');
      return;
    }
    if (val > 1440) {
      UI.toast('目标时长不能超过 24 小时', 'error');
      return;
    }
    Storage.updateSettings({ dailyGoalMinutes: val });
    UI.toast('每日目标已保存', 'success');
  }

  // ============ 数据管理 ============

  function handleExport() {
    try {
      var json = Storage.exportData();
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var today = Storage.dateUtils.todayKey();
      a.href = url;
      a.download = 'study-backup-' + today + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      UI.toast('数据已导出', 'success');
    } catch (e) {
      UI.toast('导出失败:' + e.message, 'error');
    }
  }

  function handleImportFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var text = ev.target.result;
      // 先校验,不直接覆盖
      var result = Storage.importData(text);
      if (result.success) {
        UI.toast('数据导入成功', 'success');
        UI.renderSettingsView();
        renderCurrentView();
      } else {
        UI.toast('导入失败:' + result.error, 'error');
      }
      input.value = ''; // 重置,以便再次导入同文件
    };
    reader.onerror = function () {
      UI.toast('文件读取失败', 'error');
      input.value = '';
    };
    reader.readAsText(file);
  }

  function handleClearData() {
    UI.openConfirm('⚠️ 此操作将清空所有学习记录、科目和设置,且无法恢复!\n\n建议先导出备份。确定继续吗?', function () {
      // 二次确认
      UI.openConfirm('再次确认:真的要清空全部数据吗?', function () {
        Storage.clearAll();
        UI.toast('所有数据已清空', 'success');
        UI.renderSettingsView();
        navigate('today');
      }, { danger: true, icon: '❗' });
    }, { danger: true, icon: '⚠️' });
  }

  // ============ streak 算法(宽松版) ============

  /**
   * 计算连续打卡天数
   * 宽松版:若今天有打卡则从今天起算;若今天无但昨天有,则从昨天起算(白天打开 APP 不会看到 streak 归零)
   * @param {string[]} dates - 打卡日期数组 YYYY-MM-DD
   * @returns {number}
   */
  function calcStreak(dates) {
    if (!dates || !dates.length) return 0;
    var set = {};
    dates.forEach(function (d) { set[d] = true; });

    var du = Storage.dateUtils;
    var today = du.todayKey();
    var start;
    if (set[today]) {
      start = new Date(); // 今天
    } else {
      var yesterday = du.dateKey(du.addDays(new Date(), -1));
      if (set[yesterday]) {
        start = du.addDays(new Date(), -1); // 从昨天起算
      } else {
        return 0; // 今天和昨天都没打,streak 归零
      }
    }

    var streak = 0;
    var cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // 从 start 往前逐日探测,遇到空缺停止
    while (true) {
      var key = du.dateKey(cursor);
      if (set[key]) {
        streak++;
        cursor = du.addDays(cursor, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  // ============ 键盘事件 ============

  function bindKeyboard() {
    // ESC 关闭模态框
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && UI.isModalOpen()) {
        UI.closeModal();
      }
    });
  }

  // ============ 公共 API ============
  return {
    init: init,
    navigate: navigate,
    renderCurrentView: renderCurrentView,
    calcStreak: calcStreak
  };
})();

document.addEventListener('DOMContentLoaded', window.App.init);
