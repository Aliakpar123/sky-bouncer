import { Home, Map, Gift, Users, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { haptic } from '../../lib/telegram';

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/map', label: 'Map', icon: Map },
  { to: '/offers', label: 'Offers', icon: Gift },
  { to: '/referral', label: 'Invite', icon: Users },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
];

export default function TabBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => haptic('light')}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-xs w-16 ${
                isActive ? 'text-accent' : 'text-white/50'
              }`
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
