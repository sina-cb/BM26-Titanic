import unreal
import socket
import struct
import json
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# =====================================================================
#  Module-level HTTP server singleton - survives class re-instantiation
# =====================================================================
if '_marsin_http_server' not in dir():
    _marsin_http_server = None
if '_marsin_http_thread' not in dir():
    _marsin_http_thread = None

def _get_bridge():
    """Always returns the *current* sACNReceiver instance."""
    return globals().get('marsin_sacn_bridge', None)

class _MarsinUIHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-type")
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                bridge = _get_bridge()
                if bridge:
                    if 'power' in data: bridge.ui_power = bool(data['power'])
                    if 'intensity' in data: bridge.ui_intensity_multiplier = float(data['intensity'])
                    if 'fogDensity' in data: bridge.ui_fog = float(data['fogDensity'])
                    if 'fogScattering' in data: bridge.ui_scattering = float(data['fogScattering'])
                    if 'bloom' in data: bridge.ui_bloom = float(data['bloom'])
                    bridge.ui_dirty = True
                    unreal.log(f"[Marsin UI] Recv -> Power: {bridge.ui_power}, Intensity: {bridge.ui_intensity_multiplier}")
                else:
                    unreal.log_warning("[Marsin UI] No active bridge instance!")
            except Exception as e:
                unreal.log_error(f"[Marsin UI] Failed to parse: {e}")

        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, format, *args):
        pass  # Suppress standard HTTP logs

def _ensure_http_server():
    """Start the HTTP server exactly once per Unreal session."""
    # Check if port 8081 is already in use (from a previous script execution)
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        test_sock.bind(('0.0.0.0', 8081))
        test_sock.close()
        # Port is free — start a new server
    except OSError:
        test_sock.close()
        unreal.log("[Marsin UI] HTTP Server already running on port 8081 (reusing)")
        return
    
    def run():
        try:
            ThreadingHTTPServer.allow_reuse_address = True
            server = ThreadingHTTPServer(('0.0.0.0', 8081), _MarsinUIHandler)
            unreal.log("[Marsin UI] HTTP Server listening on port 8081")
            server.serve_forever()
        except OSError as e:
            unreal.log_error(f"[Marsin UI] HTTP Server failed to start: {e}")
    t = threading.Thread(target=run, daemon=True)
    t.start()

