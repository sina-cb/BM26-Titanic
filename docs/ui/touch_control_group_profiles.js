/* Canonical group-view fader profiles for Live Touch.
 *
 * The 24 real group strips remain the only state and wire authority. This
 * module renders a smaller control bank whose faders fan out to exact,
 * group-complete memberships returned by /model/view-selection-options.
 * Missing, overlapping, partial, or non-exhaustive views fail visibly; a
 * profile may never approximate a model view.
 */
(function (root) {
  'use strict';

  var PROFILE_DEFS = Object.freeze([
    Object.freeze({ id: 'individual', label: 'Individual groups · 24', views: null }),
    Object.freeze({
      id: 'instruments',
      label: 'Show instruments · 5',
      views: Object.freeze(['Hull Canvas', 'Silhouette', 'Jewelry', 'Organs', 'Identity']),
    }),
    Object.freeze({
      id: 'planes',
      label: 'Performance planes · 4',
      views: Object.freeze(['FRONT', 'BACK', 'Organs', 'Identity']),
    }),
  ]);

  function requireUniqueStrings(values, label) {
    if (!Array.isArray(values) || !values.length) throw new Error(label + ' must be a non-empty array');
    var seen = {};
    return values.map(function (value) {
      if (typeof value !== 'string' || !value || seen[value]) {
        throw new Error(label + ' contains an invalid or duplicate name');
      }
      seen[value] = true;
      return value;
    });
  }

  function compileProfiles(catalog) {
    if (!catalog || typeof catalog !== 'object') throw new Error('group profile catalog is missing');
    var groups = requireUniqueStrings(catalog.groups, 'model groups');
    if (!Array.isArray(catalog.namedViews)) throw new Error('model namedViews catalog is missing');
    var byName = {};
    catalog.namedViews.forEach(function (entry) {
      if (!entry || typeof entry.name !== 'string' || !entry.name || byName[entry.name]) {
        throw new Error('model namedViews catalog contains an invalid or duplicate view');
      }
      byName[entry.name] = entry;
    });

    return PROFILE_DEFS.map(function (definition) {
      if (!definition.views) return { id: definition.id, label: definition.label, channels: null };
      var ownership = {};
      var channels = definition.views.map(function (viewName) {
        var view = byName[viewName];
        if (!view) throw new Error("group profile requires unknown view '" + viewName + "'");
        var partial = Array.isArray(view.partialGroupNames) ? view.partialGroupNames : null;
        var members = Array.isArray(view.groupNames) ? view.groupNames : null;
        if (!partial || !members) {
          throw new Error("view '" + viewName + "' has no exact group-membership metadata");
        }
        if (partial.length) {
          throw new Error("view '" + viewName + "' cuts through group(s): " + partial.join(', '));
        }
        if (!Number.isInteger(view.memberCount) || view.memberCount <= 0) {
          throw new Error("view '" + viewName + "' has an invalid pixel count");
        }
        members = requireUniqueStrings(members, "view '" + viewName + "' groups");
        members.forEach(function (group) {
          if (groups.indexOf(group) === -1) {
            throw new Error("view '" + viewName + "' contains unknown group '" + group + "'");
          }
          if (ownership[group]) {
            throw new Error("profile '" + definition.id + "' overlaps group '" + group +
              "' in views '" + ownership[group] + "' and '" + viewName + "'");
          }
          ownership[group] = viewName;
        });
        return {
          name: viewName,
          groups: members.slice(),
          memberCount: view.memberCount,
        };
      });
      var missing = groups.filter(function (group) { return !ownership[group]; });
      if (missing.length) {
        throw new Error("profile '" + definition.id + "' omits group(s): " + missing.join(', '));
      }
      return { id: definition.id, label: definition.label, channels: channels };
    });
  }

  var installed = false;
  var profiles = null;
  var activeId = 'individual';
  var dropdown = null;
  var profileGrid = null;
  var groupsGrid = null;
  var panel = null;
  var bank = null;

  function dispatchBrightness(names, final) {
    groupsGrid.dispatchEvent(new root.CustomEvent('groupprofilebrightnesschange', {
      bubbles: true,
      detail: { names: names.slice(), final: final === true },
    }));
  }

  function dispatchMaster(value, final) {
    groupsGrid.dispatchEvent(new root.CustomEvent('groupprofilemasterchange', {
      bubbles: true,
      detail: { value: value / 100, final: final === true },
    }));
  }

  function drawLevel(strip, percent, mixed) {
    var value = Math.max(0, Math.min(100, Math.round(percent)));
    strip.dataset.level = String(value);
    var fill = strip.querySelector('.fader-fill');
    var cap = strip.querySelector('.fader-cap');
    var out = strip.querySelector('[data-role=pct]');
    if (fill) fill.style.height = value + '%';
    if (cap) cap.style.bottom = value + '%';
    if (out) out.textContent = mixed ? 'MIX' : value + '%';
    strip.classList.toggle('is-mixed', mixed === true);
    var track = strip.querySelector('.fader-track');
    if (track) {
      track.setAttribute('aria-valuenow', String(value));
      track.setAttribute('aria-valuetext', mixed ? 'Mixed group levels' : value + ' percent');
    }
    var badge = strip.querySelector('.profile-view-count');
    if (badge && strip.dataset.summary) {
      badge.textContent = mixed ? 'MIX · ' + strip.dataset.groupCount + 'G' : strip.dataset.summary;
    }
  }

  function bindFader(track, apply, label) {
    var pointerId = null;
    var latestY = null;
    var frame = null;
    function valueFor(clientY) {
      var rect = track.getBoundingClientRect();
      if (!(rect.height > 0)) throw new Error('profile fader has no measurable height');
      return Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    }
    function cancelFrame() {
      if (frame !== null) root.cancelAnimationFrame(frame);
      frame = null;
    }
    function schedule(clientY) {
      latestY = clientY;
      if (frame !== null) return;
      frame = root.requestAnimationFrame(function () {
        frame = null;
        apply(valueFor(latestY), false);
      });
    }
    function finish(event, cancelled) {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      cancelFrame();
      var y = cancelled ? latestY : event.clientY;
      if (y !== null) apply(valueFor(y), true);
      pointerId = null;
      latestY = null;
    }
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '100');
    track.addEventListener('pointerdown', function (event) {
      pointerId = event.pointerId;
      try { track.setPointerCapture(pointerId); } catch (_) {
        // Window-level release listeners below remain authoritative when an
        // older iPad browser refuses pointer capture.
      }
      event.preventDefault();
      schedule(event.clientY);
    });
    track.addEventListener('pointermove', function (event) {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      schedule(event.clientY);
    });
    root.addEventListener('pointerup', function (event) { finish(event, false); });
    root.addEventListener('pointercancel', function (event) { finish(event, true); });
    track.addEventListener('keydown', function (event) {
      var current = Number(track.getAttribute('aria-valuenow'));
      if (!Number.isFinite(current)) current = 100;
      var step = event.shiftKey ? 5 : 1;
      var next = current;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += step;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= step;
      else if (event.key === 'PageUp') next += 10;
      else if (event.key === 'PageDown') next -= 10;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      else return;
      event.preventDefault();
      apply(Math.max(0, Math.min(100, next)), true);
    });
  }

  function masterStrip() {
    var strip = root.document.createElement('div');
    strip.className = 'fader-strip is-master';
    strip.innerHTML = '<span class="fader-name">MASTER</span>' +
      '<span class="fader-pct" data-role="pct">100%</span>' +
      '<div class="fader-track" data-role="masterfader">' +
        '<div class="fader-fill" style="height:100%"></div>' +
        '<div class="fader-cap" style="bottom:100%"></div>' +
      '</div><span class="link-count">LIVE</span>';
    var track = strip.querySelector('[data-role=masterfader]');
    bindFader(track, function (percent, final) {
      var value = bank.setMaster(percent);
      drawLevel(strip, value, false);
      dispatchMaster(value, final);
    }, 'Live groups master brightness');
    return strip;
  }

  function channelStrip(channel) {
    var strip = root.document.createElement('div');
    strip.className = 'fader-strip profile-view-strip';
    strip.dataset.viewName = channel.name;
    strip.dataset.groupCount = String(channel.groups.length);
    strip.dataset.summary = channel.groups.length + 'G · ' + channel.memberCount + 'P';
    strip.innerHTML = '<div class="fader-checks"><span class="profile-view-count">' +
      strip.dataset.summary + '</span></div>' +
      '<div class="fader-track" data-role="profilefader">' +
        '<div class="fader-fill"></div><div class="fader-cap"></div>' +
        '<span class="fader-name"></span><span class="fader-pct" data-role="pct"></span>' +
      '</div><span class="fader-sw" data-role="profilepower"></span>';
    strip.querySelector('.fader-name').textContent = channel.name;
    var track = strip.querySelector('[data-role=profilefader]');
    bindFader(track, function (percent, final) {
      var changed = bank.setGroupsLevel(channel.groups, percent);
      var state = bank.readGroups(channel.groups);
      drawLevel(strip, state.level, state.mixedLevel);
      if (changed.length) dispatchBrightness(changed, final);
    }, channel.name + ' brightness');
    var power = strip.querySelector('[data-role=profilepower]');
    power.setAttribute('role', 'button');
    power.setAttribute('tabindex', '0');
    power.setAttribute('aria-label', channel.name + ' power');
    function togglePower(event) {
      event.stopPropagation();
      var state = bank.readGroups(channel.groups);
      bank.setGroupsPower(channel.groups, state.onCount !== state.count);
      syncActiveProfile();
    }
    power.addEventListener('click', togglePower);
    power.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      togglePower(event);
    });
    return strip;
  }

  function activeProfile() {
    return profiles && profiles.find(function (profile) { return profile.id === activeId; });
  }

  function syncSummary() {
    var profile = activeProfile();
    if (!profile || !profile.channels) return;
    var on = 0;
    bank.groupNames.forEach(function (name) { on += bank.readGroups([name]).onCount; });
    var count = root.document.getElementById('groupCount');
    if (count) count.textContent = profile.channels.length + ' views · ' + on + '/' +
      bank.groupNames.length + ' groups on';
  }

  function syncActiveProfile() {
    var profile = activeProfile();
    if (!profile || !profile.channels || profileGrid.hidden) return;
    drawLevel(profileGrid.querySelector('.is-master'), bank.readMaster(), false);
    profile.channels.forEach(function (channel) {
      var strip = profileGrid.querySelector('[data-view-name="' + channel.name + '"]');
      var state = bank.readGroups(channel.groups);
      var mixed = state.mixedLevel || (state.onCount > 0 && state.onCount < state.count);
      drawLevel(strip, state.level, mixed);
      var power = strip.querySelector('[data-role=profilepower]');
      power.classList.toggle('is-on', state.onCount === state.count);
      strip.classList.toggle('is-off', state.onCount === 0);
      power.title = state.onCount + '/' + state.count + ' member groups on';
      power.setAttribute('aria-pressed', state.onCount === state.count ? 'true' : 'false');
    });
    syncSummary();
  }

  function renderProfile(id) {
    var profile = profiles.find(function (candidate) { return candidate.id === id; });
    if (!profile) throw new Error("unknown group profile '" + id + "'");
    activeId = id;
    dropdown.value = id;
    var individual = !profile.channels;
    panel.classList.toggle('is-profile-mode', !individual);
    groupsGrid.hidden = !individual;
    profileGrid.hidden = individual;
    if (individual) {
      var on = root.document.getElementById('tbOn');
      var summary = root.document.getElementById('groupCount');
      if (summary && on) summary.textContent = bank.groupNames.length + ' groups · ' + on.textContent + ' on';
      return;
    }
    profileGrid.replaceChildren();
    profileGrid.style.setProperty('--profile-columns', String(profile.channels.length));
    profileGrid.appendChild(masterStrip());
    profile.channels.forEach(function (channel) { profileGrid.appendChild(channelStrip(channel)); });
    syncActiveProfile();
  }

  function install(catalog) {
    var compiled = compileProfiles(catalog);
    if (!root.document || !root.TouchGroupBank) {
      throw new Error('group profile UI loaded before the canonical group bank');
    }
    var domGroups = requireUniqueStrings(root.TouchGroupBank.groupNames, 'Live Touch group bank');
    var catalogGroups = requireUniqueStrings(catalog.groups, 'model groups');
    var missing = domGroups.filter(function (name) { return catalogGroups.indexOf(name) === -1; });
    var extra = catalogGroups.filter(function (name) { return domGroups.indexOf(name) === -1; });
    if (missing.length || extra.length) {
      throw new Error('Live Touch/model group catalog mismatch; missing [' + missing.join(', ') +
        '], extra [' + extra.join(', ') + ']');
    }
    profiles = compiled;
    bank = root.TouchGroupBank;
    dropdown = root.document.getElementById('groupProfileSelect');
    profileGrid = root.document.getElementById('groupProfileGrid');
    groupsGrid = root.document.getElementById('groupsGrid');
    panel = root.document.querySelector('.groups-panel');
    if (!dropdown || !profileGrid || !groupsGrid || !panel) {
      throw new Error('group profile UI elements are missing');
    }
    dropdown.replaceChildren();
    profiles.forEach(function (profile) {
      var option = root.document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label;
      dropdown.appendChild(option);
    });
    dropdown.disabled = false;
    if (!installed) {
      dropdown.addEventListener('change', function () {
        try { renderProfile(dropdown.value); }
        catch (error) {
          root.document.dispatchEvent(new root.CustomEvent('panelerror', {
            detail: { message: error.message },
          }));
        }
      });
      groupsGrid.addEventListener('groupmodeschange', function () { syncActiveProfile(); });
      panel.addEventListener('click', function () { syncSummary(); });
      installed = true;
    }
    renderProfile(activeId);
    return profiles;
  }

  var api = {
    definitions: PROFILE_DEFS,
    compileProfiles: compileProfiles,
    install: install,
    state: function () { return { installed: installed, activeId: activeId, profiles: profiles }; },
  };
  root.TouchGroupProfiles = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
