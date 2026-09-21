# Installation Guide

This guide covers installing the BC-250 Bluetooth Power Controller firmware on a **Seeed Studio XIAO ESP32-C3** and bringing it online with an AMD BC-250.

The intended release workflow uses a precompiled `app.mpy`, so normal users do **not** need to install or build MicroPython tools.

---

## Before you begin

You should already have:

- a Seeed Studio XIAO ESP32-C3
- the BC-250 wiring completed according to `../hardware/wiring.md`
- a USB-C data cable
- a computer for flashing and file transfer
- a 2.4 GHz Wi-Fi network
- the release files from this repository

The tested firmware target is:

```text
MicroPython 1.28.0
ESP-IDF 5.5.1
ESP32-C3
```

> If you use a different MicroPython release, `app.mpy` compatibility is not guaranteed.

---

## Release files

A normal release package should contain:

```text
main.py
app.mpy
config.py
secrets.example.py
www/
├── index.html
├── style.css
└── app.js
```

You will create:

```text
secrets.py
```

from the provided example.

`controllers.json` is created automatically after controllers are added and does not need to exist on a fresh install.

---

# 1. Flash MicroPython

Install MicroPython for the ESP32-C3 using your preferred flashing method.

The project was tested with:

```text
MicroPython v1.28.0
ESP-IDF 5.5.1
```

After flashing, connect to the board over USB and confirm you can reach the MicroPython REPL.

A successful boot should show something similar to:

```text
MicroPython v1.28.0 on 2026-04-06; Generic ESP32C3 module with ESP32C3
Type "help()" for more information.
>>>
```

---

# 2. Prepare the configuration files

## `config.py`

The release includes a user-editable `config.py`.

The tested defaults are:

```python
PIN_BC250_BUTTON = 2
PIN_BC250_SENSE = 3
PIN_CASE_BUTTON = 4
PIN_PS_ON = 5

DEBOUNCE_MS = 50
BC250_PRESS_MS = 250
FORCE_OFF_HOLD_MS = 4000
STARTUP_GRACE_MS = 10000

WAKE_RSSI_MIN = -85
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
WAKE_SCAN_MS = 3000
WEB_SCAN_MS = 5000

CONTROLLERS_FILE = "controllers.json"
MAX_CONTROLLERS = 4

MAX_WEB_PAYLOADS_PER_DEVICE = 4

WIFI_CONNECT_TIMEOUT_MS = 15000

HOSTNAME = "bc250-controller"
WEB_UI_DEBUG = False

DEFAULT_CONTROLLERS = []
```

If you are using the documented XIAO ESP32-C3 wiring, the default GPIO mapping should already be correct.

---

## `secrets.py`

Copy:

```text
secrets.example.py
```

to:

```text
secrets.py
```

Then edit it:

```python
WIFI_SSID = "YOUR_WIFI_NAME"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"
```

Do not commit your real `secrets.py` to a public repository.

---

# 3. Upload the files

You can use **Thonny** or **mpremote**.

---

## Option A: Thonny

1. Connect the XIAO ESP32-C3 over USB.
2. Open Thonny.
3. Select the MicroPython interpreter for the ESP32-C3.
4. Open **View → Files**.
5. Upload the release files to the device root.

The device filesystem should end up looking like:

```text
/
├── main.py
├── app.mpy
├── config.py
├── secrets.py
└── www/
    ├── index.html
    ├── style.css
    └── app.js
```

Do **not** upload the development `app.py` if you intend to run the precompiled `app.mpy`.

---

## Option B: mpremote

Install:

```bash
pip install mpremote
```

Then copy the files.

Example:

```bash
mpremote connect /dev/ttyACM0 fs cp main.py :main.py
mpremote connect /dev/ttyACM0 fs cp app.mpy :app.mpy
mpremote connect /dev/ttyACM0 fs cp config.py :config.py
mpremote connect /dev/ttyACM0 fs cp secrets.py :secrets.py
```

