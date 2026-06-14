/**
 * marsin_gui.js — MarsinGui: the sim's control engine, a lil-gui
 * 0.17.0-API-compatible tree with CaptainPad-styled widgets (UI rehaul
 * Phase 3, task 018; sole control engine since the 2026-06-12 cutover).
 *
 * Imported by gui_engine.js. gui_builder.js and pattern_editor.js were
 * written against the lil-gui API and run UNCHANGED against this class.
 * The implemented surface is exactly the builders' usage inventory
 * (API_INVENTORY.md); semantics are ported from lil-gui 0.17.0.
 *
 * Deliberate deltas from the lil-gui API it mirrors:
 *  - Root element class is `marsin-gui` and all widget styling is scoped
 *    to it (marsin_gui.css).
 *  - Styles live in marsin_gui.css (theme custom properties only) and are
 *    attached via a <link> instead of an inline <style> blob — offline,
 *    no CDN.
 *  - The root element stops `pointerdown` propagation: the raycaster
 *    guard in src/core/interaction.js whitelists `.marsin-gui` by class,
 *    so without this, fader drags would deselect fixtures through the panel.
 *  - No `onOpenClose`: lil-gui 0.17 doesn't have it, and gui_builder
 *    probes for it with `typeof` — implementing it would silently switch
 *    the builders onto a code path they never otherwise exercise.
 */

import {
  BooleanController,
  ColorController,
  FunctionController,
  NumberController,
  OptionController,
  StringController,
} from './controllers.js';

// Resolved against the page URL — the sim is served at /simulation/.
const STYLESHEET_HREF = './src/gui/modern_gui/marsin_gui.css';
const STYLESHEET_ID = 'marsin-gui-stylesheet';

let stylesInjected = false;

