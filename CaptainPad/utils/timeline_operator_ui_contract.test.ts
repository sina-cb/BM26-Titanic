import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const timelineSource = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', 'timeline.tsx'),
  'utf8',
);
const tabsLayoutSource = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', '_layout.tsx'),
  'utf8',
);
const rootLayoutSource = fs.readFileSync(
  path.join(process.cwd(), 'app', '_layout.tsx'),
  'utf8',
);
const zoomBannerSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'ZoomBanner.tsx'),
  'utf8',
);
const timelineHookSource = fs.readFileSync(
  path.join(process.cwd(), 'hooks', 'useTimeline.ts'),
  'utf8',
);
const liveSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'timeline_live_view.tsx'),
  'utf8',
);
const eventSheetSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'EventSheet.tsx'),
  'utf8',
);
const timelineTravelViewSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'timeline_travel_view.tsx'),
  'utf8',
);
const planTransitionEditorSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'plan_transition_editor.tsx'),
  'utf8',
);
const leaseActivitySource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'timeline_lease_activity_surface.tsx'),
  'utf8',
);
const deckSource = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', 'index.tsx'),
  'utf8',
);
const mixerSource = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', 'mixer.tsx'),
  'utf8',
);
const cueEditorSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'CueEditorSheet.tsx'),
  'utf8',
);
const dayTimePickerSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'DayTimePicker.tsx'),
  'utf8',
);
const partyCardSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'timeline_party_card.tsx'),
  'utf8',
);
const planPickerSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'PlanPickerSheet.tsx'),
  'utf8',
);
const planIndicatorSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'PlanIndicatorPill.tsx'),
  'utf8',
);
const planLockBannerSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'PlanLockBanner.tsx'),
  'utf8',
);
const legendSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'calendar_legend.tsx'),
  'utf8',
);
const stripSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'DayOverviewStrip.tsx'),
  'utf8',
);
const dayViewSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'DayView.tsx'),
  'utf8',
);
const shellSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'timeline', 'timeline_operator_shell.tsx'),
  'utf8',
);

