# BC-250 Bluetooth Power Controller

Turn an AMD BC-250 into a much more console-like living-room system by giving it controller-triggered power-on, physical power-button handling, graceful shutdown support, and a small web UI for managing wake devices.

This project uses a **Seeed Studio XIAO ESP32-C3** running **MicroPython**. The ESP stays powered from PSU standby power, watches for configured Bluetooth LE advertisements while the BC-250 is off, and asserts the PSU / BC-250 power controls when a known controller appears.

It was built around a BC-250 running Bazzite, but the controller logic is intentionally separated from the OS. The ESP only needs a reliable "system running" sense signal and access to the PSU / motherboard power-control lines.

> **Status:** v1.0   
> Tested on XIAO ESP32-C3 + MicroPython 1.28.0.  
> The project is functional and has been stress-tested with repeated BLE scans, controller add/remove cycles, controller wake, and normal shutdown behavior.

---

## Documentation

- [`docs/installation.md`](docs/installation.md) — install MicroPython, upload the release, configure Wi-Fi, add a controller, and validate the setup
- [`hardware/wiring.md`](hardware/wiring.md) — XIAO pin mapping, transistor interfaces, PSU connector pinout, standby power, and BC-250 signal wiring
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — flashing, Wi-Fi, web UI, BLE wake, startup, and shutdown troubleshooting
- [`docs/controller-compatibility.md`](docs/controller-compatibility.md) — tested controller support, wake compatibility notes, limitations, and a community test/report format

---

## What it does

- Controller-triggered power-on using Bluetooth LE advertisements
- Physical case-button support
- Graceful BC-250 shutdown request
- Forced shutdown on long button hold
- Automatic PSU release after software shutdown
- Persistent wake-controller allowlist
- Web-based add / edit / remove controller management
- BLE scan from the web UI
- Multi-packet BLE advertisement collection
- Browser-side BLE metadata parsing and caching
- Manufacturer / service / appearance identification
- "Likely controller" detection
- Controller-first or signal-strength scan sorting
- Configurable wake RSSI threshold and timing
- Configurable mDNS hostname
- Optional browser debug console
- Precompiled `app.mpy` release workflow so normal users do **not** need to compile MicroPython code

---

## Web UI

Once the BC-250 is running and the ESP joins Wi-Fi, open:

```text
http://bc250-controller.local
```

The hostname is configurable in `config.py`.

The web UI provides:

- BC-250 / PSU state
- ESP IP address
- Configured wake controllers
- Add / edit / remove controls
- Nearby BLE device scan
- Controller-first sorting
- Signal-strength sorting
- Manufacturer / appearance / service metadata
- Optional debug logging

The ESP also prints its numeric IP address to the serial console as a fallback.

> `.local` name resolution depends on mDNS support on the client and network. If the hostname does not resolve, use the ESP IP shown by your router / DHCP server.

---

## Hardware

### Tested microcontroller

- **Seeed Studio XIAO ESP32-C3**

### Tested target

- AMD BC-250 / Cyan Skillfish board
- FlexATX PSU with standby power available while the BC-250 is off

### Required signals

The ESP needs four logical connections:

| Function | XIAO ESP32-C3 | ESP GPIO | Purpose |
|---|---:|---:|---|
| BC-250 power button | D0 | GPIO2 | Momentarily emulates the motherboard power button |
| BC-250 running sense | D1 | GPIO3 | Tells the ESP whether the BC-250 is actually running |
| Physical case button | D2 | GPIO4 | Local front-panel button input |
| PSU PS_ON control | D3 | GPIO5 | Controls PSU main power through the external transistor circuit |

The XIAO itself is powered from **always-on PSU standby 5 V** so Bluetooth wake remains available while the BC-250 is shut down.

### Important electrical note

**Do not connect BC-250 / PSU control lines directly to the ESP GPIO pins unless you have independently verified the electrical levels and circuit requirements.**

The tested build uses transistor interfaces between the ESP and the BC-250 / PSU control lines. Grounds must be referenced appropriately.

A proper wiring schematic should be treated as authoritative over the logical pin table above.

---

## Power behavior

### BC-250 off

- Main PSU output is off
- ESP remains powered from standby power
- Wi-Fi / web UI are off
- BLE wake scanning is active

### Controller wake

The ESP listens for Bluetooth advertisements from configured controller MAC addresses.

A wake requires:

- RSSI above the configured threshold
- Multiple matching advertisements within a short confirmation window

This helps avoid waking from a single stray packet.

### BC-250 running

- BLE wake scan stops
- Wi-Fi starts
- Web UI becomes available
- Manual BLE scans can be started from the web UI

### Shutdown

The ESP supports:

- graceful shutdown request from the physical button
- software shutdown detection
- forced PSU shutdown from a long physical-button hold

