// OSC listener status pill + diagnostic sheet for CaptainPad.
//
// Lives in the Global Params strip (CPCControls header). Four
// visual states derived from the engine's per-second `oscStats`
// WS broadcast — see useOscStatus() in @/hooks/useEngineState and
// docs/24_osc_integration.md §10.2 for the source spec.
//
// The pill is informational only in v1: tapping it opens a
// read-only sheet showing the live counters, listener address,
// last sender origin, and binding/allowlist counts. A future
// CaptainPad binding editor (docs/24 §15) would hang off the same
// sheet.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useOscStatus, OscPillState } from '@/hooks/useEngineState';

// Visual mapping. We keep these in one place so the pill body and
// the sheet header agree on color semantics. Prod traffic-light scheme
// (operator request feat/optimize_channels): GREEN receiving, YELLOW
// enabled-but-stalled, GRAY disabled.
//
//   off       → GRAY (listener intentionally disabled — nothing to watch)
//   idle      → YELLOW (enabled but no values flowing — the operator
//               probably needs to start their sender; this is an
//               actionable "OSC is on but starving" state, so it earns
//               a clear caution colour rather than blending into chrome)
//   unmapped  → YELLOW/amber (packets ARE arriving but addresses don't
//               match any binding — also actionable, a config mistake;
//               kept distinct from `idle` only by its label, not colour,
//               so "OSC is enabled but you're not getting data" reads as
//               ONE caution band)
//   live      → GREEN (values are flowing into the CPC)
//
// '#ffc107' (amber/yellow) / '#5a4500' (dark amber text) / '#003a44'
// (dark teal on the green chip) are semantic-state literals intentionally
// pinned across both themes — the OSC status badge should look the same
// regardless of the operator's light/dark preference so the colour reads
// as a traffic-light status signal, not a chrome accent.
// Traffic-light state colours. The PILL keeps a neutral surface and signals
// state with a coloured DOT + coloured LABEL + coloured BORDER (a flooded
// bright-yellow tile read as garish / hard to scan — operator feedback). The
// diagnostic SHEET still uses a soft `bg` tint chip in the modal header.
//   `dot`/`label` are the on-neutral-surface readable colours; `bg`/`fg` are
//   the soft-chip pair used only in the sheet header.
const OSC_GREEN = '#1b9e77';       // matches the BPM "OSC-locked" accent
const OSC_YELLOW = '#ffc107';      // caution dot/border
const OSC_YELLOW_TEXT = '#b07d00'; // readable amber on a neutral surface
const OSC_YELLOW_BG = '#fff6d6';   // soft amber chip (sheet only)
const OSC_YELLOW_FG = '#5a4500';
function makeStateStyles(C: Palette): Record<OscPillState['state'], { bg: string; fg: string; border: string; dot: string; label: string }> {
  return {
    // GRAY — listener disabled. Nothing is expected, so it stays neutral.
    off:      { bg: C.surfaceContainerHigh, fg: C.secondary, border: C.ghostBorder, dot: C.secondary, label: C.secondary },
    // YELLOW — enabled but nothing flowing (start the sender). Actionable.
    idle:     { bg: OSC_YELLOW_BG, fg: OSC_YELLOW_FG, border: OSC_YELLOW, dot: OSC_YELLOW, label: OSC_YELLOW_TEXT },
    // YELLOW — packets arriving but unmapped (a binding/config mistake). Same
    // caution band as idle; the label disambiguates the cause.
    unmapped: { bg: OSC_YELLOW_BG, fg: OSC_YELLOW_FG, border: OSC_YELLOW, dot: OSC_YELLOW, label: OSC_YELLOW_TEXT },
    // GREEN — values flowing into the CPC.
    live:     { bg: C.primaryContainer, fg: '#003a44', border: OSC_GREEN, dot: OSC_GREEN, label: OSC_GREEN },
  };
}

interface Props {
  /** Optional compact variant for tight horizontal space. */
  compact?: boolean;
}

