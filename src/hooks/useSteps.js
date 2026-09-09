import { useCallback, useEffect, useRef, useState } from 'react';

const STEP_THRESHOLD = 11.5; // m/s^2 acceleration magnitude peak that counts as a step
const STEP_DEBOUNCE_MS = 300; // minimum time between counted steps
const POINTS_PER_1000_STEPS = 100;

/**
 * Counts walking steps from the device accelerometer (DeviceMotion API) using
 * simple peak detection on the acceleration magnitude. Falls back to manual
 * simulation controls when motion sensors are unavailable (desktop/dev).
 */
export function useSteps() {
  const [steps, setSteps] = useState(0);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('unknown'); // 'unknown' | 'granted' | 'denied'
  const lastStepAt = useRef(0);
  const lastMagnitude = useRef(0);
  const rising = useRef(false);

  const handleMotion = useCallback((event) => {
    const { x, y, z } = event.accelerationIncludingGravity ?? event.acceleration ?? {};
    if (x == null || y == null || z == null) return;

    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    if (magnitude > STEP_THRESHOLD && !rising.current) {
      rising.current = true;
    } else if (magnitude < STEP_THRESHOLD && rising.current) {
      rising.current = false;
      if (now - lastStepAt.current > STEP_DEBOUNCE_MS) {
        lastStepAt.current = now;
        setSteps((s) => s + 1);
      }
    }
    lastMagnitude.current = magnitude;
  }, []);

  const requestPermission = useCallback(async () => {
    const DeviceMotionEventTyped = window.DeviceMotionEvent;
    if (!DeviceMotionEventTyped) {
      setSupported(false);
      return false;
    }
    if (typeof DeviceMotionEventTyped.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEventTyped.requestPermission();
        setPermission(result);
        return result === 'granted';
      } catch (err) {
        console.warn('Motion permission request failed', err);
        setPermission('denied');
        return false;
      }
    }
    // Non-iOS browsers don't require explicit permission.
    setPermission('granted');
    return true;
  }, []);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'DeviceMotionEvent' in window);
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return undefined;
    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [permission, handleMotion]);

  const addManualSteps = useCallback((count) => setSteps((s) => s + count), []);

  const pointsEarned = Math.floor((steps / 1000) * POINTS_PER_1000_STEPS);

  return { steps, pointsEarned, supported, permission, requestPermission, addManualSteps };
}
