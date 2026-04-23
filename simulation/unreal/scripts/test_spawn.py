import unreal

try:
    actor_class = unreal.EditorAssetLibrary.load_blueprint_class("/DMXFixtures/LightFixtures/BP_DMXFixture_SpotLight.BP_DMXFixture_SpotLight_C")
    if not actor_class:
        unreal.log_error("Could not load BP_DMXFixture_SpotLight")
    else:
        unreal.log(f"Successfully loaded BP class: {actor_class}")

        unreal_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        world = unreal_subsystem.get_editor_world()

        if world:
            location = unreal.Vector(0,0,0)
            rotation = unreal.Rotator(0,0,0)
            actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, rotation)
            if actor:
                unreal.log(f"Spawned actor: {actor.get_name()}")
                # List exposed properties to figure out how to assign Patch
                props = unreal.SystemLibrary.get_properties_of_class(actor_class)
                # get_properties_of_class is not a real function? 
                
except Exception as e:
    unreal.log_error(f"Error: {e}")
