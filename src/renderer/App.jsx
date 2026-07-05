import React, { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import DayView from './views/DayView';
import WeekView from './views/WeekView';
import MonthView from './views/MonthView';
import YearView from './views/YearView';
import SearchBar from './components/calendar/SearchBar';
import VoiceButton from './components/voice/VoiceButton';

const VIEWS = {
  day: DayView,
  week: WeekView,
  month: MonthView,
  year: YearView,
};

export default function App() {
  const [currentView, setCurrentView] = useState('day');
  const [currentDate, setCurrentDate] = useState(new Date());

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const ViewComponent = VIEWS[currentView] || DayView;

  const handleTaskCreated = () => {
    setCurrentView('day');
    setCurrentDate(new Date());
    refresh();
  };

  // 视图联动回调
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

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      <main className="main-content">
        <SearchBar onSelect={handleSearchSelect} />
        <ViewComponent
          date={currentDate}
          onDateChange={setCurrentDate}
          onDayClick={handleDayClick}
          onMonthClick={handleMonthClick}
        />
      </main>
      <VoiceButton onTaskCreated={handleTaskCreated} />
    </div>
  );
}