describe('Timeline operator UI wiring contract', () => {
  it('opens fresh launches on Timeline while preserving the tab router', () => {
    expect(tabsLayoutSource).toContain('initialRouteName={CAPTAINPAD_DEFAULT_TAB}');
    expect(rootLayoutSource).toContain('initialRouteName="(tabs)"');
    expect(tabsLayoutSource).toContain('<Tabs.Screen');
    expect(tabsLayoutSource).toContain('name="timeline"');
  });

  it('keeps native tab screens attached to avoid the iOS layout-removal crash', () => {
    expect(tabsLayoutSource).toContain('detachInactiveScreens={false}');
  });

  it('refreshes an existing lease from real app touches and still permits inactivity expiry', () => {
    expect(tabsLayoutSource).toContain('<TimelineLeaseActivitySurface>');
    expect(leaseActivitySource).toContain('onTouchStart={handleTouchStart}');
    expect(leaseActivitySource).toContain('if (!leaseHeldRef.current');
    expect(timelineHookSource).not.toContain('ZOOM_PRESENCE_PING_MS');
    expect(zoomBannerSource).not.toContain('useZoomPresence');
  });

  it('labels the yellow plan-lock takeover for Deck and Mixer', () => {
    expect(deckSource).toContain('<PlanLockBanner surface="DECK"');
    expect(mixerSource).toContain('<PlanLockBanner surface="MIXER"');
  });

  it('uses one compact lease countdown that reopens the takeover controls', () => {
    expect(deckSource).not.toContain('TOOK OVER · PLAN RESUMES');
    expect(planIndicatorSource).toContain('requestPlanLeaseNotice()');
    expect(planLockBannerSource).toContain('subscribePlanLeaseNoticeRequests');
    expect(planLockBannerSource).toContain('RESUME NOW');
    expect(planLockBannerSource).toContain('GO TO PLAN');
  });

  it('separates saved LIVE truth from draft EDIT PLAN truth', () => {
    expect(timelineSource).toContain('overviewForTimelineView(operatorView, liveOverview, draftOverview)');
    expect(timelineSource).toContain("if (operatorView === 'live')");
    expect(timelineSource).toContain("if (operatorView === 'calendar')");
    expect(timelineSource).toContain("if (operatorView === 'travel')");
    expect(timelineSource).toContain("if (operatorView === 'edit')");
  });

  it('distinguishes an active dormant plan from one driving now', () => {
    expect(timelineSource).toContain('planActive={state?.planActive === true}');
    expect(planPickerSource).toContain("'ACTIVE · OUT OF WINDOW'");
    expect(planPickerSource).toContain("'ACTIVE · WAITING'");
    expect(planPickerSource).not.toContain('● LIVE PLAN');
  });

  it('keeps Time Travel active until an explicit RESUME TIMELINE', () => {
    // The lease exit path was renamed away from AUTOPILOT/LIVE — RESUME
    // TIMELINE is the operator-facing name because the plan (not the
    // autopilot mechanism) is what's returning to the deck.
    expect(timelineSource).not.toContain('zoomEnteredHere');
    expect(timelineSource).toContain("beginPriorityHandoff('RESUME TIMELINE')");
    expect(timelineSource).toContain('const enabled = await setAutopilot(true)');
    expect(timelineSource).toContain('const ok = enabled && await resume()');
    expect(timelineSource).toContain('setOperatorView(\'travel\')');
    expect(timelineSource).toContain('setTravelDate(eventOperatorDate)');
  });

  it('applies the Event-sheet Time Travel action without stacking a hidden confirmation modal', () => {
    const start = timelineSource.indexOf('const handleTravel = useCallback');
    const end = timelineSource.indexOf('// Returning to this tab never mutates a zoom', start);
    const handler = timelineSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).not.toContain('opConfirm(');
    expect(handler).toContain('setEventBusy(true)');
    expect(handler).toContain('const outcome = await travel(spec)');
    expect(eventSheetSource).toContain('APPLYING TIME TRAVEL…');
  });

  it('offers an exact ten-second event pre-roll and explains the static comparison step', () => {
    expect(timelineSource).toContain('onTravelBefore={() => { void handleTravel(10); }}');
    expect(timelineSource).toContain('...(leadSeconds ? { leadSeconds } : {})');
    expect(eventSheetSource).toContain('⏪ 10 SEC BEFORE');
    expect(eventSheetSource).toContain('inspect the Deck, then tap ▶ to apply this event');
    expect(timelineSource).toContain('onTravelBefore={() => { void handleLocalTravel(10); }}');
    expect(timelineSource).toContain('...(leadSeconds ? { leadSeconds } : {})');
    expect(timelineSource).toContain('setTravelLeadSecondsBusy(leadSeconds ?? null)');
    expect(timelineTravelViewSource).toContain('⏪ START 10 SEC BEFORE CUE');
    expect(timelineTravelViewSource).toContain('inspect the Deck, then tap ▶ to apply this cue');
  });

  it('persists one plan-level Deck transition policy from Edit Plan', () => {
    expect(timelineSource).toContain('<PlanTransitionEditor');
    expect(timelineSource).toContain('value={draft?.transition}');
    expect(timelineSource).toContain('plan.transition = transition');
    expect(planTransitionEditorSource).toContain('Saved with this plan.');
    expect(planTransitionEditorSource).toContain("mode: 'trans_flash'");
    expect(planTransitionEditorSource).toContain('<DeckTransitionControls');
  });

  it('offers a persistent plan pause distinct from temporary takeover', () => {
    expect(timelineSource).toContain("title: 'PAUSE ACTIVE PLAN?'");
    expect(timelineSource).toContain("const ok = await setAutopilot(false)");
    expect(timelineSource).toContain('onPausePlan={() => { void handlePausePlan(); }}');
    expect(liveSource).toContain('label="PAUSE PLAN"');
    expect(liveSource).toContain('TAKE OVER is temporary and auto-resumes. PAUSE PLAN stays off until you resume it.');
  });

  it('auto-collapses Time Travel into a persistent expandable chip', () => {
    expect(zoomBannerSource).toContain('TRAVEL_EXPANDED_MS');
    expect(zoomBannerSource).toContain('scheduleTravelCollapse');
    expect(zoomBannerSource).toContain('styles.compactChip');
    expect(zoomBannerSource).toContain('EXPAND');
  });

  it('uses review-first manual and Baby Reveal workflows', () => {
    expect(timelineSource).toContain('<ManualCueReviewSheet');
    expect(timelineSource).toContain('<BabyRevealChoiceSheet');
    expect(timelineSource).toContain('babyRevealConfirmation(cue.id)');
    expect(timelineSource).toContain('confirmAndFireManualCue');
  });

  it('does not fake a Performance unlock over unprotected engine routes', () => {
    expect(timelineSource).not.toContain('PerformanceRouteGuard');
    expect(timelineSource).toContain('performanceViewOnly: performanceMode.active');
    expect(timelineSource).toContain('timelineDataStale || performanceMode.active');
    expect(timelineSource).toContain('travelDisabled={performanceMode.active}');
    expect(timelineSource).toContain("next === 'edit' || next === 'travel'");
  });

  it('keeps the cue body scrollable while dedicated drag controls lock native scrolling', () => {
    expect(cueEditorSource).toContain('<LockableScrollView');
    expect(cueEditorSource).toContain('style={styles.sheetScroll}');
    expect(cueEditorSource).toContain('<View style={styles.panelHost}>');
    expect(cueEditorSource).toContain('style={styles.backdropDismiss}');
    expect(cueEditorSource).not.toContain('onPress={(e) => e.stopPropagation()} style={styles.panelHost}');
    expect(dayTimePickerSource).toContain('<Pressable');
    expect(dayTimePickerSource).not.toContain('columnResponder');
    expect(dayTimePickerSource).toContain('acquireScrollLock()');
  });

  it('preflights the complete plan before mutating or closing the cue editor', () => {
    const validateAt = timelineSource.indexOf('const validation = await previewTimelineOverview(candidate)');
    const mutateAt = timelineSource.indexOf('mutateDraft((p) => {', validateAt);
    expect(validateAt).toBeGreaterThan(-1);
    expect(mutateAt).toBeGreaterThan(validateAt);
    expect(cueEditorSource).toContain('const result = await onSave(candidate,');
    expect(cueEditorSource).toContain('VALIDATING…');
    expect(cueEditorSource).toContain('if (!result.ok)');
    expect(cueEditorSource).toContain('opening || wantKey !== seedKey');
  });

  it('selects the next Party playlist from a dropdown instead of tap-cycling', () => {
    expect(partyCardSource).toContain('<Dropdown');
    expect(partyCardSource).toContain('availablePlaylists ?? []');
    expect(partyCardSource).toContain('setPartyConfig({ playlist })');
    expect(partyCardSource).not.toContain('cyclePlaylist');
  });

  it('authors Party as a timed window and hides internal Phase and Mood choices', () => {
    expect(cueEditorSource).toContain("{ id: 'party', label: 'Party Window' }");
    expect(cueEditorSource).toContain('<FieldLabel>PLACE ON DAY</FieldLabel>');
    expect(cueEditorSource).toContain('EXACT START ·');
    expect(cueEditorSource).toContain('<FieldLabel>WINDOW BASELINE</FieldLabel>');
    expect(cueEditorSource).toContain('<FieldLabel>DETECTED PARTY</FieldLabel>');
    expect(cueEditorSource).toContain('COPY BASELINE → PARTY');
    expect(cueEditorSource).toContain('COPY PARTY → BASELINE');
    expect(cueEditorSource).toContain('renderActionBody(partyAction');
    expect(cueEditorSource).not.toContain("{ id: 'phase', label: 'Phase' }");
    expect(cueEditorSource).not.toContain("{ id: 'mood', label: 'Mood' }");
  });

  it('shows Companion detector gates, Timeline timers, and engine readiness in LIVE', () => {
    expect(partyCardSource).toContain('audioPartyStrong');
    expect(partyCardSource).toContain('QUALIFIED SIGNAL');
    expect(partyCardSource).toContain('AUDIO COMPANION DETECTOR');
    expect(partyCardSource).toContain('LEVEL');
    expect(partyCardSource).toContain('BEAT');
    expect(partyCardSource).toContain('SHAPE');
    expect(partyCardSource).toContain('QUIET');
    expect(partyCardSource).toContain('Tap any gate');
    expect(partyCardSource).toContain('partyTimerReadouts');
    // _356 §4: the readiness row and every control's enablement/label come
    // from the two PURE helpers, so the card cannot invent a chip or leave a
    // button enabled that the engine would refuse. The chip fields and the
    // button labels are pinned by utils/party_api.test.ts.
    expect(partyCardSource).toContain('partyReadinessChips');
    expect(partyCardSource).toContain('partyButtonRules');
    expect(partyCardSource).toContain('buttons.force.enabled');
    expect(partyCardSource).toContain('buttons.returnToAudio.enabled');
    expect(partyCardSource).toContain('buttons.resetCooldown.enabled');
    expect(partyCardSource).toContain('FORCE PARTY starts immediately');
    expect(partyCardSource).toContain('setInterval(() => { void refresh(); }, 1000)');
    // No chip may be derived pad-side from the clock-only phase view.
    expect(partyCardSource).not.toContain('currentPhase');
  });

  it('names the engine deck owner in the NOW card instead of the ribbon guess', () => {
    expect(liveSource).toContain('nowOwner.sourceLabel');
    expect(liveSource).toContain('nowOwner.rangeLabel');
    expect(liveSource).toContain('timelineOwnerKindLabel(nowOwner.kind)');
  });

  it('shows the party cue error and a stale companion signal as alerts', () => {
    expect(partyCardSource).toContain('PARTY CUE ERROR');
    expect(partyCardSource).toContain('SIGNAL STALE — companion not publishing');
  });

  it('ends the party session on the ENGINE first and clears the companion override after', () => {
    const engineCall = partyCardSource.indexOf('await returnPartyToLiveAudio()');
    const companionCall = partyCardSource.indexOf("await setPartyTestOverride('auto')");
    expect(engineCall).toBeGreaterThan(-1);
    expect(companionCall).toBeGreaterThan(engineCall);
    expect(partyCardSource).toContain('setOverrideError');
  });

  it('caps the entire sidebar Global mode area at two rows', () => {
    expect(tabsLayoutSource).toContain('<PerformanceModeControl isPortrait />');
    expect(tabsLayoutSource).toContain('maxRows={1}');
    expect(tabsLayoutSource).toContain('leading={editSessionVisible ? <EditSessionChip /> : null}');
    expect(tabsLayoutSource).not.toContain('<View style={{ marginTop: 8 }}>\n          <EditSessionChip />');
  });

  // ── report _359: the working-day frame ────────────────────────────────

  it('draws every calendar marker from the ONE shared legend (C-02)', () => {
    // The legend renders from the frame model's id list, so a marker cannot be
    // drawn without a row — and both calendars read the same colour table.
    expect(legendSource).toContain('FRAME_LEGEND_IDS.map');
    expect(legendSource).toContain('FRAME_SUN_COLORS');
    expect(stripSource).toContain('FRAME_SUN_COLORS[marker.id]');
    expect(dayViewSource).toContain('FRAME_SUN_COLORS[marker.id]');
    // The unlabelled golden-hour tick is gone (it was in no legend).
    expect(stripSource).not.toContain('goldenHourStart');
    expect(legendSource).not.toContain("label=\"NIGHT\"");
  });

  it('mounts ONE week strip through one prop builder (C-12)', () => {
    expect(timelineSource).toContain('const stripPropsFor = useCallback');
    expect(timelineSource).toContain('<DayOverviewStrip {...stripPropsFor(overview.days)} />');
    expect(timelineSource).not.toContain('todayIndex={todayIndex}');
  });

  it('offers the frame toggle on every Timeline view and persists it (D.1)', () => {
    expect(shellSource).toContain('WORKING DAY · 6 PM → 6 PM');
    expect(shellSource).toContain('CALENDAR DAY · 12 AM → 12 AM');
    expect(shellSource).toContain('useDayFrame()');
    expect(rootLayoutSource).toContain('<DayFrameProvider>');
  });

  it('drops the inert SHIFT TONIGHT slot and the day-latch jargon (C-11)', () => {
    expect(dayViewSource).not.toContain('SHIFT TONIGHT');
    expect(dayViewSource).not.toContain('midnight day-latch semantics');
    expect(dayViewSource).toContain('frameExplainer(frame)');
  });

  it('never leaves NOW silent when it sits outside every span (C-01)', () => {
    expect(stripSource).toContain('frameNowSentence');
    expect(dayViewSource).toContain('frameNowSentence');
    expect(stripSource).toContain('TONIGHT · opens 6:00 PM');
  });

  it('draws party bands from the engine partyWindow alone (C-03)', () => {
    expect(stripSource).toContain('framePartyBands(span)');
    expect(dayViewSource).toContain('framePartyBands(span)');
    expect(stripSource).not.toContain("startsWith('pw_')");
    expect(dayViewSource).not.toContain("startsWith('pw_')");
  });

  it('places manual cues on the day and allows a staged Special Event action', () => {
    expect(cueEditorSource).toContain('PLANNED TIME ·');
    expect(cueEditorSource).toContain('placementAt');
    expect(cueEditorSource).toContain("{ id: 'special_event', label: 'Special Event' }");
    expect(cueEditorSource).toContain('No Special Events are usable in this scene.');
  });
});
