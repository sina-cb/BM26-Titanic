/**
 * SPECIAL EVENTS tab — staged one-button shows (docs/52; Baby Reveal is #1).
 *
 * The operator's brief, verbatim in spirit: *"a tab that I can go on and do
 * different shows with very simple buttons … multiple stages, each with a
 * button, and quick dependency to go to the next step, and extension … simple
 * and easy."*
 *
 * The revised Baby Reveal flow this surface serves:
 *
 *   TEASE ──▶ BLACKOUT ──▶ THE REVEAL (choice; holds until END SHOW)
 *     │                       │
 *     │ quick effects         │ two huge buttons: BABY PINK / BABY BLUE
 *     │ (STROBE, FLASH …)     │ pressing one flashes white, starts that
 *     │ live while tease      │ playlist, and keeps its autopilot alive
 *     ▼ holds the rig
 *   the button that starts the reveal sequence sits right under them
 *
 * THIS SCREEN OWNS NO SHOW STATE. The stage cursor, the clock, the takeover
 * lease and the restore snapshot all live in the engine (docs/52 §1c), so an
 * iPad that sleeps mid-ceremony loses nothing and a second pad shows the same
 * stage. Everything drawn here is derived by `special_events_view.ts` from the
 * engine's own state document; every enable/disable is engine truth, and the
 * engine's 409 remains the real guard (surfaced verbatim, never swallowed).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { PerformanceRouteGuard } from '@/components/performance_route_guard';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  EventChoiceButton,
  EventChromeButton,
  EventEffectButton,
  EventStageButton,
} from '@/components/special_events/stage_button';
import {
  armConfirmMessage,
  describeEventScreen,
  paintAccent,
  type StageViewModel,
} from '@/components/special_events/special_events_view';
import { ShowAutopilotCard } from '@/components/special_events/show_autopilot_card';
import { usePalette } from '@/hooks/use-theme';
import { useSharedParamValues } from '@/hooks/useEngineState';
import { useSpecialEvents } from '@/hooks/useSpecialEvents';
import { updateParamCenter } from '@/utils/api';
import type {
  EventAutopilotPatch,
  EventAutopilotState,
  EventShow,
} from '@/utils/special_events_api';

// One pending confirmation at a time. `null` = no sheet open.
type PendingConfirm =
  | { kind: 'arm'; show: EventShow }
  | { kind: 'refire'; stageId: string; label: string }
  | { kind: 'rechoice'; stageId: string; choiceId: string; label: string }
  | { kind: 'abort' }
  | { kind: 'finish' };

export default function SpecialEventsScreen() {
  return (
    <PerformanceRouteGuard routeName="special_events">
      <SpecialEventsSurface />
    </PerformanceRouteGuard>
  );
}

function SpecialEventsSurface() {
  const C = usePalette();
  const events = useSpecialEvents();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const screen = useMemo(() => describeEventScreen(events.state), [events.state]);

  const surface = C.surfaceContainerLow;

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }, []);

  const onStagePress = useCallback((stage: StageViewModel) => {
    if (stage.requiresConfirm) {
      setPending({ kind: 'refire', stageId: stage.id, label: stage.label });
      return;
    }
    void run(() => events.fire(stage.id));
  }, [events, run]);

  const onChoicePress = useCallback((
    stage: StageViewModel,
    choiceId: string,
    label: string,
    requiresConfirm: boolean,
  ) => {
    if (requiresConfirm) {
      setPending({ kind: 'rechoice', stageId: stage.id, choiceId, label });
      return;
    }
    void run(() => events.fire(stage.id, choiceId));
  }, [events, run]);

  const confirmSheet = renderConfirm(pending, setPending, events, run);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingTop: 22,
        paddingBottom: 10,
      }}>
        <IconSymbol name="sparkles" size={26} color={C.primary} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 24,
          letterSpacing: 1.2,
          color: C.text,
        }}>
          SPECIAL EVENTS
        </Text>
        <View style={{ flex: 1 }} />
        {busy ? <ActivityIndicator color={C.primary} /> : null}
        <Text
          accessibilityRole="text"
          accessibilityLabel={events.connected ? 'Engine connected' : 'Engine offline'}
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            letterSpacing: 1.4,
            color: events.connected ? C.tertiary : C.error,
          }}
        >
          {events.connected ? '● LIVE' : '○ OFFLINE'}
        </Text>
      </View>

      {events.error === null ? null : (
        <ErrorStrip message={events.error} onDismiss={events.clearError} />
      )}
      {screen.engineError === null ? null : (
        <ErrorStrip message={screen.engineError} onDismiss={null} />
      )}
      {screen.endedNotice === null ? null : (
        <Notice
          message={screen.endedNotice}
          tone="ended"
          onDismiss={() => void run(() => events.dismiss())}
        />
      )}

      {screen.mode === 'offline' ? (
        <Notice
          message={'No answer from the special events runner. Nothing is shown here until the '
            + 'engine reports its real state.'}
          tone="offline"
        />
      ) : null}

      {screen.mode === 'show' && screen.show !== null ? (
        <ShowColumn
          screen={screen}
          surface={surface}
          autopilot={events.state?.autopilot ?? null}
          onStagePress={onStagePress}
          onChoicePress={onChoicePress}
          onEffectPress={(effectId) => void run(() => events.pulseEffect(effectId))}
          onAutopilot={(patch) => void run(() => events.setAutopilot(patch))}
          onAutopilotReset={() => void run(() => events.resetAutopilot())}
          onExtend={() => void run(() => events.extend())}
          onFinish={() => setPending({ kind: 'finish' })}
          onAbort={() => setPending({ kind: 'abort' })}
        />
      ) : null}

      {screen.mode === 'picker' || screen.mode === 'ended' ? (
        <ShowPicker
          shows={screen.shows}
          loadErrors={screen.loadErrors}
          catalogRead={events.state !== null}
          surface={surface}
          onArm={(show) => setPending({ kind: 'arm', show })}
        />
      ) : null}

      {confirmSheet}
    </View>
  );
}

// ── Show picker ───────────────────────────────────────────────────────────

function ShowPicker({ shows, loadErrors, catalogRead, surface, onArm }: {
  shows: EventShow[];
  loadErrors: { file: string; error: string }[];
  catalogRead: boolean;
  surface: string;
  onArm: (show: EventShow) => void;
}) {
  const C = usePalette();
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8, gap: 16 }}>
      {!catalogRead ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary }}>
          Reading the show catalog from the engine…
        </Text>
      ) : null}
      {catalogRead && shows.length === 0 && loadErrors.length === 0 ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary }}>
          This scene has no special-event shows.
        </Text>
      ) : null}

      {shows.map((show) => {
        const paint = paintAccent(show.color, surface);
        return (
          <View
            key={show.id}
            accessibilityRole="button"
            accessibilityLabel={`Arm ${show.name}`}
            style={{
              minHeight: 132,
              borderRadius: 20,
              backgroundColor: C.surfaceContainerLow,
              borderWidth: 1,
              borderColor: C.ghostBorder,
              overflow: 'hidden',
              flexDirection: 'row',
            }}
          >
            <View style={{ width: 10, backgroundColor: paint ? paint.fill : C.primary }} />
            <View style={{ flex: 1, padding: 22, gap: 6 }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 30,
                color: C.text,
              }}>
                {show.name}
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary }}>
                {show.stages.length} stages · {show.stages.map((s) => s.label).join(' → ')}
              </Text>
            </View>
            <View style={{ justifyContent: 'center', paddingRight: 22 }}>
              <EventChromeButton label="ARM SHOW" tone="finish" onPress={() => onArm(show)} />
            </View>
          </View>
        );
      })}

      {loadErrors.map((err) => (
        <View
          key={err.file}
          accessibilityRole="alert"
          style={{
            borderRadius: 20,
            padding: 20,
            backgroundColor: C.errorContainer,
            borderWidth: 1,
            borderColor: C.errorContainerBorder,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.error }}>
            {err.file} — WILL NOT LOAD
          </Text>
          <Text style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 14,
            lineHeight: 20,
            color: C.text,
            marginTop: 6,
          }}>
            {err.error}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Show column ───────────────────────────────────────────────────────────

function ShowColumn({
  screen, surface, autopilot, onStagePress, onChoicePress, onEffectPress,
  onAutopilot, onAutopilotReset, onExtend, onFinish, onAbort,
}: {
  screen: ReturnType<typeof describeEventScreen>;
  surface: string;
  /** Live rotation for the stage holding the rig; `null` before engine truth. */
  autopilot: EventAutopilotState | null;
  onStagePress: (stage: StageViewModel) => void;
  onChoicePress: (stage: StageViewModel, choiceId: string, label: string, confirm: boolean) => void;
  onEffectPress: (effectId: string) => void;
  onAutopilot: (patch: EventAutopilotPatch) => void;
  onAutopilotReset: () => void;
  onExtend: () => void;
  onFinish: () => void;
  onAbort: () => void;
}) {
  const C = usePalette();
  const show = screen.show;
  if (show === null) return null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}>
        {screen.stages.map((stage) => {
          // While the ceremony is live, everything that is not the ceremony
          // drops to near-black so the two big buttons are the only bright
          // thing on the glass (docs/52 §5).
          const dimmed = screen.ceremonyLive && !stage.ceremonial;
          const stagePaint = paintAccent(stage.accent, surface);
          const readyEffects = stage.effects.filter((effect) => effect.enabled);
          const activeEffects = stage.effects.filter((effect) => effect.active);
          return (
            <View key={stage.id}>
              <EventStageButton
                stage={stage}
                paint={stagePaint}
                dimmed={dimmed}
                onPress={() => onStagePress(stage)}
              />

              {/* Quick effects sit directly UNDER their stage — which puts them
                  right in front of the armed "next stage" button below. They
                  are drawn whenever the stage authors them, and lit only while
                  the engine says they can fire. */}
              {stage.effects.length === 0 ? null : (
                <View style={{
                  marginTop: -4,
                  marginBottom: 18,
                  paddingLeft: 12,
                  opacity: dimmed ? 0.18 : 1,
                }}>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}>
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold',
                      fontSize: 11,
                      letterSpacing: 1.4,
                      color: C.secondary,
                    }}>
                      QUICK EFFECTS
                    </Text>
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold',
                      fontSize: 10,
                      letterSpacing: 1.3,
                      color: activeEffects.length > 0
                        ? C.tertiary
                        : readyEffects.length > 0
                          ? C.primary
                          : C.secondary,
                    }}>
                      {activeEffects.length > 0
                        ? `● ${activeEffects.length} ON`
                        : readyEffects.length > 0
                          ? `○ ${readyEffects.length} READY`
                          : '○ LOCKED'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {stage.effects.map((effect) => (
                      <EventEffectButton
                        key={effect.id}
                        effect={effect}
                        paint={paintAccent(effect.accent, surface)}
                        onPress={() => onEffectPress(effect.id)}
                      />
                    ))}
                  </View>
                </View>
              )}

              {/* AUTOPILOT PATTERNS — the rotation inside the playlist this
                  stage activated. Drawn only under the stage the ENGINE says
                  owns it (`autopilot.stageId`), so a stage that authors no
                  rotation shows no card and there is no second opinion about
                  which stage a knob belongs to. */}
              {autopilot !== null && autopilot.supported && autopilot.stageId === stage.id ? (
                <StageAutopilotCard
                  autopilot={autopilot}
                  dimmed={dimmed}
                  onChange={onAutopilot}
                  onReset={onAutopilotReset}
                />
              ) : null}

              {/* The ceremonial pair. Rendered under its stage row so the
                  column still reads top-to-bottom in show order. */}
              {stage.choices.length === 0 ? null : (
                <View style={{
                  flexDirection: 'row',
                  gap: 18,
                  marginBottom: 20,
                  opacity: dimmed ? 0.18 : 1,
                }}>
                  {stage.choices.map((choice) => (
                    <EventChoiceButton
                      key={choice.id}
                      choice={choice}
                      paint={paintAccent(choice.accent, surface)}
                      onPress={() => onChoicePress(stage, choice.id, choice.label, choice.requiresConfirm)}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: C.ghostBorder,
        backgroundColor: C.surfaceContainerLowest,
      }}>
        {screen.stages
          .filter((s) => s.extend !== null)
          .map((s) => (
            <EventChromeButton
              key={`extend-${s.id}`}
              label={s.extend!.label}
              tone="extend"
              disabled={!s.extend!.enabled}
              onPress={onExtend}
            />
          ))}
        <View style={{ flex: 1 }} />
        {screen.finishAvailable ? (
          <EventChromeButton label="END SHOW" tone="finish" onPress={onFinish} />
        ) : null}
        {screen.abortAvailable ? (
          <EventChromeButton label="ABORT" tone="abort" onPress={onAbort} />
        ) : null}
      </View>
    </View>
  );
}

// ── Stage autopilot ───────────────────────────────────────────────────────

/**
 * The SHOW AUTOPILOT card, driving a SHOW STAGE.
 *
 * WAS the deck's full `<PatternAutopilotPanel>` verbatim. Now the simplified
 * show card the operator asked for (docs/57 §4, report `_240`):
 * *"show the current pattern name on the auto pilot, and simplify the auto
 * pilot, play, and time, 1, 5, 10, 15 that's it."*
 *
 * NOW PLAYING + GLOBAL SPEED + PLAY/PAUSE + cadence pills + SINGLE/SHUFFLE
 * ALL transition style — see `show_autopilot_card.tsx`. Pattern-order shuffle,
 * group mode/size/dwell, and the selected single transition stay authored in
 * show YAML. Nothing engine-side narrowed; the DECK tab remains full-featured.
 *
 * Every control is a round trip. This card holds NO local state and the values
 * redraw from the engine's answer — so a cadence the engine refused snaps back
 * instead of lying about what the rig is doing.
 *
 * The `overridden` strip below stays: the show file is the author's intent, a
 * live tweak is the operator's, and the operator must always be able to get
 * back to the file.
 */
function StageAutopilotCard({ autopilot, dimmed, onChange, onReset }: {
  autopilot: EventAutopilotState;
  dimmed: boolean;
  onChange: (patch: EventAutopilotPatch) => void;
  onReset: () => void;
}) {
  const C = usePalette();
  const globalParams = useSharedParamValues({ speed: 0.5 }) as { speed: number };
  const setGlobalSpeed = useCallback((speed: number) => {
    void updateParamCenter({ speed });
  }, []);
  if (autopilot.transition === null) {
    throw new Error('supported show autopilot is missing its transition contract');
  }

  return (
    <View style={{ marginTop: -4, marginBottom: 18, paddingLeft: 12 }}>
      <ShowAutopilotCard
        active={autopilot.active}
        everySec={autopilot.everySec}
        nowPlaying={autopilot.nowPlaying}
        transitionShuffle={autopilot.transition.shuffle}
        transitionDurationMs={autopilot.transition.durationMs}
        globalSpeed={globalParams.speed}
        dimmed={dimmed}
        onChange={(patch) => onChange(patch)}
        onGlobalSpeedChange={setGlobalSpeed}
      />
      {/* The show file is the author's intent; a live tweak is the operator's.
          Say which one is on the rig, and always offer the way back — otherwise
          the YAML quietly becomes a lie about what the tease does. */}
      {autopilot.overridden ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6, paddingLeft: 8,
        }}>
          <Text style={{
            flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary,
          }}>
            Tuned live — the show file says something different. This is remembered for next time.
          </Text>
          <EventChromeButton label="SHOW DEFAULT" tone="extend" onPress={onReset} />
        </View>
      ) : null}
    </View>
  );
}

