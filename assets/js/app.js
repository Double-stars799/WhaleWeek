/* ==========================================================================
   鲸历 WhaleWeek — 应用逻辑
   --------------------------------------------------------------------------
   纯原生 JavaScript，无构建、无依赖、无网络请求。
   数据保存在 localStorage；时间轴按分钟定位，拖动 / 缩放按 15 分钟吸附。
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     常量与状态
     ------------------------------------------------------------------------ */

  const APP_VERSION = '1.0.0';
  const STORAGE_KEY = 'whale-week:data:v1';
  const START_MIN = 7 * 60;
  const END_MIN = 23 * 60;
  const GRID_MINUTES = END_MIN - START_MIN;
  const HOUR_HEIGHT = 56;
  const GRID_HEIGHT = (GRID_MINUTES / 60) * HOUR_HEIGHT;
  const DAY_HEAD_HEIGHT = 58;
  const SNAP = 15;
  const MIN_DURATION = 30;
  const MAX_PLANS = 500;

  const DAYS = [
    { index: 1, name: '周一', short: '一', en: 'MON' },
    { index: 2, name: '周二', short: '二', en: 'TUE' },
    { index: 3, name: '周三', short: '三', en: 'WED' },
    { index: 4, name: '周四', short: '四', en: 'THU' },
    { index: 5, name: '周五', short: '五', en: 'FRI' },
    { index: 6, name: '周六', short: '六', en: 'SAT' },
    { index: 7, name: '周日', short: '日', en: 'SUN' }
  ];

  const CATEGORIES = [
    { id: 'course', label: '课程', color: '#4d6bfe' },
    { id: 'study', label: '自习', color: '#7c5cfc' },
    { id: 'project', label: '项目', color: '#0b9cb8' },
    { id: 'life', label: '生活', color: '#18a974' },
    { id: 'sport', label: '运动', color: '#e99a12' },
    { id: 'other', label: '其他', color: '#df5b97' }
  ];

  const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));
  const DAY_MAP = Object.fromEntries(DAYS.map((day) => [day.index, day]));
  const EN_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const EN_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const state = {
    plans: [],
    hiddenCategories: new Set(),
    selectedDay: todayIndex(),
    editingId: null,
    lastFocus: null,
    lastDeleted: null,
    lastCategory: 'course',
    installPrompt: null,
    drag: null,
    suppressClickUntil: 0,
    lastDateKey: '',
    lastHour: -1,
    toastTimer: null,
    toastAction: null,
    saveTimer: null
  };

  const dom = {};

  /* ------------------------------------------------------------------------
     启动
     ------------------------------------------------------------------------ */

  init();

  function init() {
    cacheDom();
    buildDayOptions();
    buildCategoryOptions();
    buildNoResults();

    state.plans = loadPlans();
    state.selectedDay = todayIndex();
    const now = new Date();
    state.lastDateKey = dateKey(now);
    state.lastHour = now.getHours();

    bindEvents();
    renderAll();
    startClock();
    registerServiceWorker();
  }

  function cacheDom() {
    const ids = [
      'topbarDateText', 'eyebrowDate', 'greetingLead', 'greetingLine', 'heroSummary',
      'nextUp', 'nextUpText', 'statTodayCount', 'statTodayTime', 'statWeekCount',
      'artTodayCount', 'artTodayFoot', 'weekRange', 'filterRow', 'mobileDayTabs',
      'timetable', 'emptyState', 'emptyAddBtn', 'saveState',
      'addBtn', 'dataBtn', 'nowBtn', 'planDialog', 'planForm', 'planDialogTitle',
      'planTitle', 'planDay', 'planLocation', 'planStart', 'planEnd', 'planNote',
      'categoryOptions', 'formError', 'deletePlanBtn', 'savePlanBtn',
      'dataDialog', 'exportBtn', 'importBtn', 'importFile', 'printBtn',
      'installBtn', 'clearAllBtn', 'toast', 'toastIcon', 'toastMessage',
      'toastAction'
    ];

    ids.forEach((id) => {
      dom[id] = document.getElementById(id);
    });

    dom.timetableWrap = document.querySelector('.timetable-wrap');
    dom.filterRow = document.getElementById('filterRow');
  }

  function bindEvents() {
    dom.addBtn.addEventListener('click', () => openAddDefault());
    dom.emptyAddBtn.addEventListener('click', () => openAddDefault());
    dom.dataBtn.addEventListener('click', openDataDialog);
    dom.nowBtn.addEventListener('click', jumpToToday);

    dom.filterRow.addEventListener('click', onFilterClick);
    dom.mobileDayTabs.addEventListener('click', onDayTabClick);
    dom.timetable.addEventListener('click', onTimetableClick);
    dom.timetable.addEventListener('keydown', onTimetableKeydown);
    dom.timetable.addEventListener('pointerdown', onTimetablePointerDown);

    dom.planForm.addEventListener('submit', onPlanSubmit);
    dom.deletePlanBtn.addEventListener('click', onDeletePlan);
    dom.planStart.addEventListener('change', keepEndAfterStart);
    dom.planForm.addEventListener('click', onQuickDuration);

    dom.exportBtn.addEventListener('click', exportBackup);
    dom.importBtn.addEventListener('click', () => {
      dom.importFile.value = '';
      dom.importFile.click();
    });
    dom.importFile.addEventListener('change', onImportFile);
    dom.printBtn.addEventListener('click', printSchedule);
    dom.clearAllBtn.addEventListener('click', clearAllPlans);
    dom.installBtn.addEventListener('click', installApp);
    dom.toastAction.addEventListener('click', runToastAction);

    document.addEventListener('click', onDocumentClick);
    [dom.planDialog, dom.dataDialog].forEach((dialog) => {
      dialog.addEventListener('click', onDialogBackdropClick);
    });
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('storage', onStorageChange);
    window.addEventListener('keydown', onGlobalKeydown);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tickClock(true);
    });
  }

  /* ------------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------------ */

  function renderAll() {
    const now = new Date();
    state.lastDateKey = dateKey(now);
    state.lastHour = now.getHours();

    if (!state.selectedDay || state.selectedDay < 1 || state.selectedDay > 7) {
      state.selectedDay = todayIndex();
    }

    renderDateAndGreeting(now);
    renderHero(now);
    renderFilters();
    renderDayTabs();
    renderTimetable();
    updateEmptyState();
    updateNowLine();
  }

  function renderDateAndGreeting(now) {
    const todayIdx = todayIndex();
    const weekday = DAY_MAP[todayIdx];
    const greeting = getGreeting(now.getHours());
    const weekStart = getMonday(now);
    const weekEnd = addDays(weekStart, 6);

    dom.topbarDateText.textContent = `${now.getMonth() + 1}月${now.getDate()}日 · ${weekday.name}`;
    dom.eyebrowDate.textContent = `${EN_DAYS[now.getDay()]} · ${EN_MONTHS[now.getMonth()]} ${now.getDate()}`;
    dom.greetingLead.textContent = greeting.lead;
    dom.greetingLine.textContent = greeting.line;
    dom.weekRange.textContent = formatWeekRange(weekStart, weekEnd);
  }

  function renderHero(now) {
    const todayIdx = todayIndex();
    const todayPlans = state.plans
      .filter((plan) => plan.day === todayIdx)
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const totalMinutes = todayPlans.reduce((sum, plan) => sum + planDuration(plan), 0);
    const count = todayPlans.length;

    if (count === 0) {
      dom.heroSummary.textContent = '今天还没有安排。空着也很好，或者放进一件想做的事。';
      dom.artTodayFoot.textContent = '海面很安静';
    } else {
      dom.heroSummary.textContent = `今天有 ${count} 个计划，共 ${formatDuration(totalMinutes)}。按自己的节奏来就好。`;
      dom.artTodayFoot.textContent = count === 1 ? '慢慢来，一件一件' : count <= 3 ? '今天也游得动' : '小鲸鱼陪你慢慢游';
    }

    dom.statTodayCount.textContent = String(count);
    dom.statTodayTime.innerHTML = `${formatHoursCompact(totalMinutes)}<small>h</small>`;
    dom.statWeekCount.textContent = String(state.plans.length);
    dom.artTodayCount.textContent = String(count);

    renderNextUp(todayPlans, now);
  }

  function renderNextUp(todayPlans, now) {
    if (!todayPlans.length) {
      dom.nextUp.hidden = true;
      dom.nextUp.classList.remove('is-live');
      return;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let live = null;
    let next = null;

    for (const plan of todayPlans) {
      const start = timeToMinutes(plan.start);
      const end = timeToMinutes(plan.end);

      if (start <= nowMinutes && nowMinutes < end) {
        live = plan;
        break;
      }
      if (start > nowMinutes) {
        next = plan;
        break;
      }
    }

    if (live) {
      const end = timeToMinutes(live.end);
      dom.nextUpText.textContent = `正在进行 · ${live.title} · ${minutesToTime(end)} 结束`;
      dom.nextUp.hidden = false;
      dom.nextUp.classList.add('is-live');
      return;
    }

    if (next) {
      dom.nextUpText.textContent = `下一件 · ${next.start} · ${next.title}`;
      dom.nextUp.hidden = false;
      dom.nextUp.classList.remove('is-live');
      return;
    }

    dom.nextUpText.textContent = '今天的安排都结束啦，去休息一下。';
    dom.nextUp.hidden = false;
    dom.nextUp.classList.remove('is-live');
  }

  function renderFilters() {
    const fragment = document.createDocumentFragment();
    const allChip = createFilterChip(null, '全部', state.plans.length, null);
    allChip.classList.add('filter-chip-all');
    allChip.classList.toggle('is-active', state.hiddenCategories.size === 0);
    allChip.setAttribute('aria-pressed', String(state.hiddenCategories.size === 0));
    fragment.append(allChip);

    CATEGORIES.forEach((category) => {
      const count = state.plans.filter((plan) => plan.category === category.id).length;
      const active = !state.hiddenCategories.has(category.id);
      const chip = createFilterChip(category.id, category.label, count, category.color);
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
      fragment.append(chip);
    });

    dom.filterRow.replaceChildren(fragment);
  }

  function createFilterChip(categoryId, label, count, color) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    if (categoryId) {
      button.dataset.category = categoryId;
      button.style.setProperty('--chip-color', color || '#a4adc5');
    } else {
      button.dataset.category = '';
    }

    const dot = document.createElement('span');
    dot.className = 'filter-dot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = label;

    const countEl = document.createElement('span');
    countEl.className = 'filter-count';
    countEl.textContent = String(count);

    button.append(dot, text, countEl);
    return button;
  }

  function renderDayTabs() {
    const fragment = document.createDocumentFragment();
    const todayIdx = todayIndex();

    DAYS.forEach((day) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-day-tab';
      button.dataset.day = String(day.index);
      button.setAttribute('aria-pressed', String(day.index === state.selectedDay));
      button.setAttribute('aria-label', `${day.name}${day.index === todayIdx ? '，今天' : ''}`);
      button.classList.toggle('is-active', day.index === state.selectedDay);
      button.classList.toggle('is-today', day.index === todayIdx);
      if (state.plans.some((plan) => plan.day === day.index)) {
        button.classList.add('has-plans');
      }

      const label = document.createElement('span');
      label.textContent = day.name;
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.append(label, dot);
      fragment.append(button);
    });

    dom.mobileDayTabs.replaceChildren(fragment);
  }

  function renderTimetable() {
    const fragment = document.createDocumentFragment();
    const todayIdx = todayIndex();

    fragment.append(buildTimeColumn());

    DAYS.forEach((day) => {
      const plans = state.plans.filter((plan) => {
        return plan.day === day.index && !state.hiddenCategories.has(plan.category);
      });
      fragment.append(buildDayColumn(day, plans, day.index === todayIdx));
    });

    dom.timetable.replaceChildren(fragment);
    applyActiveDay();
  }

  function buildTimeColumn() {
    const column = document.createElement('div');
    column.className = 'time-col';

    const corner = document.createElement('div');
    corner.className = 'corner-head';
    corner.textContent = 'TIME';

    const scale = document.createElement('div');
    scale.className = 'time-scale';
    scale.style.height = `${GRID_HEIGHT}px`;

    for (let hour = 7; hour <= 23; hour += 1) {
      const label = document.createElement('span');
      label.className = 'time-label';
      label.textContent = `${String(hour).padStart(2, '0')}:00`;
      label.style.top = `${(hour - 7) * HOUR_HEIGHT}px`;
      scale.append(label);
    }

    column.append(corner, scale);
    return column;
  }

  function buildDayColumn(day, plans, isToday) {
    const column = document.createElement('div');
    column.className = 'day-col';
    column.dataset.day = String(day.index);
    column.classList.toggle('is-today', isToday);
    column.classList.toggle('is-active', day.index === state.selectedDay);

    const head = document.createElement('div');
    head.className = 'day-head';
    head.classList.toggle('is-today', isToday);

    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = day.name;

    head.append(name);

    if (isToday) {
      const badge = document.createElement('span');
      badge.className = 'today-badge';
      badge.textContent = '今天';
      head.append(badge);
    } else {
      const en = document.createElement('span');
      en.className = 'day-en';
      en.textContent = day.en;
      head.append(en);
    }

    const body = document.createElement('div');
    body.className = 'day-body';
    body.dataset.day = String(day.index);
    body.style.height = `${GRID_HEIGHT}px`;
    body.setAttribute('aria-label', `${day.name}时间轴，点击空白处添加计划`);

    const plansLayer = document.createElement('div');
    plansLayer.className = 'plans-layer';

    const laidOut = layoutDayPlans(plans);
    laidOut.forEach((item) => {
      plansLayer.append(buildPlanCard(item));
    });

    body.append(plansLayer);
    column.append(head, body);
    return column;
  }

  function buildPlanCard(item) {
    const plan = item.plan;
    const category = CATEGORY_MAP[plan.category] || CATEGORY_MAP.other;
    const height = Math.max((item.end - item.start) / 60 * HOUR_HEIGHT - 4, 22);

    const card = document.createElement('div');
    card.className = `plan-card cat-${category.id}`;
    card.dataset.id = plan.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-haspopup', 'dialog');
    card.setAttribute(
      'aria-label',
      `${plan.title}，${DAY_MAP[plan.day].name} ${plan.start} 到 ${plan.end}${plan.location ? `，地点 ${plan.location}` : ''}。按回车编辑`
    );
    card.style.top = `${((item.start - START_MIN) / 60) * HOUR_HEIGHT + 2}px`;
    card.style.height = `${height}px`;
    card.style.left = `calc(${(item.lane / item.lanes) * 100}% + 2px)`;
    card.style.width = `calc(${100 / item.lanes}% - 4px)`;

    if (height < 39) {
      card.classList.add('is-tiny');
    } else if (height < 72) {
      card.classList.add('is-compact');
    }

    const time = document.createElement('span');
    time.className = 'plan-time';
    time.textContent = `${plan.start} – ${plan.end}`;

    const title = document.createElement('span');
    title.className = 'plan-title';
    title.textContent = plan.title;

    card.append(time, title);

    if (plan.location) {
      const meta = document.createElement('span');
      meta.className = 'plan-meta';
      meta.append(createIcon('i-pin'));
      const location = document.createElement('span');
      location.textContent = plan.location;
      meta.append(location);
      card.append(meta);
    }

    const resize = document.createElement('span');
    resize.className = 'plan-resize';
    resize.setAttribute('aria-hidden', 'true');
    resize.title = '拖动调整结束时间';
    card.append(resize);

    return card;
  }

  function layoutDayPlans(plans) {
    const items = plans
      .map((plan) => ({
        plan,
        start: timeToMinutes(plan.start),
        end: timeToMinutes(plan.end),
        lane: 0,
        lanes: 1
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const output = [];
    let group = [];
    let groupEnd = -1;

    const flush = () => {
      if (!group.length) return;

      const laneEnds = [];
      group.forEach((item) => {
        let lane = laneEnds.findIndex((end) => end <= item.start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.end);
        } else {
          laneEnds[lane] = item.end;
        }
        item.lane = lane;
      });

      group.forEach((item) => {
        item.lanes = Math.max(laneEnds.length, 1);
        output.push(item);
      });

      group = [];
      groupEnd = -1;
    };

    items.forEach((item) => {
      if (group.length && item.start >= groupEnd) flush();
      group.push(item);
      groupEnd = Math.max(groupEnd, item.end);
    });
    flush();

    return output;
  }

  function applyActiveDay() {
    if (!state.selectedDay || state.selectedDay < 1 || state.selectedDay > 7) {
      state.selectedDay = todayIndex();
    }

    dom.timetable.querySelectorAll('.day-col').forEach((column) => {
      column.classList.toggle('is-active', Number(column.dataset.day) === state.selectedDay);
    });

    dom.mobileDayTabs.querySelectorAll('.mobile-day-tab').forEach((tab) => {
      const active = Number(tab.dataset.day) === state.selectedDay;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
  }

  function updateEmptyState() {
    const visibleCount = state.plans.filter((plan) => !state.hiddenCategories.has(plan.category)).length;
    dom.emptyState.hidden = state.plans.length > 0;
    dom.noResults.hidden = !(state.plans.length > 0 && visibleCount === 0);
  }

  function updateNowLine() {
    document.querySelectorAll('.now-line').forEach((line) => line.remove());

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < START_MIN || currentMinutes > END_MIN) return;

    const dayBody = dom.timetable.querySelector(`.day-body[data-day="${todayIndex()}"]`);
    if (!dayBody) return;

    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = `${((currentMinutes - START_MIN) / 60) * HOUR_HEIGHT}px`;
    line.setAttribute('aria-hidden', 'true');
    dayBody.append(line);
  }

  function markSaved() {
    if (!dom.saveState) return;
    const dot = document.createElement('span');
    dot.className = 'save-dot';
    dot.setAttribute('aria-hidden', 'true');
    const now = new Date();
    const text = document.createTextNode(`已自动保存 · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    dom.saveState.replaceChildren(dot, text);
  }

  /* ------------------------------------------------------------------------
     新建 / 编辑计划
     ------------------------------------------------------------------------ */

  function openAddDefault() {
    let day = state.selectedDay || todayIndex();
    let start = 9 * 60;

    if (day === todayIndex()) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();

      if (minutes >= END_MIN - 60) {
        // 太晚了，默认给第二天留一个上午的位置，避免一打开就是过去的 9:00。
        day = day === 7 ? 1 : day + 1;
      } else if (minutes >= START_MIN && minutes < END_MIN - MIN_DURATION) {
        start = Math.ceil(minutes / 30) * 30;
      }
    }

    start = clamp(start, START_MIN, END_MIN - MIN_DURATION);
    let end = Math.min(start + 60, END_MIN);
    if (end - start < MIN_DURATION) {
      start = END_MIN - 60;
      end = END_MIN;
    }

    openPlanDialog({
      mode: 'add',
      defaults: { day, start, end }
    });
  }

  function openEditPlan(id) {
    const plan = findPlan(id);
    if (!plan) return;
    openPlanDialog({ mode: 'edit', plan });
  }

  function openPlanDialog(options) {
    const isEdit = options.mode === 'edit' && options.plan;
    const plan = isEdit ? options.plan : null;
    const defaults = options.defaults || {};

    state.editingId = plan ? plan.id : null;
    state.lastFocus = document.activeElement;
    dom.planForm.reset();
    clearFormError();

    dom.planDialogTitle.textContent = isEdit ? '编辑计划' : '添加计划';
    dom.savePlanBtn.textContent = isEdit ? '保存修改' : '添加计划';
    dom.deletePlanBtn.hidden = !isEdit;

    const day = plan ? plan.day : defaults.day || state.selectedDay || todayIndex();
    const start = plan ? timeToMinutes(plan.start) : defaults.start || 9 * 60;
    const end = plan ? timeToMinutes(plan.end) : defaults.end || 10 * 60;
    const category = plan ? plan.category : state.lastCategory || 'course';

    dom.planDay.value = String(day);
    dom.planTitle.value = plan ? plan.title : '';
    dom.planLocation.value = plan ? plan.location : '';
    dom.planStart.value = minutesToTime(start);
    dom.planEnd.value = minutesToTime(end);
    dom.planNote.value = plan ? plan.note : '';
    dom.formError.hidden = true;

    const categoryInput = dom.categoryOptions.querySelector(`input[value="${cssEscape(category)}"]`);
    if (categoryInput) categoryInput.checked = true;

    openDialog(dom.planDialog);

    requestAnimationFrame(() => {
      dom.planTitle.focus({ preventScroll: true });
      dom.planTitle.select();
    });
  }

  function onPlanSubmit(event) {
    event.preventDefault();
    clearFormError();

    const result = readPlanForm();
    if (!result.valid) {
      showFormError(result.message, result.field);
      return;
    }

    const data = result.data;
    const nowIso = new Date().toISOString();
    const wasEdit = Boolean(state.editingId);
    let savedPlan;

    if (wasEdit) {
      const existing = findPlan(state.editingId);
      if (!existing) {
        state.editingId = null;
        closeDialog(dom.planDialog);
        showToast('这个计划已经不在了，可能在其他标签页被删除了。', { type: 'error' });
        renderAll();
        return;
      }
      Object.assign(existing, data, { updatedAt: nowIso });
      savedPlan = existing;
    } else {
      savedPlan = {
        id: createId(),
        ...data,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      state.plans.push(savedPlan);
    }

    state.hiddenCategories.delete(data.category);
    state.lastCategory = data.category;
    state.selectedDay = data.day;
    state.editingId = null;

    closeDialog(dom.planDialog);
    const saved = persist();
    renderAll();

    if (saved) {
      showToast(wasEdit ? `已保存「${savedPlan.title}」` : `已添加「${savedPlan.title}」`);
    }
  }

  function readPlanForm() {
    const title = dom.planTitle.value.trim();
    const day = Number(dom.planDay.value);
    const location = dom.planLocation.value.trim().slice(0, 40);
    const note = dom.planNote.value.trim().slice(0, 200);
    const start = parseTime(dom.planStart.value);
    const end = parseTime(dom.planEnd.value);
    const checkedCategory = dom.categoryOptions.querySelector('input[name="category"]:checked');
    const category = checkedCategory && CATEGORY_MAP[checkedCategory.value] ? checkedCategory.value : 'other';

    if (!title) {
      return { valid: false, message: '给计划起个名字吧。', field: dom.planTitle };
    }
    if (title.length > 40) {
      return { valid: false, message: '计划名称最多 40 个字。', field: dom.planTitle };
    }
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return { valid: false, message: '请选择计划在哪一天。', field: dom.planDay };
    }
    if (start === null || end === null) {
      return { valid: false, message: '请填写开始和结束时间。', field: start === null ? dom.planStart : dom.planEnd };
    }
    if (start < START_MIN || end > END_MIN) {
      return { valid: false, message: '时间需要在 07:00 到 23:00 之间。', field: dom.planStart };
    }
    if (end - start < MIN_DURATION) {
      return { valid: false, message: '结束时间至少要比开始时间晚 30 分钟。', field: dom.planEnd };
    }

    return {
      valid: true,
      data: {
        title,
        day,
        start: minutesToTime(start),
        end: minutesToTime(end),
        location,
        note,
        category
      }
    };
  }

  function onDeletePlan() {
    if (!state.editingId) return;

    const index = state.plans.findIndex((plan) => plan.id === state.editingId);
    if (index === -1) {
      closeDialog(dom.planDialog);
      return;
    }

    const [removed] = state.plans.splice(index, 1);
    state.lastDeleted = { plan: removed, index };
    state.editingId = null;

    closeDialog(dom.planDialog);
    const saved = persist();
    renderAll();

    if (saved) {
      showToast(`已删除「${removed.title}」`, {
        actionLabel: '撤销',
        duration: 6000,
        onAction: () => {
          if (!state.lastDeleted) return;
          const restored = state.lastDeleted.plan;
          const at = Math.min(state.lastDeleted.index, state.plans.length);
          state.plans.splice(at, 0, restored);
          state.lastDeleted = null;
          persist();
          renderAll();
          showToast('已恢复计划');
        }
      });
    }
  }

  function keepEndAfterStart() {
    const start = parseTime(dom.planStart.value);
    const end = parseTime(dom.planEnd.value);

    if (start === null) return;
    if (end === null || end - start < MIN_DURATION) {
      dom.planEnd.value = minutesToTime(Math.min(start + 60, END_MIN));
    }
  }

  function onQuickDuration(event) {
    const button = event.target.closest('[data-duration]');
    if (!button) return;

    let start = parseTime(dom.planStart.value);
    if (start === null) {
      start = 9 * 60;
      dom.planStart.value = minutesToTime(start);
    }

    const duration = Number(button.dataset.duration);
    if (!Number.isFinite(duration)) return;

    let end = start + duration;
    if (end > END_MIN) end = END_MIN;
    if (end - start < MIN_DURATION) {
      start = Math.max(START_MIN, END_MIN - MIN_DURATION);
      dom.planStart.value = minutesToTime(start);
      end = END_MIN;
    }
    dom.planEnd.value = minutesToTime(end);
  }

  function showFormError(message, field) {
    dom.formError.textContent = message;
    dom.formError.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus({ preventScroll: false });
    }
  }

  function clearFormError() {
    dom.formError.hidden = true;
    dom.formError.textContent = '';
    [dom.planTitle, dom.planDay, dom.planStart, dom.planEnd].forEach((field) => {
      field.removeAttribute('aria-invalid');
    });
  }

  /* ------------------------------------------------------------------------
     时间轴交互
     ------------------------------------------------------------------------ */

  function onTimetableClick(event) {
    if (Date.now() < state.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const card = event.target.closest('.plan-card');
    if (card) {
      openEditPlan(card.dataset.id);
      return;
    }

    const dayBody = event.target.closest('.day-body');
    if (!dayBody) return;

    const rect = dayBody.getBoundingClientRect();
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const clickedMinutes = START_MIN + ratio * GRID_MINUTES;
    let start = Math.floor(clickedMinutes / 30) * 30;
    start = clamp(start, START_MIN, END_MIN - MIN_DURATION);
    let end = Math.min(start + 60, END_MIN);

    if (end - start < MIN_DURATION) {
      start = END_MIN - MIN_DURATION;
      end = END_MIN;
    }

    openPlanDialog({
      mode: 'add',
      defaults: { day: Number(dayBody.dataset.day), start, end }
    });
  }

  function onTimetableKeydown(event) {
    const card = event.target.closest('.plan-card');
    if (!card) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    openEditPlan(card.dataset.id);
  }

  function onTimetablePointerDown(event) {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    if (window.matchMedia('(max-width: 860px)').matches) return;

    const card = event.target.closest('.plan-card');
    if (!card) return;

    const plan = findPlan(card.dataset.id);
    if (!plan) return;

    const rect = card.getBoundingClientRect();
    const mode = event.target.closest('.plan-resize') ? 'resize' : 'move';
    const start = timeToMinutes(plan.start);
    const end = timeToMinutes(plan.end);

    state.drag = {
      id: plan.id,
      pointerId: event.pointerId,
      card,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      originalStart: start,
      originalEnd: end,
      currentStart: start,
      currentEnd: end,
      targetDay: plan.day,
      started: false,
      changed: false,
      ghost: null,
      badge: null,
      hoverColumn: null
    };

    if (card.setPointerCapture) {
      try { card.setPointerCapture(event.pointerId); } catch (error) { /* 浏览器不支持时退回全局监听 */ }
    }

    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragCancel);
  }

  function onDragMove(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.started) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.started = true;
      drag.card.classList.add('is-dragging');
      document.body.classList.add('is-dragging-plan');

      if (drag.mode === 'move') {
        createDragGhost(drag);
      }
    }

    event.preventDefault();

    if (drag.mode === 'resize') {
      const deltaMinutes = (dy / HOUR_HEIGHT) * 60;
      let end = Math.round((drag.originalEnd + deltaMinutes) / SNAP) * SNAP;
      end = clamp(end, drag.originalStart + MIN_DURATION, END_MIN);
      drag.currentEnd = end;
      drag.changed = end !== drag.originalEnd;
      drag.card.style.height = `${Math.max(((end - drag.originalStart) / 60) * HOUR_HEIGHT - 4, 22)}px`;
      updateCardTime(drag.card, drag.originalStart, end);
      return;
    }

    const duration = drag.originalEnd - drag.originalStart;
    let start = drag.originalStart + Math.round((dy / HOUR_HEIGHT) * 60 / SNAP) * SNAP;
    start = clamp(start, START_MIN, END_MIN - duration);
    start = Math.round(start / SNAP) * SNAP;
    const end = start + duration;
    const targetDay = findDayForX(event.clientX);

    drag.currentStart = start;
    drag.currentEnd = end;
    drag.targetDay = targetDay;
    drag.changed = start !== drag.originalStart || targetDay !== state.plans.find((plan) => plan.id === drag.id)?.day;

    if (drag.ghost) {
      drag.ghost.style.left = `${drag.rect.left + dx}px`;
      drag.ghost.style.top = `${drag.rect.top + dy}px`;
      updateCardTime(drag.ghost, start, end);
    }

    if (drag.badge) {
      drag.badge.textContent = `${DAY_MAP[targetDay].name} ${minutesToTime(start)}–${minutesToTime(end)}`;
      drag.badge.style.left = `${clamp(drag.rect.left + dx + 10, 8, window.innerWidth - 180)}px`;
      drag.badge.style.top = `${clamp(drag.rect.top + dy - 34, 8, window.innerHeight - 42)}px`;
    }

    highlightDropDay(drag, targetDay);
  }

  function onDragEnd(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const started = drag.started;
    const changed = drag.changed;
    const mode = drag.mode;

    if (started) {
      event.preventDefault();
      // 拖动结束浏览器会补发一次 click，用极短窗口把它挡掉；
      // 但不能影响紧接着的第二次真实点击。
      state.suppressClickUntil = Date.now() + 120;
    }

    cleanupDrag(drag);

    if (started && changed) {
      const plan = findPlan(drag.id);
      if (plan) {
        plan.day = drag.targetDay;
        if (mode === 'resize') {
          plan.end = minutesToTime(drag.currentEnd);
        } else {
          plan.start = minutesToTime(drag.currentStart);
          plan.end = minutesToTime(drag.currentEnd);
        }
        plan.updatedAt = new Date().toISOString();
        state.selectedDay = drag.targetDay;
        persist();
        renderAll();
      }
    } else if (started) {
      renderAll();
    }

    state.drag = null;
  }

  function onDragCancel(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cleanupDrag(drag);
    state.drag = null;
    renderAll();
  }

  function createDragGhost(drag) {
    const ghost = drag.card.cloneNode(true);
    ghost.classList.remove('is-dragging');
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('tabindex');
    ghost.style.left = `${drag.rect.left}px`;
    ghost.style.top = `${drag.rect.top}px`;
    ghost.style.width = `${drag.rect.width}px`;
    ghost.style.height = `${drag.rect.height}px`;
    document.body.append(ghost);
    drag.ghost = ghost;

    const badge = document.createElement('div');
    badge.className = 'drag-time-badge';
    badge.textContent = `${DAY_MAP[drag.targetDay].name} ${minutesToTime(drag.originalStart)}–${minutesToTime(drag.originalEnd)}`;
    document.body.append(badge);
    drag.badge = badge;
    drag.badge.style.left = `${clamp(drag.rect.left + 10, 8, window.innerWidth - 180)}px`;
    drag.badge.style.top = `${clamp(drag.rect.top - 34, 8, window.innerHeight - 42)}px`;
  }

  function highlightDropDay(drag, dayIndex) {
    if (drag.hoverColumn && drag.hoverColumn.dataset.day === String(dayIndex)) return;

    if (drag.hoverColumn) {
      drag.hoverColumn.classList.remove('is-drop-target');
    }

    const column = dom.timetable.querySelector(`.day-col[data-day="${dayIndex}"]`);
    if (column) {
      column.classList.add('is-drop-target');
      drag.hoverColumn = column;
    }
  }

  function findDayForX(clientX) {
    const columns = Array.from(dom.timetable.querySelectorAll('.day-col')).filter((column) => {
      return column.getClientRects().length > 0;
    });

    let closestDay = state.selectedDay || todayIndex();
    let closestDistance = Infinity;

    columns.forEach((column) => {
      const rect = column.getBoundingClientRect();
      const day = Number(column.dataset.day);

      if (clientX >= rect.left && clientX <= rect.right) {
        closestDay = day;
        closestDistance = 0;
        return;
      }

      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDay = day;
      }
    });

    return closestDay;
  }

  function cleanupDrag(drag) {
    if (drag.card) {
      drag.card.classList.remove('is-dragging');
      if (drag.card.releasePointerCapture) {
        try { drag.card.releasePointerCapture(drag.pointerId); } catch (error) { /* 指针可能已经释放 */ }
      }
    }

    if (drag.ghost) drag.ghost.remove();
    if (drag.badge) drag.badge.remove();
    if (drag.hoverColumn) drag.hoverColumn.classList.remove('is-drop-target');

    document.body.classList.remove('is-dragging-plan');
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragCancel);
  }

  function updateCardTime(card, start, end) {
    const time = card.querySelector('.plan-time');
    if (time) time.textContent = `${minutesToTime(start)} – ${minutesToTime(end)}`;
  }

  /* ------------------------------------------------------------------------
     筛选、切天、跳转
     ------------------------------------------------------------------------ */

  function onFilterClick(event) {
    const chip = event.target.closest('.filter-chip');
    if (!chip) return;

    const category = chip.dataset.category;
    if (!category) {
      state.hiddenCategories.clear();
    } else if (state.hiddenCategories.has(category)) {
      state.hiddenCategories.delete(category);
    } else {
      state.hiddenCategories.add(category);
    }

    renderFilters();
    renderTimetable();
    updateEmptyState();
    updateNowLine();
  }

  function onDayTabClick(event) {
    const tab = event.target.closest('.mobile-day-tab');
    if (!tab) return;

    const day = Number(tab.dataset.day);
    if (day < 1 || day > 7) return;

    state.selectedDay = day;
    applyActiveDay();
  }

  function jumpToToday() {
    state.selectedDay = todayIndex();
    applyActiveDay();

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const wrapTop = window.scrollY + dom.timetableWrap.getBoundingClientRect().top;
    let target = wrapTop - 110;

    if (minutes >= START_MIN && minutes <= END_MIN) {
      const offset = ((minutes - START_MIN) / 60) * HOUR_HEIGHT;
      target = wrapTop + DAY_HEAD_HEIGHT + offset - Math.min(window.innerHeight * 0.42, 320);
    }

    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------------
     数据与备份
     ------------------------------------------------------------------------ */

  function loadPlans() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return [];
    }
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.plans;
      return sanitizePlans(list);
    } catch (error) {
      console.warn('鲸历：本地数据格式异常，已从空白开始。', error);
      return [];
    }
  }

  function sanitizePlans(list) {
    if (!Array.isArray(list)) return [];

    const seen = new Set();
    const output = [];

    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      if (output.length >= MAX_PLANS) break;

      const title = cleanString(raw.title, 40);
      const day = Number(raw.day);
      const start = parseTime(raw.start);
      const end = parseTime(raw.end);

      if (!title) continue;
      if (!Number.isInteger(day) || day < 1 || day > 7) continue;
      if (start === null || end === null) continue;
      if (start < START_MIN || end > END_MIN) continue;
      if (end - start < MIN_DURATION) continue;

      let id = cleanString(raw.id, 80);
      if (!id || seen.has(id)) id = createId();
      seen.add(id);

      const category = CATEGORY_MAP[raw.category] ? raw.category : 'other';
      const createdAt = isIsoLike(raw.createdAt) ? raw.createdAt : new Date().toISOString();
      const updatedAt = isIsoLike(raw.updatedAt) ? raw.updatedAt : createdAt;

      output.push({
        id,
        title,
        day,
        start: minutesToTime(start),
        end: minutesToTime(end),
        location: cleanString(raw.location, 40),
        note: cleanString(raw.note, 200),
        category,
        createdAt,
        updatedAt
      });
    }

    return output;
  }

  function persist() {
    const payload = {
      app: 'whale-week',
      version: 1,
      updatedAt: new Date().toISOString(),
      plans: state.plans
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      markSaved();
      return true;
    } catch (error) {
      console.error('鲸历：保存失败', error);
      showToast('保存失败：浏览器本地存储不可用或已满。', { type: 'error', duration: 6500 });
      return false;
    }
  }

  function exportBackup() {
    if (!state.plans.length) {
      closeDialog(dom.dataDialog);
      showToast('还没有可以导出的计划。');
      return;
    }

    const payload = {
      app: 'whale-week',
      version: 1,
      exportedAt: new Date().toISOString(),
      plans: state.plans
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date();
    link.href = url;
    link.download = `鲸历备份-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);

    closeDialog(dom.dataDialog);
    showToast(`已导出 ${state.plans.length} 个计划`);
  }

  async function onImportFile(event) {
    const file = event.target.files && event.target.files[0];
    dom.importFile.value = '';
    if (!file) return;

    closeDialog(dom.dataDialog);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.plans;
      const imported = sanitizePlans(list);

      if (!imported.length) {
        showToast('导入失败：文件里没有可用的计划。', { type: 'error', duration: 6000 });
        return;
      }

      if (state.plans.length) {
        const confirmed = window.confirm(`导入会替换当前的 ${state.plans.length} 个计划，确定继续吗？`);
        if (!confirmed) return;
      }

      state.plans = imported;
      state.hiddenCategories.clear();
      state.lastDeleted = null;
      state.selectedDay = todayIndex();
      persist();
      renderAll();
      showToast(`已导入 ${imported.length} 个计划`);
    } catch (error) {
      console.error('鲸历：导入失败', error);
      showToast('导入失败：请选择鲸历导出的 JSON 备份文件。', { type: 'error', duration: 6500 });
    }
  }

  function clearAllPlans() {
    if (!state.plans.length) {
      closeDialog(dom.dataDialog);
      showToast('现在还没有计划。');
      return;
    }

    if (!window.confirm('确定清空所有计划吗？清空后还可以在提示条里撤销。')) return;

    const backup = state.plans.map((plan) => ({ ...plan }));
    state.plans = [];
    state.hiddenCategories.clear();
    state.lastDeleted = null;
    state.selectedDay = todayIndex();

    closeDialog(dom.dataDialog);
    persist();
    renderAll();

    showToast('已清空所有计划', {
      actionLabel: '撤销',
      duration: 7000,
      onAction: () => {
        state.plans = backup;
        persist();
        renderAll();
        showToast('计划已经找回来啦');
      }
    });
  }

  function printSchedule() {
    if (!state.plans.length) {
      closeDialog(dom.dataDialog);
      showToast('还没有计划可以打印。');
      return;
    }

    const previousHidden = new Set(state.hiddenCategories);
    if (previousHidden.size) {
      state.hiddenCategories.clear();
      renderTimetable();
      updateEmptyState();
    }

    closeDialog(dom.dataDialog);

    const restore = () => {
      if (previousHidden.size) {
        state.hiddenCategories = previousHidden;
        renderTimetable();
        updateEmptyState();
        updateNowLine();
      }
    };

    window.addEventListener('afterprint', restore, { once: true });
    window.setTimeout(() => {
      window.print();
      window.setTimeout(restore, 1200);
    }, 160);
  }

  function onStorageChange(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea !== window.localStorage) return;

    state.plans = loadPlans();
    state.hiddenCategories.clear();
    renderAll();
    showToast('已同步另一个标签页里的修改');
  }

  /* ------------------------------------------------------------------------
     弹窗 & 提示
     ------------------------------------------------------------------------ */

  function openDataDialog() {
    closeDialog(dom.planDialog);
    openDialog(dom.dataDialog);
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function onDocumentClick(event) {
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) {
      const dialog = closer.closest('dialog');
      closeDialog(dialog);
    }
  }

  function onDialogBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeDialog(event.currentTarget);
    }
  }

  function showToast(message, options = {}) {
    const { type = 'success', actionLabel = '', onAction = null, duration = 3800 } = options;
    window.clearTimeout(state.toastTimer);
    state.toastAction = onAction;

    dom.toastMessage.textContent = message;
    dom.toast.classList.toggle('is-error', type === 'error');
    dom.toastIcon.querySelector('use').setAttribute('href', type === 'error' ? '#i-close' : '#i-check');

    if (actionLabel && onAction) {
      dom.toastAction.textContent = actionLabel;
      dom.toastAction.hidden = false;
    } else {
      dom.toastAction.hidden = true;
      dom.toastAction.textContent = '';
    }

    dom.toast.hidden = false;
    dom.toast.style.animation = 'none';
    void dom.toast.offsetWidth;
    dom.toast.style.animation = '';

    state.toastTimer = window.setTimeout(() => {
      dom.toast.hidden = true;
      state.toastAction = null;
    }, duration);
  }

  function runToastAction() {
    const action = state.toastAction;
    state.toastAction = null;
    dom.toast.hidden = true;
    window.clearTimeout(state.toastTimer);
    if (typeof action === 'function') action();
  }

  function onGlobalKeydown(event) {
    const target = event.target;
    const isFormField = target instanceof HTMLElement
      && (target.matches('input, textarea, select, button') || target.isContentEditable);
    const hasOpenDialog = Boolean(document.querySelector('dialog[open]'));

    if (event.key === 'Escape') {
      return;
    }

    if ((event.key === 'n' || event.key === 'N') && !isFormField && !hasOpenDialog && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openAddDefault();
    }
  }

  /* ------------------------------------------------------------------------
     PWA
     ------------------------------------------------------------------------ */

  function onBeforeInstallPrompt(event) {
    event.preventDefault();
    state.installPrompt = event;
    if (dom.installBtn) dom.installBtn.hidden = false;
  }

  async function installApp() {
    if (!state.installPrompt) return;
    const prompt = state.installPrompt;
    state.installPrompt = null;

    try {
      prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === 'accepted') {
        dom.installBtn.hidden = true;
        closeDialog(dom.dataDialog);
        showToast('已经装到桌面啦，下次直接点鲸历图标');
      }
    } catch (error) {
      console.warn('鲸历：安装提示未完成', error);
    }
  }

  function onAppInstalled() {
    dom.installBtn.hidden = true;
    closeDialog(dom.dataDialog);
    showToast('已经装到桌面啦');
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(window.location.protocol)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.info('鲸历：离线缓存未启用。', error);
      });
    });
  }

  /* ------------------------------------------------------------------------
     时钟
     ------------------------------------------------------------------------ */

  function startClock() {
    window.setInterval(() => tickClock(false), 30000);
  }

  function tickClock(force) {
    const now = new Date();
    const nextDateKey = dateKey(now);

    if (force || nextDateKey !== state.lastDateKey) {
      renderAll();
      return;
    }

    if (now.getHours() !== state.lastHour) {
      state.lastHour = now.getHours();
      renderDateAndGreeting(now);
      renderHero(now);
      updateNowLine();
      return;
    }

    updateNowLine();
  }

  /* ------------------------------------------------------------------------
     小工具
     ------------------------------------------------------------------------ */

  function todayIndex() {
    const day = new Date().getDay();
    return day === 0 ? 7 : day;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function getMonday(date) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay() === 0 ? 7 : result.getDay();
    result.setDate(result.getDate() - (day - 1));
    return result;
  }

  function addDays(date, amount) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + amount);
    return result;
  }

  function formatWeekRange(start, end) {
    const startText = `${start.getMonth() + 1}月${start.getDate()}日`;
    const endText = start.getFullYear() === end.getFullYear()
      ? `${end.getMonth() + 1}月${end.getDate()}日`
      : `${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
    return `${startText} – ${endText}`;
  }

  function getGreeting(hour) {
    if (hour < 5) return { lead: '夜深啦，', line: '剩下的明天再游过去。' };
    if (hour < 9) return { lead: '早上好呀，', line: '今天也慢慢来。' };
    if (hour < 12) return { lead: '上午好呀，', line: '把重要的事，先做一点点。' };
    if (hour < 14) return { lead: '中午好呀，', line: '先去吃饭，计划不会跑。' };
    if (hour < 18) return { lead: '下午好呀，', line: '今天也慢慢来。' };
    if (hour < 22) return { lead: '晚上好呀，', line: '今天辛苦啦，收个尾吧。' };
    return { lead: '夜深啦，', line: '剩下的明天再游过去。' };
  }

  function timeToMinutes(value) {
    const parsed = parseTime(value);
    return parsed === null ? 0 : parsed;
  }

  function parseTime(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function minutesToTime(minutes) {
    const safe = clamp(Math.round(minutes), 0, 24 * 60);
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function planDuration(plan) {
    return Math.max(timeToMinutes(plan.end) - timeToMinutes(plan.start), 0);
  }

  function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours && mins) return `${hours} 小时 ${mins} 分`;
    if (hours) return `${hours} 小时`;
    return `${mins} 分钟`;
  }

  function formatHoursCompact(minutes) {
    if (!minutes) return '0';
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
  }

  function findPlan(id) {
    return state.plans.find((plan) => plan.id === id) || null;
  }

  function cleanString(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  function isIsoLike(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value);
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function createIcon(id) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  function buildDayOptions() {
    DAYS.forEach((day) => {
      const option = document.createElement('option');
      option.value = String(day.index);
      option.textContent = day.name;
      dom.planDay.append(option);
    });
  }

  function buildCategoryOptions() {
    CATEGORIES.forEach((category) => {
      const label = document.createElement('label');
      label.className = `category-option cat-${category.id}`;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'category';
      input.value = category.id;

      const dot = document.createElement('span');
      dot.className = 'filter-dot';
      dot.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.textContent = category.label;

      label.append(input, dot, text);
      dom.categoryOptions.append(label);
    });
  }

  function buildNoResults() {
    const box = document.createElement('div');
    box.className = 'no-results';
    box.hidden = true;

    const text = document.createElement('p');
    text.textContent = '这些分类暂时都被藏起来了。';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '显示全部分类';
    button.addEventListener('click', () => {
      state.hiddenCategories.clear();
      renderFilters();
      renderTimetable();
      updateEmptyState();
      updateNowLine();
    });

    box.append(text, button);
    dom.timetableWrap.append(box);
    dom.noResults = box;
  }

  // 暴露少量只读信息，方便将来做插件或排查，不影响正常使用。
  window.WhaleWeek = Object.freeze({
    version: APP_VERSION,
    storageKey: STORAGE_KEY
  });
})();
