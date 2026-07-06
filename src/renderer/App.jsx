import React, { useState, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import DayView from './views/DayView';
import WeekView from './views/WeekView';
import MonthView from './views/MonthView';
import YearView from './views/YearView';
import CreateView from './views/CreateView';
import ModelView from './views/ModelView';
import SearchBar from './components/calendar/SearchBar';

const VIEWS = {
  day: DayView,
  week: WeekView,
  month: MonthView,
  year: YearView,
  create: CreateView,
  models: ModelView,
};

export default function App() {
  const [currentView, setCurrentView] = useState('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const ViewComponent = VIEWS[currentView] || DayView;
  const isCreateView = currentView === 'create';
  const isCalendarView = ['day', 'week', 'month', 'year'].includes(currentView);

  const handleTaskCreated = () => {
    setCurrentView('day');
    setCurrentDate(new Date());
    refresh();
  };

  const handleDayClick = (newDate) => {
    setCurrentDate(newDate);
    setCurrentView('day');
  };

  const handleMonthClick = (monthIndex) => {
    const d = new Date(currentDate.getFullYear(), monthIndex, 1);
    setCurrentDate(d);
    setCurrentView('month');
  };

  const handleSearchSelect = (task) => {
    if (task.start_time) {
      setCurrentDate(new Date(task.start_time));
    }
    setCurrentView('day');
  };

  // 监听快捷键：切换到创建页面
  useEffect(() => {
    const handler = () => setCurrentView('create');
    window.electronAPI?.on('shortcut:quick-create', handler);
    return () => window.electronAPI?.removeListener('shortcut:quick-create', handler);
  }, []);

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      <main className="main-content">
        {/* 非日历视图不显示搜索栏 */}
        {isCalendarView && (
          <SearchBar onSelect={handleSearchSelect} />
        )}
        <div key={isCreateView ? 'create' : refreshKey} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <ViewComponent
            date={currentDate}
            onDateChange={setCurrentDate}
            onDayClick={handleDayClick}
            onMonthClick={handleMonthClick}
            onCreated={handleTaskCreated}
            onCancel={() => setCurrentView('day')}
          />
        </div>
      </main>
    </div>
  );
}