// ── Chrome bits ───────────────────────────────────────────────────────────

function ErrorStrip({ message, onDismiss }: { message: string; onDismiss: (() => void) | null }) {
  const C = usePalette();
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: 24,
        marginBottom: 10,
        padding: 14,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: C.errorContainer,
        borderWidth: 1,
        borderColor: C.errorContainerBorder,
      }}
    >
      <IconSymbol name="exclamationmark.triangle.fill" size={18} color={C.error} />
      <Text style={{
        flex: 1,
        fontFamily: 'Inter_400Regular',
        fontSize: 14,
        lineHeight: 20,
        color: C.text,
      }}>
        {message}
      </Text>
      {onDismiss === null ? null : (
        <EventChromeButton label="DISMISS" tone="extend" onPress={onDismiss} />
      )}
    </View>
  );
}

function Notice({ message, tone, onDismiss }: {
  message: string;
  tone: 'ended' | 'offline';
  onDismiss?: () => void;
}) {
  const C = usePalette();
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: 24,
        marginBottom: 10,
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: C.surfaceContainerHigh,
        borderWidth: 1,
        borderColor: tone === 'ended' ? C.primary : C.ghostBorder,
      }}
    >
      <Text style={{
        flex: 1,
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 15,
        lineHeight: 22,
        color: C.text,
      }}>
        {message}
      </Text>
      {onDismiss === undefined ? null : (
        <EventChromeButton label="DISMISS" tone="extend" onPress={onDismiss} />
      )}
    </View>
  );
}

