import Header from '../components/layout/Header';
import TonConnectButton from '../components/wallet/TonConnectButton';
import StarShop from '../components/wallet/StarShop';
import { useUser } from '../context/UserContext';

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
          <TonConnectButton />
        </div>
      </main>
    </div>
  );
}