When the BC-250 running-sense signal drops, the ESP releases PSU main power.

---

## Default configuration

User-editable settings live in:

```text
config.py
```

Example:

```python
# GPIO: XIAO ESP32-C3 defaults
PIN_BC250_BUTTON = 2
PIN_BC250_SENSE = 3
PIN_CASE_BUTTON = 4
PIN_PS_ON = 5

# Power / button timing
DEBOUNCE_MS = 50
BC250_PRESS_MS = 250
FORCE_OFF_HOLD_MS = 4000
STARTUP_GRACE_MS = 10000

# BLE wake
WAKE_RSSI_MIN = -85
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
WAKE_SCAN_MS = 3000
WEB_SCAN_MS = 5000

# Controller storage
CONTROLLERS_FILE = "controllers.json"
MAX_CONTROLLERS = 4

# Web BLE scan collection
MAX_WEB_PAYLOADS_PER_DEVICE = 4

# Wi-Fi
WIFI_CONNECT_TIMEOUT_MS = 15000

# Web UI
HOSTNAME = "bc250-controller"
WEB_UI_DEBUG = False

# Optional first-run controller list.
# Public releases should normally leave this empty.
DEFAULT_CONTROLLERS = []
```

---

## Wi-Fi credentials

Wi-Fi credentials live separately in:

```text
secrets.py
```

Example:

```python
WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"
```

Do **not** commit your real `secrets.py` to a public repository.

---

## Release file layout

A normal installed device should look like this:

```text
/
├── main.py
├── app.mpy
├── config.py
├── secrets.py
├── controllers.json
└── www/
    ├── index.html
    ├── style.css
    └── app.js
```

`main.py` is intentionally tiny:

```python
import app
```

The main application is distributed as precompiled `app.mpy`.

This reduces MicroPython runtime memory pressure and means end users do not need to install a compiler.

---

## Installing a release

### 1. Install MicroPython

Flash a compatible MicroPython build to the XIAO ESP32-C3.

The tested build used:

```text
MicroPython 1.28.0
ESP-IDF 5.5.1
ESP32-C3
```

### 2. Upload the release files

Using Thonny, `mpremote`, or another MicroPython filesystem tool, upload:

```text
main.py
app.mpy
config.py
secrets.py
www/index.html
www/style.css
www/app.js
```

`controllers.json` can be omitted on a clean installation. The firmware will create it when needed.

### 3. Configure Wi-Fi

Edit:

```text
secrets.py
```

### 4. Review hardware settings

Edit:

```text
config.py
```

At minimum, verify:

- GPIO mapping
- hostname
- wake RSSI threshold
- controller count limit

### 5. Boot the BC-250

Use the physical case button for the first startup.

Once Wi-Fi connects, browse to:

```text
http://bc250-controller.local
```

### 6. Add a controller

Use **Nearby Bluetooth Devices → Scan**.

For best results:

1. Scan once with the controller off
2. Turn the controller on
3. Scan again
4. Look for the new / likely-controller entry
5. Add it to the wake list

---

## BLE device identification

The ESP intentionally does very little BLE interpretation itself.

During a web scan it collects a small number of unique raw advertisement packets per MAC address and returns them to the browser **only after the scan completes**.

The browser handles:

- local name decoding
- manufacturer identification
- Bluetooth Appearance decoding
- standard GATT service identification
- service-data UUIDs
- advertisement history
- controller detection
- display-name inference
- scan-to-scan NEW-device comparison

Keeping this work in JavaScript dramatically reduces pressure on the ESP32-C3.

### Why some devices still have generic names

Many BLE devices do not advertise an exact product name.

The UI may therefore display names such as:

```text
Apple Bluetooth Device
Samsung Bluetooth Device
Microsoft Bluetooth Device
```

rather than guessing a specific product model.

This is intentional.

---

## Controller detection

The web UI promotes devices that look like game controllers using signals such as:

- Gamepad Appearance
- Joystick Appearance
- HID service
- advertised controller names
- known controller-name patterns

Examples include:

- Xbox Wireless Controller
- DualSense
- DualShock
- 8BitDo
- GameSir
- Joy-Con
- Pro Controller
- Stadia Controller
- Luna Controller
- Backbone
- Razer Kishi

The default scan view is:

```text
Controllers first
```

This **does not hide other BLE devices**.

You can switch to:

```text
Signal
```

to see a traditional RSSI-oriented view.

This is intentional: if somebody really wants their Bluetooth blender to boot a BC-250, the software will not stand in their way.

---

## Wake-controller limitations

Adding a BLE device to the wake list does not guarantee it can wake the system.

The device must:

- advertise while being switched on / activated
- expose a usable BLE address
- continue presenting an address the ESP can match later
- appear above the configured RSSI threshold

