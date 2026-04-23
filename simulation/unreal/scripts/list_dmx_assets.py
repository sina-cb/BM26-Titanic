import unreal

unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()

# List all assets under /DMXFixtures using get_assets_by_path
assets = unreal.AssetRegistryHelpers.get_asset_registry().get_assets_by_path("/DMXFixtures", recursive=True)
unreal.log(f"Found {len(assets)} assets under /DMXFixtures:")
for a in assets:
    unreal.log(f"  {a.asset_name} | class={a.asset_class_path} | pkg={a.package_name}")
