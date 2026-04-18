import { createRoot } from 'react-dom/client';
import { StrictMode, useState } from 'react';
import '../ui/styles/globals.css';
import { ThemeProvider } from '../ui/app-shell/ThemeProvider';
import { Toaster } from '../ui/app-shell/Toaster';
import { SiteHeader } from '../ui/branded/SiteHeader';
import { SiteFooter } from '../ui/branded/SiteFooter';
import { HeroSection } from '../ui/branded/HeroSection';
import { PricingSection } from '../ui/branded/PricingSection';
import { FinalCTASection } from '../ui/branded/FinalCTASection';
import { AccountSettings } from '../ui/branded/AccountSettings';

function PricingPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <ThemeProvider>
      <div className="hanzo-chrome font-inter min-h-screen bg-background text-foreground">
        <SiteHeader onOpenSettings={() => setSettingsOpen(true)} />
        <AccountSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
        <main>
          <HeroSection />
          <PricingSection />
          <FinalCTASection />
        </main>
        <SiteFooter />
        <Toaster />
      </div>
    </ThemeProvider>
  );
}

const el = document.getElementById('pricing-root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <PricingPage />
    </StrictMode>,
  );
}