function renderConfirm(
  pending: PendingConfirm | null,
  setPending: (p: PendingConfirm | null) => void,
  events: ReturnType<typeof useSpecialEvents>,
  run: (action: () => Promise<unknown>) => Promise<void>,
) {
  const close = () => setPending(null);
  if (pending === null) {
    return <ConfirmSheet visible={false} title="" message="" onConfirm={close} onCancel={close} />;
  }
  const spec = (() => {
    switch (pending.kind) {
      case 'arm':
        return {
          title: `Arm ${pending.show.name}`,
          message: armConfirmMessage(pending.show),
          confirmLabel: 'ARM SHOW',
          onConfirm: () => { close(); void run(() => events.arm(pending.show.id)); },
        };
      case 'refire':
        return {
          title: `Run ${pending.label} again`,
          message: 'This stage is already live. Firing it again re-runs its actions from the top.',
          confirmLabel: 'RUN AGAIN',
          onConfirm: () => { close(); void run(() => events.fire(pending.stageId)); },
        };
      case 'rechoice':
        return {
          title: `Change the answer to ${pending.label}`,
          message: 'An answer is already on the ship. Confirming replaces it with this one.',
          confirmLabel: 'REPLACE',
          onConfirm: () => { close(); void run(() => events.fire(pending.stageId, pending.choiceId)); },
        };
      case 'abort':
        return {
          title: 'Abort the show',
          message: 'Stops the show and puts the rig back on the look that was running before it '
            + 'was armed, over a short morph.',
          confirmLabel: 'ABORT',
          onConfirm: () => { close(); void run(() => events.abort()); },
        };
      case 'finish':
      default:
        return {
          title: 'End the show',
          message: 'Ends the show and puts the rig back on the look that was running before it '
            + 'was armed, over a short morph.',
          confirmLabel: 'END SHOW',
          onConfirm: () => { close(); void run(() => events.finish()); },
        };
    }
  })();
  return (
    <ConfirmSheet
      visible
      title={spec.title}
      message={spec.message}
      confirmLabel={spec.confirmLabel}
      onConfirm={spec.onConfirm}
      onCancel={close}
    />
  );
}
