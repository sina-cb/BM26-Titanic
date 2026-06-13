/**
 * controllers.js — MarsinGui controller classes.
 *
 * Behavior is a faithful port of lil-gui 0.17.0 (the vendored build the
 * legacy UI runs) — see API_INVENTORY.md for the exact surface the
 * builders consume. Only the WIDGET DOM differs: CaptainPad-styled
 * markup (horizontal fader, pill toggle, themed select, swatch + hex,
 * macro button) styled exclusively via theme custom properties in
 * marsin_gui.css.
 *
 * DOM contract (consumed by gui_builder.js / pattern_editor.js /
 * control_schema.js):
 *   div.controller.<type>  — type ∈ boolean|color|string|number|option|function
 *     div.name             — label (40% column)
 *     <.widget>            — widget container
 * Number-with-range additionally exposes `.slider` > `.fill` (width in %)
 * so pattern_editor's styleAsHueSlider() keeps working unchanged.
 */

// ─── Base controller ─────────────────────────────────────────────────────

export class Controller {
  constructor(parent, object, property, className, widgetTag = 'div') {
    this.parent = parent;
    this.object = object;
    this.property = property;
    this._disabled = false;
    this._hidden = false;
    this.initialValue = this.getValue();

    this.domElement = document.createElement('div');
    this.domElement.classList.add('controller');
    this.domElement.classList.add(className);

    this.$name = document.createElement('div');
    this.$name.classList.add('name');
    Controller.nextNameID = (Controller.nextNameID || 0) + 1;
    this.$name.id = `marsin-gui-name-${Controller.nextNameID}`;

    this.$widget = document.createElement(widgetTag);
    this.$widget.classList.add('widget');
    this.$disable = this.$widget;

    this.domElement.appendChild(this.$name);
    this.domElement.appendChild(this.$widget);

    this.parent.children.push(this);
    this.parent.controllers.push(this);
    this.parent.$children.appendChild(this.domElement);

    this._listenCallback = this._listenCallback.bind(this);
    this.name(property);
  }

  name(name) {
    this._name = name;
    this.$name.innerHTML = name;
    return this;
  }

  onChange(callback) {
    this._onChange = callback;
    return this;
  }

  _callOnChange() {
    this.parent._callOnChange(this);
    if (this._onChange !== undefined) this._onChange.call(this, this.getValue());
    this._changed = true;
  }

  onFinishChange(callback) {
    this._onFinishChange = callback;
    return this;
  }

  _callOnFinishChange() {
    if (this._changed) {
      this.parent._callOnFinishChange(this);
      if (this._onFinishChange !== undefined) {
        this._onFinishChange.call(this, this.getValue());
      }
    }
    this._changed = false;
  }

  reset() {
    this.setValue(this.initialValue);
    this._callOnFinishChange();
    return this;
  }

  enable(enabled = true) {
    return this.disable(!enabled);
  }

  disable(disabled = true) {
    if (disabled !== this._disabled) {
      this._disabled = disabled;
      this.domElement.classList.toggle('disabled', disabled);
      this.$disable.toggleAttribute('disabled', disabled);
    }
    return this;
  }

  show(show = true) {
    this._hidden = !show;
    this.domElement.style.display = this._hidden ? 'none' : '';
    return this;
  }

  hide() {
    return this.show(false);
  }

  options(options) {
    const controller = this.parent.add(this.object, this.property, options);
    controller.name(this._name);
    this.destroy();
    return controller;
  }

  // No-ops on non-number controllers — NumberController overrides.
  min() { return this; }
  max() { return this; }
  step() { return this; }
  decimals() { return this; }

  listen(listen = true) {
    this._listening = listen;
    if (this._listenCallbackID !== undefined) {
      cancelAnimationFrame(this._listenCallbackID);
      this._listenCallbackID = undefined;
    }
    if (this._listening) this._listenCallback();
    return this;
  }

  _listenCallback() {
    this._listenCallbackID = requestAnimationFrame(this._listenCallback);
    const value = this.save();
    if (value !== this._listenPrevValue) this.updateDisplay();
    this._listenPrevValue = value;
  }

  getValue() {
    return this.object[this.property];
  }

  setValue(value) {
    this.object[this.property] = value;
    this._callOnChange();
    this.updateDisplay();
    return this;
  }

  updateDisplay() {
    return this;
  }

  load(value) {
    this.setValue(value);
    this._callOnFinishChange();
    return this;
  }

  save() {
    return this.getValue();
  }

