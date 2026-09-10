import { Route, Routes } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { UserProvider, useUser } from './context/UserContext';
import { useSteps } from './hooks/useSteps';
import TabBar from './components/layout/TabBar';
import Home from './pages/Home';
import MapPage from './pages/MapPage';
import Offers from './pages/Offers';
import Referral from './pages/Referral';
import Wallet from './pages/Wallet';
import Merchant from './pages/Merchant';
import Onboarding from './pages/Onboarding';

const TON_MANIFEST_URL =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? '/tonconnect-manifest.json';

function AppShell() {
  const { profile, loading, error } = useUser();
  // Held here so onboarding and the home screen share one counter — mounting
  // useSteps twice would run two independent tallies.
  const steps = useSteps();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-white/50">
        Loading Pulse Radar…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center px-8 text-center text-white/60">
        {error}
      </div>
    );
  }

  if (profile && !profile.onboarded_at) {
    return <Onboarding motion={steps} />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Home steps={steps} />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/offers" element={<Offers />} />
        <Route path="/referral" element={<Referral />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/merchant/:venueId" element={<Merchant />} />
      </Routes>
      <TabBar />
    </>
  );
}

export default function App() {
  return (
    <TonConnectUIProvider manifestUrl={TON_MANIFEST_URL}>
      <UserProvider>
        <AppShell />
      </UserProvider>
    </TonConnectUIProvider>
  );
}
