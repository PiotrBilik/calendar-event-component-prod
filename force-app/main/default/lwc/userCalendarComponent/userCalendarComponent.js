import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getMyEvents from '@salesforce/apex/UserCalendarController.getMyEvents';
import updateEventStatus from '@salesforce/apex/UserCalendarController.updateEventStatus';
import { encodeDefaultFieldValues } from 'lightning/pageReferenceUtils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_PER_DAY = 24 * 60;
const OVERLAP_PAD = 1;
const RETURN_REFRESH_KEY = 'userCalendarComponent:returnRefreshPending';
const FILTER_STATE_KEY = 'userCalendarComponent:filterState';
const IGNORED_ALERT_KEY = 'userCalendarComponent:ignoredAlertIds';

export default class UserCalendarComponent extends NavigationMixin(LightningElement) {
  @track days = [];
  @track weekdayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  @track timeCols = [];
  @track agendaDays = [];
  @track selectedEventCard = null;
  @track selectedMonthDay = null;

  view = 'agenda';
  current = new Date();
  visibleStart;
  visibleEnd;
  selectedDate = new Date();
  dayEvents = [];
  searchTerm = '';
  callFilter = 'all';
  statusFilter = 'all';
  timeFilter = 'range';
  visibleEventCount = 0;
  shouldRefreshOnReturn = false;
  refreshNonce = Date.now();
  eventLookup = new Map();
  focusHandler;
  visibilityHandler;
  pendingRefreshInterval;
  pendingRefreshTimeout;
  isUpdatingStatus = false;
  ignoredAlertIds = [];
  
  get titleLabel() {
    const opts = { month: 'long', year: 'numeric' };
    if (this.view === 'agenda') {
      const s = this.visibleStart?.toLocaleDateString(undefined, { month:'short', day:'numeric' });
      const e = this.visibleEnd ? new Date(this.visibleEnd.getTime()-MS_PER_DAY)
        .toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
      return `${s} – ${e}`;
    }
    if (this.view === 'week') {
      const s = this.visibleStart?.toLocaleDateString(undefined, { month:'short', day:'numeric' });
      const e = this.visibleEnd ? new Date(this.visibleEnd.getTime()-MS_PER_DAY)
        .toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
      return `${s} – ${e}`;
    }
    if (this.view === 'day') {
      return this.selectedDate.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
    return this.current.toLocaleString(undefined, opts);
  }
  get agendaBtnVariant(){ return this.view === 'agenda' ? 'brand' : 'neutral'; }
  get monthBtnVariant() { return this.view === 'month' ? 'brand' : 'neutral'; }
  get weekBtnVariant()  { return this.view === 'week'  ? 'brand' : 'neutral'; }
  get dayBtnVariant()   { return this.view === 'day'   ? 'brand' : 'neutral'; }
  get showGridHeader()  { return this.view === 'month'; }
  get showGrid()        { return this.view === 'month'; }
  get showAgenda()      { return this.view === 'agenda'; }
  get gridClass()       { return `uc-grid ${this.view === 'week' ? 'uc-grid-week' : ''}`; }
  get showTimeGrid()    { return this.view === 'week' || this.view === 'day'; }
  get showDaySummary()  { return this.view === 'day'; }
  get showDayCampaignSubtitle() { return this.view === 'day'; }
  get timeGridCols()    { return this.timeCols; }
  get searchPlaceholder() { return 'Search calls or campaign IDs'; }
  get eventPreviewClass() {
    return 'uc-preview-card uc-preview-card-modal';
  }
  get showEventPreviewBackdrop() { return this.showEventPreview; }
  get showEventPreview() { return !!this.selectedEventCard; }
  get hasVisibleEvents() { return this.visibleEventCount > 0; }
  get hasActiveFilters() {
    return !!this.searchTerm || this.callFilter !== 'all' || this.statusFilter !== 'all' || this.timeFilter !== 'range';
  }
  get showEmptyState() { return !this.showAgenda && !this.hasVisibleEvents; }
  get showSelectionHint() {
    return this.hasVisibleEvents && !this.selectedEventCard;
  }
  get showClearFilters() {
    return this.hasActiveFilters;
  }
  get activeAlertEvent() {
    const now = new Date();
    const openEvents = Array.from(this.eventLookup.values())
      .filter((ev) => !this.isClosedStatus(ev.Status))
      .filter((ev) => !this.ignoredAlertIds.includes(ev.id))
      .map((ev) => ({
        raw: ev,
        preview: this.buildEventPreview(ev),
        start: new Date(ev.start),
        end: new Date(ev.endd || ev.start)
      }));

    const overdue = openEvents
      .filter((ev) => ev.end < now)
      .sort((a, b) => a.end.getTime() - b.end.getTime())[0];
    if (overdue) {
      return {
        ...overdue.preview,
        alertTitle: 'Needs attention now',
        alertMessage: 'This event is overdue and should be handled first.',
        alertClass: 'uc-alert-banner uc-alert-banner-overdue',
        canIgnore: true,
        canRestoreIgnored: false,
        canOpenQuickActions: true
      };
    }

    return {
      id: 'no-more-events',
      title: 'No more events',
      timeRangeLabel: 'Today',
      statusLabel: 'Clear',
      hasCampaignTag: false,
      campaignTagLabel: '',
      alertTitle: 'All clear',
      alertMessage: 'There are no overdue events left in your current filtered view.',
      alertClass: 'uc-alert-banner uc-alert-banner-upcoming',
      canIgnore: false,
      canRestoreIgnored: this.ignoredAlertIds.length > 0,
      canOpenQuickActions: false
    };
  }
  get showActiveAlert() {
    return !!this.activeAlertEvent;
  }
  get emptyStateTitle() {
    if (this.showAgenda) return 'No events in this range';
    if (this.view === 'day') return 'No events on this day';
    if (this.view === 'week') return 'No events in this week';
    return 'No events in this month';
  }
  get emptyStateMessage() {
    if (this.searchTerm || this.callFilter !== 'all' || this.statusFilter !== 'all' || this.timeFilter !== 'range') {
      return 'Try clearing one of the filters or search terms to bring events back into view.';
    }
    return 'Create a new event or move to a different date range to continue working.';
  }
  get showNowLine() {
    return this.view === 'day' && this.isToday(this.selectedDate || new Date());
  }
  get nowLineStyle() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const topPx = (minutes / 60) * this.hourSlotHeight;
    return `top:${topPx}px;`;
  }
  get daySummaryStats() {
    const selected = this.startOfDay(this.selectedDate || new Date());
    const nextDay = new Date(selected.getTime() + MS_PER_DAY);
    const rows = Array.from(this.eventLookup.values()).filter((ev) => {
      const start = new Date(ev.start);
      const end = new Date(ev.endd || ev.start);
      return start < nextDay && end >= selected;
    });
    const completed = rows.filter((ev) => this.isClosedStatus(ev.Status) && (ev.Status || '').toLowerCase().trim() === 'completed').length;
    const overdue = rows.filter((ev) => this.isOverdueEvent(ev)).length;
    const allDay = rows.filter((ev) => !!ev.allDay).length;
    return {
      totalLabel: `${rows.length} ${rows.length === 1 ? 'event' : 'events'}`,
      completedLabel: `${completed} completed`,
      overdueLabel: `${overdue} overdue`,
      allDayLabel: `${allDay} all day`
    };
  }
  get hours() { return Array.from({length:24}, (_,i)=>String(i).padStart(2,'0')); }
  get hourSlotHeight() { return 56; }
  get callFilterOptions() {
    return [
      { label: 'All calls', value: 'all' },
      { label: 'Hide follow-ups', value: 'hideFollowUps' }
    ];
  }
  get timeFilterOptions() {
    return [
      { label: 'All in view', value: 'range' },
      { label: 'Today', value: 'today' },
      { label: 'Upcoming', value: 'upcoming' },
      { label: 'Overdue', value: 'overdue' }
    ];
  }
  get statusFilterOptions() {
    return [
      { label: 'All statuses', value: 'all' },
      { label: 'Not Started', value: 'not_started' },
      { label: 'Completed', value: 'completed' },
      { label: 'Canceled', value: 'canceled' }
    ];
  }