  destroy() {
    this.listen(false);
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent.controllers.splice(this.parent.controllers.indexOf(this), 1);
    this.parent.$children.removeChild(this.domElement);
  }
}

// ─── Boolean — CaptainPad pill toggle ────────────────────────────────────

export class BooleanController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, 'boolean', 'label');

    this.$input = document.createElement('input');
    this.$input.setAttribute('type', 'checkbox');
    this.$input.setAttribute('aria-labelledby', this.$name.id);
    this.$pill = document.createElement('span');
    this.$pill.classList.add('pill');

    this.$widget.appendChild(this.$input);
    this.$widget.appendChild(this.$pill);

    this.$input.addEventListener('change', () => {
      this.setValue(this.$input.checked);
      this._callOnFinishChange();
    });

    this.$disable = this.$input;
    this.updateDisplay();
  }

  updateDisplay() {
    this.$input.checked = this.getValue();
    return this;
  }
}

// ─── Color formats (verbatim lil-gui 0.17 semantics) ─────────────────────

function normalizeHexString(string) {
  let match;
  let result;
  if ((match = string.match(/(#|0x)?([a-f0-9]{6})/i))) {
    result = match[2];
  } else if ((match = string.match(/rgb\(\s*(\d*)\s*,\s*(\d*)\s*,\s*(\d*)\s*\)/))) {
    result =
      parseInt(match[1]).toString(16).padStart(2, 0) +
      parseInt(match[2]).toString(16).padStart(2, 0) +
      parseInt(match[3]).toString(16).padStart(2, 0);
  } else if ((match = string.match(/^#?([a-f0-9])([a-f0-9])([a-f0-9])$/i))) {
    result = match[1] + match[1] + match[2] + match[2] + match[3] + match[3];
  }
  return !!result && `#${result}`;
}

const STRING_FORMAT = {
  isPrimitive: true,
  match: (v) => typeof v === 'string',
  fromHexString: normalizeHexString,
  toHexString: normalizeHexString,
};

const INT_FORMAT = {
  isPrimitive: true,
  match: (v) => typeof v === 'number',
  fromHexString: (string) => parseInt(string.substring(1), 16),
  toHexString: (value) => `#${value.toString(16).padStart(6, 0)}`,
};

const ARRAY_FORMAT = {
  isPrimitive: false,
  match: Array.isArray,
  fromHexString(string, target, rgbScale = 1) {
    const int = INT_FORMAT.fromHexString(string);
    target[0] = ((int >> 16) & 255) / 255 * rgbScale;
    target[1] = ((int >> 8) & 255) / 255 * rgbScale;
    target[2] = (int & 255) / 255 * rgbScale;
  },
  toHexString([r, g, b], rgbScale = 1) {
    rgbScale = 255 / rgbScale;
    return INT_FORMAT.toHexString((r * rgbScale) << 16 ^ (g * rgbScale) << 8 ^ (b * rgbScale) << 0);
  },
};

const OBJECT_FORMAT = {
  isPrimitive: false,
  match: (v) => Object(v) === v,
  fromHexString(string, target, rgbScale = 1) {
    const int = INT_FORMAT.fromHexString(string);
    target.r = ((int >> 16) & 255) / 255 * rgbScale;
    target.g = ((int >> 8) & 255) / 255 * rgbScale;
    target.b = (int & 255) / 255 * rgbScale;
  },
  toHexString({ r, g, b }, rgbScale = 1) {
    rgbScale = 255 / rgbScale;
    return INT_FORMAT.toHexString((r * rgbScale) << 16 ^ (g * rgbScale) << 8 ^ (b * rgbScale) << 0);
  },
};

const COLOR_FORMATS = [STRING_FORMAT, INT_FORMAT, ARRAY_FORMAT, OBJECT_FORMAT];

// ─── Color — swatch + native picker + hex text ───────────────────────────

export class ColorController extends Controller {
  constructor(parent, object, property, rgbScale) {
    super(parent, object, property, 'color');

    this.$input = document.createElement('input');
    this.$input.setAttribute('type', 'color');
    this.$input.setAttribute('tabindex', -1);
    this.$input.setAttribute('aria-labelledby', this.$name.id);

    this.$text = document.createElement('input');
    this.$text.setAttribute('type', 'text');
    this.$text.setAttribute('spellcheck', 'false');
    this.$text.setAttribute('aria-labelledby', this.$name.id);

    this.$display = document.createElement('div');
    this.$display.classList.add('display');
    this.$display.appendChild(this.$input);

    this.$widget.appendChild(this.$display);
    this.$widget.appendChild(this.$text);

    this._format = COLOR_FORMATS.find((f) => f.match(this.initialValue));
    if (!this._format) {
      throw new Error(`MarsinGui: addColor failed — unsupported color value for "${property}"`);
    }
    this._rgbScale = rgbScale;
    this._initialValueHexString = this.save();
    this._textFocused = false;

    this.$input.addEventListener('input', () => {
      this._setValueFromHexString(this.$input.value);
    });
    this.$input.addEventListener('blur', () => {
      this._callOnFinishChange();
    });
    this.$text.addEventListener('input', () => {
      const hex = normalizeHexString(this.$text.value);
      if (hex) this._setValueFromHexString(hex);
    });
    this.$text.addEventListener('focus', () => {
      this._textFocused = true;
      this.$text.select();
    });
    this.$text.addEventListener('blur', () => {
      this._textFocused = false;
      this.updateDisplay();
      this._callOnFinishChange();
    });

    this.$disable = this.$text;
    this.updateDisplay();
  }

  reset() {
    this._setValueFromHexString(this._initialValueHexString);
    return this;
  }

  _setValueFromHexString(hex) {
    if (this._format.isPrimitive) {
      this.setValue(this._format.fromHexString(hex));
    } else {
      this._format.fromHexString(hex, this.getValue(), this._rgbScale);
      this._callOnChange();
      this.updateDisplay();
    }
  }

  save() {
    return this._format.toHexString(this.getValue(), this._rgbScale);
  }

  load(value) {
    this._setValueFromHexString(value);
    this._callOnFinishChange();
    return this;
  }

  updateDisplay() {
    this.$input.value = this._format.toHexString(this.getValue(), this._rgbScale);
    if (!this._textFocused) this.$text.value = this.$input.value.substring(1);
    this.$display.style.backgroundColor = this.$input.value;
    return this;
  }
}

// ─── Function — full-width macro button ──────────────────────────────────

export class FunctionController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, 'function');

    this.$button = document.createElement('button');
    this.$button.appendChild(this.$name); // lil-gui idiom: label lives in the button
    this.$widget.appendChild(this.$button);

    this.$button.addEventListener('click', (e) => {
      e.preventDefault();
      this.getValue().call(this.object);
    });
    this.$button.addEventListener('touchstart', () => {}, { passive: true });

    this.$disable = this.$button;
  }
}

// ─── Number — horizontal fader (ranged) / drag input (un-ranged) ─────────

export class NumberController extends Controller {
  constructor(parent, object, property, min, max, step) {
    super(parent, object, property, 'number');
    this._initInput();
    this.min(min);
    this.max(max);
    const stepExplicit = step !== undefined;
    this.step(stepExplicit ? step : this._getImplicitStep(), stepExplicit);
    this.updateDisplay();
  }

  decimals(decimals) {
    this._decimals = decimals;
    this.updateDisplay();
    return this;
  }

  min(min) {
    this._min = min;
    this._onUpdateMinMax();
    return this;
  }

  max(max) {
    this._max = max;
    this._onUpdateMinMax();
    return this;
  }

  step(step, explicit = true) {
    this._step = step;
    this._stepExplicit = explicit;
    return this;
  }

  updateDisplay() {
    const value = this.getValue();
    if (this._hasSlider) {
      let percent = (value - this._min) / (this._max - this._min);
      percent = Math.max(0, Math.min(percent, 1));
      this.$fill.style.width = `${percent * 100}%`;
    }
    if (!this._inputFocused) {
      this.$input.value = this._decimals === undefined ? value : value.toFixed(this._decimals);
    }
    return this;
  }

  _initInput() {
    this.$input = document.createElement('input');
    this.$input.setAttribute('type', 'number');
    this.$input.setAttribute('step', 'any');
    this.$input.setAttribute('aria-labelledby', this.$name.id);
    this.$widget.appendChild(this.$input);
    this.$disable = this.$input;

    const increment = (delta) => {
      const value = parseFloat(this.$input.value);
      if (isNaN(value)) return;
      this._snapClampSetValue(value + delta);
      this.$input.value = this.getValue();
    };

    this.$input.addEventListener('input', () => {
      let value = parseFloat(this.$input.value);
      if (isNaN(value)) return;
      if (this._stepExplicit) value = this._snap(value);
      this.setValue(this._clamp(value));
    });
    this.$input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.$input.blur();
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        increment(this._step * this._arrowKeyMultiplier(e));
      }
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        increment(this._step * this._arrowKeyMultiplier(e) * -1);
      }
    });
    this.$input.addEventListener('wheel', (e) => {
      if (this._inputFocused) {
        e.preventDefault();
        increment(this._step * this._normalizeMouseWheel(e));
      }
    }, { passive: false });
    this.$input.addEventListener('focus', () => { this._inputFocused = true; });
    this.$input.addEventListener('blur', () => {
      this._inputFocused = false;
      this.updateDisplay();
      this._callOnFinishChange();
    });

    // lil-gui-style drag-to-change on the numeric input: a vertical drag
    // (>5px) changes the value; a horizontal one is left to text selection.
    let dragStartX = 0;
    let dragStartY = 0;
    let prevClientY = 0;
    let initialValue = 0;
    let dragDelta = 0;
    let testingForDrag = false;
    let dragging = false;

    this.$input.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragStartX = e.clientX;
      dragStartY = prevClientY = e.clientY;
      testingForDrag = true;
      initialValue = this.getValue();
      dragDelta = 0;
    });
    this.$input.addEventListener('pointermove', (e) => {
      if (testingForDrag) {
        // The press may have ended off-element (no pointerup ever reaches
        // us pre-capture) — a stale test must not engage a drag on a
        // buttons-up hover.
        if ((e.buttons & 1) === 0) {
          testingForDrag = false;
          return;
        }
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dy) > 5) {
          e.preventDefault();
          this.$input.blur();
          testingForDrag = false;
          dragging = true;
          this.$input.setPointerCapture(e.pointerId);
          this._setDraggingStyle(true, 'vertical');
        } else if (Math.abs(dx) > 5) {
          testingForDrag = false; // horizontal — text selection
        }
      } else if (dragging) {
        const dy = e.clientY - prevClientY;
        dragDelta -= dy * this._step * this._arrowKeyMultiplier(e);
        if (initialValue + dragDelta > this._max) {
          dragDelta = this._max - initialValue;
        } else if (initialValue + dragDelta < this._min) {
          dragDelta = this._min - initialValue;
        }
        this._snapClampSetValue(initialValue + dragDelta);
      }
      prevClientY = e.clientY;
    });
    const endDrag = (e) => {
      testingForDrag = false;
      if (!dragging) return;
      dragging = false;
      if (this.$input.hasPointerCapture(e.pointerId)) {
        this.$input.releasePointerCapture(e.pointerId);
      }
      this._setDraggingStyle(false, 'vertical');
      this._callOnFinishChange();
    };
    this.$input.addEventListener('pointerup', endDrag);
    this.$input.addEventListener('pointercancel', endDrag);
    // Pre-capture, leaving the element must abandon the drag test, and a
    // capture lost to outside forces must unwind the dragging style.
    this.$input.addEventListener('pointerleave', () => {
      if (!dragging) testingForDrag = false;
    });
    this.$input.addEventListener('lostpointercapture', endDrag);
  }

  _initSlider() {
    this._hasSlider = true;

    this.$slider = document.createElement('div');
    this.$slider.classList.add('slider');
    this.$slider.setAttribute('tabindex', 0);
    this.$fill = document.createElement('div');
    this.$fill.classList.add('fill');
    this.$slider.appendChild(this.$fill);
    this.$widget.insertBefore(this.$slider, this.$input);
    this.domElement.classList.add('hasSlider');

    const setValueFromX = (clientX) => {
      const rect = this.$slider.getBoundingClientRect();
      const proportion = (clientX - rect.left) / (rect.right - rect.left);
      this._snapClampSetValue(this._min + proportion * (this._max - this._min));
    };

    // Drag + click-to-jump via pointer capture.
    let sliderDragging = false;
    this.$slider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sliderDragging = true;
      this.$slider.setPointerCapture(e.pointerId);
      this._setDraggingStyle(true);
      setValueFromX(e.clientX);
    });
    this.$slider.addEventListener('pointermove', (e) => {
      if (sliderDragging) setValueFromX(e.clientX);
    });
    const endSliderDrag = (e) => {
      if (!sliderDragging) return;
      sliderDragging = false;
      if (this.$slider.hasPointerCapture(e.pointerId)) {
        this.$slider.releasePointerCapture(e.pointerId);
      }
      this._setDraggingStyle(false);
      this._callOnFinishChange();
    };
    this.$slider.addEventListener('pointerup', endSliderDrag);
    this.$slider.addEventListener('pointercancel', endSliderDrag);

    // Keyboard arrows on the focused fader track.
    this.$slider.addEventListener('keydown', (e) => {
      let direction = 0;
      if (e.code === 'ArrowRight' || e.code === 'ArrowUp') direction = 1;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowDown') direction = -1;
      if (direction === 0) return;
      e.preventDefault();
      this._snapClampSetValue(this.getValue() + direction * this._step * this._arrowKeyMultiplier(e));
      this._callOnFinishChange();
    });

    // Wheel — identical step math to lil-gui, debounced finish-change.
    const finishChange = this._callOnFinishChange.bind(this);
    let wheelFinishTimeout;
    this.$slider.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && this._hasScrollBar) return;
      e.preventDefault();
      const delta = this._normalizeMouseWheel(e) * this._step;
      this._snapClampSetValue(this.getValue() + delta);
      this.$input.value = this.getValue();
      clearTimeout(wheelFinishTimeout);
      wheelFinishTimeout = setTimeout(finishChange, 400);
    }, { passive: false });
  }

  _setDraggingStyle(active, axis = 'horizontal') {
    if (this.$slider) this.$slider.classList.toggle('active', active);
    document.body.classList.toggle('marsin-gui-dragging', active);
    document.body.classList.toggle(`marsin-gui-${axis}`, active);
  }

  _getImplicitStep() {
    if (this._hasMin && this._hasMax) return (this._max - this._min) / 1000;
    return 0.1;
  }

  _onUpdateMinMax() {
    if (!this._hasSlider && this._hasMin && this._hasMax) {
      if (!this._stepExplicit) this.step(this._getImplicitStep(), false);
      this._initSlider();
      this.updateDisplay();
    }
  }

  _normalizeMouseWheel(e) {
    let { deltaX, deltaY } = e;
    if (Math.floor(e.deltaY) !== e.deltaY && e.wheelDelta) {
      deltaX = 0;
      deltaY = -e.wheelDelta / 120;
      deltaY *= this._stepExplicit ? 1 : 10;
    }
    return deltaX + -deltaY;
  }

  _arrowKeyMultiplier(e) {
    let mult = this._stepExplicit ? 1 : 10;
    if (e.shiftKey) mult *= 10;
    else if (e.altKey) mult /= 10;
    return mult;
  }

  _snap(value) {
    const r = Math.round(value / this._step) * this._step;
    return parseFloat(r.toPrecision(15));
  }

  _clamp(value) {
    if (value < this._min) value = this._min;
    if (value > this._max) value = this._max;
    return value;
  }

  _snapClampSetValue(value) {
    this.setValue(this._clamp(this._snap(value)));
  }

  get _hasScrollBar() {
    const root = this.parent.root.$children;
    return root.scrollHeight > root.clientHeight;
  }

  get _hasMin() {
    return this._min !== undefined;
  }

  get _hasMax() {
    return this._max !== undefined;
  }
}

