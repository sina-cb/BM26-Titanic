# DMX Fixture Designer

The Fixture Designer is a **desktop application** (built with Electron, Vite, React, and React Three Fiber) that lets you visually map out your physical DMX fixtures. 

It provides a 3D interface for placing LED "dots", grouping them into DMX "pixels", and assigning DMX channels. This bridges the gap between raw channel profiles (like `channels_135.yaml`) and 3D simulation geometry.

## 🚀 Quick Start

### 1. Install Dependencies
Make sure you are in the `simulation/dmx/designer` directory:
```bash
cd simulation/dmx/designer
npm install
```

### 2. Run the Desktop App
Launch the desktop application using the included Electron script:
```bash
npm run desktop
```
*Note: This will automatically start the Vite development server in the background and open the Electron window when ready.*

---

## 🛠️ How to Use

### Loading a Fixture Model
1. Click the **Load YAML** button in the top-left toolbar.
2. Navigate to one of the verification models in `simulation/dmx/fixtures/`:
   - **Endyshow 240W Bar**: `fixtures\endyshow_240w_stage_strobe_led_bar\model_135.yaml`
   - **UKing PAR**: `fixtures\uking_rgbwau_par_light\model_10.yaml`
   - **Vintage LED**: `fixtures\vintage_led_stage_light\model_33.yaml`

### UI Panels
- **3D Viewport**: Use left-click to select individual dots or rotate the camera (if in 3D mode). The toolbar lets you toggle between Orthographic (2D) and Perspective (3D) views, and toggle the reference grid and fixture shell.
- **Properties Panel (Right)**: Shows fixture metadata. When you click a dot/pixel, this panel expands to let you edit coordinates, DMX channels, and pixel types directly.
- **DMX Test Panel (Right)**: A visual stub for DMX testing. Click "Static Red" or "Blackout" to preview how the active pixels respond based on their definitions. (Actual Art-Net transmission is coming in the next phase).
- **Pixel List (Bottom)**: A quick spreadsheet view of every pixel in your fixture, including channel assignments and dot counts.

### Saving Your Work
Once you've tuned the pixel mapping perfectly, click the **Save YAML** button in the toolbar. It will download the updated model YAML file which you can copy back into your `simulation/dmx/fixtures/` folder.

---

## 💻 Tech Stack
- **Electron**: Desktop window container (`electron/main.js`)
- **Vite**: Rapid local bundler and dev server (`vite.config.js`)
- **React 19 + Zustand**: Component UI and global state management (`src/store.js`)
- **React Three Fiber (R3F)**: 3D viewport rendering using `InstancedMesh` for peak performance.
- **js-yaml**: For parsing/saving the config structure.