  connectedCallback() {
    this.current = this.atMidday(new Date());
    this.selectedDate = this.current;
    this.restoreFilterState();
    this.restoreIgnoredAlert();
    if (this.hasPendingReturnRefresh()) {
      this.clearPendingReturnRefresh();
      this.bumpRefreshNonce();
    }
    this.focusHandler = () => this.refreshWhenReturning();
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        this.refreshWhenReturning();
      }
    };
    window.addEventListener('focus', this.focusHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.buildAndLoad();
  }

  disconnectedCallback() {
    window.removeEventListener('focus', this.focusHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.stopPendingRefreshWatcher();
  }

  classForStatus(val) {
    const v = (val || '').toLowerCase().trim();
    if (v === 'not started') return 'uc-status-gray';
    if (v === 'completed')   return 'uc-status-green';
    if (v === 'canceled')    return 'uc-status-red';
    return 'uc-status-default';
  }

  goPrev = () => {
    if (this.view === 'month') this.current = this.addMonths(this.current, -1);
    else if (this.view === 'agenda') this.current = new Date(this.current.getTime() - 7*MS_PER_DAY);
    else if (this.view === 'week') this.current = new Date(this.current.getTime() - 7*MS_PER_DAY);
    else this.selectedDate = new Date(this.selectedDate.getTime() - MS_PER_DAY);
    this.buildAndLoad();
  }
  goNext = () => {
    if (this.view === 'month') this.current = this.addMonths(this.current, 1);
    else if (this.view === 'agenda') this.current = new Date(this.current.getTime() + 7*MS_PER_DAY);
    else if (this.view === 'week') this.current = new Date(this.current.getTime() + 7*MS_PER_DAY);
    else this.selectedDate = new Date(this.selectedDate.getTime() + MS_PER_DAY);
    this.buildAndLoad();
  }
  goToday = () => {
    const t = this.atMidday(new Date());
    this.current = t;
    this.selectedDate = t; 
    this.buildAndLoad();
  }
  refresh = () => {
    this.bumpRefreshNonce();
    this.loadEventsIntoView();
  }

  buildAndLoad() {
    this.selectedEventCard = null;
    this.selectedMonthDay = null;
    if (this.view === 'agenda') {
      this.buildAgenda();
    } else if (this.view === 'week') {
      this.buildWeekGrid();
    } else if (this.view === 'day') {
      this.buildDay();
    } else {
      this.buildMonthGrid();
    }
    this.loadEventsIntoView();
  }

  buildAgenda() {
    const start = this.startOfDay(this.current);
    const end = new Date(start.getTime() + 7 * MS_PER_DAY);
    this.visibleStart = start;
    this.visibleEnd = end;
    this.days = [];
    this.timeCols = [];
    this.agendaDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * MS_PER_DAY);
      return {
        iso: this.toLocalIsoDate(d),
        label: d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }),
        subLabel: this.isToday(d) ? 'Today' : '',
        events: []
      };
    });
  }


   buildMonthGrid() {
    const firstOfMonth = new Date(this.current.getFullYear(), this.current.getMonth(), 1, 0, 0, 0, 0);
    const start = this.startOfCalendar(firstOfMonth);
    const end = new Date(start.getTime() + 42 * MS_PER_DAY); // 6 weeks

    this.visibleStart = start;
    this.visibleEnd = end;

    const tmp = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getTime() + i * MS_PER_DAY);
      const inMonth = d.getMonth() === this.current.getMonth();
      tmp.push({
        key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
        date: d,
        iso: this.toLocalIsoDate(d),
        day: d.getDate(),
        inMonth,
        className: `uc-cell ${inMonth ? '' : 'uc-out'} ${this.isToday(d) ? 'uc-today' : ''}`,
        events: [],
        moreCount: 0
      });
    }
    this.days = tmp;
  }

  buildWeekGrid() {
    const start = this.startOfWeek(this.current);
    const end   = new Date(start.getTime() + 7*MS_PER_DAY);
    this.visibleStart = start;
    this.visibleEnd   = end;

    this.timeCols = Array.from({length:7}, (_,i) => {
      const d = new Date(start.getTime() + i*MS_PER_DAY);
      const isToday = this.isToday(d);
      return {
        iso: this.toLocalIsoDate(d),
        headerLabel: d.toLocaleDateString(undefined, { weekday:'short', day:'numeric' }),
        headerDayLabel: d.toLocaleDateString(undefined, { weekday:'short' }),
        headerDateLabel: d.toLocaleDateString(undefined, { month:'short', day:'numeric' }),
        headerSubLabel: isToday ? 'Today' : '',
        headerClass: `uc-timecol-head ${isToday ? 'uc-timecol-head-today' : ''}`,
        showNowLine: isToday,
        allDay: [],
        timed: [],
        timedCount: 0,
        overdueCount: 0
      };
    });
    this.days = [];
  }

  buildDay() {
    const d = this.selectedDate || this.current;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end   = new Date(start.getTime() + MS_PER_DAY);

    this.visibleStart = start;
    this.visibleEnd   = end;

    this.timeCols = [{
      iso: this.toLocalIsoDate(start),
      headerLabel: start.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'short' }),
      showNowLine: this.isToday(start),
      allDay: [],
      timed: []
    }];
    this.days = [];
  }

  async loadEventsIntoView() {
    try {
      const events = await getMyEvents({
        start: this.visibleStart.toISOString(),
        endd:  this.visibleEnd.toISOString(),
        cacheBust: this.refreshNonce
      });
      const filteredEvents = (events || []).filter((ev) => this.eventMatchesFilters(ev));
      this.eventLookup = new Map(filteredEvents.map((ev) => [ev.id, ev]));
      this.visibleEventCount = filteredEvents.length;
      if (this.selectedEventCard) {
        const refreshedSelectedEvent = this.eventLookup.get(this.selectedEventCard.id);
        this.selectedEventCard = refreshedSelectedEvent ? this.buildEventPreview(refreshedSelectedEvent) : null;
      }

      if (this.showAgenda) {
        const agendaByIso = new Map(this.agendaDays.map(day => [day.iso, { ...day, events: [] }]));
        for (const raw of filteredEvents) {
          const start = new Date(raw.start);
          const end = new Date(raw.endd || raw.start);
          const iso = this.toLocalIsoDate(this.startOfDay(start));
          const bucket = agendaByIso.get(iso);
          if (!bucket) continue;
          bucket.events.push(this.normalizeAgendaEvent(raw, start, end));
        }
        this.agendaDays = Array.from(agendaByIso.values()).map(day => ({
          ...day,
          events: day.events.sort((a, b) => this.compareAgendaEvents(a, b))
        }));
        return;
      }

      if (this.showTimeGrid) {
        const freshCols = this.timeCols.map((col) => ({ ...col, allDay: [], timed: [] }));
        const colsByIso = new Map(freshCols.map(c => [c.iso, c]));

        for (const raw of filteredEvents) {
          const start = new Date(raw.start);
          const end   = new Date(raw.endd || raw.start);

          for (let d = this.startOfDay(start); d <= this.startOfDay(end); d = new Date(d.getTime() + MS_PER_DAY)) {
            const iso = this.toLocalIsoDate(d);
            const col = colsByIso.get(iso);
            if (!col) continue;

            const dayStart = new Date(`${iso}T00:00:00`);
            const dayEnd   = new Date(dayStart.getTime() + MS_PER_DAY);

            const s = new Date(Math.max(start.getTime(), dayStart.getTime()));
            const e = new Date(Math.min(end.getTime(),   dayEnd.getTime()));

            const isAllDay = !!raw.allDay || (this.startOfDay(e) > this.startOfDay(s) && (e - s) >= (MS_PER_DAY - 60*1000));
            const hh = (n)=>String(n).padStart(2,'0');
            const preview = this.buildEventPreview(raw, start, end);

            const base = {
              id: raw.id,
              title: preview.title,
              rawTitle: raw.title || 'Event',
              timeRangeLabel: `${hh(s.getHours())}:${hh(s.getMinutes())} – ${hh(e.getHours())}:${hh(e.getMinutes())}`,
              dotStyle: this.dotStyleForStatus(raw.Status),
              previewTitle: preview.title,
              previewTime: preview.timeRangeLabel,
              previewStatus: preview.statusLabel,
              campaignTagLabel: preview.campaignTagLabel,
              campaignName: preview.campaignName,
              campaignMemberId: preview.campaignMemberId,
              hasCampaignMemberLink: preview.hasCampaignMemberLink,
              hasCampaignTag: preview.hasCampaignTag,
              isOverdue: preview.isOverdue
            };

            if (isAllDay) {
              col.allDay.push({ ...base, style: this.styleForStatus(raw.Status) });
            } else {
              const minsStart = s.getHours()*60 + s.getMinutes();
              const minsEnd   = e.getHours()*60 + e.getMinutes();
              const topPct    = (minsStart / MIN_PER_DAY) * 100;
              const heightPct = Math.max(2, ((Math.max(1, minsEnd - minsStart)) / MIN_PER_DAY) * 100);

              const colorStyle = this.styleForStatus(raw.Status);
              const posStyle   = `top:${topPct}%;height:${heightPct}%;`;
              col.timed.push({
                ...base,
                key: `${raw.id}-${minsStart}`,
                statusClass: this.classForStatus(raw.Status),
                posStyle: `top:${topPct}%;height:${heightPct}%;`,
                sortKey: minsStart,
                style: this.styleForStatus(raw.Status) 
                
              });
            }
          }
        }

        this.timeCols = freshCols.map(c => {
        const col = {
          ...c,
          timed: c.timed.sort((a,b) => (a.sortKey ?? 0) - (b.sortKey ?? 0)),
          timedCount: c.timed.length + c.allDay.length,
          overdueCount: [...c.timed, ...c.allDay].filter((ev) => ev.isOverdue).length
        };
        this.layoutTimedColumn(col); 
        return col;
      });
      return;
      }


      const buckets = new Map();
      for (const ev of filteredEvents) {
        const s = new Date(ev.start);
        const e = new Date(ev.endd || ev.start);
        for (let d = this.startOfDay(s); d <= this.startOfDay(e); d = new Date(d.getTime() + MS_PER_DAY)) {
          const key = this.toLocalIsoDate(d);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(this.normalizeEvent(ev, d));
        }
      }
      this.days = this.days.map(cell => {
        const dayEvents = (buckets.get(cell.iso) || []).sort((a,b) => (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0));
        return {
          ...cell,
          events: dayEvents,
          moreCount: 0,
          eventCount: dayEvents.length,
          eventCountLabel: dayEvents.length === 1 ? '1 event' : `${dayEvents.length} events`,
          hasEvents: dayEvents.length > 0
        };
      });
    } catch (e) {
      console.error('Failed to load events', e);
      this.visibleEventCount = 0;
      this.eventLookup = new Map();
    }
  }

  setMonth = () => { this.view = 'month'; this.buildAndLoad(); }
  setWeek  = () => { this.view = 'week';  this.buildAndLoad(); }
  setDay   = () => { this.view = 'day';   this.selectedDate = this.atMidday(this.selectedDate || this.current); this.buildAndLoad(); }
  setAgenda = () => { this.view = 'agenda'; this.current = this.atMidday(this.current); this.buildAndLoad(); }

  handleSearchChange = (evt) => {
    this.searchTerm = evt.target.value || '';
    this.persistFilterState();
    this.buildAndLoad();
  }

  handleFilterChange = (evt) => {
    this.callFilter = evt.detail.value;
    this.persistFilterState();
    this.buildAndLoad();
  }

  handleTimeFilterChange = (evt) => {
    this.timeFilter = evt.detail.value;
    this.persistFilterState();
    this.buildAndLoad();
  }

  handleStatusFilterChange = (evt) => {
    this.statusFilter = evt.detail.value;
    this.persistFilterState();
    this.buildAndLoad();
  }

  handleClearFilters = () => {
    this.searchTerm = '';
    this.callFilter = 'all';
    this.statusFilter = 'all';
    this.timeFilter = 'range';
    this.persistFilterState();
    this.buildAndLoad();
  }

  handleMenuSelect = (evt) => {
    if (evt.detail?.value === 'refresh') {
      this.refresh();
    }
  }


  async loadEventsIntoGrid() {
    try {
      const events = await getMyEvents({
        start: this.visibleStart.toISOString(),
        endd: this.visibleEnd.toISOString()
      });

      if (this.showTimeGrid) {
        const colsByIso = new Map(this.timeCols.map(c => [c.iso, c]));
        for (const raw of (events || [])) {
          const start = new Date(raw.start);
          const end   = new Date(raw.endd || raw.start);
          for (let d = this.startOfDay(start); d <= this.startOfDay(end); d = new Date(d.getTime() + MS_PER_DAY)) {
            const iso = this.toLocalIsoDate(d);
            const col = colsByIso.get(iso);
            if (!col) continue;

            const dayStart = new Date(`${iso}T00:00:00`);
            const dayEnd   = new Date(dayStart.getTime() + MS_PER_DAY);

            const s = new Date(Math.max(start.getTime(), dayStart.getTime()));
            const e = new Date(Math.min(end.getTime(),   dayEnd.getTime()));

            const isAllDay = !!raw.allDay || (this.startOfDay(e) > this.startOfDay(s) && (e - s) >= (MS_PER_DAY - 60*1000));
            const hh = (n)=>String(n).padStart(2,'0');

            const base = {
              id: raw.id,
              title: raw.title || 'Event',
              timeRangeLabel: `${hh(s.getHours())}:${hh(s.getMinutes())} – ${hh(e.getHours())}:${hh(e.getMinutes())}`,
              style: this.styleForStatus(raw.Status),
              dotStyle: this.dotStyleForStatus(raw.Status)
            };

            if (isAllDay) {
              col.allDay.push(base);
            } else {
              const minsStart = s.getHours()*60 + s.getMinutes();
              const minsEnd   = e.getHours()*60 + e.getMinutes();
              const topPct    = (minsStart / MIN_PER_DAY) * 100;
              const heightPct = Math.max(2, ((Math.max(1, minsEnd - minsStart)) / MIN_PER_DAY) * 100);

              col.timed.push({
              ...base,
              statusClass: this.classForStatus(raw.Status),
              posStyle: `top:${topPct}%;height:${heightPct}%;`,
              sortKey: minsStart
            });
            }
          }
        }

        this.timeCols = this.timeCols.map(c => {
        const col = {
          ...c,
          allDay: c.allDay,
          timed: c.timed.sort((a,b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
        };
        this.layoutTimedColumn(col);
        return col;
      });
      return;
      }
      const buckets = new Map();
      for (const ev of (events || [])) {
        const start = new Date(ev.start);
        const end = new Date(ev.endd || ev.start);

        for (let d = this.startOfDay(start); d <= this.startOfDay(end); d = new Date(d.getTime() + MS_PER_DAY)) {
          const key = this.toLocalIsoDate(d);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(this.normalizeEvent(ev, d));
        }
      }

      this.days = this.days.map(cell => {
        const dayEvents = (buckets.get(cell.iso) || []).sort((a,b) => (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0));
        const visible = dayEvents.slice(0, 5);
        const more = Math.max(0, dayEvents.length - visible.length);
        return { ...cell, events: visible, moreCount: more };
      });
    } catch (e) {
      console.error('Failed to load events', e);
    }
  }

  // --- Event interaction ---
  handleEventClick = (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    if (!id) return;

    const raw = this.eventLookup.get(id);
    if (raw) {
      this.selectedEventCard = this.buildEventPreview(raw);
      if (this.view === 'month') {
        this.selectedMonthDay = null;
      }
    }
  }

  handleDateClick = (evt) => {
    const iso = evt.currentTarget?.dataset?.datestr;
    if (!iso) return;

    if (this.view === 'month') {
      this.selectedDate = this.dateFromIsoAtMidday(iso);
      return;
    }

    if (this.view !== 'day') {
      this.selectedDate = this.dateFromIsoAtMidday(iso);
      this.setDay();
      return;
    }
    this.quickCreate(iso);
  }

  handleAgendaNewEvent = (evt) => {
    evt.stopPropagation();
    const iso = evt.currentTarget?.dataset?.datestr;
    if (!iso) return;
    this.quickCreate(iso);
  }

  handleEditEvent = (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    if (!id) return;
    this.openEventRecord(id, 'edit');
  }

  handleOpenRecord = (evt) => {
    evt.stopPropagation();
    const recordId = evt.currentTarget?.dataset?.recordId;
    const objectApiName = evt.currentTarget?.dataset?.objectApiName;
    if (!recordId || !objectApiName) return;
    this.markForRefreshOnReturn();
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId, objectApiName, actionName: 'view' }
    });
  }

  handlePreviewOpenEvent = (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    if (!id) return;
    this.openEventRecord(id, 'view');
  }

  clearSelectedEvent = () => {
    this.selectedEventCard = null;
  }

  handleAlertOpenEvent = (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    if (!id) return;
    const raw = this.eventLookup.get(id);
    if (!raw) return;
    this.selectedEventCard = this.buildEventPreview(raw);
  }

  handleIgnoreAlert = (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    if (!id) return;
    if (!this.ignoredAlertIds.includes(id)) {
      this.ignoredAlertIds = [...this.ignoredAlertIds, id];
    }
    this.persistIgnoredAlert();
  }

  handleRestoreIgnoredAlerts = (evt) => {
    evt.stopPropagation();
    this.ignoredAlertIds = [];
    this.persistIgnoredAlert();
  }

  handleQuickStatus = async (evt) => {
    evt.stopPropagation();
    const id = evt.currentTarget?.dataset?.id;
    const statusValue = evt.currentTarget?.dataset?.status;
    if (!id || !statusValue || this.isUpdatingStatus) return;

    this.isUpdatingStatus = true;
    try {
      await updateEventStatus({ eventId: id, statusValue });
      this.bumpRefreshNonce();
      await this.loadEventsIntoView();
    } catch (e) {
      console.error('Failed to update event status', e);
    } finally {
      this.isUpdatingStatus = false;
    }
  }

  clearSelectedMonthDay = () => {
    this.selectedMonthDay = null;
  }

  quickCreate(isoDate) {
    const start = new Date(isoDate + 'T09:00:00');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const defaults = encodeDefaultFieldValues({
      StartDateTime: start.toISOString(),
      EndDateTime: end.toISOString(),
      IsAllDayEvent: false
    });
    this.markForRefreshOnReturn();
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: 'Event', actionName: 'new' },
      state: { defaultFieldValues: defaults }
    });
  }

  openEventRecord(id, actionName) {
    this.markForRefreshOnReturn();
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'Event', actionName }
    });
  }

  markForRefreshOnReturn() {
    this.shouldRefreshOnReturn = true;
    this.storePendingReturnRefresh();
    this.startPendingRefreshWatcher();
  }

  refreshWhenReturning() {
    if (!this.shouldRefreshOnReturn && !this.hasPendingReturnRefresh()) return;
    this.shouldRefreshOnReturn = false;
    this.clearPendingReturnRefresh();
    this.stopPendingRefreshWatcher();
    this.bumpRefreshNonce();
    this.loadEventsIntoView();
  }

  bumpRefreshNonce() {
    this.refreshNonce = Date.now();
  }

  storePendingReturnRefresh() {
    try {
      sessionStorage.setItem(RETURN_REFRESH_KEY, '1');
    } catch (e) {
      // Ignore storage issues and keep in-memory fallback only.
    }
  }

  hasPendingReturnRefresh() {
    try {
      return sessionStorage.getItem(RETURN_REFRESH_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  clearPendingReturnRefresh() {
    try {
      sessionStorage.removeItem(RETURN_REFRESH_KEY);
    } catch (e) {
      // Ignore storage issues.
    }
  }

  persistFilterState() {
    try {
      sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
        searchTerm: this.searchTerm || '',
        callFilter: this.callFilter || 'all',
        statusFilter: this.statusFilter || 'all',
        timeFilter: this.timeFilter || 'range'
      }));
    } catch (e) {
      // Ignore storage issues and keep in-memory state only.
    }
  }

  restoreFilterState() {
    try {
      const raw = sessionStorage.getItem(FILTER_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.searchTerm = typeof parsed?.searchTerm === 'string' ? parsed.searchTerm : '';
      this.callFilter = this.isAllowedFilterValue(parsed?.callFilter, ['all', 'hideFollowUps']) ? parsed.callFilter : 'all';
      this.statusFilter = this.isAllowedFilterValue(parsed?.statusFilter, ['all', 'not_started', 'completed', 'canceled']) ? parsed.statusFilter : 'all';
      this.timeFilter = this.isAllowedFilterValue(parsed?.timeFilter, ['range', 'today', 'upcoming', 'overdue']) ? parsed.timeFilter : 'range';
    } catch (e) {
      // Ignore invalid storage payloads and fall back to defaults.
    }
  }

  persistIgnoredAlert() {
    try {
      if (this.ignoredAlertIds.length) {
        sessionStorage.setItem(IGNORED_ALERT_KEY, JSON.stringify(this.ignoredAlertIds));
      } else {
        sessionStorage.removeItem(IGNORED_ALERT_KEY);
      }
    } catch (e) {
      // Ignore storage issues.
    }
  }

  restoreIgnoredAlert() {
    try {
      const raw = sessionStorage.getItem(IGNORED_ALERT_KEY);
      if (!raw) {
        this.ignoredAlertIds = [];
        return;
      }
      const parsed = JSON.parse(raw);
      this.ignoredAlertIds = Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
    } catch (e) {
      this.ignoredAlertIds = [];
    }
  }

  isAllowedFilterValue(value, allowedValues) {
    return typeof value === 'string' && allowedValues.includes(value);
  }

  startPendingRefreshWatcher() {
    this.stopPendingRefreshWatcher();

    this.pendingRefreshInterval = window.setInterval(() => {
      if (!this.shouldRefreshOnReturn && !this.hasPendingReturnRefresh()) {
        this.stopPendingRefreshWatcher();
        return;
      }
      this.bumpRefreshNonce();
      this.loadEventsIntoView();
    }, 3000);

    this.pendingRefreshTimeout = window.setTimeout(() => {
      this.shouldRefreshOnReturn = false;
      this.clearPendingReturnRefresh();
      this.stopPendingRefreshWatcher();
    }, 120000);
  }

  stopPendingRefreshWatcher() {
    if (this.pendingRefreshInterval) {
      window.clearInterval(this.pendingRefreshInterval);
      this.pendingRefreshInterval = null;
    }
    if (this.pendingRefreshTimeout) {
      window.clearTimeout(this.pendingRefreshTimeout);
      this.pendingRefreshTimeout = null;
    }
  }

  // --- Styling helpers ---
  styleForStatus(val) {
    const v = (val || '').toLowerCase().trim();
    if (v === 'not started') return 'background:#f3f3f3;color:#666;border-color:#dcdcdc';
    if (v === 'completed')   return 'background:#e7f7ec;color:#087a2e;border-color:#c1e4c7';
    if (v === 'canceled')    return 'background:#fdeaea;color:#a61b1b;border-color:#f2bcbc';
    return 'background:#f3f9ff;color:#0b5cab;border-color:#e0efff';
  }

  dotStyleForStatus(val) {
    const v = (val || '').toLowerCase().trim();
    if (v === 'not started') return 'background:#909090';
    if (v === 'completed')   return 'background:#2e844a';
    if (v === 'canceled')    return 'background:#ba0517';
    return '';
  }

  normalizeEvent(ev, dayStart) {
    const preview = this.buildEventPreview(ev);
    const dayKey = dayStart ? this.toLocalIsoDate(dayStart) : '';

    return {
      key: `${ev.id}-${dayKey}`,  // ✅ unique key
      id: preview.id,
      title: preview.rawTitle,
      condensedTitle: preview.title,
      timeLabel: preview.shortTimeLabel,
      startTimeMs: preview.startTimeMs,
      style: this.styleForStatus(ev.Status),
      dotStyle: this.dotStyleForStatus(ev.Status),
      campaignTagLabel: preview.campaignTagLabel,
      hasCampaignTag: preview.hasCampaignTag,
      campaignName: preview.campaignName,
      campaignMemberId: preview.campaignMemberId,
      hasCampaignMemberLink: preview.hasCampaignMemberLink,
      canMarkCompleted: preview.canMarkCompleted,
      canMarkCanceled: preview.canMarkCanceled
    };
  }

  normalizeAgendaEvent(ev, start, end) {
    const preview = this.buildEventPreview(ev, start, end);

    return {
      key: preview.id,
      id: preview.id,
      className: `uc-agenda-item uc-status-card ${this.classForStatus(ev.Status)}`,
      title: preview.rawTitle,
      displayTitle: preview.title,
      startTimeMs: preview.startTimeMs,
      category: preview.category,
      typeLabel: preview.typeLabel,
      typeClass: preview.typeClass,
      timeRangeLabel: preview.timeRangeLabel,
      metaLabel: preview.metaLabel,
      statusLabel: preview.statusLabel,
      statusClass: this.classForStatus(ev.Status),
      isOverdue: preview.isOverdue,
      hasCampaignTag: preview.hasCampaignTag,
      campaignTagLabel: preview.campaignTagLabel,
      campaignName: preview.campaignName,
      hasCampaignName: preview.hasCampaignName,
      campaignTooltip: preview.campaignTooltip,
      hasCampaignMemberLink: preview.hasCampaignMemberLink,
      campaignMemberId: preview.campaignMemberId,
      hasActionRow: true,
      canMarkCompleted: preview.canMarkCompleted,
      canMarkCanceled: preview.canMarkCanceled
    };
  }

  buildEventPreview(ev, explicitStart, explicitEnd) {
    const start = explicitStart ? new Date(explicitStart) : new Date(ev.start);
    const end = explicitEnd ? new Date(explicitEnd) : new Date(ev.endd || ev.start);
    const sameDay = start.toDateString() === end.toDateString();
    const hh = (n) => String(n).padStart(2, '0');
    const rawTitle = ev.title || 'Event';
    const title = this.getDisplayTitle(rawTitle);
    const statusLabel = ev.Status || 'Planned';
    const normalizedStatus = (ev.Status || '').toLowerCase().trim();
    const category = this.getEventCategory(rawTitle);
    const campaignTagLabel = this.getCampaignTagLabel(ev.campaignLabel);
    const campaignName = (ev.campaignName || '').trim();
    const shortTimeLabel = !ev.allDay && sameDay ? `${hh(start.getHours())}:${hh(start.getMinutes())}` : '';
    const timeRangeLabel = ev.allDay
      ? 'All day'
      : `${hh(start.getHours())}:${hh(start.getMinutes())} – ${hh(end.getHours())}:${hh(end.getMinutes())}`;

    return {
      id: ev.id,
      rawTitle,
      title,
      startTimeMs: start.getTime(),
      timeRangeLabel,
      shortTimeLabel,
      statusLabel,
      category,
      typeLabel: this.labelForCategory(category),
      typeClass: this.classForCategory(category),
      isOverdue: this.isOverdueEvent(ev),
      metaLabel: rawTitle === title ? statusLabel : rawTitle,
      hasCampaignTag: !!campaignTagLabel,
      campaignTagLabel,
      campaignName,
      hasCampaignName: !!campaignName && campaignName !== campaignTagLabel,
      campaignTooltip: campaignName || campaignTagLabel,
      hasCampaignMemberLink: !!ev.campaignMemberId,
      campaignMemberId: ev.campaignMemberId,
      canMarkCompleted: normalizedStatus !== 'completed',
      canMarkCanceled: normalizedStatus !== 'canceled'
    };
  }

  compareAgendaEvents(a, b) {
    return (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0);
  }

  getDisplayTitle(title) {
    if (!title) return 'Event';

    const normalized = this.cleanTitle(title);
    const followUpMatch = normalized.match(/^(?:Follow-up Call|Scheduled Callback)(?:\s*-\s*Attempt\s*\d+)?\s*[–-]\s*(.+)$/i);
    if (followUpMatch?.[1]) return followUpMatch[1].trim();

    return normalized;
  }

  getEventCategory(title) {
    const normalized = this.cleanTitle(title).toLowerCase();
    if (normalized.includes('scheduled callback')) return 'scheduled';
    if (normalized.includes('follow-up call')) return 'followup';
    return 'other';
  }

  cleanTitle(title) {
    return (title || '')
      .replace(/\[sample[^\]]*\]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  labelForCategory(category) {
    if (category === 'scheduled') return 'Scheduled call';
    if (category === 'followup') return 'Follow-up';
    return 'Other';
  }

  classForCategory(category) {
    if (category === 'scheduled') return 'uc-type-badge uc-type-scheduled';
    if (category === 'followup') return 'uc-type-badge uc-type-followup';
    return 'uc-type-badge uc-type-other';
  }

  getCampaignTagLabel(campaignLabel) {
    const normalized = (campaignLabel || '').trim();
    if (!normalized) return '';

    const codeMatch = normalized.match(/\b([A-Z]{2,}\d{2,})\b/);
    if (codeMatch?.[1]) {
      return codeMatch[1];
    }

    return normalized;
  }

  eventMatchesFilters(ev) {
    const rawTitle = ev?.title || '';
    const displayTitle = this.getDisplayTitle(rawTitle);
    const category = this.getEventCategory(rawTitle);
    const searchValue = this.searchTerm.trim().toLowerCase();
    const campaignTagLabel = this.getCampaignTagLabel(ev?.campaignLabel);
    const campaignName = (ev?.campaignName || '').trim();
    const normalizedStatus = (ev?.Status || '').toLowerCase().trim();

    if (this.callFilter === 'hideFollowUps' && category === 'followup') return false;
    if (!this.matchesStatusFilter(normalizedStatus)) return false;
    if (!this.matchesTimeFilter(ev)) return false;

    if (!searchValue) return true;

    const haystack = `${rawTitle} ${displayTitle} ${campaignTagLabel} ${campaignName}`.toLowerCase();
    return haystack.includes(searchValue);
  }

  matchesStatusFilter(normalizedStatus) {
    if (this.statusFilter === 'all') return true;
    if (this.statusFilter === 'not_started') return normalizedStatus === 'not started';
    if (this.statusFilter === 'completed') return normalizedStatus === 'completed';
    if (this.statusFilter === 'canceled') return normalizedStatus === 'canceled';
    return true;
  }

  matchesTimeFilter(ev) {
    if (this.timeFilter === 'range') return true;

    const start = new Date(ev.start);
    const end = new Date(ev.endd || ev.start);
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const tomorrowStart = new Date(todayStart.getTime() + MS_PER_DAY);
    const isClosed = this.isClosedStatus(ev.Status);

    if (this.timeFilter === 'today') {
      return start < tomorrowStart && end >= todayStart;
    }
    if (this.timeFilter === 'upcoming') {
      return !isClosed && end >= now;
    }
    if (this.timeFilter === 'overdue') {
      return !isClosed && end < now;
    }
    return true;
  }

  isClosedStatus(statusValue) {
    const normalized = (statusValue || '').toLowerCase().trim();
    return normalized === 'completed' || normalized === 'canceled';
  }

  isOverdueEvent(ev) {
    const end = new Date(ev.endd || ev.start);
    return !this.isClosedStatus(ev.Status) && end < new Date();
  }

  // --- Date helpers ---
  startOfCalendar(firstOfMonth) {
    const d = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1, 0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0,0,0,0);
    return d;
  }

  startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // Monday start
    d.setDate(d.getDate() - day);
    d.setHours(0,0,0,0);
    return d;
  }
  addMonths(date, n) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + n);
    d.setDate(1);
    d.setHours(12,0,0,0);
    return d;
  }

  startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  dateFromIsoAtMidday(isoDate) {
    const [year, month, day] = (isoDate || '').split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  }

  toLocalIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  atMidday(date) {
    const d = new Date(date.getTime());
    d.setHours(12,0,0,0);
    return d;
  }

  isToday(date) {
    const t = new Date(); t.setHours(0,0,0,0);
    return date.getFullYear() === t.getFullYear()
        && date.getMonth() === t.getMonth()
        && date.getDate() === t.getDate();
  }

   openNewEvent(start, end, isAllDay = false) {
    const defaults = encodeDefaultFieldValues({
      StartDateTime: start.toISOString(),
      EndDateTime: end.toISOString(),
      IsAllDayEvent: isAllDay
    });
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: 'Event', actionName: 'new' },
      state: { defaultFieldValues: defaults }
    });
  }

  handleNewEventClick = () => {
    let base = this.view === 'day'
      ? (this.selectedDate || this.current)
      : this.current;
    const now = new Date();
    const startHour = now.getMinutes() ? now.getHours() + 1 : now.getHours();
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), startHour, 0, 0, 0);
    const end   = new Date(start.getTime() + 60 * 60 * 1000);
    this.openNewEvent(start, end,  false);
  };

  layoutTimedColumn(col) {
    const items = col.timed.map(ev => {
      const topPct = this.extractPercent(ev.posStyle, 'top');
      const heightPct = this.extractPercent(ev.posStyle, 'height');
      const startMin = Math.round((topPct / 100) * MIN_PER_DAY);
      const durationMin = Math.max(1, Math.round((heightPct / 100) * MIN_PER_DAY));
      const endMin = startMin + durationMin;
      return { ev, startMin, endMin };
    });

    items.sort((a,b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

    let active = [];
    let groupId = -1;
    const groupMax = new Map();
    for (const it of items) {
      active = active.filter(a => a.endMin > (it.startMin - OVERLAP_PAD));
      if (active.length === 0) groupId++;
      const used = new Set(active.map(a => a.lane));
      let lane = 0; while (used.has(lane)) lane++;
      it.lane = lane;
      it.group = groupId;
      active.push(it);
      groupMax.set(groupId, Math.max(groupMax.get(groupId) || 0, lane + 1));
    }

    for (const it of items) {
      const lanes = groupMax.get(it.group) || 1;
      const lane  = it.lane || 0;
      const width = lanes > 1
        ? `calc((100% / ${lanes}) - 8px)`
        : 'calc(100% - 12px)';
      const left = lanes > 1
        ? `calc((100% / ${lanes}) * ${lane} + 4px)`
        : '6px';

      it.ev.style = `${it.ev.posStyle || ''}left:${left};width:${width};${it.ev.style || ''}`;
    }
  }

  extractPercent(styleText, propertyName) {
    const match = styleText?.match(new RegExp(`${propertyName}:\\s*([\\d.]+)%`));
    return match ? Number(match[1]) : 0;
  }

}
