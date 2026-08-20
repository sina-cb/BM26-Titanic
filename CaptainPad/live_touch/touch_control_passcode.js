/* ────────────────────────────────────────────────────────────────────────────
   touch_control_passcode.js — the Live Touch operator-passcode gate.

   Operator ruling (2026-08-14): "Take over in performance mode from the
   timeline needs to have either of the passwords we have for Sina, Muisha, or
   Sailors … pass code is required EVERY TIME."

   The engine enforces that gate (marsin_engine/lib/api_server.js →
   checkTakeoverPasscode). It refuses a takeover of a running plan with
   401/429 and one of three codes. Before this file existed the Live Touch
   surface simply showed that refusal as a raw error and stayed disarmed — the
   operator had no way to answer it. This module is the answer: it classifies
   the refusal, renders a prompt in the panel's own visual language, and hands
   the typed passcode to ONE retried request.

   THE RULES THIS FILE OBEYS — they are the ruling, not preferences:

   1. FRESH PROMPT PER ATTEMPT. Every gated request opens its own prompt. Two
      ARMs ask twice. Nothing is remembered between them.
   2. NO STORAGE OF ANY KIND. The passcode exists as a function argument and as
      the value of one <input> that is wiped the instant it is read. It is
      never written to localStorage, sessionStorage, IndexedDB, a cookie, a
      module-level variable, a URL, a log line, or a postMessage. This file
      contains no reference to any of those APIs, and the tests assert that.
   3. THE ATTEMPT IS NEVER ECHOED. A refusal shows the ENGINE's reason only.
   4. CANCEL IS NOT A FAILURE, BUT IT IS NOT A TAKEOVER EITHER. No request is
      retried and the surface stays disarmed.
   5. FAIL LOUD (codex P0). If the prompt cannot render, the gate throws. It
      never proceeds unauthenticated and never silently does nothing.
   ──────────────────────────────────────────────────────────────────────────── */

