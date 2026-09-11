import React, { useState } from 'react';
import { PageId } from './types';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardPage } from './pages/DashboardPage';
import { EquityPage } from './pages/EquityPage';
import { SetupLabPage } from './pages/SetupLabPage';
import { SettingsPage } from './pages/SettingsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');

  return (
    <div className="min-h-screen bg-[#05070A] text-white flex flex-col font-sans select-none antialiased">
      {/* Fixed Left Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
      />

      {/* Fixed Top Header */}
      <TopHeader />

      {/* Main Content Area - scrolls independently */}
      <main
        id="main-content-scroll"
        className="ml-56 pt-12 min-h-screen bg-[#05070A] flex-1 overflow-y-auto"
      >
        <div className="max-w-[1680px] mx-auto p-4 md:p-5 pb-12">
          {currentPage === 'dashboard' && <DashboardPage />}
          {currentPage === 'equity' && <EquityPage />}
          {currentPage === 'setup-lab' && <SetupLabPage />}
          {currentPage === 'settings' && <SettingsPage />}
          {currentPage !== 'dashboard' && currentPage !== 'equity' && currentPage !== 'setup-lab' && currentPage !== 'settings' && (
            <PlaceholderPage pageId={currentPage} />
          )}
        </div>
      </main>
    </div>
  );
}
