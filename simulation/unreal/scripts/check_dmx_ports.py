import unreal
settings = unreal.get_default_object(unreal.DMXProtocolSettings)
if settings:
    ports = settings.get_editor_property("input_port_configs")
    unreal.log(f"Found {len(ports)} DMX input ports")
    for p in ports:
        unreal.log(f"  Port: {p.get_editor_property('port_name')} - {p.get_editor_property('protocol_name')}")
else:
    unreal.log("DMXProtocolSettings not found")