function injectStylesheet() {
  if (stylesInjected || document.getElementById(STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = STYLESHEET_HREF;
  document.head.appendChild(link);
  stylesInjected = true;
}

export class MarsinGui {
  constructor({
    parent,
    autoPlace = parent === undefined,
    container,
    width,
    title = 'Controls',
    injectStyles = true,
    touchStyles = true,
  } = {}) {
    this.parent = parent;
    this.root = parent ? parent.root : this;

    this.children = [];
    this.controllers = [];
    this.folders = [];

    this._closed = false;
    this._hidden = false;

    this.domElement = document.createElement('div');
    this.domElement.classList.add('marsin-gui');

    this.$title = document.createElement('div');
    this.$title.classList.add('title');
    this.$title.setAttribute('role', 'button');
    this.$title.setAttribute('aria-expanded', true);
    this.$title.setAttribute('tabindex', 0);
    this.$title.addEventListener('click', () => this.openAnimated(this._closed));
    this.$title.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.$title.click();
      }
    });
    this.$title.addEventListener('touchstart', () => {}, { passive: true });

    this.$children = document.createElement('div');
    this.$children.classList.add('children');

    this.domElement.appendChild(this.$title);
    this.domElement.appendChild(this.$children);

    this.title(title);
    if (touchStyles) this.domElement.classList.add('allow-touch-styles');

    if (this.parent) {
      this.parent.children.push(this);
      this.parent.folders.push(this);
      this.parent.$children.appendChild(this.domElement);
      return;
    }

    // ── Root-only setup ──
    this.domElement.classList.add('root');
    if (injectStyles) injectStylesheet();

    if (container) {
      container.appendChild(this.domElement);
    } else if (autoPlace) {
      this.domElement.classList.add('autoPlace');
      document.body.appendChild(this.domElement);
    }

    if (width) this.domElement.style.setProperty('--width', `${width}px`);

    // lil-gui idiom: keystrokes typed into GUI inputs never reach app-level
    // keyboard shortcuts.
    this.domElement.addEventListener('keydown', (e) => e.stopPropagation());
    this.domElement.addEventListener('keyup', (e) => e.stopPropagation());

    // Raycaster guard — see file header.
    this.domElement.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  add(object, property, $1, max, step) {
    if (Object($1) === $1) {
      return new OptionController(this, object, property, $1);
    }
    const initialValue = object[property];
    switch (typeof initialValue) {
      case 'number':
        return new NumberController(this, object, property, $1, max, step);
      case 'boolean':
        return new BooleanController(this, object, property);
      case 'string':
        return new StringController(this, object, property);
      case 'function':
        return new FunctionController(this, object, property);
    }
    // lil-gui logs and limps on; we fail loudly (P0 codex rule).
    throw new Error(
      `MarsinGui: gui.add failed — property "${property}" has unsupported type "${typeof initialValue}"`,
    );
  }

  addColor(object, property, rgbScale = 1) {
    return new ColorController(this, object, property, rgbScale);
  }

  addFolder(title) {
    return new MarsinGui({ parent: this, title });
  }

  load(obj, recursive = true) {
    if (obj.controllers) {
      this.controllers.forEach((c) => {
        if (c instanceof FunctionController) return;
        if (c._name in obj.controllers) c.load(obj.controllers[c._name]);
      });
    }
    if (recursive && obj.folders) {
      this.folders.forEach((f) => {
        if (f._title in obj.folders) f.load(obj.folders[f._title]);
      });
    }
    return this;
  }

  save(recursive = true) {
    const obj = { controllers: {}, folders: {} };
    this.controllers.forEach((c) => {
      if (c instanceof FunctionController) return;
      if (c._name in obj.controllers) {
        throw new Error(`Cannot save GUI with duplicate property "${c._name}"`);
      }
      obj.controllers[c._name] = c.save();
    });
    if (recursive) {
      this.folders.forEach((f) => {
        if (f._title in obj.folders) {
          throw new Error(`Cannot save GUI with duplicate folder "${f._title}"`);
        }
        obj.folders[f._title] = f.save();
      });
    }
    return obj;
  }

  open(open = true) {
    this._closed = !open;
    this.$title.setAttribute('aria-expanded', !this._closed);
    this.domElement.classList.toggle('closed', this._closed);
    return this;
  }

  close() {
    return this.open(false);
  }

  show(show = true) {
    this._hidden = !show;
    this.domElement.style.display = this._hidden ? 'none' : '';
    return this;
  }

  hide() {
    return this.show(false);
  }

  openAnimated(open = true) {
    // _closed flips synchronously — gui_builder's .title click listeners
    // read it right after lil-gui's own handler runs.
    this._closed = !open;
    this.$title.setAttribute('aria-expanded', !this._closed);
    requestAnimationFrame(() => {
      const startHeight = this.$children.clientHeight;
      this.$children.style.height = `${startHeight}px`;
      this.domElement.classList.add('transition');
      const onTransitionEnd = (e) => {
        if (e.target !== this.$children) return;
        this.$children.style.height = '';
        this.domElement.classList.remove('transition');
        this.$children.removeEventListener('transitionend', onTransitionEnd);
      };
      this.$children.addEventListener('transitionend', onTransitionEnd);
      const targetHeight = open ? this.$children.scrollHeight : 0;
      this.domElement.classList.toggle('closed', !open);
      requestAnimationFrame(() => {
        this.$children.style.height = `${targetHeight}px`;
      });
    });
    return this;
  }

  title(title) {
    this._title = title;
    this.$title.innerHTML = title;
    return this;
  }

  reset(recursive = true) {
    (recursive ? this.controllersRecursive() : this.controllers).forEach((c) => c.reset());
    return this;
  }

  onChange(callback) {
    this._onChange = callback;
    return this;
  }

  _callOnChange(controller) {
    if (this.parent) this.parent._callOnChange(controller);
    if (this._onChange !== undefined) {
      this._onChange.call(this, {
        object: controller.object,
        property: controller.property,
        value: controller.getValue(),
        controller,
      });
    }
  }

  onFinishChange(callback) {
    this._onFinishChange = callback;
    return this;
  }

  _callOnFinishChange(controller) {
    if (this.parent) this.parent._callOnFinishChange(controller);
    if (this._onFinishChange !== undefined) {
      this._onFinishChange.call(this, {
        object: controller.object,
        property: controller.property,
        value: controller.getValue(),
        controller,
      });
    }
  }

  destroy() {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent.folders.splice(this.parent.folders.indexOf(this), 1);
    }
    if (this.domElement.parentElement) {
      this.domElement.parentElement.removeChild(this.domElement);
    }
    Array.from(this.children).forEach((c) => c.destroy());
  }

  controllersRecursive() {
    let controllers = Array.from(this.controllers);
    this.folders.forEach((f) => {
      controllers = controllers.concat(f.controllersRecursive());
    });
    return controllers;
  }

  foldersRecursive() {
    let folders = Array.from(this.folders);
    this.folders.forEach((f) => {
      folders = folders.concat(f.foldersRecursive());
    });
    return folders;
  }
}