Some BLE products use rotating / private addresses.

Those devices may appear in the scanner but may not be reliable wake sources.

---

## Why web-scan polling returns no devices until completion

The ESP32-C3 is memory-constrained when Wi-Fi and Bluetooth are active together.

An early version returned the growing BLE result set on every browser poll during the five-second scan. With multiple advertisement variants per device, this created unnecessary JSON serialization and socket traffic while BLE was still collecting packets.

The current API deliberately returns:

```json
{
  "scanning": true,
  "done": false,
  "devices": []
}
```

while a scan is active.

The complete device set is sent once after the scan finishes.

This change substantially improved stability during repeated scans.

---

## Debug mode

Browser-side scan diagnostics are available but disabled by default.

In `config.py`:

```python
WEB_UI_DEBUG = False
```

Set:

```python
WEB_UI_DEBUG = True
```

to enable the Scan Debug panel.

The panel records:

- scan start
- API requests
- polling state
- device-analysis completion
- cache updates
- result rendering
- failures

It also provides a Copy button with a fallback suitable for the local HTTP web UI.

This is useful when filing bug reports.

---

## Building `app.mpy` from source

Normal users do **not** need to do this.

For development, build `mpy-cross` using the same MicroPython release used by the target firmware.

Example for MicroPython 1.28.0:

```bash
git clone https://github.com/micropython/micropython.git
cd micropython
git checkout v1.28.0

sudo apt install build-essential
make -C mpy-cross
```

Then compile:

```bash
./mpy-cross/build/mpy-cross \
    -o app.mpy \
    app.py
```

Do not leave an old `app.py` on the device when testing the compiled release if you intend the device to import `app.mpy`.

---

## Development notes

The ESP32-C3 has limited memory headroom when MicroPython, BLE, Wi-Fi, HTTP, JSON, and scan payload collection are all active.

Several design decisions exist specifically to keep the C3 stable:

- precompiled `app.mpy`
- bounded BLE advertisement variants
- browser-side BLE metadata parsing
- browser-side metadata caching
- tiny in-progress scan responses
- full result serialization only after scan completion
- no repeated BLE stack teardown / reinitialization

Do not casually move metadata parsing back into MicroPython without re-testing memory behavior.

---

## Project structure

Suggested repository layout:

```text
bc250-bluetooth-controller/
├── README.md
├── LICENSE
├── .gitignore
├── firmware/
|   ├── app.py
|   ├── boot.py
|   ├── main.py
|   ├── config.py
|   ├── secrets.example.py
│   └── www/
│       ├── index.html
│       ├── style.css
│       └── app.js
├── release/
│   ├── app.mpy
│   ├── main.py
│   ├── config.py
│   ├── secrets.example.py
│   └── www/
├── hardware/
│   ├── wiring.md
│   └── diagrams/
└── docs/
    ├── installation.md
    ├── controller-compatibility.md
    └── troubleshooting.md
```

---

## Recommended `.gitignore`

```gitignore
# Local credentials
secrets.py

# User-specific controller database
controllers.json

# Local / temporary files
*.tmp
__pycache__/
.DS_Store
```

---

## Troubleshooting

See the dedicated troubleshooting guide:

- [`docs/troubleshooting.md`](docs/troubleshooting.md)

It covers flashing, first boot, Wi-Fi, mDNS / web access, BLE scanning, controller wake, startup sense, graceful shutdown, forced shutdown, and standby-power issues.

---

## Security

The web interface is designed for a trusted local network.

Current v1.0 behavior:

- plain HTTP
- no authentication
- no Internet-facing service intended

Do **not** expose the ESP web server directly to the public Internet.

HTTPS / TLS was intentionally not included in the initial ESP32-C3 release because of the additional memory cost and certificate-management complexity.

---

## Tested workflow

The release candidate has been exercised with:

- cold boot
- physical case-button startup
- repeated BLE web scans
- multiple unique advertisement packets per device
- browser metadata accumulation
- add controller
- remove controller
- controller-first sorting
- signal sorting
- graceful shutdown
- software shutdown detection
- Bluetooth controller wake

---

## Roadmap / possible future work

Not required for v1.0:

- ESP32-S3 port
- broader controller compatibility testing
- optional captive-portal first-run setup
- authenticated web UI
- additional BLE device fingerprints
- improved installation tooling
- formal hardware PCB
- additional case / antenna mounting documentation

---

## License

This project is licensed under the MIT License.

See the [LICENSE](LICENSE) file for the full license text.

---

## Disclaimer

This project directly controls computer and PSU power signals.

You are responsible for verifying:

- wiring
- voltage levels
- transistor interfaces
- grounding
- PSU pinout
- motherboard control behavior

Incorrect wiring can damage the ESP, BC-250, PSU, or other hardware.

Build and modify at your own risk.
