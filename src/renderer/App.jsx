import React, { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import DayView from './views/DayView';
import WeekView from './views/WeekView';
import MonthView from './views/MonthView';
import YearView from './views/YearView';
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

  const ViewComponent = VIEWS[currentView] || DayView;

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      <main className="main-content">
        <ViewComponent
          date={currentDate}
          onDateChange={setCurrentDate}
        />
      </main>
      <VoiceButton />
    </div>
  );
}
