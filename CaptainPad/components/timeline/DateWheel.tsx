/**
 * DateWheel — a themed Year / Month / Day wheel-picker modal for the festival
 * START DATE (operator request 2026-06: jump directly to any date instead of
 * clicking the ±1-day stepper repeatedly).
 *
 * Built on the ALREADY-INSTALLED `@react-native-picker/picker` (works on web +
 * iPad, offline-safe — no new dependency). Three columns:
 *   - Year  (YEAR_MIN..YEAR_MAX)
 *   - Month (Jan..Dec)
 *   - Day   (1..daysInMonth(year, month)) — clamped so a Feb 30 is impossible.
 *
 * Presentational + self-contained: it owns the in-flight wheel selection in
 * local state (seeded from `initialDate`), and only calls `onConfirm` with a
 * zero-padded 'YYYY-MM-DD' when the operator taps SET. Cancel / backdrop
 * dismiss without change. The parent applies the date to the draft via the
 * SAME mutation path the ±1-day stepper used (timeline.tsx onSetStartDate).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';

// Sensible bounds for a festival date picker (BM 2026 sits comfortably inside).
export const YEAR_MIN = 2024;
export const YEAR_MAX = 2030;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Days in a given month (month is 1-based). UTC day-0 of the next month rolls
// back to the last day of THIS month — the canonical "days in month" trick.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampYear(y: number): number {
  if (!Number.isFinite(y)) return YEAR_MIN;
  return Math.min(YEAR_MAX, Math.max(YEAR_MIN, y));
}

// Parse a 'YYYY-MM-DD' into {year, month(1-12), day}, clamped to the picker's
// year range. A malformed key falls back to the lower year bound, Jan 1 — the
// parent always passes a valid festival start, so this is purely defensive.
function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return { year: YEAR_MIN, month: 1, day: 1 };
  const year = clampYear(Number(m[1]));
  const month = Math.min(12, Math.max(1, Number(m[2])));
  const day = Math.min(daysInMonth(year, month), Math.max(1, Number(m[3])));
  return { year, month, day };
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function DateWheel({
  visible, initialDate, onConfirm, onClose,
}: {
  visible: boolean;
  /** The festival start date to seed the wheels with ('YYYY-MM-DD'). */
  initialDate: string;
  /** Called with the chosen zero-padded 'YYYY-MM-DD' when the operator taps SET. */
  onConfirm: (dateKey: string) => void;
  /** Cancel / backdrop — dismiss without change. */
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const [year, setYear] = useState(YEAR_MIN);
  const [month, setMonth] = useState(1); // 1-based
  const [day, setDay] = useState(1);

  // Re-seed the wheels from initialDate every time the sheet OPENS so a prior
  // cancelled edit never leaks into the next open (the wheels always start at
  // the current festival start).
  useEffect(() => {
    if (!visible) return;
    const p = parseDateKey(initialDate);
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
  }, [visible, initialDate]);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = YEAR_MIN; y <= YEAR_MAX; y += 1) out.push(y);
    return out;
  }, []);

  const maxDay = daysInMonth(year, month);
  const days = useMemo(() => {
    const out: number[] = [];
    for (let d = 1; d <= maxDay; d += 1) out.push(d);
    return out;
  }, [maxDay]);

  // Clamp the selected day to the valid range whenever year/month change (so a
  // day-31 selection followed by switching to Feb collapses to Feb's last day —
  // no Feb 30 is reachable).
  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [maxDay, day]);

  const handleConfirm = () => {
    const safeDay = Math.min(day, daysInMonth(year, month));
    onConfirm(formatDateKey(year, month, safeDay));
  };

  // Native iOS spinner is dark-on-light by default; itemStyle keeps the wheel
  // text legible against the themed sheet. On web the Picker renders as a
  // <select>, which honors the color prop directly.
  const itemColor = C.text;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440 }}>
          <View style={styles.sheet}>
            <Text style={styles.title}>FESTIVAL START DATE</Text>

            <View style={styles.wheelsRow}>
              <View style={styles.wheelCol}>
                <Text style={styles.wheelLabel}>YEAR</Text>
                <Picker
                  selectedValue={year}
                  onValueChange={(v) => setYear(Number(v))}
                  style={styles.picker}
                  itemStyle={[styles.pickerItem, { color: itemColor }]}
                  dropdownIconColor={C.text}
                >
                  {years.map((y) => (
                    <Picker.Item key={y} label={String(y)} value={y} color={Platform.OS === 'android' ? '#000' : itemColor} />
                  ))}
                </Picker>
              </View>

              <View style={styles.wheelCol}>
                <Text style={styles.wheelLabel}>MONTH</Text>
                <Picker
                  selectedValue={month}
                  onValueChange={(v) => setMonth(Number(v))}
                  style={styles.picker}
                  itemStyle={[styles.pickerItem, { color: itemColor }]}
                  dropdownIconColor={C.text}
                >
                  {MONTH_LABELS.map((lbl, i) => (
                    <Picker.Item key={lbl} label={lbl} value={i + 1} color={Platform.OS === 'android' ? '#000' : itemColor} />
                  ))}
                </Picker>
              </View>

              <View style={styles.wheelCol}>
                <Text style={styles.wheelLabel}>DAY</Text>
                <Picker
                  selectedValue={day}
                  onValueChange={(v) => setDay(Number(v))}
                  style={styles.picker}
                  itemStyle={[styles.pickerItem, { color: itemColor }]}
                  dropdownIconColor={C.text}
                >
                  {days.map((d) => (
                    <Picker.Item key={d} label={String(d)} value={d} color={Platform.OS === 'android' ? '#000' : itemColor} />
                  ))}
                </Picker>
              </View>
            </View>

            <Text style={styles.preview} numberOfLines={1}>
              {formatDateKey(year, month, Math.min(day, maxDay))}
            </Text>

            <View style={styles.actionsRow}>
              <TouchableOpacity onPress={onClose} style={styles.cancelBtn} accessibilityLabel="Cancel date picker">
                <Text style={styles.cancelBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleConfirm} style={styles.setBtn} accessibilityLabel="Set festival start date">
                <Text style={styles.setBtnText}>SET</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
      letterSpacing: 1,
      color: C.text,
      textTransform: 'uppercase',
      marginBottom: 14,
    },
    wheelsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    wheelCol: {
      flex: 1,
      minWidth: 0,
    },
    wheelLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.secondary,
      textTransform: 'uppercase',
      marginBottom: 6,
      textAlign: 'center',
    },
    picker: {
      // On web this is a <select> sized by content; on iOS it's a tall spinner.
      // A min height keeps the iOS wheel usable; web ignores the height.
      color: C.text,
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 8,
      ...(Platform.OS === 'ios' ? { height: 180 } : { height: 44 }),
    },
    pickerItem: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
    },
    preview: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 1,
      color: C.primary,
      textAlign: 'center',
      marginTop: 14,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    cancelBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: C.text,
    },
    setBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 8,
      backgroundColor: C.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    setBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: C.onPrimary,
    },
  });
}
