/**
 * useHeartRate — Web Bluetooth Heart Rate Monitor
 *
 * Connects to any BLE device that implements the standard Heart Rate GATT
 * profile (UUID 0x180D), which covers virtually all chest straps and most
 * sport watches (Polar, Wahoo, Garmin HRM, etc.).
 *
 * Browser support: Chrome 56+, Edge 79+, Chrome for Android 56+.
 * Does NOT work in Firefox or Safari (no Web Bluetooth support).
 *
 * Features:
 *  - Auto-reconnect: when the device goes out of range, retries every 5 s
 *    (up to 12 attempts = ~1 minute) before giving up.
 *  - Persistence: flushes the pending-readings buffer to the server every 30 s
 *    so data survives page navigations and refreshes.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface HRReading {
  /** Epoch ms when the reading was captured */
  ts: number;
  /** Heart rate in BPM */
  bpm: number;
}

export interface UseHeartRateReturn {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  heartRate: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  /** Rolling window of up to 300 readings (≈ 5 min at 1 Hz) */
  readings: HRReading[];
  connect: () => Promise<void>;
  disconnect: () => void;
  error: string | null;
}

// Keep at most this many readings in the in-memory display buffer
const MAX_READINGS = 300;
// How often (ms) to flush unsaved readings to the server
const FLUSH_INTERVAL_MS = 30_000;
// How long (ms) to wait between reconnect attempts
const RECONNECT_DELAY_MS = 5_000;
// Max number of auto-reconnect retries before giving up
const MAX_RECONNECT_ATTEMPTS = 12;

export function useHeartRate(): UseHeartRateReturn {
  const bt = typeof navigator !== "undefined" ? (navigator as any).bluetooth : null;
  const supported = !!bt;

  const [connected,    setConnected]    = useState(false);
  const [connecting,   setConnecting]   = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [heartRate,    setHeartRate]    = useState<number | null>(null);
  const [readings,     setReadings]     = useState<HRReading[]>([]);
  const [error,        setError]        = useState<string | null>(null);

  const deviceRef          = useRef<any>(null);
  const charRef            = useRef<any>(null);
  // Buffer of readings not yet flushed to the server
  const pendingRef         = useRef<HRReading[]>([]);
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef  = useRef(0);
  const flushTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether the user explicitly disconnected (suppress auto-reconnect)
  const userDisconnectedRef = useRef(false);

  // ── Flush pending readings to the server ────────────────────────────────────
  const flush = useCallback(async () => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current.splice(0);
    try {
      await apiRequest("POST", "/api/heart-rate", { readings: batch });
    } catch {
      // On failure, push them back to the front so they're retried next flush
      pendingRef.current.unshift(...batch);
    }
  }, []);

  // ── Parse the Heart Rate Measurement characteristic (GATT spec §3.106) ──────
  const handleValue = useCallback((event: any) => {
    const val   = event.target.value as DataView;
    const flags = val.getUint8(0);
    // Bit 0: 0 = UINT8 format, 1 = UINT16 format
    const bpm   = (flags & 0x01) ? val.getUint16(1, /* littleEndian */ true) : val.getUint8(1);
    const reading: HRReading = { ts: Date.now(), bpm };

    setHeartRate(bpm);
    setReadings(prev => {
      const next = [...prev, reading];
      return next.length > MAX_READINGS ? next.slice(next.length - MAX_READINGS) : next;
    });
    pendingRef.current.push(reading);
  }, []);

  // ── Subscribe to the HR characteristic on an already-connected GATT server ──
  const subscribe = useCallback(async (server: any) => {
    const service = await server.getPrimaryService("heart_rate");
    const char    = await service.getCharacteristic("heart_rate_measurement");
    charRef.current = char;
    char.addEventListener("characteristicvaluechanged", handleValue);
    await char.startNotifications();
    setConnected(true);
    setReconnecting(false);
    reconnectCountRef.current = 0;
  }, [handleValue]);

  // ── Auto-reconnect logic ─────────────────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (userDisconnectedRef.current) return;
    if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setReconnecting(false);
      setError("Device out of range. Tap Connect to try again.");
      return;
    }
    reconnectCountRef.current += 1;
    setReconnecting(true);
    reconnectTimerRef.current = setTimeout(async () => {
      if (userDisconnectedRef.current || !deviceRef.current) return;
      try {
        const server = await deviceRef.current.gatt.connect();
        await subscribe(server);
      } catch {
        // Still not in range — schedule another attempt
        scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }, [subscribe]);

  // ── Hard disconnect (user-initiated) ────────────────────────────────────────
  const disconnect = useCallback(() => {
    userDisconnectedRef.current = true;

    // Cancel any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Stop flush interval
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Unsubscribe from characteristic
    if (charRef.current) {
      try {
        charRef.current.removeEventListener("characteristicvaluechanged", handleValue);
        charRef.current.stopNotifications();
      } catch { /* ignore */ }
      charRef.current = null;
    }
    // Disconnect GATT
    if (deviceRef.current?.gatt?.connected) {
      try { deviceRef.current.gatt.disconnect(); } catch { /* ignore */ }
    }
    deviceRef.current = null;

    // Final flush of any remaining readings before clearing state
    flush();

    setConnected(false);
    setReconnecting(false);
    setHeartRate(null);
  }, [handleValue, flush]);

  // ── Initial connect (user-initiated) ────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!supported) {
      setError("Web Bluetooth is not supported in this browser. Use Chrome or Edge.");
      return;
    }
    try {
      setConnecting(true);
      setError(null);
      setReadings([]);
      pendingRef.current = [];
      userDisconnectedRef.current = false;
      reconnectCountRef.current = 0;

      // Prompt the user to pick a BLE HR device
      const device: any = await bt.requestDevice({
        filters: [{ services: ["heart_rate"] }],
      });
      deviceRef.current = device;

      // When the device drops, try to reconnect automatically
      device.addEventListener("gattserverdisconnected", () => {
        setConnected(false);
        setHeartRate(null);
        if (charRef.current) {
          try { charRef.current.removeEventListener("characteristicvaluechanged", handleValue); } catch { /* ignore */ }
          charRef.current = null;
        }
        scheduleReconnect();
      });

      const server = await device.gatt.connect();
      await subscribe(server);

      // Start periodic flush to server
      flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
    } catch (err: any) {
      // NotFoundError = user closed the picker without choosing
      if (err?.name !== "NotFoundError") {
        setError(err?.message ?? "Connection failed");
      }
    } finally {
      setConnecting(false);
    }
  }, [bt, supported, handleValue, subscribe, scheduleReconnect, flush]);

  // ── Clean up on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Flush any remaining readings before unmounting
      if (pendingRef.current.length > 0) flush();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      // Don't call full disconnect() here — just tear down timers and listeners
      if (charRef.current) {
        try {
          charRef.current.removeEventListener("characteristicvaluechanged", handleValue);
          charRef.current.stopNotifications();
        } catch { /* ignore */ }
      }
    };
  }, [flush, handleValue]);

  const bpms = readings.map(r => r.bpm);
  return {
    supported,
    connected,
    connecting,
    reconnecting,
    heartRate,
    avg:      bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null,
    min:      bpms.length ? Math.min(...bpms) : null,
    max:      bpms.length ? Math.max(...bpms) : null,
    readings,
    connect,
    disconnect,
    error,
  };
}
