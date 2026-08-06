/**
 * ui.js — 渲染层
 * 纯渲染,不直接操作数据;通过 window.Storage 读取,生成 DOM。
 * 通过 window.UI 全局命名空间暴露。
 */
window.UI = (function () {
  'use strict';

  // ============ 基础工具 ============

  /** HTML 转义(防 XSS,所有用户输入内容必经此函数) */
  function _escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 简单选择器缩写 */
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /** 将分钟转为 "1小时30分" 友好显示 */
  function formatDuration(minutes) {
    minutes = Math.max(0, Math.round(minutes || 0));
    if (minutes < 60) return minutes + '分钟';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return m > 0 ? h + '小时' + m + '分' : h + '小时';
  }

  /** 获取科目查找表 */
  function _getSubjectMap() {
    var map = {};
    Storage.getSubjects().forEach(function (s) { map[s.id] = s; });
    return map;
  }

  // ============ 视图容器获取 ============
  function _getView(name) {
    return $('#view-' + name);
  }

  // ============ 今日打卡视图 ============

  function renderTodayView() {
    var view = _getView('today');
    if (!view) return;
    var Storage = window.Storage;
    var today = Storage.dateUtils.todayKey();
    var settings = Storage.getSettings();
    var subjects = Storage.getSubjects();
    var records = Storage.getRecords({ date: today });
    var todayDuration = records.reduce(function (s, r) { return s + (r.duration || 0); }, 0);
    var goal = settings.dailyGoalMinutes || 120;
    var progress = Math.min(100, Math.round((todayDuration / goal) * 100));
    var subjMap = {};
    subjects.forEach(function (s) { subjMap[s.id] = s; });

    var html = '';

    // 顶部:日期 + 打卡状态
    html += '<div class="today-header">';
    html += '  <div class="today-date">' + _escape(Storage.dateUtils.formatDateDisplay(today)) + '</div>';
    html += '  <div class="today-status ' + (records.length > 0 ? 'is-done' : '') + '">';
    if (records.length > 0) {
      html += '✅ 今日已打卡 · ' + records.length + ' 条记录';
    } else {
      html += '💪 还未打卡,点击下方按钮记录今天的学习';
    }
    html += '  </div>';
    html += '</div>';

    // 今日目标进度条
    html += '<div class="goal-card card">';
    html += '  <div class="goal-row">';
    html += '    <span class="goal-label">今日目标</span>';
    html += '    <span class="goal-value">' + formatDuration(todayDuration) + ' / ' + formatDuration(goal) + '</span>';
    html += '  </div>';
    html += '  <div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';
    html += '  <div class="goal-progress-text">' + progress + '%</div>';
    html += '</div>';

    // 操作按钮
    html += '<div class="action-row">';
    html += '  <button class="btn btn-primary" data-action="add-record">+ 添加学习记录</button>';
    html += '  <button class="btn btn-ghost" data-action="quick-checkin">快速打卡 30 分钟</button>';
    html += '</div>';

    // 今日记录列表
    html += '<div class="section-title">今日记录</div>';
    if (records.length === 0) {
      html += '<div class="empty-state">';
      html += '  <div class="empty-icon">📝</div>';
      html += '  <div class="empty-text">今天还没有学习记录</div>';
      html += '  <div class="empty-hint">点击「添加学习记录」开始记录吧</div>';
      html += '</div>';
    } else {
      html += '<div class="record-list">';
      records.forEach(function (r) {
        html += renderRecordCard(r, subjMap);
      });
      html += '</div>';
    }

    view.innerHTML = html;
  }

  /** 渲染单条记录卡片 */
  function renderRecordCard(record, subjMap) {
    var subj = record.subjectId && subjMap[record.subjectId] ? subjMap[record.subjectId] : null;
    var html = '<div class="record-item card" data-record-id="' + _escape(record.id) + '">';
    html += '  <div class="record-main">';
    html += '    <div class="record-title">' + _escape(record.title) + '</div>';
    html += '    <div class="record-meta">';
    if (subj) {
      html += '  <span class="subject-badge" style="background:' + _escape(subj.color) + '22;color:' + _escape(subj.color) + ';border-color:' + _escape(subj.color) + '44">';
      if (subj.icon) html += _escape(subj.icon) + ' ';
      html += _escape(subj.name) + '</span>';
    } else {
      html += '  <span class="subject-badge uncategorized">未分类</span>';
    }
    html += '      <span class="record-duration">⏱ ' + formatDuration(record.duration) + '</span>';
    html += '    </div>';
    if (record.notes) {
      html += '    <div class="record-notes">' + _escape(record.notes) + '</div>';
    }
    html += '  </div>';
    html += '  <div class="record-actions">';
    html += '    <button class="icon-btn" data-action="edit-record" data-id="' + _escape(record.id) + '" title="编辑">✏️</button>';
    html += '    <button class="icon-btn danger" data-action="delete-record" data-id="' + _escape(record.id) + '" title="删除">🗑️</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  // ============ 日历视图 ============

  var calendarCursor = null; // {year, month}  month: 0-11

  function renderCalendarView() {
    var view = _getView('calendar');
    if (!view) return;
    if (!calendarCursor) {
      var now = new Date();
      calendarCursor = { year: now.getFullYear(), month: now.getMonth() };
    }
    _drawCalendar();
  }

  function _drawCalendar() {
    var view = _getView('calendar');
    var Storage = window.Storage;
    var y = calendarCursor.year;
    var m = calendarCursor.month;
    var monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    var settings = Storage.getSettings();
    var weekStart = settings.weekStart === 0 ? 0 : 1;

    // 当月范围
    var firstDay = new Date(y, m, 1);
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var firstWeekday = firstDay.getDay(); // 0=周日

    // 计算网格起始偏移(让周一或周日为第一列)
    var lead = (firstWeekday - weekStart + 7) % 7;

    // 当月有打卡的日期集合 + 科目色点
    var monthFrom = Storage.dateUtils.dateKey(firstDay);
    var monthTo = Storage.dateUtils.dateKey(new Date(y, m, daysInMonth));
    var datesWithRecords = {};
    Storage.getDatesWithRecords(monthFrom, monthTo).forEach(function (d) { datesWithRecords[d] = true; });

    var today = Storage.dateUtils.todayKey();

    // 星期表头
    var weekHeaders = weekStart === 0 ? ['日', '一', '二', '三', '四', '五', '六'] : ['一', '二', '三', '四', '五', '六', '日'];

    var html = '';
    html += '<div class="calendar-toolbar">';
    html += '  <button class="icon-btn" data-action="cal-prev" title="上月">‹</button>';
    html += '  <div class="calendar-title">' + y + '年 ' + monthNames[m] + '</div>';
    html += '  <button class="icon-btn" data-action="cal-next" title="下月">›</button>';
    html += '</div>';
    html += '<button class="btn btn-ghost cal-today-btn" data-action="cal-today">回到今天</button>';

    html += '<div class="calendar-grid">';
    weekHeaders.forEach(function (w) {
      html += '<div class="cal-weekday">' + w + '</div>';
    });

    // 前置空位
    for (var i = 0; i < lead; i++) {
      html += '<div class="cal-cell empty"></div>';
    }

    // 当月每一天
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = Storage.dateUtils.dateKey(new Date(y, m, day));
      var hasRecord = !!datesWithRecords[dateStr];
      var isToday = dateStr === today;
      var daySubjects = hasRecord ? Storage.getSubjectsByDate(dateStr) : [];
      var duration = hasRecord ? Storage.getDurationByDate(dateStr) : 0;

      html += '<div class="cal-cell' + (hasRecord ? ' has-record' : '') + (isToday ? ' is-today' : '') + '" data-date="' + dateStr + '" data-action="cal-select-date">';
      html += '  <div class="cal-day">' + day + '</div>';
      if (hasRecord) {
        html += '  <div class="cal-dots">';
        daySubjects.slice(0, 3).forEach(function (s) {
          html += '<span class="cal-dot" style="background:' + _escape(s.color) + '"></span>';
        });
        if (daySubjects.length > 3) html += '<span class="cal-dot-more">+' + (daySubjects.length - 3) + '</span>';
        html += '  </div>';
        html += '  <div class="cal-duration">' + formatDuration(duration) + '</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // .calendar-grid

    // 选中日期的记录详情(默认显示今天)
    html += '<div id="cal-detail"></div>';

    view.innerHTML = html;
  }

  /** 渲染日历选中日期的记录详情 */
  function renderCalendarDetail(date) {
    var container = $('#cal-detail');
    if (!container) return;
    var Storage = window.Storage;
    var records = Storage.getRecords({ date: date });
    var subjMap = _getSubjectMap();
    var total = records.reduce(function (s, r) { return s + (r.duration || 0); }, 0);

    var html = '<div class="cal-detail-header">';
    html += '  <span class="cal-detail-date">' + _escape(Storage.dateUtils.formatRelative(date)) + '</span>';
    if (records.length > 0) {
      html += '  <span class="cal-detail-total">共 ' + records.length + ' 条 · ' + formatDuration(total) + '</span>';
    }
    html += '</div>';

    if (records.length === 0) {
      html += '<div class="empty-state small">';
      html += '  <div class="empty-text">该日无学习记录</div>';
      html += '  <button class="btn btn-ghost btn-sm" data-action="add-record-date" data-date="' + date + '">为这天添加记录</button>';
      html += '</div>';
    } else {
      html += '<div class="record-list">';
      records.forEach(function (r) {
        html += renderRecordCard(r, subjMap);
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function calendarPrev() {
    calendarCursor.month--;
    if (calendarCursor.month < 0) {
      calendarCursor.month = 11;
      calendarCursor.year--;
    }
    _drawCalendar();
  }

  function calendarNext() {
    calendarCursor.month++;
    if (calendarCursor.month > 11) {
      calendarCursor.month = 0;
      calendarCursor.year++;
    }
    _drawCalendar();
  }

  function calendarGoToday() {
    var now = new Date();
    calendarCursor = { year: now.getFullYear(), month: now.getMonth() };
    _drawCalendar();
  }

  // ============ 统计视图 ============

  var statsRange = 'all'; // 'week' | 'month' | 'all'

  function renderStatsView() {
    var view = _getView('stats');
    if (!view) return;
    var Storage = window.Storage;
    var stats = Storage.getStats(statsRange);
    var streak = window.App ? window.App.calcStreak(stats.datesWithRecords) : 0;

    var html = '';
    // 范围切换
    html += '<div class="range-tabs">';
    html += '  <button class="range-tab ' + (statsRange === 'week' ? 'active' : '') + '" data-action="stats-range" data-range="week">本周</button>';
    html += '  <button class="range-tab ' + (statsRange === 'month' ? 'active' : '') + '" data-action="stats-range" data-range="month">本月</button>';
    html += '  <button class="range-tab ' + (statsRange === 'all' ? 'active' : '') + '" data-action="stats-range" data-range="all">累计</button>';
    html += '</div>';

    // 核心统计卡片
    html += '<div class="stat-cards">';
    html += '  <div class="stat-card card">';
    html += '    <div class="stat-icon">🔥</div>';
    html += '    <div class="stat-value">' + streak + '</div>';
    html += '    <div class="stat-label">连续打卡(天)</div>';
    html += '  </div>';
    html += '  <div class="stat-card card">';
    html += '    <div class="stat-icon">📅</div>';
    html += '    <div class="stat-value">' + stats.totalDays + '</div>';
    html += '    <div class="stat-label">累计打卡(天)</div>';
    html += '  </div>';
    html += '  <div class="stat-card card">';
    html += '    <div class="stat-icon">⏱</div>';
    html += '    <div class="stat-value">' + formatDuration(stats.totalDuration) + '</div>';
    html += '    <div class="stat-label">累计学习时长</div>';
    html += '  </div>';
    html += '  <div class="stat-card card">';
    html += '    <div class="stat-icon">📝</div>';
    html += '    <div class="stat-value">' + stats.totalRecords + '</div>';
    html += '    <div class="stat-label">学习记录(条)</div>';
    html += '  </div>';
    html += '</div>';

    // 范围时长卡片
    if (statsRange !== 'all') {
      html += '<div class="card range-card">';
      html += '  <div class="range-card-label">' + (statsRange === 'week' ? '本周' : '本月') + '学习时长</div>';
      html += '  <div class="range-card-value">' + formatDuration(stats.rangeDuration) + '</div>';
      html += '</div>';
    }

    // 近 7 天柱状图
    html += '<div class="card chart-card">';
    html += '  <div class="card-title">近 7 天学习时长</div>';
    html += '  <canvas id="chart-bar" class="chart-canvas"></canvas>';
    html += '</div>';

    // 科目占比饼图
    if (stats.subjectStats.length === 0) {
      html += '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">暂无数据,开始打卡后这里会显示统计图表</div></div>';
    } else {
      html += '<div class="card chart-card">';
      html += '  <div class="card-title">科目时长占比</div>';
      html += '  <div class="pie-wrap">';
      html += '    <canvas id="chart-pie" class="chart-canvas"></canvas>';
      html += '    <div class="pie-legend">';
      stats.subjectStats.forEach(function (s) {
        var pct = stats.totalDuration > 0 ? Math.round((s.duration / stats.totalDuration) * 100) : 0;
        html += '      <div class="legend-item">';
        html += '        <span class="legend-dot" style="background:' + _escape(s.color) + '"></span>';
        html += '        <span class="legend-name">' + _escape(s.name) + '</span>';
        html += '        <span class="legend-pct">' + pct + '%</span>';
        html += '        <span class="legend-dur">' + formatDuration(s.duration) + '</span>';
        html += '      </div>';
      });
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    view.innerHTML = html;

    // 绘制图表(DOM 插入后)
    if (stats.last7Days && stats.last7Days.length) {
      drawDurationBar($('#chart-bar'), stats.last7Days);
    }
    if (stats.subjectStats.length > 0 && stats.totalDuration > 0) {
      drawSubjectPie($('#chart-pie'), stats.subjectStats, stats.totalDuration);
    }
  }

  /** Canvas 绘制饼图(高 DPI) */
  function drawSubjectPie(canvas, data, total) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var size = 180;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    var cx = size / 2;
    var cy = size / 2;
    var radius = size / 2 - 4;
    var innerRadius = radius * 0.55; // 环形

    if (total <= 0) return;

    var startAngle = -Math.PI / 2;
    data.forEach(function (item) {
      if (item.duration <= 0) return;
      var angle = (item.duration / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
      ctx.arc(cx, cy, innerRadius, startAngle + angle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = item.color || '#9E9E9E';
      ctx.fill();
      startAngle += angle;
    });

    // 中心文字
    ctx.fillStyle = '#666';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('总时长', cx, cy - 8);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(formatDuration(total), cx, cy + 10);
  }

  /** Canvas 绘制柱状图(高 DPI) */
  function drawDurationBar(canvas, data) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.clientWidth || 320;
    var h = 160;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var max = Math.max.apply(null, data.map(function (d) { return d.duration; }).concat([60]));
    var barCount = data.length;
    var padding = 24;
    var barAreaW = w - padding * 2;
    var barW = Math.max(12, (barAreaW / barCount) * 0.55);
    var gap = (barAreaW - barW * barCount) / (barCount - 1);
    var today = window.Storage.dateUtils.todayKey();

    data.forEach(function (d, i) {
      var x = padding + i * (barW + gap);
      var barH = max > 0 ? (d.duration / max) * (h - padding * 2) : 0;
      var y = h - padding - barH;

      // 柱子
      ctx.fillStyle = d.date === today ? '#4CAF50' : '#BBDEFB';
      _roundRect(ctx, x, y, barW, barH, 4);
      ctx.fill();

      // 时长文字
      if (d.duration > 0) {
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(d.duration) + '分', x + barW / 2, y - 4);
      }

      // 星期标签
      ctx.fillStyle = '#999';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.weekday, x + barW / 2, h - padding + 14);
    });
  }

  /** 圆角矩形辅助 */
  function _roundRect(ctx, x, y, w, h, r) {
    if (h < 0) { y += h; h = -h; }
    if (h === 0) h = 0.5;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ============ 设置视图 ============

  function renderSettingsView() {
    var view = _getView('settings');
    if (!view) return;
    var Storage = window.Storage;
    var subjects = Storage.getSubjects();
    var settings = Storage.getSettings();

    var html = '';

    // 每日目标
    html += '<div class="card settings-card">';
    html += '  <div class="card-title">每日目标</div>';
    html += '  <div class="setting-row">';
    html += '    <label for="setting-goal">目标学习时长(分钟)</label>';
    html += '    <input type="number" id="setting-goal" min="10" max="1440" step="10" value="' + settings.dailyGoalMinutes + '">';
    html += '  </div>';
    html += '  <button class="btn btn-primary btn-sm" data-action="save-goal">保存</button>';
    html += '</div>';

    // 科目管理
    html += '<div class="card settings-card">';
    html += '  <div class="card-title-row">';
    html += '    <div class="card-title">科目管理</div>';
    html += '    <button class="btn btn-primary btn-sm" data-action="add-subject">+ 新建科目</button>';
    html += '  </div>';
    if (subjects.length === 0) {
      html += '<div class="empty-state small"><div class="empty-text">暂无科目</div></div>';
    } else {
      html += '<div class="subject-list">';
      subjects.forEach(function (s) {
        html += '<div class="subject-item" data-subject-id="' + _escape(s.id) + '">';
        html += '  <span class="subject-color-dot" style="background:' + _escape(s.color) + '"></span>';
        if (s.icon) html += '<span class="subject-icon">' + _escape(s.icon) + '</span>';
        html += '  <span class="subject-name">' + _escape(s.name) + '</span>';
        html += '  <div class="subject-actions">';
        html += '    <button class="icon-btn" data-action="edit-subject" data-id="' + _escape(s.id) + '" title="编辑">✏️</button>';
        html += '    <button class="icon-btn danger" data-action="delete-subject" data-id="' + _escape(s.id) + '" title="删除">🗑️</button>';
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // 数据管理
    html += '<div class="card settings-card">';
    html += '  <div class="card-title">数据管理</div>';
    html += '  <div class="data-actions">';
    html += '    <button class="btn btn-ghost" data-action="export-data">📤 导出数据备份</button>';
    html += '    <button class="btn btn-ghost" data-action="import-data">📥 导入数据</button>';
    html += '    <button class="btn btn-danger" data-action="clear-data">🗑️ 清空所有数据</button>';
    html += '  </div>';
    html += '  <input type="file" id="import-file-input" accept=".json" style="display:none">';
    html += '</div>';

    // 关于
    html += '<div class="about-text">尚美岐不爱学习 v1.0 · 数据保存在本地浏览器</div>';

    view.innerHTML = html;
  }

  // ============ 模态框 ============

  /** 打开记录模态框(无 id=新增,有 id=编辑) */
  function openRecordModal(options) {
    options = options || {};
    var Storage = window.Storage;
    var subjects = Storage.getSubjects();
    var record = options.id ? Storage.getRecord(options.id) : null;
    var defaultDate = options.date || Storage.dateUtils.todayKey();

    var titleText = record ? '编辑学习记录' : '添加学习记录';
    var data = record || { title: '', subjectId: subjects.length ? subjects[0].id : '', duration: 30, notes: '', date: defaultDate };

    var subjectOptions = subjects.map(function (s) {
      var sel = s.id === data.subjectId ? ' selected' : '';
      return '<option value="' + _escape(s.id) + '"' + sel + '>' + _escape((s.icon ? s.icon + ' ' : '') + s.name) + '</option>';
    }).join('');

    var html = '<div class="modal-overlay" data-action="close-modal-bg">';
    html += '  <div class="modal">';
    html += '    <div class="modal-header">';
    html += '      <div class="modal-title">' + titleText + '</div>';
    html += '      <button class="icon-btn" data-action="close-modal">✕</button>';
    html += '    </div>';
    html += '    <div class="modal-body">';
    html += '      <div class="form-row">';
    html += '        <label>学习日期</label>';
    html += '        <input type="date" id="form-date" value="' + _escape(data.date) + '">';
    html += '      </div>';
    html += '      <div class="form-row">';
    html += '        <label>学习内容 <span class="required">*</span></label>';
    html += '        <input type="text" id="form-title" placeholder="例如:SolidWorks 曲面建模练习" value="' + _escape(data.title) + '" maxlength="100">';
    html += '      </div>';
    html += '      <div class="form-row two-col">';
    html += '        <div>';
    html += '          <label>科目</label>';
    html += '          <select id="form-subject">' + subjectOptions + '</select>';
    html += '        </div>';
    html += '        <div>';
    html += '          <label>学习时长(分钟)<span class="required">*</span></label>';
    html += '          <input type="number" id="form-duration" min="1" max="1440" value="' + data.duration + '">';
    html += '        </div>';
    html += '      </div>';
    html += '      <div class="form-row">';
    html += '        <label>学习笔记</label>';
    html += '        <textarea id="form-notes" placeholder="记录今天学了什么、遇到的问题、心得..." maxlength="2000" rows="4">' + _escape(data.notes) + '</textarea>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="modal-footer">';
    html += '      <button class="btn btn-ghost" data-action="close-modal">取消</button>';
    html += '      <button class="btn btn-primary" data-action="submit-record" data-id="' + (record ? _escape(record.id) : '') + '">保存</button>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    _openModalHtml(html);
    setTimeout(function () { $('#form-title') && $('#form-title').focus(); }, 50);
  }

  /** 打开科目模态框 */
  function openSubjectModal(id) {
    var Storage = window.Storage;
    var subject = id ? Storage.getSubject(id) : null;
    var titleText = subject ? '编辑科目' : '新建科目';
    var data = subject || { name: '', color: '#4CAF50', icon: '' };
    var colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#795548', '#607D8B'];
    var icons = ['📐', '🔬', '💼', '📖', '✏️', '💻', '⚙️', '📊', '🎯', '📝', '🧪', '🔌'];

    var html = '<div class="modal-overlay" data-action="close-modal-bg">';
    html += '  <div class="modal modal-sm">';
    html += '    <div class="modal-header">';
    html += '      <div class="modal-title">' + titleText + '</div>';
    html += '      <button class="icon-btn" data-action="close-modal">✕</button>';
    html += '    </div>';
    html += '    <div class="modal-body">';
    html += '      <div class="form-row">';
    html += '        <label>科目名称 <span class="required">*</span></label>';
    html += '        <input type="text" id="subj-name" placeholder="例如:有限元分析" value="' + _escape(data.name) + '" maxlength="20">';
    html += '      </div>';
    html += '      <div class="form-row">';
    html += '        <label>颜色</label>';
    html += '        <div class="color-picker">';
    colors.forEach(function (c) {
      var sel = c === data.color ? ' selected' : '';
      html += '<span class="color-dot' + sel + '" style="background:' + c + '" data-color="' + c + '" data-action="pick-color"></span>';
    });
    html += '        </div>';
    html += '      </div>';
    html += '      <div class="form-row">';
    html += '        <label>图标(可选)</label>';
    html += '        <div class="icon-picker">';
    icons.forEach(function (ic) {
      var sel = ic === data.icon ? ' selected' : '';
      html += '<span class="icon-dot' + sel + '" data-icon="' + ic + '" data-action="pick-icon">' + ic + '</span>';
    });
    html += '        </div>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="modal-footer">';
    html += '      <button class="btn btn-ghost" data-action="close-modal">取消</button>';
    html += '      <button class="btn btn-primary" data-action="submit-subject" data-id="' + (subject ? _escape(subject.id) : '') + '">保存</button>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    _openModalHtml(html);
    // 记录当前选中颜色/图标
    var pickedColor = data.color;
    var pickedIcon = data.icon;
    var overlay = $('#modal-root .modal-overlay');
    overlay._pickedColor = pickedColor;
    overlay._pickedIcon = pickedIcon;
    setTimeout(function () { $('#subj-name') && $('#subj-name').focus(); }, 50);
  }

  /** 确认对话框 */
  function openConfirm(message, onConfirm, options) {
    options = options || {};
    var html = '<div class="modal-overlay" data-action="close-modal-bg">';
    html += '  <div class="modal modal-sm">';
    html += '    <div class="modal-body confirm-body">';
    html += '      <div class="confirm-icon">' + (options.icon || '⚠️') + '</div>';
    html += '      <div class="confirm-message">' + _escape(message) + '</div>';
    html += '    </div>';
    html += '    <div class="modal-footer">';
    html += '      <button class="btn btn-ghost" data-action="close-modal">取消</button>';
    html += '      <button class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + '" data-action="confirm-yes">确定</button>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>';
    _openModalHtml(html);
    var btn = $('#modal-root [data-action="confirm-yes"]');
    if (btn) {
      btn.onclick = function () {
        closeModal();
        if (typeof onConfirm === 'function') onConfirm();
      };
    }
  }

  function _openModalHtml(html) {
    var root = $('#modal-root');
    if (!root) return;
    root.innerHTML = html;
    root.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    var root = $('#modal-root');
    if (!root) return;
    root.innerHTML = '';
    root.classList.remove('active');
    document.body.classList.remove('modal-open');
  }

  /** 点击遮罩关闭(由 app 绑定) */
  function isModalOpen() {
    return $('#modal-root') && $('#modal-root').classList.contains('active');
  }

  // ============ Toast 提示 ============

  var toastTimer = null;
  function toast(message, type) {
    type = type || 'info';
    var container = $('#toast-root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-root';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    container.innerHTML = '<div class="toast toast-' + type + '">' + _escape(message) + '</div>';
    container.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      container.classList.remove('show');
    }, 2200);
  }

  // ============ 持久化降级提示条 ============

  function renderPersistenceWarning() {
    if (window.Storage.isPersistent()) return;
    var banner = $('#persistence-banner');
    if (!banner) return;
    banner.style.display = 'block';
    banner.innerHTML = '⚠️ 当前浏览器不支持本地持久化,数据将在关闭页面后丢失。建议使用 Chrome 或 Edge 打开本文件。';
  }

  // ============ 公共 API ============
  return {
    // 工具
    escape: _escape,
    formatDuration: formatDuration,
    // 视图
    renderTodayView: renderTodayView,
    renderCalendarView: renderCalendarView,
    renderCalendarDetail: renderCalendarDetail,
    renderStatsView: renderStatsView,
    renderSettingsView: renderSettingsView,
    // 日历控制
    calendarPrev: calendarPrev,
    calendarNext: calendarNext,
    calendarGoToday: calendarGoToday,
    setStatsRange: function (r) { statsRange = r; },
    // 模态框
    openRecordModal: openRecordModal,
    openSubjectModal: openSubjectModal,
    openConfirm: openConfirm,
    closeModal: closeModal,
    isModalOpen: isModalOpen,
    // 提示
    toast: toast,
    renderPersistenceWarning: renderPersistenceWarning
  };
})();
