#!/usr/bin/env python3
"""Control Center — TITANIC Desktop Monitor.

PySide6 window showing live USB serial + BLE status for both Heltec
controllers. Design system: "Industrial Brutalism" from Stitch mockup.

Launch:  python config.py monitor
"""

import sys
import time
import threading
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QTextEdit, QLineEdit, QPushButton, QFrame, QStatusBar,
    QGridLayout, QSizePolicy, QTableWidget, QTableWidgetItem,
    QHeaderView, QAbstractItemView,
)
from PySide6.QtCore import Qt, QTimer, Signal, QObject
from PySide6.QtGui import QFont, QColor, QTextCursor, QPalette

import serial

# Setup path for local imports
BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE))

from utils import config_store
from utils import discovery
from utils import serial_parser

log = logging.getLogger(__name__)


# ── Design Tokens (from Stitch "Submersible Command" mockup) ─────

SURFACE           = "#111318"
SURFACE_CONTAINER = "#1e2024"
SURFACE_HIGH      = "#282a2e"
SURFACE_HIGHEST   = "#333539"
SURFACE_LOW       = "#1a1c20"
SURFACE_LOWEST    = "#0c0e12"

PRIMARY           = "#ebffe2"
PRIMARY_CONTAINER = "#00ff41"
PRIMARY_DIM       = "#00e639"
ON_PRIMARY        = "#007117"

SECONDARY         = "#feb700"
SECONDARY_DIM     = "#ffba20"

ERROR             = "#ffb4ab"
ERROR_CONTAINER   = "#93000a"

ON_SURFACE        = "#e2e2e8"
OUTLINE           = "#84967e"
OUTLINE_VARIANT   = "#3b4b37"
SURFACE_TINT      = "#00e639"

FONT_HEADLINE = "Segoe UI"
FONT_BODY     = "Segoe UI"
FONT_MONO     = "Cascadia Code"


# ── Signals bridge (thread-safe Qt updates) ──────────────────────

class SerialSignals(QObject):
    """Thread-safe signals for serial data → Qt main thread."""

    line_received = Signal(str, str)
    status_changed = Signal(str, str)
    stats_updated = Signal(str, dict)
    ble_result = Signal(dict)


# ── Serial Reader Thread ────────────────────────────────────────

class SerialReader(threading.Thread):
    """Background thread reading serial from one controller."""

    def __init__(self, role: str, port: str, signals: SerialSignals):
        super().__init__(daemon=True)
        self.role = role
        self.port = port
        self.signals = signals
        self.running = True
        self.ser: Optional[serial.Serial] = None
        self.tx_count = 0
        self.rx_count = 0
        self.last_rssi = ""
        self.last_snr = ""
        self.is_connected = False

    def run(self) -> None:
        """Main loop — connect and read, reconnect on failure."""
        while self.running:
            try:
                self.ser = serial.Serial(self.port, 115200, timeout=1)
                self.is_connected = True
                self.signals.status_changed.emit(self.role, "serial_connected")
                self._read_loop()
            except serial.SerialException as e:
                self.is_connected = False
                self.signals.status_changed.emit(self.role, "serial_disconnected")
                log.debug(f"{self.role} serial error: {e}")
                time.sleep(2)
            except Exception as e:
                log.error(f"{self.role} unexpected error: {e}")
                time.sleep(2)

    def _read_loop(self) -> None:
        """Read serial lines until disconnected."""
        while self.running:
            try:
                raw = self.ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                self.signals.line_received.emit(self.role, line)
                self._parse(line)
            except serial.SerialException:
                self.is_connected = False
                self.signals.status_changed.emit(self.role, "serial_disconnected")
                break

    def _parse(self, line: str) -> None:
        """Parse serial line and emit stats if relevant."""
        rx = serial_parser.parse_rx_line(line)
        if rx:
            self.rx_count += 1
            self.last_rssi = rx.rssi
            self.last_snr = rx.snr
            self._emit_stats()
            return
        tx = serial_parser.parse_tx_ack(line)
        if tx and tx.success:
            self.tx_count += 1
            self._emit_stats()

    def _emit_stats(self) -> None:
        """Emit current stats to the main thread."""
        self.signals.stats_updated.emit(self.role, {
            "rssi": self.last_rssi,
            "snr": self.last_snr,
            "tx": self.tx_count,
            "rx": self.rx_count,
        })

    def send(self, msg: str) -> None:
        """Send a message over serial (called from Qt thread)."""
        if not self.ser or not self.ser.is_open:
            return
        try:
            self.ser.write(f"{msg}\n".encode("utf-8"))
        except serial.SerialException as e:
            log.warning(f"Serial send failed: {e}")

    def stop(self) -> None:
        """Stop the reader thread and close the serial port."""
        self.running = False
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except serial.SerialException:
                pass


# ── BLE Reader Thread ───────────────────────────────────────────

