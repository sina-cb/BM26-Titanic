import unreal
import sys
import os

unreal.log("==================================================")
unreal.log(" [MarsinEngine] Initializing Unreal Editor hooks  ")
unreal.log("==================================================")

# Add our custom script dir to the path so we can import the receiver
scripts_dir = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "scripts"))
if scripts_dir not in sys.path:
    sys.path.append(scripts_dir)

try:
    # Importing it actually runs the global activation inside the file
    import sacn_unreal_receiver
    import importlib
    
    # Force reload to ensure we restart the thread clean if the editor hot-reloads
    importlib.reload(sacn_unreal_receiver)
except Exception as e:
    unreal.log_error(f"[MarsinEngine] Failed to auto-start sACN Receiver: {e}")
