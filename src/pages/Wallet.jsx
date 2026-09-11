import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import TonConnectButton from '../components/wallet/TonConnectButton';
import StarShop from '../components/wallet/StarShop';
import { useUser } from '../context/UserContext';

// Mounted here rather than around the whole app: the provider fetches the
// wallet list from ~25 CDN hosts on mount, and that has no business happening
// while someone is looking at the step counter.
const TON_MANIFEST_URL =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? '/tonconnect-manifest.json';

export default function Wallet() {
  const { profile, refreshProfile } = useUser();

  return (
    <div className="pb-24">
      <Header title="Wallet" />
      <main className="px-4 pt-8 flex flex-col gap-8 items-center">
        <div className="text-center">
          <p className="text-sm text-white/50">Points balance</p>
          <p className="text-4xl font-extrabold mt-1">{(profile?.balance ?? 0).toLocaleString()}</p>
        </div>

        <StarShop
          profile={profile}
          onPurchased={() => profile && refreshProfile(profile.id)}
        />

        <div className="w-full border-t border-border pt-8">
          <TonConnectUIProvider manifestUrl={TON_MANIFEST_URL}>
            <TonConnectButton />
          </TonConnectUIProvider>
        </div>

        <Link
          to="/merchant"
          className="w-full flex items-center justify-center gap-2 text-sm text-white/45 border-t border-border pt-6"
        >
          <Store size={15} />
          Own a venue? List it on the radar
        </Link>
      </main>
    </div>
  );
}