class BleReader(threading.Thread):
    def __init__(self, role: str, mac: str, signals: SerialSignals):
        super().__init__(daemon=True)
        self.role = role
        self.mac = mac
        self.signals = signals
        self.running = True
        self.client = None
        self.loop = None
        self._command_queue = []
        self._last_tx = -1
        self._last_rx = -1
        self.is_connected = False

    def run(self):
        from utils.ble_client import BLENodeClient
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.client = BLENodeClient(self.mac, self._on_disconnect)
        self.loop.run_until_complete(self._async_loop())

    async def _async_loop(self):
        while self.running:
            if not self.client.is_connected:
                self.is_connected = False
                self.signals.status_changed.emit(self.role, "ble_disconnected")
                success = await self.client.connect(timeout=5.0)
                if success:
                    self.is_connected = True
                    self.signals.status_changed.emit(self.role, "ble_connected")
                else:
                    await asyncio.sleep(3)
                    continue

            # Drain command queue
            while self._command_queue:
                cmd = self._command_queue.pop(0)
                await self.client.send_command(cmd)

            # Poll stats
            try:
                stats = await self.client.read_stats()
                if stats is None:
                    await asyncio.sleep(1)
                    continue

                self.signals.stats_updated.emit(self.role, {
                    "rssi": str(stats.last_rssi),
                    "snr": str(stats.last_snr),
                    "tx": stats.tx_count,
                    "rx": stats.rx_count,
                })

                if self._last_tx != -1 and stats.tx_count > self._last_tx:
                    self.signals.line_received.emit(self.role, "TX_OK")
                self._last_tx = stats.tx_count

                if self._last_rx != -1 and stats.rx_count > self._last_rx:
                    self.signals.line_received.emit(self.role, f"RX:{stats.last_rx_payload}")
                self._last_rx = stats.rx_count
            except Exception as e:
                log.debug(f"BLE read error: {e}")

            await asyncio.sleep(1)

        await self.client.disconnect()

    def _on_disconnect(self, mac):
        self.is_connected = False
        self.signals.status_changed.emit(self.role, "ble_disconnected")

    def send(self, msg: str):
        self._command_queue.append(msg)

    def stop(self):
        self.running = False


# ── Glow Pill indicator ──────────────────────────────────────────

class GlowPill(QLabel):
    """Rectangular glow-pill status indicator (4×12px)."""

    def __init__(self, color: str = PRIMARY_CONTAINER, parent: QWidget = None):
        super().__init__(parent)
        self.setFixedSize(4, 12)
        self.set_color(color)

    def set_color(self, color: str) -> None:
        """Set the glow-pill color with a bright border to simulate glow."""
        self.setStyleSheet(
            f"background: {color}; border: 1px solid {color};"
        )


# ── Node Card (Industrial Brutalism) ────────────────────────────