(function (root) {
  'use strict';

  /* The engine's three refusal codes. ANYTHING ELSE IS NOT A PASSCODE PROBLEM
     and must go to the caller's normal error channel — the operator is never
     asked to retype a passcode against "portwatch owns the rig". */
  var REFUSAL_CODES = {
    TAKEOVER_AUTH_REQUIRED: true,
    TAKEOVER_AUTH_INVALID: true,
    TAKEOVER_AUTH_RATE_LIMITED: true,
  };

  var HEADER = 'X-CaptainPad-Passcode';

  /* Big-thumb night UI. The operator is standing on a dark ship mid-show with
     one hand on the panel; these are floors, deliberately above the 44 px
     touch minimum the rest of the surface uses for controls touched between
     looks rather than during one. */
  var INPUT_HEIGHT_PX = 72;
  var BUTTON_HEIGHT_PX = 64;

  /**
   * Classify one engine response body as a takeover refusal.
   *
   * @param {number} status HTTP status.
   * @param {string} bodyText raw response body.
   * @returns {{status:number, code:string, reason:string, retryAfterMs:(number|null)}|null}
   *   null when this is not a passcode refusal.
   */
  function refusalFromResponse(status, bodyText) {
    if (status !== 401 && status !== 429) return null;
    var parsed;
    try { parsed = JSON.parse(bodyText); } catch (error) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (!REFUSAL_CODES[parsed.code]) return null;
    return {
      status: status,
      code: parsed.code,
      /* The ENGINE's words. Never the attempt. */
      reason: typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : 'the engine refused this takeover',
      retryAfterMs: typeof parsed.retryAfterMs === 'number' ? parsed.retryAfterMs : null,
    };
  }

  function takeoverRefusalOf(error) {
    return error && error.takeoverRefusal ? error.takeoverRefusal : null;
  }

  /** Operator-facing line for a refusal. Contains no credential material. */
  function messageForRefusal(refusal) {
    if (refusal.code === 'TAKEOVER_AUTH_RATE_LIMITED') {
      var seconds = refusal.retryAfterMs ? Math.ceil(refusal.retryAfterMs / 1000) : null;
      return seconds
        ? 'Too many attempts — this panel is locked out for ' + seconds + ' s.'
        : 'Too many attempts — this panel is locked out. Wait, then try again.';
    }
    if (refusal.code === 'TAKEOVER_AUTH_INVALID') {
      return 'Passcode rejected. Check it and try again.';
    }
    return refusal.reason;
  }

  function cancellation(what) {
    var error = new Error(what + ' was cancelled at the passcode prompt — '
      + 'the timeline keeps the rig and this panel stays DISARMED.');
    error.takeoverCancelled = true;
    return error;
  }

  /**
   * Run one takeover-gated request behind the passcode prompt.
   *
   * `send(passcode)` performs EXACTLY ONE request. It is called once with
   * `null` (the ordinary, passcode-free attempt — performance mode off, or on
   * but the engine has not refused yet) and then once per submitted passcode.
   * That one-call-per-attempt shape is what makes "the header rides exactly one
   * retry" true rather than hopeful.
   *
   * @param {function(?string): Promise<*>} send
   * @param {{ask: function(Object): Promise<?string>, close: function()}} prompt
   * @param {string} what operator-facing name of the gesture being authorised.
   * @returns {Promise<*>}
   */
  function runGatedRequest(send, prompt, what) {
    if (typeof send !== 'function') {
      throw new Error('the Live Touch passcode gate needs a request to send');
    }
    return Promise.resolve().then(function () { return send(null); })
      .catch(function (error) {
        var refusal = takeoverRefusalOf(error);
        /* PERFORMANCE MODE OFF → this branch is never taken and the request is
           byte-identical to what it always was. A mode flip between our last
           state read and this request lands HERE, so it prompts instead of
           failing silently. */
        if (!refusal) throw error;

        /* FAIL LOUD. A gate that cannot ask must never let the takeover past. */
        if (!prompt || typeof prompt.ask !== 'function' || typeof prompt.close !== 'function') {
          throw new Error('performance mode requires an operator passcode for ' + what
            + ', but this panel cannot render the passcode prompt — refusing the takeover');
        }

        function attempt(detail) {
          return prompt.ask(detail).then(function (passcode) {
            if (passcode === null) {
              prompt.close();
              throw cancellation(what);
            }
            /* ONE retry per submission. The value lives only as this argument;
               it is not captured, cached, or reused for the next attempt. */
            return send(passcode).then(function (value) {
              prompt.close();
              return value;
            }, function (retryError) {
              var retryRefusal = takeoverRefusalOf(retryError);
              if (!retryRefusal) {
                /* Not a passcode problem — close and let it surface normally. */
                prompt.close();
                throw retryError;
              }
              return attempt({
                what: what,
                code: retryRefusal.code,
                reason: messageForRefusal(retryRefusal),
              });
            });
          }, function (promptError) {
            prompt.close();
            throw promptError;
          });
        }

        return attempt({
          what: what,
          code: refusal.code,
          reason: messageForRefusal(refusal),
        });
      });
  }

  /* ── the prompt ───────────────────────────────────────────────────────────
     Rendered INSIDE this iframe, into this document. Nothing about it crosses
     the frame boundary: no postMessage, no parent DOM, no query string. The
     parent page never sees the value and cannot read it back — the panel and
     the engine are the only two parties. */
  function styleBlock(rules) {
    return rules.join(';');
  }

  function createPrompt(doc) {
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      throw new Error('Live Touch cannot render the operator passcode prompt: no document body');
    }

    var overlay = doc.createElement('div');
    overlay.id = 'takeoverPasscode';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Operator passcode required');
    /* Above the Spatial fullscreen panel (z-index 1000) and the wire's error
       toast (9999). A prompt the operator cannot see is a prompt that hangs
       the takeover. */
    overlay.style.cssText = styleBlock([
      'position:fixed', 'inset:0', 'z-index:100000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'background:rgba(4,8,16,.86)',
      'backdrop-filter:blur(3px)', '-webkit-backdrop-filter:blur(3px)',
      'font:400 14px/1.4 Inter,system-ui,sans-serif',
    ]);

    var card = doc.createElement('div');
    card.style.cssText = styleBlock([
      'width:min(560px,100%)', 'box-sizing:border-box',
      'background:var(--panel,#24406f)', 'color:var(--text,#fff)',
      'border:1px solid var(--border,rgba(226,238,255,.34))',
      'border-radius:var(--radius-lg,18px)', 'padding:26px',
      'box-shadow:0 24px 64px rgba(0,0,0,.6)',
      'display:flex', 'flex-direction:column', 'gap:16px',
    ]);

    var title = doc.createElement('div');
    title.textContent = 'OPERATOR PASSCODE';
    title.style.cssText = styleBlock([
      'font:800 20px/1.2 Inter,system-ui,sans-serif', 'letter-spacing:.10em',
      'color:var(--text,#fff)',
    ]);

    var subtitle = doc.createElement('div');
    subtitle.style.cssText = styleBlock([
      'font-size:14px', 'line-height:1.45', 'color:var(--text-dim,rgba(255,255,255,.86))',
    ]);

    var errorBox = doc.createElement('div');
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;
    /* The SAME error language the wire's failure toast already uses, so a
       refusal here reads as the panel's own voice rather than a new dialect. */
    errorBox.style.cssText = styleBlock([
      'display:none', 'padding:12px 14px', 'border-radius:var(--radius-sm,10px)',
      'border:1px solid rgba(255,120,120,.5)', 'background:rgba(40,8,12,.96)',
      'color:#ff8f8f', 'font-weight:700', 'font-size:15px',
    ]);

    var input = doc.createElement('input');
    input.type = 'password';
    input.id = 'takeoverPasscodeInput';
    /* No autofill, no suggestion strip, no password-manager capture: this code
       is typed fresh every time and must not be offered back later. */
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('name', 'takeover-passcode');
    input.setAttribute('aria-label', 'Operator passcode');
    input.style.cssText = styleBlock([
      'box-sizing:border-box', 'width:100%', 'height:' + INPUT_HEIGHT_PX + 'px',
      'padding:0 18px', 'border-radius:var(--radius-md,14px)',
      'border:2px solid var(--border,rgba(226,238,255,.34))',
      'background:var(--bg-elevated,#0b1220)', 'color:var(--text,#fff)',
      'font:700 24px/1 Inter,system-ui,sans-serif', 'letter-spacing:.20em',
    ]);

    var hint = doc.createElement('div');
    hint.textContent = 'Tap the box to bring up the keyboard.';
    hint.style.cssText = styleBlock([
      'font-size:12px', 'letter-spacing:.04em',
      'color:var(--text-dim,rgba(255,255,255,.7))',
    ]);

    var row = doc.createElement('div');
    row.style.cssText = styleBlock(['display:flex', 'gap:14px']);

    function buttonStyle(primary) {
      return styleBlock([
        'flex:1', 'min-height:' + BUTTON_HEIGHT_PX + 'px',
        'border-radius:var(--radius-md,14px)',
        'font:800 17px/1 Inter,system-ui,sans-serif', 'letter-spacing:.08em',
        'cursor:pointer', 'touch-action:manipulation',
        primary
          ? 'border:1px solid var(--live,#8bffd4)'
          : 'border:1px solid var(--border,rgba(226,238,255,.34))',
        primary
          ? 'background:var(--live,#8bffd4)'
          : 'background:var(--bg-elevated,#0b1220)',
        primary ? 'color:var(--live-ink,#071a14)' : 'color:var(--text-soft,#e2eeff)',
      ]);
    }

    var cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.setAttribute('aria-label', 'Cancel the takeover and stay disarmed');
    cancelBtn.style.cssText = buttonStyle(false);

    var submitBtn = doc.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = 'TAKE OVER';
    submitBtn.setAttribute('aria-label', 'Submit the operator passcode and take over');
    submitBtn.style.cssText = buttonStyle(true);

    row.appendChild(cancelBtn);
    row.appendChild(submitBtn);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(errorBox);
    card.appendChild(input);
    card.appendChild(hint);
    card.appendChild(row);
    overlay.appendChild(card);

    var settle = null;      /* resolver for the ask() currently awaiting input */
    var attached = false;

    /* THE ONLY PLACE THE VALUE IS READ, AND IT IS WIPED IN THE SAME BREATH. */
    function takeValue() {
      var typed = input.value;
      input.value = '';
      return typed;
    }

    function finish(value) {
      if (!settle) return;
      var resolve = settle;
      settle = null;
      resolve(value);
    }

    function submit() {
      var typed = takeValue();
      if (!typed) {
        showReason('Type the operator passcode, or press CANCEL.');
        return;
      }
      finish(typed);
    }

    function showReason(reason) {
      if (reason) {
        errorBox.textContent = reason;
        errorBox.hidden = false;
        errorBox.style.display = 'block';
        return;
      }
      errorBox.textContent = '';
      errorBox.hidden = true;
      errorBox.style.display = 'none';
    }

    cancelBtn.addEventListener('click', function () { takeValue(); finish(null); });
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
      else if (event.key === 'Escape') { event.preventDefault(); takeValue(); finish(null); }
    });

    function ask(detail) {
      if (settle) {
        throw new Error('the Live Touch passcode prompt is already waiting for an answer');
      }
      var gesture = (detail && detail.what) || 'this takeover';
      subtitle.textContent = 'PERFORMANCE MODE IS LIVE. ' + gesture
        + ' needs a fresh operator passcode — every time.';
      /* REQUIRED is the explanation, not a fault: only a real rejection paints
         the error box red. */
      showReason(detail && detail.code && detail.code !== 'TAKEOVER_AUTH_REQUIRED'
        ? detail.reason : '');
      input.value = '';
      if (!attached) {
        doc.body.appendChild(overlay);
        attached = true;
      }
      /* iOS will not always raise the on-screen keyboard for a focus() that is
         not inside the original touch gesture — and the prompt necessarily
         opens after an async refusal. The box is therefore a 72 px target with
         a printed hint, so a tap is always enough. */
      if (typeof input.focus === 'function') input.focus();
      return new Promise(function (resolve) { settle = resolve; });
    }

    function close() {
      takeValue();
      showReason('');
      if (settle) finish(null);
      if (attached && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      attached = false;
    }

    return {
      ask: ask,
      close: close,
      isOpen: function () { return attached; },
      element: overlay,
      input: input,
      cancelButton: cancelBtn,
      submitButton: submitBtn,
      errorBox: errorBox,
      subtitle: subtitle,
    };
  }

  root.TouchControlPasscode = Object.freeze({
    HEADER: HEADER,
    INPUT_HEIGHT_PX: INPUT_HEIGHT_PX,
    BUTTON_HEIGHT_PX: BUTTON_HEIGHT_PX,
    refusalFromResponse: refusalFromResponse,
    takeoverRefusalOf: takeoverRefusalOf,
    messageForRefusal: messageForRefusal,
    runGatedRequest: runGatedRequest,
    createPrompt: createPrompt,
  });
}(window));