class sACNReceiver:
    def __init__(self, port=5568, universe=1):
        self.port = port
        self.target_universe = universe
        self.sock = None
        self.running = False
        
        self.lights = []
        self.last_log = 0.0
        self.frame_count = 0
        
        # Real-time UI parameters
        self.ui_power = True
        self.ui_intensity_multiplier = 5.0
        self.ui_bloom = 0.8
        self.ui_fog = 0.05
        self.ui_scattering = 0.2
        
        # We need a reference to the delegate handle to unregister it later
        self.tick_handle = None
        
        self.http_server = None
        self.http_thread = None
        
        self.setup_socket()
        _ensure_http_server()  # Use module-level singleton
        self.cache_lights()
        
    # HTTP server is now a module-level singleton — see _ensure_http_server()
        
    def setup_socket(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(('127.0.0.1', self.port))
        self.sock.setblocking(False)
        unreal.log(f"[Marsin sACN] Listening on UDP {self.port} for Universe {self.target_universe}")
        
    def cache_lights(self):
        unreal_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        world = unreal_subsystem.get_editor_world()
        
        if not world:
            return
            
        all_actors = unreal.GameplayStatics.get_all_actors_with_tag(world, "MarsinPixel")
        
        for actor in all_actors:
            tags = [str(t) for t in actor.tags]
            
            # Extract metadata: ["MarsinPixel", "U1", "A166", "PxOffset_0", "PxType_rgb"]
            unv = 1
            addr = 1
            px_offset = 0
            px_type = "rgb"
            
            for t in tags:
                if t.startswith("U"): unv = int(t[1:])
                elif t.startswith("A"): addr = int(t[1:])
                elif t.startswith("PxOffset_"): px_offset = int(t[9:])
                elif t.startswith("PxType_"): px_type = t[7:]
                
            if unv != self.target_universe:
                continue
                
            # Find the light component
            comp = None
            if hasattr(actor, 'point_light_component'):
                comp = actor.point_light_component
            elif hasattr(actor, 'spot_light_component'):
                comp = actor.spot_light_component
                
            if comp:
                self.lights.append({
                    'actor': actor,
                    'comp': comp,
                    'addr': addr,
                    'px_offset': px_offset,
                    'type': px_type
                })
        unreal.log(f"[Marsin sACN] Cached {len(self.lights)} pixel lights in the scene.")
        
    def start(self):
        if self.running:
            return
        self.running = True
        self.frame_count = 0
        self.last_log = time.time()
        
        # Register the tick callback
        self.tick_handle = unreal.register_slate_pre_tick_callback(self.tick)
        unreal.log("[Marsin sACN] Receiver Started.")
        
    def stop(self):
        if not self.running:
            return
        self.running = False
        if self.tick_handle is not None:
            unreal.unregister_slate_pre_tick_callback(self.tick_handle)
            self.tick_handle = None
        if self.sock:
            self.sock.close()
            self.sock = None
        # NOTE: HTTP server is a module-level singleton, not stopped here
        unreal.log("[Marsin sACN] Receiver Stopped.")

    def tick(self, delta_time):
        if not hasattr(self, 'first_tick'):
            self.first_tick = True
            unreal_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
            if unreal_subsystem:
                world = unreal_subsystem.get_editor_world()
                if world:
                    unreal.SystemLibrary.execute_console_command(world, "ShowFlag.BillboardSprites 0")
                    unreal.SystemLibrary.execute_console_command(world, "ShowFlag.Grid 0")
                    unreal.SystemLibrary.execute_console_command(world, "ShowFlag.Selection 0")
                    unreal.SystemLibrary.execute_console_command(world, "ShowFlag.ModeWidgets 0")
                    unreal.SystemLibrary.execute_console_command(world, "ShowFlag.LightRadius 0")

        if hasattr(self, 'ui_dirty') and self.ui_dirty:
            self.ui_dirty = False
            try:
                unreal.log(f"[Marsin UI] APPLYING: power={self.ui_power}, intensity={self.ui_intensity_multiplier}, bloom={self.ui_bloom}, fog={self.ui_fog}")
                unreal_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
                world = unreal_subsystem.get_editor_world()
                if world:
                    fog = unreal.GameplayStatics.get_actor_of_class(world, unreal.ExponentialHeightFog)
                    if not fog:
                        unreal.log_warning("[Marsin UI] ExponentialHeightFog NOT found! Spawning one...")
                        fog = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0,0,0), unreal.Rotator(0,0,0))
                    
                    if fog:
                        fog.component.set_editor_property("fog_density", self.ui_fog)
                        fog.component.set_editor_property("volumetric_fog_scattering_distribution", self.ui_scattering)
                        unreal.log(f"[Marsin UI] Set fog density to {self.ui_fog} and scattering to {self.ui_scattering}")
                        
                    pp = unreal.GameplayStatics.get_actor_of_class(world, unreal.PostProcessVolume)
                    if not pp:
                        unreal.log_warning("[Marsin UI] PostProcessVolume NOT found! Spawning one...")
                        pp = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0,0,0), unreal.Rotator(0,0,0))
                        pp.set_editor_property("unbound", True) # Make it infinite extent
                        
                    if pp:
                        settings = pp.settings
                        settings.override_bloom_intensity = True
                        settings.bloom_intensity = self.ui_bloom
                        # Ensure we have fog beams (Volumetric Fog) enabled in the post process or fog actor
                        if fog:
                            fog.component.set_editor_property("bEnableVolumetricFog", True)
                        pp.set_editor_property("settings", settings)
                        unreal.log(f"[Marsin UI] Set bloom intensity to {self.ui_bloom}")
                    
                    # Link directional/ambient lighting visibility to the Master Power UI toggle
                    for dl in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
                        dl.set_actor_hidden_in_game(not self.ui_power)
                    
                    unreal.log("[Marsin UI] Successfully applied all UI parameters!")
                else:
                    unreal.log_warning("[Marsin UI] No editor world found!")
            except Exception as e:
                unreal.log_error(f"[Marsin UI] CRASH in ui_dirty handler: {e}")
            
        if not self.sock:
            return
            
        latest_dmx = None
        # Drain all available UDP packets and only process the most recent one to prevent lag cascade
        while True:
            try:
                data, addr = self.sock.recvfrom(2048)
                if len(data) >= 638:
                    # sACN Universe is at byte 113-114 (big endian)
                    unv = struct.unpack('>H', data[113:115])[0]
                    if unv == self.target_universe:
                        # DMX Data starts at byte 126
                        latest_dmx = data[126:638]
            except socket.error:
                break # No more data available right now

        if latest_dmx:
            self.frame_count += 1
            self.apply_dmx(latest_dmx)
            
            # Status logging
            now = time.time()
            if now - self.last_log > 5.0:
                fps = self.frame_count / 5.0
                unreal.log(f"[Marsin sACN] Streaming active: {fps:.1f} FPS")
                self.frame_count = 0
                self.last_log = now

    def apply_dmx(self, dmx):
        for light in self.lights:
            addr = light['addr']
            px_offset = light['px_offset']
            ptype = light['type']
            
            # Calculate byte offset
            # DMX arrays are 0-indexed in array, 1-indexed in spec string
            base_offset = addr - 1
            px_start = base_offset + px_offset
            
            if px_start < 512:
                if ptype == "warm" or ptype == "w":
                    v = dmx[px_start]
                    r = v
                    g = int(v * 0.8) # Slight warm tint
                    b = int(v * 0.4)
                elif px_start + 2 < 512:
                    r = dmx[px_start]
                    g = dmx[px_start + 1]
                    b = dmx[px_start + 2]
                else:
                    r, g, b = 0, 0, 0
                
                # Boost brightness in Editor (Unreal point lights need high raw values to glow intensely)
                multiplier = self.ui_intensity_multiplier if self.ui_power else 0.0
                
                if not self.ui_power:
                    r, g, b = 0, 0, 0
                    
                comp = light['comp']
                
                # Filter out pure black to prevent Unreal from culling the light entirely (optional, but good for DMX 0)
                if r == 0 and g == 0 and b == 0:
                    comp.set_intensity(0.0)
                else:
                    comp.set_intensity(255.0 * multiplier)
                    comp.set_light_color(unreal.LinearColor(r/255.0, g/255.0, b/255.0, 1.0))

# Global instance pattern to allow simple reload
if 'marsin_sacn_bridge' in globals() and marsin_sacn_bridge:
    marsin_sacn_bridge.stop()

marsin_sacn_bridge = sACNReceiver(port=5568, universe=1)
marsin_sacn_bridge.start()
