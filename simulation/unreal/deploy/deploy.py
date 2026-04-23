import os
import subprocess
import time

def main():
    print("==================================================")
    print(" [MarsinEngine] Automated Unreal Scene Deployment ")
    print("==================================================")
    
    # Paths
    NODE_SCRIPT = r"C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal\scripts\export_unreal_data.js"
    UPROJECT = r"C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal\BM26_Unreal.uproject"
    INGEST_SCRIPT = r"C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal\scripts\ingest_scene.py"
    UNREAL_CMD = r"C:\Program Files\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
    UNREAL_EDITOR = r"C:\Program Files\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor.exe"

    # Step 1: Kill Editor to release file locks on Marsin_Scene.umap
    print("\n[1/4] Terminating active Unreal Editor instances...")
    os.system("taskkill /IM UnrealEditor.exe /F >nul 2>&1")
    time.sleep(3) # Wait for file handles to cleanly release

    # Step 2: Regenerate the JSON mappings from the newest YAML definitions
    print("\n[2/4] Regenerating DMX and Geolocation offsets via Node.js...")
    try:
        subprocess.run(["node", NODE_SCRIPT, "test_bench"], check=True)
    except subprocess.CalledProcessError:
        print("[ERROR] Node export failed.")
        return

    # Step 3: Run the headless Unreal command to ingest and save the map safely
    print("\n[3/4] Rebuilding Marsin_Scene geometry in UE5 Headless (Takes ~15 seconds)...")
    try:
        # Note: -NoUI hides the splash screen, -stdout pushes logs to python stdout
        subprocess.run([
            UNREAL_CMD, 
            UPROJECT, 
            f'-ExecutePythonScript={INGEST_SCRIPT}',
            '-NoUI'
        ], check=True)
    except subprocess.CalledProcessError:
        print("[ERROR] Epic Games UnrealEditor-Cmd failed during ingestion.")
        return

    # Step 4: Restart the Unreal Editor graphical instance
    print("\n[4/4] Restarting the Unreal Editor Graphical interface...")
    # 'start' forks the process so Python can exit while Editor launches
    os.system(f'start "" "{UNREAL_EDITOR}" "{UPROJECT}"')
    
    print("\nDone! Unreal Editor is launching.")
    print("Note: The sACN loop will start automatically when the map opens thanks to init_unreal.py!")

if __name__ == "__main__":
    main()
