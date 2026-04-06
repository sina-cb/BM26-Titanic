/**
 * state.js — Shared mutable application state.
 * All modules import this and read/write properties directly.
 * Populated during bootstrap and init().
 */
import * as THREE from "three";

// ─── Three.js Core ──────────────────────────────────────────────────────
export let scene, camera, renderer, composer, controls;
export let transformControl, raycaster, mouse;

// ─── Model ──────────────────────────────────────────────────────────────
export let model = null;
export let modelCenter = new THREE.Vector3();
export let modelSize = new THREE.Vector3();
export let modelRadius = 1;
export const modelMeshes = [];
export let structureMaterial, editMaterial;
export let gridHelper, ground, starField;

// ─── Fixtures & Selection ───────────────────────────────────────────────
export const interactiveObjects = [];
export const selectedFixtureIndices = new Set();
export const selectedDmxIndices = new Set();
export let dragStartState = null;

// ─── Lighting ───────────────────────────────────────────────────────────
export const lights = { moon: null, towers: [], ambient: null, helpers: [] };

// ─── Timing ─────────────────────────────────────────────────────────────
export const clock = new THREE.Clock();
export let frameCount = 0;
export let lastFpsTime = 0;

// ─── Config & GUI ───────────────────────────────────────────────────────
export let configTree = null;
export const params = {};
export let cameraPresets = [];
export let gui = null;

// ─── Undo ───────────────────────────────────────────────────────────────
export const undoStack = [];
export const redoStack = [];
export const MAX_UNDO = 50;

// ─── Pattern Engine ─────────────────────────────────────────────────────
export let engineReady = false;
export let engineEnabled = false;
export let lightingEnabled = false;
export let lightingMode = 'gradient';

// ─── Setters (needed because ES module exports are read-only bindings) ──
export function setScene(v) { scene = v; }
export function setCamera(v) { camera = v; }
export function setRenderer(v) { renderer = v; }
export function setComposer(v) { composer = v; }
export function setControls(v) { controls = v; }
export function setTransformControl(v) { transformControl = v; }
export function setRaycaster(v) { raycaster = v; }
export function setMouse(v) { mouse = v; }
export function setModel(v) { model = v; }
export function setModelCenter(v) { modelCenter = v; }
export function setModelSize(v) { modelSize = v; }
export function setModelRadius(v) { modelRadius = v; }
export function setStructureMaterial(v) { structureMaterial = v; }
export function setEditMaterial(v) { editMaterial = v; }
export function setGridHelper(v) { gridHelper = v; }
export function setGround(v) { ground = v; }
export function setStarField(v) { starField = v; }
export function setConfigTree(v) { configTree = v; }
export function setCameraPresets(v) { cameraPresets = v; }
export function setGui(v) { gui = v; }
export function setDragStartState(v) { dragStartState = v; }
export function setEngineReady(v) { engineReady = v; }
export function setEngineEnabled(v) { engineEnabled = v; }
export function setLightingEnabled(v) { lightingEnabled = v; }
export function setLightingMode(v) { lightingMode = v; }
export function setFrameCount(v) { frameCount = v; }
export function setLastFpsTime(v) { lastFpsTime = v; }
