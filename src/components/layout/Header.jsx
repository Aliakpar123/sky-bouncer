import { Zap } from 'lucide-react';
import { useUser } from '../../context/UserContext';

export default function Header({ title }) {
  const { profile } = useUser();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-base/90 backdrop-blur border-b border-border">
      <h1 className="text-lg font-bold">{title}</h1>
      <div className="flex items-center gap-1.5 bg-surface2 border border-border rounded-full px-3 py-1.5">
        <Zap size={14} className="text-accent2 fill-accent2" />
        <span className="text-sm font-semibold tabular-nums">
          {(profile?.balance ?? 0).toLocaleString()}
        </span>
      </div>
    </header>
  );
}