export function OscStatusPill({ compact = false }: Props) {
  const C = usePalette();
  const status = useOscStatus();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Tile dimensions mirror BpmTile / ColorPairButton so the COLORS · BPM
  // · OSC cluster reads as one row of compact status tiles, distinct
  // from the SPEED / SIZE sliders to the left. Operator request
  // 2026-05-28.
  const w = compact ? 60 : 86;
  const TILE_HEIGHT = 48;

  if (!status) {
    // First frame before any WS message lands — placeholder that
    // doesn't shift layout once real data arrives.
    return (
      <View style={{
        width: w, height: TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1,
        backgroundColor: C.surface,
        borderColor: C.ghostBorder,
        justifyContent: 'space-between',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8,
          }}>OSC</Text>
        </View>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: C.icon, textAlign: 'center',
        }}>…</Text>
      </View>
    );
  }

  const styles = makeStateStyles(C)[status.state];

  return (
    <>
      <TouchableOpacity
        onPress={() => setSheetVisible(true)}
        accessibilityLabel={`OSC listener status: ${status.state}, ${status.label}`}
        accessibilityRole="button"
        style={{
          width: w, height: TILE_HEIGHT,
          paddingVertical: 4, paddingHorizontal: 6,
          borderRadius: 8, borderWidth: 1,
          // Neutral surface always; the coloured border + dot + label carry the
          // traffic-light signal (no flooded-yellow tile).
          backgroundColor: C.surface,
          borderColor: styles.border,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: styles.label, textTransform: 'uppercase', letterSpacing: 0.8,
          }}>OSC</Text>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: styles.dot }} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: styles.label, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6,
          }}
        >
          {status.label}
        </Text>
      </TouchableOpacity>

      <OscDiagnosticSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        status={status}
      />
    </>
  );
}

// ── Diagnostic sheet ───────────────────────────────────────────────────────

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  status: OscPillState;
}

function OscDiagnosticSheet({ visible, onClose, status }: SheetProps) {
  const C = usePalette();
  const { state, stats } = status;
  const styles = makeStateStyles(C)[state];
  const referenceTime = stats.now ?? Date.now();
  const lastSeenSeconds = stats.lastSeenMs === 0
    ? '—'
    : `${Math.max(0, Math.floor((referenceTime - stats.lastSeenMs) / 1000))}s ago`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center', alignItems: 'center',
      }}>
        <View style={{
          width: 340, backgroundColor: C.surfaceContainerLowest,
          padding: 20, borderRadius: 12,
          borderWidth: 1, borderColor: C.ghostBorder,
        }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            marginBottom: 16,
          }}>
            <View style={{
              paddingHorizontal: 10, paddingVertical: 4,
              borderRadius: 10, borderWidth: 1,
              backgroundColor: styles.bg, borderColor: styles.border,
            }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
                color: styles.fg, textTransform: 'uppercase',
              }}>OSC {status.label}</Text>
            </View>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.primary,
              fontSize: 14, textTransform: 'uppercase',
            }}>Listener</Text>
          </View>

          {/* Listener address */}
          <Row label="Listener" value={
            stats.enabled
              ? `${stats.host ?? '0.0.0.0'}:${stats.port ?? '—'}`
              : 'disabled at boot'
          } />
          <Row label="Bindings" value={String(stats.bindingsCount)} />
          <Row
            label="Allowed senders"
            value={stats.allowedSendersCount === 0 ? 'open (any sender)' : String(stats.allowedSendersCount)}
          />

          {/* Counters */}
          <View style={{
            marginTop: 12, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
              color: C.secondary, textTransform: 'uppercase',
              marginBottom: 8,
            }}>Last second</Text>
            <Row label="RX (received)" value={String(stats.rxMessagesPerSec)} />
            <Row label="Mapped" value={String(stats.mappedMessagesPerSec)} />
            <Row label="Dropped (no binding)" value={String(stats.droppedMessagesPerSec)} />
            <Row label="Invalid" value={String(stats.invalidMessagesPerSec)} />
          </View>

          {/* Origin info */}
          <View style={{
            marginTop: 12, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
          }}>
            <Row label="Last sender" value={stats.lastSender ?? '—'} />
            <Row label="Last packet" value={lastSeenSeconds} />
          </View>

          {/* Close */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              marginTop: 20, alignSelf: 'flex-end',
              backgroundColor: C.primary,
              paddingHorizontal: 24, paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const C = usePalette();
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between',
      paddingVertical: 4,
    }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.secondary, textTransform: 'uppercase',
      }}>{label}</Text>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.text,
      }}>{value}</Text>
    </View>
  );
}
