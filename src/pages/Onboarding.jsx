import { useState } from 'react';
import { Check, Footprints, Gift, MapPin, Users, Zap } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import { haptic } from '../lib/telegram';

const STEP_COUNT = 3;

function ProgressDots({ step }) {
  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? 'w-6 bg-accent' : 'w-1.5 bg-white/20'
          }`}
        />
      ))}
    </div>
  );
}

function Intro({ referredBy }) {
  const rules = [
    { icon: Footprints, title: 'Walk anywhere', body: 'Every 1,000 steps earns you 100 points.' },
    { icon: MapPin, title: 'Visit partners', body: 'Check in at cafés and shops nearby for bonus points.' },
    { icon: Gift, title: 'Spend them', body: 'Trade points for free coffee, discounts and perks.' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center mb-4">
          <Zap size={30} className="text-white fill-white" />
        </div>
        <h1 className="text-2xl font-extrabold">Welcome to Pulse Radar</h1>
        <p className="text-white/60 mt-2">Get rewarded for walking around your city.</p>
      </div>

      <div className="flex flex-col gap-4">
        {rules.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3 items-start">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-surface2 border border-border flex items-center justify-center">
              <Icon size={18} className="text-accent2" />
            </div>
            <div>
              <p className="font-semibold text-sm">{title}</p>
              <p className="text-sm text-white/60">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {referredBy && (
        <div className="flex gap-3 items-start bg-surface2 border border-border rounded-2xl p-4">
          <Users size={18} className="text-accent2 shrink-0 mt-0.5" />
          <p className="text-sm text-white/70">
            You joined through a friend&apos;s invite. They&apos;ll earn 10% of the points you
            collect — it costs you nothing.
          </p>
        </div>
      )}
    </div>
  );
}

function PermissionStep({ icon: Icon, title, body, note, state, onGrant, grantLabel }) {
  return (
    <div className="flex flex-col gap-6 text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-surface2 border border-border flex items-center justify-center">
        {state === 'granted' ? (
          <Check size={30} className="text-green-400" />
        ) : (
          <Icon size={30} className="text-accent2" />
        )}
      </div>

      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="text-white/60 mt-2">{body}</p>
      </div>

      {state === 'granted' ? (
        <p className="text-green-400 text-sm font-semibold">All set</p>
      ) : (
        <>
          <button
            type="button"
            onClick={onGrant}
            className="w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-accent to-accent2"
          >
            {grantLabel}
          </button>
          {state === 'denied' && (
            <p className="text-sm text-white/50">
              {note} You can still use the app — enable it later in your device settings.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function Onboarding({ motion }) {
  const { profile, setProfile } = useUser();
  const [step, setStep] = useState(0);
  const [locationState, setLocationState] = useState('idle');
  const [finishing, setFinishing] = useState(false);

  const motionState =
    motion.permission === 'granted'
      ? 'granted'
      : motion.permission === 'denied'
      ? 'denied'
      : 'idle';

  // iOS only honours DeviceMotionEvent.requestPermission() inside a user
  // gesture, so this must stay wired to a real tap rather than an effect.
  async function grantMotion() {
    haptic('light');
    const granted = await motion.requestPermission();
    if (granted) haptic('success');
  }

  function grantLocation() {
    haptic('light');
    if (!navigator.geolocation) {
      setLocationState('denied');
      return;
    }
    setLocationState('pending');
    navigator.geolocation.getCurrentPosition(
      () => {
        haptic('success');
        setLocationState('granted');
      },
      () => setLocationState('denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function finish() {
    setFinishing(true);
    haptic('medium');
    try {
      const { data, error } = await supabase.rpc('complete_onboarding');
      if (error) throw error;
      if (data) setProfile(data);
    } catch (err) {
      console.error('Failed to complete onboarding', err);
      // Don't trap the user behind a failed write — let them into the app and
      // let the next launch retry.
      setProfile({ ...profile, onboarded_at: new Date().toISOString() });
    }
  }

  const steps = [
    <Intro key="intro" referredBy={profile?.referrer_id} />,
    <PermissionStep
      key="motion"
      icon={Footprints}
      title="Count your steps"
      body="Pulse Radar uses your phone's motion sensor to turn steps into points. Nothing leaves your device except the step count."
      note="Motion access was declined."
      state={motionState}
      onGrant={grantMotion}
      grantLabel="Enable step tracking"
    />,
    <PermissionStep
      key="location"
      icon={MapPin}
      title="Find venues near you"
      body="Your location is used to show partner venues on the map and to verify you're actually at one when you check in."
      note="Location access was declined."
      state={locationState === 'pending' ? 'idle' : locationState}
      onGrant={grantLocation}
      grantLabel={locationState === 'pending' ? 'Locating…' : 'Enable location'}
    />,
  ];

  const isLast = step === STEP_COUNT - 1;

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="flex-1 flex flex-col justify-center">{steps[step]}</div>

      <div className="flex flex-col gap-5 pt-8">
        <ProgressDots step={step} />
        <button
          type="button"
          disabled={finishing}
          onClick={() => {
            haptic('light');
            if (isLast) finish();
            else setStep((s) => s + 1);
          }}
          className="w-full rounded-xl py-3.5 font-semibold bg-surface2 border border-border disabled:opacity-50"
        >
          {isLast ? (finishing ? 'Starting…' : 'Start earning') : 'Continue'}
        </button>
      </div>
    </div>
  );
}