Create the web directory:

```bash
mpremote connect /dev/ttyACM0 fs mkdir :www
```

Then upload the web files:

```bash
mpremote connect /dev/ttyACM0 fs cp www/index.html :www/index.html
mpremote connect /dev/ttyACM0 fs cp www/style.css :www/style.css
mpremote connect /dev/ttyACM0 fs cp www/app.js :www/app.js
```

Device names vary by platform.

Examples:

```text
Linux:   /dev/ttyACM0
macOS:   /dev/cu.usbmodem...
Windows: COM3
```

---

# 4. First boot

With the files uploaded, reset or power-cycle the XIAO.

`main.py` should simply contain:

```python
import app
```

The precompiled `app.mpy` will load automatically.

On first boot:

- the ESP initializes GPIO
- the BC-250 state is checked
- controller storage is loaded or created as needed
- BLE wake logic becomes active while the BC-250 is off

If the BC-250 is already running, Wi-Fi should start automatically.

---

# 5. First startup of the BC-250

For initial setup, use the **physical case button** rather than Bluetooth wake.

Press the case button briefly.

Expected sequence:

```text
1. ESP detects the button press
2. PSU PS_ON is asserted
3. PSU main rails come up
4. BC-250 starts
5. TPMS1 pin 9 indicates running
6. ESP detects the running state
7. Wi-Fi starts
8. Web UI becomes available
```

If the BC-250 does not start, stop here and verify the hardware using `../hardware/wiring.md`.

---

# 6. Open the web interface

Once the BC-250 is running and Wi-Fi connects, open:

```text
http://bc250-controller.local
```

The hostname comes from:

```python
HOSTNAME = "bc250-controller"
```

in `config.py`.

If `.local` does not resolve, use the ESP's numeric IP address instead.

The IP can be found using:

- your router / DHCP client list
- serial output
- a local network scanner

---

# 7. Add your first controller

The easiest method is to use the web scanner.

## Recommended pairing workflow

1. Open the web UI.
2. Leave the controller powered off.
3. Click **Scan**.
4. Let the scan complete.
5. Turn the controller on.
6. Click **Scan** again.
7. Look for a **NEW** device near the top.
8. Use the **Controllers first** sort mode.
9. Add the likely controller.

The browser uses:

- advertised name
- HID service
- gamepad / joystick appearance
- manufacturer data
- controller-name patterns

to promote likely controllers.

---

# 8. Test Bluetooth wake

After adding the controller:

1. Shut the BC-250 down normally.
2. Wait for the PSU main rails to turn off.
3. Confirm the XIAO remains powered.
4. Turn on the configured controller.

Expected behavior:

```text
1. ESP sees the controller advertisement
2. RSSI passes the configured threshold
3. Enough matching advertisements are seen
4. PSU PS_ON is asserted
5. BC-250 powers up
6. Bazzite starts
7. The controller separately reconnects to the BC-250
```

The ESP does **not** pair with the controller.

It only watches for BLE advertisements.

---

# 9. Test normal shutdown

With the BC-250 running, shut it down from Bazzite / the OS.

Expected behavior:

```text
1. OS shuts down
2. TPMS1 pin 9 drops to the off state
3. ESP detects shutdown
4. PSU PS_ON is released
5. PSU main rails turn off
6. XIAO remains powered from standby 5 V
7. BLE wake scanning resumes
```

---

# 10. Test the physical power button

## Short press while off

Should start the BC-250.

## Short press while running

Should send a normal BC-250 power-button pulse and allow the OS to shut down gracefully.

## Long press

Holding the case button for approximately:

```text
4 seconds
```

should force main PSU power off.

Only use forced shutdown when normal shutdown is not working.

---

# 11. Confirm repeated web scans

Before considering the installation complete, perform several BLE scans from the web UI.

A healthy install should:

