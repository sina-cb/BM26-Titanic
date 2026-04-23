import unreal
import json
import os
import sys
import argparse

# Three.js uses meters with Y-up; Unreal uses centimeters with Z-up
SCALE_FACTOR = 100.0

def threejs_to_unreal(pos):
    """Convert Three.js [x, y, z] (meters, Y-up) to Unreal Vector (cm, Z-up)"""
    x = pos[0] * SCALE_FACTOR
    y = pos[2] * SCALE_FACTOR   # Three.js Z → Unreal Y (forward)
    z = pos[1] * SCALE_FACTOR   # Three.js Y → Unreal Z (up)
    return unreal.Vector(x, y, z)

def threejs_rot_to_unreal(rot):
    """Convert Three.js rotation [rx, ry, rz] (degrees) to Unreal Rotator"""
    # Three.js: X=pitch, Y=yaw, Z=roll (roughly) with Y-up
    # Unreal: Pitch=Y, Yaw=Z, Roll=X with Z-up
    return unreal.Rotator(rot[0], rot[2], rot[1])

def configure_dmx_input_ports(universes_required):
    pass

def create_or_get_dmx_library(package_path="/Game/DMX/MarsinDMXLibrary"):
    library = unreal.EditorAssetLibrary.load_asset(package_path)
    if not library:
        try:
            # Depending on 5.7 minor version, it's either DMXLibraryFactory or DMXLibraryFactoryNew
            factory = None
            if hasattr(unreal, 'DMXLibraryFactoryNew'):
                factory = unreal.DMXLibraryFactoryNew()
            elif hasattr(unreal, 'DMXLibraryFactory'):
                factory = unreal.DMXLibraryFactory()
            
            if factory:
                library = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
                    asset_name="MarsinDMXLibrary",
                    package_path="/Game/DMX",
                    asset_class=unreal.DMXLibrary,
                    factory=factory
                )
        except Exception as e:
            unreal.log_error(f"Failed to create DMX Library: {e}")
    return library

