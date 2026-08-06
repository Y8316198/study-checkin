/**
 * storage.js — 数据层
 * 所有 localStorage 操作的唯一入口,提供同步 API。
 * 通过 window.Storage 全局命名空间暴露。
 * 三层架构:storage.js(数据) ↔ app.js(控制) ↔ ui.js(渲染)
 */
window.Storage = (function () {
  'use strict';

  var STORAGE_KEY = 'daily_study_app_v1';
  var SCHEMA_VERSION = 1;

  // 内存缓存,减少读写;同时作为 localStorage 不可用时的降级存储
  var cache = null;
  var persistenceAvailable = true;

  // 默认科目(贴合机械设计工程方向用户背景)
  var DEFAULT_SUBJECTS = [
    { id: 'subj_solidworks', name: 'SolidWorks练习', color: '#4CAF50', icon: '📐', order: 1 },
    { id: 'subj_ansys',      name: 'ANSYS学习',      color: '#2196F3', icon: '🔬', order: 2 },
    { id: 'subj_interview',  name: '面试准备',        color: '#FF9800', icon: '💼', order: 3 },
    { id: 'subj_english',    name: '英语',            color: '#9C27B0', icon: '📖', order: 4 }
  ];

  var DEFAULT_SETTINGS = {
    theme: 'light',
    dailyGoalMinutes: 120,
    weekStart: 1 // 0=周日, 1=周一
  };

  // ============ 内部工具 ============

  /** 生成唯一 ID,crypto.randomUUID 不可用时降级 */
  function _genId(prefix) {
    prefix = prefix || 'id';
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + ts + '_' + rand;
  }

  /** 获取本地日期 YYYY-MM-DD(关键:非 UTC,避免凌晨错位) */
  function _todayKey() {
    return _dateKey(new Date());
  }

  /** Date 对象转本地日期字符串 YYYY-MM-DD */
  function _dateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** 深拷贝(简单结构够用) */
  function _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** 默认空数据结构 */
  function _emptyData() {
    return {
      version: SCHEMA_VERSION,
      records: [],
      subjects: _clone(DEFAULT_SUBJECTS).map(function (s) {
        s.createdAt = Date.now();
        return s;
      }),
      settings: _clone(DEFAULT_SETTINGS),
      meta: { createdAt: Date.now(), lastBackupAt: null }
    };
  }

  /** 版本迁移(预留) */
  function _migrate(data) {
    if (!data || typeof data !== 'object') return _emptyData();
    if (!data.version || data.version < SCHEMA_VERSION) {
      // 未来在此处做字段补全/重命名
      data.version = SCHEMA_VERSION;
    }
    if (!Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.subjects)) data.subjects = [];
    if (!data.settings) data.settings = _clone(DEFAULT_SETTINGS);
    if (!data.meta) data.meta = { createdAt: Date.now(), lastBackupAt: null };
    return data;
  }

  /** 读取全部数据到缓存 */
  function _load() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        cache = _migrate(JSON.parse(raw));
      } else {
        cache = _emptyData();
        _save(); // 首次启动写入默认数据
      }
    } catch (e) {
      // localStorage 不可用(file:// 下某些浏览器 origin=null 或被禁用)
      persistenceAvailable = false;
      cache = _emptyData();
      console.warn('[Storage] localStorage 不可用,已降级为内存存储(刷新后数据丢失):', e);
    }
    return cache;
  }

  /** 写回 localStorage,带配额兜底 */
  function _save() {
    if (!cache) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        // 配额不足,提示用户导出
        console.error('[Storage] 存储空间不足,请导出数据后清理。');
        if (window.UI && typeof window.UI.toast === 'function') {
          window.UI.toast('存储空间不足,请导出数据后清理', 'error');
        }
      } else {
        persistenceAvailable = false;
        console.warn('[Storage] 写入失败,降级为内存存储:', e);
      }
    }
  }

  /** 持久化是否可用(供 UI 显示提示条) */
  function isPersistent() {
    return persistenceAvailable;
  }

  // ============ 记录 CRUD ============

  /**
   * 获取记录(可筛选)
   * @param {object} filter - {date, subjectId, from, to} 任一可空
   */
  function getRecords(filter) {
    var data = _load();
    var list = data.records;
    if (!filter) return _clone(list);
    if (filter.date) {
      list = list.filter(function (r) { return r.date === filter.date; });
    }
    if (filter.subjectId) {
      list = list.filter(function (r) { return r.subjectId === filter.subjectId; });
    }
    if (filter.from) {
      list = list.filter(function (r) { return r.date >= filter.from; });
    }
    if (filter.to) {
      list = list.filter(function (r) { return r.date <= filter.to; });
    }
    // 按日期倒序、创建时间倒序
    list = list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return _clone(list);
  }

  function getRecord(id) {
    var data = _load();
    var found = data.records.filter(function (r) { return r.id === id; })[0];
    return found ? _clone(found) : null;
  }

  /**
   * 新增记录
   * @param {object} data - {title, subjectId, duration, notes, date?}
   */
  function addRecord(payload) {
    var data = _load();
    var now = Date.now();
    var record = {
      id: _genId('rec'),
      date: payload.date || _todayKey(),
      title: (payload.title || '').trim(),
      subjectId: payload.subjectId || null,
      duration: Math.max(0, parseInt(payload.duration, 10) || 0),
      notes: (payload.notes || '').trim(),
      createdAt: now,
      updatedAt: now
    };
    data.records.push(record);
    _save();
    return _clone(record);
  }

  function updateRecord(id, patch) {
    var data = _load();
    var idx = data.records.findIndex(function (r) { return r.id === id; });
    if (idx === -1) return null;
    var r = data.records[idx];
    if (patch.title !== undefined) r.title = patch.title.trim();
    if (patch.subjectId !== undefined) r.subjectId = patch.subjectId || null;
    if (patch.duration !== undefined) r.duration = Math.max(0, parseInt(patch.duration, 10) || 0);
    if (patch.notes !== undefined) r.notes = patch.notes.trim();
    if (patch.date !== undefined) r.date = patch.date;
    r.updatedAt = Date.now();
    _save();
    return _clone(r);
  }

  function deleteRecord(id) {
    var data = _load();
    var before = data.records.length;
    data.records = data.records.filter(function (r) { return r.id !== id; });
    _save();
    return data.records.length < before;
  }

  // ============ 科目 CRUD ============

  function getSubjects() {
    var data = _load();
    var list = data.subjects.slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    return _clone(list);
  }

  function getSubject(id) {
    var data = _load();
    var found = data.subjects.filter(function (s) { return s.id === id; })[0];
    return found ? _clone(found) : null;
  }

  function addSubject(payload) {
    var data = _load();
    var maxOrder = data.subjects.reduce(function (m, s) {
      return Math.max(m, s.order || 0);
    }, 0);
    var subject = {
      id: _genId('subj'),
      name: (payload.name || '').trim(),
      color: payload.color || '#607D8B',
      icon: payload.icon || '',
      order: maxOrder + 1,
      createdAt: Date.now()
    };
    data.subjects.push(subject);
    _save();
    return _clone(subject);
  }

  function updateSubject(id, patch) {
    var data = _load();
    var idx = data.subjects.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return null;
    var s = data.subjects[idx];
    if (patch.name !== undefined) s.name = patch.name.trim();
    if (patch.color !== undefined) s.color = patch.color;
    if (patch.icon !== undefined) s.icon = patch.icon;
    if (patch.order !== undefined) s.order = patch.order;
    _save();
    return _clone(s);
  }

  /** 删除科目:关联记录的 subjectId 置 null(软删除,保留记录) */
  function deleteSubject(id) {
    var data = _load();
    var before = data.subjects.length;
    data.subjects = data.subjects.filter(function (s) { return s.id !== id; });
    if (data.subjects.length === before) return false;
    data.records.forEach(function (r) {
      if (r.subjectId === id) r.subjectId = null;
    });
    _save();
    return true;
  }

  // ============ 设置 ============

  function getSettings() {
    return _clone(_load().settings);
  }

  function updateSettings(patch) {
    var data = _load();
    Object.keys(patch || {}).forEach(function (k) {
      data.settings[k] = patch[k];
    });
    _save();
    return _clone(data.settings);
  }

  // ============ 统计查询 ============

  /** 获取有打卡记录的日期集合(指定范围内) */
  function getDatesWithRecords(from, to) {
    var data = _load();
    var set = {};
    data.records.forEach(function (r) {
      if (from && r.date < from) return;
      if (to && r.date > to) return;
      set[r.date] = true;
    });
    return Object.keys(set).sort();
  }

  /** 获取指定日期的科目色点信息(用于日历高亮) */
  function getSubjectsByDate(date) {
    var data = _load();
    var subjMap = {};
    data.subjects.forEach(function (s) { subjMap[s.id] = s; });
    var seen = {};
    var result = [];
    data.records.forEach(function (r) {
      if (r.date === date && r.subjectId && subjMap[r.subjectId] && !seen[r.subjectId]) {
        seen[r.subjectId] = true;
        result.push(subjMap[r.subjectId]);
      }
    });
    return _clone(result);
  }

  /** 获取指定日期总时长(分钟) */
  function getDurationByDate(date) {
    var data = _load();
    return data.records
      .filter(function (r) { return r.date === date; })
      .reduce(function (sum, r) { return sum + (r.duration || 0); }, 0);
  }

  /**
   * 获取统计聚合数据
   * @param {string} range - 'week' | 'month' | 'all'
   */
  function getStats(range) {
    var data = _load();
    var allRecords = data.records;
    var today = _todayKey();

    // 累计打卡天数(去重 date)
    var dateSet = {};
    allRecords.forEach(function (r) { dateSet[r.date] = true; });
    var totalDays = Object.keys(dateSet).length;

    // 累计学习时长
    var totalDuration = allRecords.reduce(function (s, r) { return s + (r.duration || 0); }, 0);

    // 今日时长
    var todayDuration = allRecords
      .filter(function (r) { return r.date === today; })
      .reduce(function (s, r) { return s + (r.duration || 0); }, 0);

    // 本周/本月时长
    var rangeDuration = 0;
    var rangeFrom = null;
    var now = new Date();
    if (range === 'week') {
      rangeFrom = _startOfWeek(now, data.settings.weekStart);
    } else if (range === 'month') {
      rangeFrom = _dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    if (rangeFrom) {
      rangeDuration = allRecords
        .filter(function (r) { return r.date >= rangeFrom && r.date <= today; })
        .reduce(function (s, r) { return s + (r.duration || 0); }, 0);
    }

    // 科目时长分布
    var subjMap = {};
    data.subjects.forEach(function (s) { subjMap[s.id] = s; });
    var subjectStats = {};
    allRecords.forEach(function (r) {
      var key = r.subjectId || 'uncategorized';
      if (!subjectStats[key]) {
        subjectStats[key] = {
          subjectId: r.subjectId,
          name: r.subjectId ? (subjMap[r.subjectId] ? subjMap[r.subjectId].name : '已删除科目') : '未分类',
          color: r.subjectId ? (subjMap[r.subjectId] ? subjMap[r.subjectId].color : '#9E9E9E') : '#9E9E9E',
          duration: 0,
          count: 0
        };
      }
      subjectStats[key].duration += r.duration || 0;
      subjectStats[key].count += 1;
    });
    var subjectList = Object.keys(subjectStats).map(function (k) { return subjectStats[k]; });
    subjectList.sort(function (a, b) { return b.duration - a.duration; });

    // 近 7 天每日时长
    var last7Days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = _dateKey(d);
      var dur = allRecords
        .filter(function (r) { return r.date === key; })
        .reduce(function (s, r) { return s + (r.duration || 0); }, 0);
      last7Days.push({ date: key, duration: dur, weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] });
    }

    return {
      totalDays: totalDays,
      totalDuration: totalDuration,
      todayDuration: todayDuration,
      range: range,
      rangeDuration: rangeDuration,
      rangeFrom: rangeFrom,
      totalRecords: allRecords.length,
      subjectStats: subjectList,
      last7Days: last7Days,
      datesWithRecords: Object.keys(dateSet).sort()
    };
  }

  /** 计算本周起始日期(本地 YYYY-MM-DD) */
  function _startOfWeek(d, weekStart) {
    weekStart = weekStart === 0 ? 0 : 1;
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = date.getDay(); // 0=周日
    var diff = (day - weekStart + 7) % 7;
    date.setDate(date.getDate() - diff);
    return _dateKey(date);
  }

  // ============ 数据管理 ============

  /** 导出完整数据为 JSON 字符串 */
  function exportData() {
    var data = _load();
    data.meta.lastBackupAt = Date.now();
    _save();
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入 JSON 数据
   * @returns {{success:boolean, error?:string}}
   */
  function importData(jsonString) {
    try {
      var parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object') {
        return { success: false, error: '数据格式无效' };
      }
      if (!Array.isArray(parsed.records) || !Array.isArray(parsed.subjects)) {
        return { success: false, error: '数据结构不完整(缺少 records 或 subjects)' };
      }
      cache = _migrate(parsed);
      _save();
      return { success: true };
    } catch (e) {
      return { success: false, error: 'JSON 解析失败:' + e.message };
    }
  }

  /** 清空所有数据(恢复默认) */
  function clearAll() {
    cache = _emptyData();
    _save();
  }

  // ============ 日期工具(暴露给 app/ui 使用) ============
  var dateUtils = {
    todayKey: _todayKey,
    dateKey: _dateKey,
    /** YYYY-MM-DD 转 Date(本地零点) */
    parseDate: function (str) {
      var parts = str.split('-');
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    },
    /** 日期加天数,返回新 Date */
    addDays: function (d, days) {
      var n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      n.setDate(n.getDate() + days);
      return n;
    },
    /** 友好显示:2026-08-06 -> 8月6日 周三 */
    formatDateDisplay: function (str) {
      var d = this.parseDate(str);
      var wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + wd;
    },
    /** 相对显示:今天/昨天/前天 或 8月6日 */
    formatRelative: function (str) {
      var today = _todayKey();
      if (str === today) return '今天';
      var yesterday = _dateKey(this.addDays(new Date(), -1));
      if (str === yesterday) return '昨天';
      var beforeY = _dateKey(this.addDays(new Date(), -2));
      if (str === beforeY) return '前天';
      return this.formatDateDisplay(str);
    }
  };

  // ============ 公共 API ============
  return {
    isPersistent: isPersistent,
    dateUtils: dateUtils,
    // 记录
    getRecords: getRecords,
    getRecord: getRecord,
    addRecord: addRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    // 科目
    getSubjects: getSubjects,
    getSubject: getSubject,
    addSubject: addSubject,
    updateSubject: updateSubject,
    deleteSubject: deleteSubject,
    // 设置
    getSettings: getSettings,
    updateSettings: updateSettings,
    // 统计
    getDatesWithRecords: getDatesWithRecords,
    getSubjectsByDate: getSubjectsByDate,
    getDurationByDate: getDurationByDate,
    getStats: getStats,
    // 数据管理
    exportData: exportData,
    importData: importData,
    clearAll: clearAll
  };
})();