- complete repeated 5-second scans
- return no device list while the scan is still active
- return the full result set only after completion
- keep the web UI responsive
- avoid BLE / Wi-Fi crashes

This behavior is intentional and reduces ESP32-C3 memory pressure.

---

# 12. Optional debug mode

If scanning or controller discovery behaves strangely, enable:

```python
WEB_UI_DEBUG = True
```

in `config.py`.

Reload the web UI.

A **Scan Debug** panel will appear and log:

- scan start
- API requests
- polling state
- result count
- browser metadata processing
- rendering
- errors

Set it back to:

```python
WEB_UI_DEBUG = False
```

for a normal clean interface.

---

# 13. Adjust wake sensitivity if needed

The default threshold is:

```python
WAKE_RSSI_MIN = -85
```

If a controller is not reliably waking the BC-250 from normal couch distance, you may lower the threshold slightly.

Example:

```python
WAKE_RSSI_MIN = -90
```

If devices farther away are causing unintended wakes, raise it.

Example:

```python
WAKE_RSSI_MIN = -75
```

Do not change this aggressively until you have observed the controller's normal RSSI in the web scanner.

---

# 14. Multiple controllers

The default maximum is:

```python
MAX_CONTROLLERS = 4
```

Controllers are stored persistently in:

```text
controllers.json
```

You can add, rename, or remove controllers from the web UI.

For a public install, the release should start with:

```python
DEFAULT_CONTROLLERS = []
```

so no personal MAC addresses are included.

---

# 15. Verify the final installation

Before closing the case, verify all of the following:

- [ ] XIAO boots reliably from standby 5 V
- [ ] physical case button starts the BC-250
- [ ] TPMS1 pin 9 correctly reports running state
- [ ] Wi-Fi starts only when expected
- [ ] `bc250-controller.local` resolves
- [ ] controller list persists after reboot
- [ ] web scan completes repeatedly
- [ ] controller is promoted as a likely controller
- [ ] controller wake powers on the BC-250
- [ ] Bazzite shutdown causes PSU release
- [ ] short button press performs graceful shutdown
- [ ] long button press forces shutdown
- [ ] XIAO stays powered after PSU main rails turn off

---

# Upgrading to a newer release

A normal firmware upgrade should require replacing only the release-managed files:

```text
app.mpy
main.py
www/index.html
www/style.css
www/app.js
```

Do **not** overwrite your user-specific files unless the release notes explicitly require it:

```text
config.py
secrets.py
controllers.json
```

If a new release adds configuration options, merge those options into your existing `config.py`.

Back up `controllers.json` before major upgrades if you want to preserve enrolled controllers.

---

# Development installs

Developers may use `app.py` instead of `app.mpy`.

For normal releases, the compiled form is preferred because the ESP32-C3 has limited memory headroom when BLE, Wi-Fi, HTTP, JSON, and MicroPython are all active.

If building from source, compile with the matching MicroPython release.

For MicroPython 1.28.0:

```bash
git clone https://github.com/micropython/micropython.git
cd micropython
git checkout v1.28.0
make -C mpy-cross
```

Then:

```bash
./mpy-cross/build/mpy-cross -o app.mpy app.py
```

Do not leave both a stale `app.py` and a release `app.mpy` on the device if you are trying to validate the compiled release.

---

# Troubleshooting

Installation problems and runtime issues are documented separately:

- [`troubleshooting.md`](troubleshooting.md)

That guide covers flashing, Wi-Fi, web UI access, BLE scanning and wake, startup, shutdown, and hardware-sense problems.

---

# Security note

The web interface is intended for a trusted LAN.

Current v1.0 behavior:

- HTTP only
- no authentication
- no public-Internet exposure intended

Do not port-forward the ESP web server.

---

# Next steps

Once installation is complete:

- close up the hardware
- mount the external XIAO antenna if used
- expose the XIAO USB-C service port if desired
- enjoy turning on your weird server-board game console with an Xbox controller