class NodeCard(QFrame):
    """Status card for one controller node — matches Stitch mockup."""

    def __init__(self, role: str, port: str, ble_name: str,
                 parent: QWidget = None):
        super().__init__(parent)
        self.role = role
        self.port = port
        self.ble_name = ble_name
        self.usb_online = False
        self.ble_online = False
        self.setStyleSheet(
            f"background: {SURFACE_CONTAINER}; border: none;"
        )
        self._build_ui()
        self.update_connection_status("init", "init")

    def _build_ui(self) -> None:
        """Construct the card layout."""
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # ── Header bar ──
        header = QFrame()
        header.setStyleSheet(
            f"background: {SURFACE_HIGHEST};"
            f"border-left: 4px solid {PRIMARY_CONTAINER};"
        )
        h_layout = QHBoxLayout()
        h_layout.setContentsMargins(16, 8, 16, 8)

        title_col = QVBoxLayout()
        self.title_label = QLabel(
            f"NODE: {self.role.upper()}"
        )
        self.title_label.setFont(QFont(FONT_HEADLINE, 10))
        self.title_label.setStyleSheet(
            f"color: {PRIMARY_CONTAINER};"
            "font-weight: 900; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        self.subtitle_label = QLabel(
            "COMMAND NODE" if self.role == "podium" else "VISUALS NODE"
        )
        self.subtitle_label.setFont(QFont(FONT_HEADLINE, 7))
        self.subtitle_label.setStyleSheet(
            f"color: {OUTLINE}; text-transform: uppercase;"
        )
        self.conn_label = QLabel(f"PORT: {self.port} | BLE: SCANNING...")
        self.conn_label.setFont(QFont(FONT_HEADLINE, 7))
        self.conn_label.setStyleSheet(
            f"color: {OUTLINE_VARIANT}; text-transform: uppercase;"
        )
        title_col.addWidget(self.title_label)
        title_col.addWidget(self.subtitle_label)
        title_col.addWidget(self.conn_label)
        h_layout.addLayout(title_col)
        h_layout.addStretch()

        # USB Status badge
        self.usb_frame = QFrame()
        uf_lay = QHBoxLayout()
        uf_lay.setContentsMargins(8, 2, 8, 2)
        uf_lay.setSpacing(6)
        self.usb_pill = GlowPill(OUTLINE)
        self.usb_text = QLabel("USB OFFLINE")
        self.usb_text.setFont(QFont(FONT_HEADLINE, 8))
        self.usb_text.setStyleSheet(f"color: {OUTLINE}; font-weight: 900; text-transform: uppercase;")
        uf_lay.addWidget(self.usb_pill)
        uf_lay.addWidget(self.usb_text)
        self.usb_frame.setLayout(uf_lay)
        self.usb_frame.setStyleSheet(f"background: rgba(132,150,126,0.1);")
        h_layout.addWidget(self.usb_frame)

        # BLE Status badge
        self.ble_frame = QFrame()
        bf_lay = QHBoxLayout()
        bf_lay.setContentsMargins(8, 2, 8, 2)
        bf_lay.setSpacing(6)
        self.ble_pill = GlowPill(OUTLINE)
        self.ble_text = QLabel("BLE OFFLINE")
        self.ble_text.setFont(QFont(FONT_HEADLINE, 8))
        self.ble_text.setStyleSheet(f"color: {OUTLINE}; font-weight: 900; text-transform: uppercase;")
        bf_lay.addWidget(self.ble_pill)
        bf_lay.addWidget(self.ble_text)
        self.ble_frame.setLayout(bf_lay)
        self.ble_frame.setStyleSheet(f"background: rgba(132,150,126,0.1);")
        h_layout.addWidget(self.ble_frame)
        header.setLayout(h_layout)
        layout.addWidget(header)

        # ── Body: telemetry + counters ──
        body = QFrame()
        body.setStyleSheet(f"background: {SURFACE_CONTAINER};")
        body_grid = QGridLayout()
        body_grid.setContentsMargins(16, 16, 16, 16)
        body_grid.setSpacing(16)

        # RSSI
        rssi_col = QVBoxLayout()
        rssi_col.setSpacing(4)
        rssi_lbl = QLabel("RSSI INTENSITY")
        rssi_lbl.setFont(QFont(FONT_HEADLINE, 8))
        rssi_lbl.setStyleSheet(
            f"color: {OUTLINE}; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        rssi_col.addWidget(rssi_lbl)

        rssi_val_row = QHBoxLayout()
        self.rssi_value = QLabel("—")
        self.rssi_value.setFont(QFont(FONT_MONO, 18))
        self.rssi_value.setStyleSheet(
            f"color: {ON_SURFACE}; font-weight: bold;"
        )
        self.rssi_unit = QLabel("dBm")
        self.rssi_unit.setFont(QFont(FONT_MONO, 10))
        self.rssi_unit.setStyleSheet(f"color: {OUTLINE};")
        rssi_val_row.addWidget(self.rssi_value)
        rssi_val_row.addWidget(self.rssi_unit)

        # RSSI bar
        self.rssi_bar_bg = QFrame()
        self.rssi_bar_bg.setFixedHeight(6)
        self.rssi_bar_bg.setStyleSheet(
            f"background: {SURFACE_LOWEST};"
        )
        self.rssi_bar_fill = QFrame(self.rssi_bar_bg)
        self.rssi_bar_fill.setFixedHeight(4)
        self.rssi_bar_fill.move(1, 1)
        self.rssi_bar_fill.setFixedWidth(0)
        self.rssi_bar_fill.setStyleSheet(
            f"background: {PRIMARY_CONTAINER};"
        )
        rssi_val_row.addWidget(self.rssi_bar_bg, 1)
        rssi_col.addLayout(rssi_val_row)

        # SNR
        snr_lbl = QLabel("SNR FLOOR")
        snr_lbl.setFont(QFont(FONT_HEADLINE, 8))
        snr_lbl.setStyleSheet(
            f"color: {OUTLINE}; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        rssi_col.addWidget(snr_lbl)
        self.snr_value = QLabel("—")
        self.snr_value.setFont(QFont(FONT_MONO, 18))
        self.snr_value.setStyleSheet(
            f"color: {ON_SURFACE}; font-weight: bold;"
        )
        rssi_col.addWidget(self.snr_value)
        body_grid.addLayout(rssi_col, 0, 0)

        # Counters panel (recessed pit)
        counters = QFrame()
        counters.setStyleSheet(f"background: {SURFACE_LOW};")
        c_lay = QVBoxLayout()
        c_lay.setContentsMargins(12, 12, 12, 12)
        c_lay.setSpacing(8)

        for label_text, attr_name in [
            ("PACKETS IN", "rx_count_label"),
            ("PACKETS OUT", "tx_count_label"),
            ("DROPS", "drops_label"),
        ]:
            row = QHBoxLayout()
            lbl = QLabel(label_text)
            lbl.setFont(QFont(FONT_HEADLINE, 8))
            lbl.setStyleSheet(
                f"color: {OUTLINE}; letter-spacing: 2px;"
                "text-transform: uppercase;"
            )
            val = QLabel("0")
            val.setFont(QFont(FONT_MONO, 10))
            val.setStyleSheet(f"color: {ON_SURFACE};")
            val.setAlignment(Qt.AlignmentFlag.AlignRight)
            setattr(self, attr_name, val)
            row.addWidget(lbl)
            row.addWidget(val)
            c_lay.addLayout(row)

        counters.setLayout(c_lay)
        body_grid.addWidget(counters, 0, 1)

        body.setLayout(body_grid)
        layout.addWidget(body)
        self.setLayout(layout)

    def update_connection_status(self, kind: str, state: str) -> None:
        """Update USB/BLE connection badge."""
        if kind == "serial" or kind == "init":
            self.usb_online = (state == "serial_connected")
            if self.usb_online:
                self.usb_pill.set_color(PRIMARY_CONTAINER)
                self.usb_text.setStyleSheet(f"color: {PRIMARY_CONTAINER}; font-weight: 900;")
                self.usb_frame.setStyleSheet(f"background: rgba(0,255,65,0.1);")
                self.usb_text.setText("USB ONLINE")
            else:
                self.usb_pill.set_color(OUTLINE)
                self.usb_text.setStyleSheet(f"color: {OUTLINE}; font-weight: 900;")
                self.usb_frame.setStyleSheet(f"background: rgba(132,150,126,0.1);")
                self.usb_text.setText("USB OFFLINE")

        if kind == "ble" or kind == "init":
            self.ble_online = (state == "ble_connected")
            if self.ble_online:
                self.ble_pill.set_color(SECONDARY_DIM)
                self.ble_text.setStyleSheet(f"color: {SECONDARY_DIM}; font-weight: 900;")
                self.ble_frame.setStyleSheet(f"background: rgba(255,186,32,0.1);")
                self.ble_text.setText("BLE ONLINE")
            else:
                self.ble_pill.set_color(OUTLINE)
                self.ble_text.setStyleSheet(f"color: {OUTLINE}; font-weight: 900;")
                self.ble_frame.setStyleSheet(f"background: rgba(132,150,126,0.1);")
                self.ble_text.setText("BLE OFFLINE")

    def update_stats(self, stats: dict) -> None:
        """Update RSSI, SNR, and counter display."""
        if stats.get("rssi"):
            rssi_str = stats["rssi"]
            self.rssi_value.setText(rssi_str)
            try:
                val = float(rssi_str)
                pct = max(0, min(100, (val + 100) * 2.5))
                bar_w = int(self.rssi_bar_bg.width() * pct / 100)
                self.rssi_bar_fill.setFixedWidth(max(bar_w, 0))
                color = PRIMARY_CONTAINER if val > -70 else SECONDARY
                self.rssi_bar_fill.setStyleSheet(
                    f"background: {color};"
                )
            except ValueError:
                pass

        if stats.get("snr"):
            self.snr_value.setText(stats["snr"])

        self.rx_count_label.setText(f"{stats.get('rx', 0):,}")
        self.tx_count_label.setText(f"{stats.get('tx', 0):,}")


# ── Live Command Log (table-based) ──────────────────────────────

class CommandLog(QFrame):
    """Scrolling command log table matching Stitch mockup."""

    MAX_ROWS = 200

    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.setStyleSheet(f"background: {SURFACE_CONTAINER};")
        self._build_ui()

    def _build_ui(self) -> None:
        """Construct the log table."""
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QFrame()
        header.setStyleSheet(f"background: {SURFACE_HIGHEST};")
        h_lay = QHBoxLayout()
        h_lay.setContentsMargins(16, 10, 16, 10)
        title = QLabel("LIVE COMMAND LOG")
        title.setFont(QFont(FONT_HEADLINE, 9))
        title.setStyleSheet(
            f"color: {ON_SURFACE}; font-weight: 900;"
            "letter-spacing: 3px; text-transform: uppercase;"
        )
        h_lay.addWidget(title)
        h_lay.addStretch()

        clear_btn = QPushButton("CLEAR")
        clear_btn.setFont(QFont(FONT_HEADLINE, 8))
        clear_btn.setStyleSheet(
            f"color: {OUTLINE}; background: transparent;"
            "border: none; font-weight: bold;"
            "text-transform: uppercase;"
        )
        clear_btn.clicked.connect(self._clear)
        h_lay.addWidget(clear_btn)
        header.setLayout(h_lay)
        layout.addWidget(header)

        # Table
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(
            ["TIMESTAMP", "SOURCE", "MESSAGE", "STATUS"]
        )
        self.table.horizontalHeader().setFont(QFont(FONT_MONO, 9))
        self.table.horizontalHeader().setStyleSheet(
            f"QHeaderView::section {{"
            f"  background: {SURFACE_LOW};"
            f"  color: {OUTLINE};"
            f"  border: none; padding: 8px 16px;"
            f"  font-weight: bold; text-transform: uppercase;"
            f"}}"
        )
        self.table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionMode(
            QAbstractItemView.SelectionMode.NoSelection
        )
        self.table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.table.setShowGrid(False)
        self.table.setStyleSheet(
            f"QTableWidget {{"
            f"  background: {SURFACE_LOWEST};"
            f"  color: {ON_SURFACE};"
            f"  border: none;"
            f"  gridline-color: transparent;"
            f"}}"
            f"QTableWidget::item {{"
            f"  padding: 6px 16px;"
            f"  border-bottom: 1px solid rgba(59,75,55,0.1);"
            f"}}"
        )
        self.table.setFont(QFont(FONT_MONO, 10))
        self.table.setMaximumHeight(250)
        layout.addWidget(self.table)

        # Footer
        footer = QFrame()
        footer.setStyleSheet(f"background: {SURFACE_LOW};")
        f_lay = QHBoxLayout()
        f_lay.setContentsMargins(16, 4, 16, 4)
        dot = GlowPill(PRIMARY_CONTAINER)
        f_lay.addWidget(dot)
        status = QLabel("LISTENING FOR EVENTS...")
        status.setFont(QFont(FONT_HEADLINE, 8))
        status.setStyleSheet(
            f"color: {OUTLINE}; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        f_lay.addWidget(status)
        f_lay.addStretch()
        footer.setLayout(f_lay)
        layout.addWidget(footer)

        self.setLayout(layout)

    def append_line(self, role: str, line: str) -> None:
        """Add a line to the log table."""
        if self.table.rowCount() >= self.MAX_ROWS:
            self.table.removeRow(0)

        row = self.table.rowCount()
        self.table.insertRow(row)

        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        source_color, status_text = self._classify(role, line)

        items = [
            self._item(ts, OUTLINE),
            self._item(role.upper(), source_color),
            self._item(line, ON_SURFACE),
            self._item(status_text, source_color),
        ]
        for col, item in enumerate(items):
            self.table.setItem(row, col, item)

        self.table.scrollToBottom()

    def _classify(self, role: str, line: str) -> tuple[str, str]:
        """Determine source color and status text from line content."""
        color = PRIMARY_CONTAINER if role == "podium" else SECONDARY
        if line.startswith("RX:"):
            return color, "OK"
        if line == "TX_OK":
            return color, "OK"
        if line.startswith("TX_FAIL"):
            return ERROR, "FAIL"
        if line.startswith("BLE"):
            return SECONDARY_DIM, "BLE"
        return color, "PROC"

    def _item(self, text: str, color: str) -> QTableWidgetItem:
        """Create a styled table item."""
        item = QTableWidgetItem(text)
        item.setFont(QFont(FONT_MONO, 10))
        item.setForeground(QColor(color))
        return item

    def _clear(self) -> None:
        """Clear all log entries."""
        self.table.setRowCount(0)


# ── Main Window ─────────────────────────────────────────────────

class ControlCenter(QMainWindow):
    """Main Control Center window — Industrial Brutalism design."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("TITANIC_CTRL")
        self.setMinimumSize(1000, 700)
        self.resize(1200, 800)
        self.setStyleSheet(f"background: {SURFACE};")

        self.config = config_store.load()
        self.nodes: dict = {}
        self.readers: dict = {}
        self.ble_readers: dict = {}
        self.signals = SerialSignals()

        self._build_ui()
        self._connect_signals()
        self._start_readers()
        self._start_ble_timer()

    def _build_ui(self) -> None:
        """Construct the main window layout."""
        central = QWidget()
        main = QVBoxLayout()
        main.setContentsMargins(0, 0, 0, 0)
        main.setSpacing(0)

        main.addWidget(self._build_header())
        main.addWidget(self._build_stats_row())
        main.addLayout(self._build_cards())
        main.addWidget(self._build_command_log())
        main.addWidget(self._build_command_bar())

        central.setLayout(main)
        self.setCentralWidget(central)
        self.statusBar().showMessage("INITIALIZING...")
        self.statusBar().setFont(QFont(FONT_MONO, 8))
        self.statusBar().setStyleSheet(
            f"background: {SURFACE_LOWEST};"
            f"color: {OUTLINE}; border: none;"
        )

    def _build_header(self) -> QFrame:
        """Build the top header bar."""
        header = QFrame()
        header.setStyleSheet(
            f"background: {SURFACE};"
            f"border-bottom: 1px solid rgba(59,75,55,0.2);"
        )
        h_lay = QHBoxLayout()
        h_lay.setContentsMargins(24, 12, 24, 12)

        title = QLabel("TITANIC_CTRL")
        title.setFont(QFont(FONT_HEADLINE, 16))
        title.setStyleSheet(
            f"color: {PRIMARY_CONTAINER}; font-weight: bold;"
            "letter-spacing: 4px; text-transform: uppercase;"
        )
        h_lay.addWidget(title)
        h_lay.addSpacing(24)

        # System health
        health_col = QVBoxLayout()
        health_lbl = QLabel("SYSTEM HEALTH")
        health_lbl.setFont(QFont(FONT_HEADLINE, 7))
        health_lbl.setStyleSheet(
            f"color: {OUTLINE}; letter-spacing: 2px;"
        )
        health_col.addWidget(health_lbl)
        health_row = QHBoxLayout()
        health_pill = GlowPill(PRIMARY_CONTAINER)
        health_row.addWidget(health_pill)
        self.health_text = QLabel("NOMINAL")
        self.health_text.setFont(QFont(FONT_MONO, 10))
        self.health_text.setStyleSheet(
            f"color: {PRIMARY_CONTAINER}; font-weight: bold;"
        )
        health_row.addWidget(self.health_text)
        health_col.addLayout(health_row)
        h_lay.addLayout(health_col)
        h_lay.addSpacing(24)

        # Latency display
        lat_col = QVBoxLayout()
        lat_lbl = QLabel("LAST LATENCY")
        lat_lbl.setFont(QFont(FONT_HEADLINE, 7))
        lat_lbl.setStyleSheet(
            f"color: {OUTLINE}; letter-spacing: 2px;"
        )
        lat_col.addWidget(lat_lbl)
        self.latency_text = QLabel("—")
        self.latency_text.setFont(QFont(FONT_MONO, 10))
        self.latency_text.setStyleSheet(
            f"color: {ON_SURFACE}; font-weight: bold;"
        )
        lat_col.addWidget(self.latency_text)
        h_lay.addLayout(lat_col)

        h_lay.addStretch()

        # Force Rescan Button
        self.rescan_btn = QPushButton("RESCAN BLE")
        self.rescan_btn.setFont(QFont(FONT_HEADLINE, 8))
        self.rescan_btn.setStyleSheet(
            f"background: {SURFACE_LOW}; color: {ON_SURFACE};"
            f"border: 1px solid {OUTLINE_VARIANT}; padding: 6px 12px;"
            "font-weight: bold; letter-spacing: 2px;"
        )
        self.rescan_btn.clicked.connect(self._force_ble_scan)
        h_lay.addWidget(self.rescan_btn)
        h_lay.addSpacing(12)

        # Command search
        self.cmd_search = QLineEdit()
        self.cmd_search.setPlaceholderText("CMD SEARCH...")
        self.cmd_search.setFont(QFont(FONT_HEADLINE, 8))
        self.cmd_search.setMaximumWidth(180)
        self.cmd_search.setStyleSheet(
            f"background: {SURFACE_LOW};"
            f"color: {ON_SURFACE}; border: none;"
            "padding: 6px 12px; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        h_lay.addWidget(self.cmd_search)

        header.setLayout(h_lay)
        return header

    def _build_stats_row(self) -> QFrame:
        """Build the global statistics row."""
        row = QFrame()
        row.setStyleSheet(f"background: {SURFACE};")
        r_lay = QHBoxLayout()
        r_lay.setContentsMargins(24, 12, 24, 12)
        r_lay.setSpacing(16)

        # Active links
        links_card = self._stat_card(
            "ACTIVE LINKS", "02", "ONLINE NODES"
        )
        r_lay.addWidget(links_card)

        # Radio config
        radio = self.config.get("radio", {})
        freq = radio.get("frequency", 915.0)
        sf = radio.get("spreading_factor", 7)
        bw = radio.get("bandwidth", 250.0)
        radio_card = self._stat_card(
            "RADIO CONFIG", f"SF{sf}", f"{freq} MHz / BW{bw}"
        )
        r_lay.addWidget(radio_card)

        # FW version
        fw = self.config.get("firmware_version", "1.2")
        fw_card = self._stat_card("FIRMWARE", fw, "DEPLOYED")
        r_lay.addWidget(fw_card)

        row.setLayout(r_lay)
        return row

    def _stat_card(self, title: str, value: str,
                   subtitle: str) -> QFrame:
        """Build a single stats card."""
        card = QFrame()
        card.setStyleSheet(f"background: {SURFACE_CONTAINER};")
        card.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed
        )
        lay = QVBoxLayout()
        lay.setContentsMargins(16, 12, 16, 12)

        t = QLabel(title)
        t.setFont(QFont(FONT_HEADLINE, 8))
        t.setStyleSheet(
            f"color: {OUTLINE}; font-weight: 900;"
            "letter-spacing: 3px; text-transform: uppercase;"
        )
        lay.addWidget(t)

        v = QLabel(value)
        v.setFont(QFont(FONT_MONO, 28))
        v.setStyleSheet(f"color: {ON_SURFACE}; font-weight: 300;")
        lay.addWidget(v)

        s = QLabel(subtitle)
        s.setFont(QFont(FONT_HEADLINE, 8))
        s.setStyleSheet(
            f"color: {OUTLINE}; text-transform: uppercase;"
        )
        lay.addWidget(s)
        card.setLayout(lay)
        return card

    def _build_cards(self) -> QHBoxLayout:
        """Build node cards for all configured nodes."""
        cards_layout = QHBoxLayout()
        cards_layout.setContentsMargins(24, 8, 24, 8)
        cards_layout.setSpacing(16)

        for name in config_store.node_names(self.config):
            node = config_store.get_node(self.config, name)
            port = (
                node.get("usb_port")
                or discovery.find_port_by_mac(node.get("usb_mac"))
                or "—"
            )
            ble_name = (
                node.get("ble_name")
                or f"Titanic-{name.capitalize()}"
            )
            card = NodeCard(name, port, ble_name)
            cards_layout.addWidget(card)
            self.nodes[name] = {
                "card": card, "port": port, "ble_name": ble_name,
            }

        return cards_layout

    def _build_command_log(self) -> CommandLog:
        """Build the live command log table."""
        self.command_log = CommandLog()
        return self.command_log

    def _build_command_bar(self) -> QFrame:
        """Build the bottom command input bar."""
        bar = QFrame()
        bar.setStyleSheet(f"background: {SURFACE_LOW};")
        b_lay = QHBoxLayout()
        b_lay.setContentsMargins(24, 8, 24, 8)

        self.cmd_input = QLineEdit()
        self.cmd_input.setPlaceholderText(
            "ENTER COMMAND (e.g. titanic:scene:sunset)"
        )
        self.cmd_input.setFont(QFont(FONT_MONO, 10))
        self.cmd_input.setStyleSheet(
            f"background: {SURFACE_LOWEST};"
            f"color: {ON_SURFACE}; border: none;"
            "padding: 10px 16px;"
        )
        self.cmd_input.returnPressed.connect(self._send_command)
        b_lay.addWidget(self.cmd_input)

        self.target_label = QLabel("→ PODIUM")
        self.target_label.setFont(QFont(FONT_HEADLINE, 9))
        self.target_label.setStyleSheet(
            f"color: {PRIMARY_CONTAINER}; font-weight: bold;"
            "padding: 0 12px; letter-spacing: 2px;"
        )
        self.send_target = "podium"
        b_lay.addWidget(self.target_label)

        toggle = QPushButton("⇄")
        toggle.setFixedSize(36, 36)
        toggle.setStyleSheet(
            f"background: {SURFACE_HIGHEST}; color: {ON_SURFACE};"
            "border: none; font-size: 16px;"
        )
        toggle.clicked.connect(self._toggle_target)
        b_lay.addWidget(toggle)

        send = QPushButton("TRANSMIT")
        send.setFont(QFont(FONT_HEADLINE, 9))
        send.setStyleSheet(
            f"background: {PRIMARY_CONTAINER};"
            f"color: {ON_PRIMARY};"
            "border: none; padding: 10px 20px;"
            "font-weight: 900; letter-spacing: 2px;"
            "text-transform: uppercase;"
        )
        send.clicked.connect(self._send_command)
        b_lay.addWidget(send)

        bar.setLayout(b_lay)
        return bar

    def _connect_signals(self) -> None:
        """Wire up all cross-thread signals."""
        self.signals.line_received.connect(self._on_line)
        self.signals.status_changed.connect(self._on_status)
        self.signals.stats_updated.connect(self._on_stats)
        self.signals.ble_result.connect(self._on_ble_result)

    def _start_readers(self) -> None:
        """Start serial reader threads for all nodes."""
        for name, info in self.nodes.items():
            if info["port"] == "—":
                info["card"].set_usb_status("disconnected")
                continue
            reader = SerialReader(name, info["port"], self.signals)
            reader.start()
            self.readers[name] = reader

        active = list(self.readers.keys())
        status = (
            f"MONITORING: {', '.join(active).upper()}"
            if active else "NO NODES CONNECTED"
        )
        self.statusBar().showMessage(status)

    def _start_ble_timer(self) -> None:
        """Start periodic BLE scanning."""
        self._ble_scanning = False
        self.ble_timer = QTimer()
        self.ble_timer.timeout.connect(self._ble_scan)
        self.ble_timer.start(10_000)
        QTimer.singleShot(1000, self._ble_scan)

    def _force_ble_scan(self) -> None:
        """Manually trigger a BLE scan."""
        self.rescan_btn.setText("SCANNING...")
        self.rescan_btn.setEnabled(False)
        self._ble_scan()

    # ── Event handlers ──────────────────────────────────────────

    def _on_line(self, role: str, line: str) -> None:
        """Handle a serial line from any node."""
        self.command_log.append_line(role, line)

    def _on_status(self, role: str, status: str) -> None:
        """Handle USB or BLE connection status change."""
        card = self.nodes.get(role, {}).get("card")
        if card:
            if status.startswith("serial_"):
                card.update_connection_status("serial", status)
            elif status.startswith("ble_"):
                card.update_connection_status("ble", status)

    def _on_stats(self, role: str, stats: dict) -> None:
        """Handle stats update from serial parser."""
        card = self.nodes.get(role, {}).get("card")
        if card:
            card.update_stats(stats)

    def _on_ble_result(self, results: dict) -> None:
        """Handle BLE scan results on the main thread."""
        for role, device_info in results.items():
            card = self.nodes.get(role, {}).get("card")
            if not card:
                continue
            if device_info:
                card.conn_label.setText(
                    f"PORT: {card.port} | BLE: {device_info.get('rssi', 'N/A')}dBm"
                )
                
                # If we haven't started a BleReader for this node yet, start one!
                if role not in self.ble_readers and device_info.get("address"):
                    r = BleReader(role, device_info["address"], self.signals)
                    r.start()
                    self.ble_readers[role] = r

        if hasattr(self, 'rescan_btn'):
            self.rescan_btn.setText("RESCAN BLE")
            self.rescan_btn.setEnabled(True)

    def _send_command(self) -> None:
        """Send command to the selected target node using Serial first, fallback to BLE."""
        text = self.cmd_input.text().strip()
        if not text:
            return
        
        reader = self.readers.get(self.send_target)
        ble_reader = self.ble_readers.get(self.send_target)
        
        sent = False
        if reader and reader.is_connected:
            reader.send(text)
            sent = True
        elif ble_reader and ble_reader.is_connected:
            ble_reader.send(text)
            sent = True
            
        if sent:
            self.command_log.append_line("CMD", f"► {text}")
        else:
            self.command_log.append_line("SYS", f"FAIL: NO CONNECT TO {self.send_target.upper()}")
            
        self.cmd_input.clear()

    def _toggle_target(self) -> None:
        """Toggle send target between nodes."""
        names = list(self.nodes.keys())
        if len(names) < 2:
            return
        idx = names.index(self.send_target)
        self.send_target = names[(idx + 1) % len(names)]
        self.target_label.setText(f"→ {self.send_target.upper()}")
        color = (
            PRIMARY_CONTAINER if self.send_target == "podium"
            else SECONDARY
        )
        self.target_label.setStyleSheet(
            f"color: {color}; font-weight: bold;"
            "padding: 0 12px; letter-spacing: 2px;"
        )

    def _ble_scan(self) -> None:
        """Run BLE scan in background thread."""
        if getattr(self, "_ble_scanning", False):
            return
        self._ble_scanning = True
        
        def _scan():
            try:
                from utils import ble_discovery
                loop = asyncio.new_event_loop()
                results = loop.run_until_complete(
                    ble_discovery.scan_and_match(self.config, timeout=5.0)
                )
                loop.close()
                data = {}
                for role, device in results.items():
                    if device:
                        data[role] = {
                            "name": device.name,
                            "address": device.address,
                            "rssi": device.rssi,
                        }
                    else:
                        data[role] = None
                self.signals.ble_result.emit(data)
            except Exception as e:
                log.debug(f"BLE scan failed: {e}")
            finally:
                self._ble_scanning = False

        t = threading.Thread(target=_scan, daemon=True)
        t.start()

    def closeEvent(self, event) -> None:
        """Clean up readers on close."""
        for reader in self.readers.values():
            reader.stop()
        for reader in self.ble_readers.values():
            reader.stop()
        event.accept()


# ── Entry Point ─────────────────────────────────────────────────

def main() -> None:
    """Launch the Control Center application."""
    import signal
    # Allow terminal Ctrl+C to safely kill the PyQt application
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    logging.basicConfig(
        level=logging.WARNING, format="%(name)s: %(message)s"
    )

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    # Fonts: uses system-installed Google Fonts if available,
    # otherwise falls back to Segoe UI / Cascadia Code / Consolas

    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(SURFACE))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(ON_SURFACE))
    palette.setColor(QPalette.ColorRole.Base, QColor(SURFACE_CONTAINER))
    palette.setColor(QPalette.ColorRole.Text, QColor(ON_SURFACE))
    palette.setColor(QPalette.ColorRole.Button, QColor(SURFACE_HIGHEST))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(ON_SURFACE))
    palette.setColor(
        QPalette.ColorRole.Highlight, QColor(PRIMARY_CONTAINER)
    )
    app.setPalette(palette)

    try:
        window = ControlCenter()
        window.show()
        app.exec()
        sys.exit(0)
    except KeyboardInterrupt:
        print("\nSHUTTING DOWN...", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