// ─── Option — themed select ──────────────────────────────────────────────

export class OptionController extends Controller {
  constructor(parent, object, property, options) {
    super(parent, object, property, 'option');

    this.$select = document.createElement('select');
    this.$select.setAttribute('aria-labelledby', this.$name.id);

    this._values = Array.isArray(options) ? options : Object.values(options);
    this._names = Array.isArray(options) ? options : Object.keys(options);

    this._names.forEach((name) => {
      const $option = document.createElement('option');
      $option.innerHTML = name;
      this.$select.appendChild($option);
    });

    this.$select.addEventListener('change', () => {
      this.setValue(this._values[this.$select.selectedIndex]);
      this._callOnFinishChange();
    });

    this.$widget.appendChild(this.$select);
    this.$disable = this.$select;
    this.updateDisplay();
  }

  updateDisplay() {
    const value = this.getValue();
    this.$select.selectedIndex = this._values.indexOf(value);
    return this;
  }
}

// ─── String — themed text input ──────────────────────────────────────────

export class StringController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, 'string');

    this.$input = document.createElement('input');
    this.$input.setAttribute('type', 'text');
    this.$input.setAttribute('aria-labelledby', this.$name.id);

    this.$input.addEventListener('input', () => {
      this.setValue(this.$input.value);
    });
    this.$input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.$input.blur();
    });
    this.$input.addEventListener('blur', () => {
      this._callOnFinishChange();
    });

    this.$widget.appendChild(this.$input);
    this.$disable = this.$input;
    this.updateDisplay();
  }

  updateDisplay() {
    this.$input.value = this.getValue();
    return this;
  }
}