def ingest_scene(json_path):
    unreal.log("=========================================")
    unreal.log(f" MARSIN ENGINE: Ingesting Scene Data ")
    unreal.log(f" Reading from: {json_path}")
    unreal.log("=========================================")

    if not os.path.exists(json_path):
        unreal.log_error(f"[ERROR] JSON configuration not found at {json_path}")
        return

    with open(json_path, 'r') as f:
        data = json.load(f)

    # 1. Prepare DMX Library
    library = create_or_get_dmx_library()
    if not library:
        unreal.log_warning("[WARNING] Could not automatically generate DMX Library asset via headless execution, but continuing to structure and spawn Fixture geometry!")
        
    fixtures = data.get("fixtures", [])
    static_geo = data.get("staticGeometry", [])
    
    unreal.log(f"Found {len(fixtures)} live DMX fixtures.")
    unreal.log(f"Found {len(static_geo)} static geometry objects.")

    # 1.5 Configure Ports Automatically
    max_universe = 1
    for f in fixtures:
        if f.get("universe", 1) > max_universe:
            max_universe = f.get("universe", 1)
    configure_dmx_input_ports(max_universe)

    # 2. Iterate and Alias Patches
    aliased_patches = {} # Key: "Universe_Address", Value: PatchRef
    
    # 3. Spawn Blueprints
    unreal_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = unreal_subsystem.get_editor_world() if unreal_subsystem else None
    
    unreal.log("Waiting for asset registry...")
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
    
    # --- Load all available DMX fixture blueprint classes ---
    bp_paths = {
        "StaticHead":  "/DMXFixtures/LightFixtures/BP_StaticHead",
        "WashLED":     "/DMXFixtures/LightFixtures/BP_WashLED",
        "MovingHead":  "/DMXFixtures/LightFixtures/BP_MovingHead",
        "StaticMatrix":"/DMXFixtures/LightFixtures/BP_StaticMatrix",
        "StaticStrobe":"/DMXFixtures/LightFixtures/BP_StaticStrobe",
    }
    bp_classes = {}
    for key, path in bp_paths.items():
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if asset:
            bp_classes[key] = asset.generated_class()
            unreal.log(f"  Loaded BP class: {key}")
        else:
            unreal.log_warning(f"  Could not load: {path}")
    
    # Map simulation fixtureType → Unreal BP class
    TYPE_MAP = {
        "UkingPar":    "StaticHead",    # Par cans → static spotlight
        "VintageLed":  "WashLED",       # LED wash fixtures
        "ShehdsBar":   "StaticMatrix",  # LED bar → matrix fixture
        "FogMachine":  "StaticStrobe",  # Fog machines → strobe placeholder
        "Generic":     "WashLED",       # Fallback
    }
    fallback_class = bp_classes.get("WashLED") or unreal.SpotLight.static_class()
    
    # Shell mesh definitions from YAML fixture models
    # Maps fixtureType → shell shape info for procedural geometry
    SHELL_SHAPES = {
        "UkingPar":   {"shape": "cylinder", "dims": [15, 15, 12], "color": [0.067, 0.067, 0.067]},
        "VintageLed": {"shape": "box",      "dims": [8, 42, 6],   "color": [0.067, 0.067, 0.067]},
        "ShehdsBar":  {"shape": "box",      "dims": [100, 9, 11], "color": [0.102, 0.102, 0.102]},
        "FogMachine": {"shape": "box",      "dims": [50, 50, 50], "color": [0.1, 0.1, 0.1]},
    }
    
    # --- Add scene lighting so the map isn't pitch black ---
    unreal.log("Adding scene lighting...")
    if world:
        # Cleanup old actors to prevent duplicates
        all_actors = unreal.EditorLevelLibrary.get_all_level_actors()
        for a in all_actors:
            label = a.get_actor_label()
            if label and (label.startswith("Fixture_") or label.startswith("Shell_") or label.startswith("Pixel_") or label.startswith("Spot_") or label.startswith("Floor_") or label.startswith("Marsin_Moonlight") or label.startswith("Marsin_PlayerStart")):
                unreal.EditorLevelLibrary.destroy_actor(a)
                
        # --- Spawn Ground/Floor for reflections ---
        floor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.StaticMeshActor.static_class(),
            unreal.Vector(0, 0, -50),
            unreal.Rotator(0, 0, 0)
        )
        if floor:
            floor.set_actor_label("Floor_Main")
            mesh_comp = floor.static_mesh_component
            if mesh_comp:
                mesh_asset = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
                if mesh_asset:
                    mesh_comp.set_static_mesh(mesh_asset)
                    # Scale to 5000x5000 cm (50x50 meters), thickness 10 cm
                    mesh_comp.set_world_scale3d(unreal.Vector(50.0, 50.0, 0.1))
                    
                    mat = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
                    if mat:
                        mesh_comp.set_material(0, mat)
                
        # Directional light (moonlight)
        dir_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.DirectionalLight.static_class(),
            unreal.Vector(0, 0, 500),
            unreal.Rotator(-45, -30, 0)
        )
        if dir_light:
            dir_light.set_actor_label("Marsin_Moonlight")
            comp = dir_light.light_component
            if comp:
                comp.set_mobility(unreal.ComponentMobility.MOVABLE)
                comp.set_editor_property("intensity", 2.0)
                comp.set_editor_property("light_color", unreal.Color(170, 187, 221, 255))
                
        # --- Spawn PlayerStart ---
        # Ensures that headless pixel streaming spawns viewers back and elevated to see the full scene
        pstart = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.PlayerStart.static_class(),
            unreal.Vector(-800, 0, 200),
            unreal.Rotator(0, 0, 0)
        )
        if pstart:
            pstart.set_actor_label("Marsin_PlayerStart")

        # Sky light for ambient fill
        sky_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.SkyLight.static_class(),
            unreal.Vector(0, 0, 300),
            unreal.Rotator(0, 0, 0)
        )
        if sky_light:
            sky_light.set_actor_label("Marsin_AmbientSky")

        # --- Cinematic Realism (Volumetric Fog) ---
        unreal.log("Enabling cinematic Volumetric Fog and Post Process...")
        fog = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.ExponentialHeightFog.static_class(),
            unreal.Vector(0, 0, -200),
            unreal.Rotator(0, 0, 0)
        )
        if fog:
            fog.set_actor_label("Marsin_VolumetricFog")
            fog_comp = fog.component
            if fog_comp:
                fog_comp.set_editor_property("bEnableVolumetricFog", True)
                fog_comp.set_editor_property("fog_density", 0.05)
                # Adds a beautiful glowing haziness
                fog_comp.set_editor_property("volumetric_fog_scattering_distribution", 0.2)
                fog_comp.set_editor_property("volumetric_fog_extinction_scale", 1.5)
                
        # --- Cinematic Realism (Post Process) ---
        pp = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.PostProcessVolume.static_class(),
            unreal.Vector(0, 0, 0),
            unreal.Rotator(0, 0, 0)
        )
        if pp:
            pp.set_actor_label("Marsin_PostProcess")
            pp.set_editor_property("unbound", True)
            
            settings = pp.settings
            settings.bOverride_BloomIntensity = True
            settings.bloom_intensity = 0.8
            settings.bOverride_AutoExposureBias = True
            settings.auto_exposure_bias = 0.5   # Brighten up slightly to balance dark fog
            pp.set_editor_property("settings", settings)

    for obj in fixtures:
        actor_name = obj.get("name", "UnknownFixture")
        unv = obj.get("universe", 1)
        addr = obj.get("address", 1)
        type_class = obj.get("type", "Generic")
        
        # Convert position from Three.js meters (Y-up) to Unreal cm (Z-up)
        loc = obj.get("position", [0,0,0])
        rot = obj.get("rotation", [0,0,0])
        location = threejs_to_unreal(loc)
        rotation = threejs_rot_to_unreal(rot)
        
        alias_key = f"{unv}_{addr}"
        
        # Parse color for light tinting
        color_hex = obj.get("color", "#ffaa44")
        try:
            r = int(color_hex[1:3], 16)
            g = int(color_hex[3:5], 16)
            b = int(color_hex[5:7], 16)
        except:
            r, g, b = 255, 170, 68
        
        fixture_intensity = obj.get("intensity", 5)
        pixel_data = obj.get("pixels", [])
        pixel_count = obj.get("pixelCount", 0)
        dims_from_json = obj.get("dimensions", None)
        
        # Pick the right BP class for this fixture type
        bp_key = TYPE_MAP.get(type_class, "WashLED")
        spawn_class = bp_classes.get(bp_key, fallback_class)
        
        # Get shell dimensions — prefer JSON data over defaults
        shell_info = SHELL_SHAPES.get(type_class, SHELL_SHAPES.get("FogMachine"))
        if dims_from_json:
            shell_w = dims_from_json.get("width", 100) * 0.1   # mm → cm
            shell_h = dims_from_json.get("height", 100) * 0.1
            shell_d = dims_from_json.get("depth", 100) * 0.1
        else:
            shell_w = shell_info["dims"][0]
            shell_h = shell_info["dims"][1]
            shell_d = shell_info["dims"][2]
        
        unreal.log(f"Spawning [{type_class}] {actor_name} (U{unv}:A{addr}) {pixel_count}px, shell={shell_w:.0f}x{shell_h:.0f}x{shell_d:.0f}cm")
        
        if not world:
            continue
            
        # --- Spawn custom geometric shell ---
        shell_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.StaticMeshActor.static_class(),
            location,
            rotation
        )
        if shell_actor:
            shell_actor.set_actor_label(f"Shell_{actor_name}")
            
            mesh_comp = shell_actor.static_mesh_component
            if mesh_comp:
                if shell_info["shape"] == "cylinder":
                    mesh_asset = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cylinder")
                else:
                    mesh_asset = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
                
                if mesh_asset:
                    mesh_comp.set_static_mesh(mesh_asset)
                    mesh_comp.set_world_scale3d(unreal.Vector(
                        shell_w / 100.0,
                        shell_d / 100.0,
                        shell_h / 100.0
                    ))
                    # Prevent the custom shell from blocking the internal DMX light emissions
                    mesh_comp.set_editor_property("cast_shadow", False)
                    
                    mat = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
                    if mat:
                        mesh_comp.set_material(0, mat)
                        
        # --- Spawn per-pixel PointLights ---
        if pixel_count > 0 and pixel_data:
            for pi, pixel in enumerate(pixel_data):
                px_mm = pixel.get("position", [0, 0, 0])
                # Convert mm → cm with axis swap (Three.js Y-up → Unreal Z-up)
                px_offset = unreal.Vector(
                    px_mm[0] * 0.1,
                    px_mm[2] * 0.1,
                    px_mm[1] * 0.1
                )
                px_world = unreal.Vector(
                    location.x + px_offset.x,
                    location.y + px_offset.y,
                    location.z + px_offset.z
                )
                
                px_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
                    unreal.PointLight.static_class(),
                    px_world,
                    rotation
                )
                if px_light:
                    px_id = pixel.get("id", f"px{pi}")
                    px_light.set_actor_label(f"Pixel_{actor_name}_{px_id}")
                    # Tag with DMX info so runtime can map sACN → light color
                    px_light.tags = [
                        f"MarsinPixel",
                        f"U{unv}",
                        f"A{addr}",
                        f"PxOffset_{pixel.get('offset', 0)}",
                        f"PxType_{pixel.get('type', 'rgb')}"
                    ]
                    light_comp = px_light.point_light_component
                    if light_comp:
                        light_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
                        # Give it a baseline intensity just to be visible in editor
                        light_comp.set_editor_property("intensity", 0.0)
                        light_comp.set_editor_property("light_color", unreal.Color(r, g, b, 255))
                        light_comp.set_editor_property("attenuation_radius", 2500.0) # Increased to 25 meters
                        light_comp.set_editor_property("cast_shadows", False)
            
            unreal.log(f"  -> {len(pixel_data)} pixel lights spawned")
        elif pixel_count <= 1:
            # Single-pixel fixtures get one SpotLight instead
            spot = unreal.EditorLevelLibrary.spawn_actor_from_class(
                unreal.SpotLight.static_class(),
                location,
                rotation
            )
            if spot:
                spot.set_actor_label(f"Spot_U{unv}_A{addr}_{actor_name}")
                spot_offset = 0
                spot_type = "rgbwau"
                if pixel_data and len(pixel_data) > 0:
                    spot_offset = pixel_data[0].get('offset', 0)
                    spot_type = pixel_data[0].get('type', 'rgbwau')
                
                spot.tags = [
                    f"MarsinPixel",
                    f"U{unv}",
                    f"A{addr}",
                    f"PxOffset_{spot_offset}",
                    f"PxType_{spot_type}"
                ]
                spot_comp = spot.spot_light_component if hasattr(spot, 'spot_light_component') else None
                if spot_comp:
                    spot_comp.set_mobility(unreal.ComponentMobility.MOVABLE)
                    spot_comp.set_editor_property("intensity", 0.0)
                    spot_comp.set_editor_property("light_color", unreal.Color(r, g, b, 255))
                    spot_comp.set_editor_property("attenuation_radius", 5000.0) # Increased to 50 meters
                    spot_comp.set_editor_property("inner_cone_angle", obj.get("angle", 45) * 0.3)
                    spot_comp.set_editor_property("outer_cone_angle", obj.get("angle", 45))
                    spot_comp.set_editor_property("cast_shadows", False)
        
    static_mesh_class = unreal.StaticMeshActor.static_class()
    for obj in static_geo:
        actor_name = obj.get("name", "UnknownStaticGeo")
        loc = obj.get("position", [0,0,0])
        rot = obj.get("rotation", [0,0,0])
        location = threejs_to_unreal(loc)
        rotation = threejs_rot_to_unreal(rot)
        unreal.log(f"Spawning Static Geometry (patch: null) {actor_name}")
        if world and static_mesh_class:
            actor = unreal.EditorLevelLibrary.spawn_actor_from_class(static_mesh_class, location, rotation)
            if actor:
                actor.set_actor_label(f"Environment_{actor_name}")
        
    unreal.log("=========================================")
    unreal.log(" INGESTION COMPLETE")
    unreal.log("=========================================")
    
    # --- Clean up Editor viewport so it looks like Play mode ---
    # Hide editor-only visual clutter: billboard icons, light radius circles, 
    # selection outlines, grid, etc. via console commands on the active viewport.
    cleanup_cmds = [
        "show BillboardSprites",    # Hide light bulb / camera icons
        "show LightRadius",          # Hide light attenuation circles
        "show Selection",            # Hide selection outlines
        "show ModeWidgets",          # Hide transform gizmos
        "show Grid",                 # Hide the floor grid
        "show Volumes",              # Hide trigger/blocking volumes
        "show BSP",                  # Hide BSP brushes
        "show Bounds",               # Hide bounding boxes
        "show NavigationNodes",      # Hide nav mesh
        "show Splines",              # Hide spline visualizations
    ]
    for cmd in cleanup_cmds:
        unreal.SystemLibrary.execute_console_command(None, cmd)
    unreal.log("[Viewport] Editor visual clutter hidden (billboard sprites, light radius, grid, etc.)")
    
    # Save the map explicitly to a dedicated path so headless spawned actors persist
    if world:
        success = unreal.EditorLoadingAndSavingUtils.save_map(world, "/Game/Marsin_Scene")
        unreal.log(f"Current level saved to Marsin_Scene: {success}")

parser = argparse.ArgumentParser(description="Ingest Marsin DMX JSON")
parser.add_argument("--json", type=str, help="Path to flattened scene json", default="")
args, unknown = parser.parse_known_args()

json_path = args.json
if not json_path:
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "unreal_ingested_model.json")

ingest_scene(json_path)
