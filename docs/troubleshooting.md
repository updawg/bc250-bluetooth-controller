# Troubleshooting

This guide covers common problems with flashing, Wi-Fi, web access, BLE scanning and wake, startup, and shutdown.

For initial setup, see [`installation.md`](installation.md). For hardware connections, see [`../hardware/wiring.md`](../hardware/wiring.md).

This section is organized by **symptom → likely cause → fix**.

---

## Flashing / first boot

### Symptom: the XIAO does not appear as a serial device

**Likely causes**

- USB cable is power-only
- board is not in the expected boot / download mode
- host OS did not enumerate the USB serial device
- another application already has the port open

**Fixes**

- try a known-good USB data cable
- reconnect the XIAO directly to the computer instead of through a questionable hub
- close Thonny, serial monitors, or other tools that may already own the port
- check for a new serial device:
  - Linux: `/dev/ttyACM*` or `/dev/ttyUSB*`
  - macOS: `/dev/cu.usbmodem*`
  - Windows: Device Manager → Ports

---

### Symptom: MicroPython flashes successfully but the board drops to the REPL instead of starting the controller app

**Likely causes**

- `main.py` is missing
- `main.py` does not contain the expected import
- `app.mpy` is missing
- `app.mpy` is incompatible with the installed MicroPython version
- `config.py` or `secrets.py` is missing or contains a syntax error

**Fixes**

Verify the root filesystem contains:

```text
main.py
app.mpy
config.py
secrets.py
www/
```

Verify `main.py` contains:

```python
import app
```

If the REPL shows an import or `.mpy` compatibility error, confirm the board is running the same MicroPython major/minor release used to build the release package.

The tested release target is:

```text
MicroPython 1.28.0
ESP-IDF 5.5.1
ESP32-C3
```

---

### Symptom: `ValueError`, `SyntaxError`, or import errors appear immediately at boot

**Likely causes**

- malformed `config.py`
- malformed `secrets.py`
- copied smart quotes or other invalid characters
- edited variable names no longer match what the firmware expects

**Fixes**

Compare your local files against the provided examples.

For Wi-Fi, `secrets.py` should look like:

```python
WIFI_SSID = "YOUR_WIFI_NAME"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"
```

For initial testing, avoid changing variable names in `config.py`; change only their values.

---

### Symptom: the board boots from `app.py` instead of the release `app.mpy`

**Likely cause**

Both files exist on the device and an old development copy is being imported.

**Fix**

For a normal release install, remove:

```text
app.py
```

and leave:

```text
app.mpy
```

on the device.

---

## Wi-Fi

### Symptom: BC-250 starts, but the ESP never connects to Wi-Fi

**Likely causes**

- incorrect SSID or password
- Wi-Fi network does not provide 2.4 GHz service
- weak signal
- SSID is hidden or otherwise difficult for the ESP to join
- `secrets.py` was not uploaded
- typo or syntax error in `secrets.py`

**Fixes**

Verify:

```python
WIFI_SSID = "your_actual_ssid"
WIFI_PASSWORD = "your_actual_password"
```

Then check:

- the network supports 2.4 GHz
- the XIAO is within reasonable range of the access point
- the credentials match exactly, including capitalization
- the ESP can see the same network from the intended installation location

Use serial output during startup to confirm whether the failure is authentication, timeout, or file/config related.

---

### Symptom: Wi-Fi connects only intermittently

**Likely causes**

- weak 2.4 GHz coverage
- poor antenna placement
- antenna is inside or directly against metal
- noisy RF environment
- power instability on the XIAO standby supply

**Fixes**

- move or mount the XIAO antenna away from metal shielding
- use the external antenna supplied with the XIAO if appropriate
- verify standby 5 V remains stable while the BC-250 transitions on and off
- compare the ESP's behavior with the case open versus closed

Do not compensate for a power or antenna problem by immediately increasing Wi-Fi timeouts.

---

### Symptom: Wi-Fi works while the BC-250 is on but disappears after shutdown

**Expected behavior**

This is normal.

The v1.0 firmware only enables Wi-Fi / the management web UI while the BC-250 is running. When the system is off, the ESP remains powered and uses BLE wake scanning instead.

---

## Web UI access

### Symptom: `http://bc250-controller.local` does not load

**Likely causes**

- mDNS is unsupported or blocked on the client/network
- hostname was changed in `config.py`
- ESP has not connected to Wi-Fi
- browser is trying HTTPS instead of HTTP

**Fixes**

First try the numeric ESP IP:

```text
http://<ESP-IP>
```

Find the IP using:

- router / DHCP client list
- serial output
- local network tools

Also verify:

```python
HOSTNAME = "bc250-controller"
```

and explicitly use:

```text
http://
```

not:

```text
https://
```

---

### Symptom: the page loads but CSS or JavaScript is missing

**Likely causes**

- incomplete `www/` upload
- wrong directory structure
- stale browser cache
- one of the static files was copied to the device root instead of `www/`

**Fixes**

Verify:

```text
/www/index.html
/www/style.css
/www/app.js
```

Then force-refresh the browser.

If needed, reload the files from the release package.

---

### Symptom: the page loads but buttons fail or scan results never render

**Likely causes**

- stale `app.js`
- mismatched web files from different releases
- old firmware API paired with newer browser code
- JavaScript error in the browser

**Fixes**

Upload the complete matching set:

```text
app.mpy
www/index.html
www/style.css
www/app.js
```

Then force-refresh the page.

If the problem persists, enable:

```python
WEB_UI_DEBUG = True
```

and reproduce the issue.

---

### Symptom: BLE scan appears stuck for several seconds

**Expected behavior**

A web scan normally runs for about:

```text
5 seconds
```

During that time, the API intentionally returns:

```json
{
  "scanning": true,
  "done": false,
  "devices": []
}
```

The full device list is returned only after scanning finishes.

This is deliberate and avoids repeatedly serializing a growing BLE result set while Bluetooth and Wi-Fi are active together.

---

### Symptom: repeated scans eventually produce network errors or BLE crashes

**Likely causes**

- outdated firmware
- firmware modified to return scan payloads while scanning is still active
- BLE stack is being disabled and re-enabled dynamically
- Python-side BLE parsing has grown beyond the C3's available memory

**Fixes**

Use the current release architecture:

- precompiled `app.mpy`
- browser-side BLE metadata parsing
- bounded advertisement variants
- empty device arrays while a scan is active
- BLE initialized once rather than repeatedly torn down and restarted

Do not add `ble.active(False)` / `ble.active(True)` cycles to normal scan behavior.

---

## BLE wake

### Symptom: controller appears in the scanner but does not wake the BC-250

**Likely causes**

- wrong MAC address saved
- controller uses a rotating/private BLE address
- controller does not advertise during startup
- RSSI is below the wake threshold
- controller is using a proprietary non-BLE radio mode
- not enough matching advertisements are seen within the wake window

**Fixes**

Confirm the saved MAC matches the controller while it is being turned on.

Use the scanner to observe RSSI at normal couch distance.

Default wake settings are:

```python
WAKE_RSSI_MIN = -85
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
```

If RSSI is consistently weaker than `-85 dBm`, lower the threshold slightly and retest.

Example:

```python
WAKE_RSSI_MIN = -90
```

Do not immediately set an extremely low threshold; doing so increases the chance of waking from distant devices.

---

### Symptom: the wrong BLE device wakes the BC-250

**Likely causes**

- wrong MAC was added
- a non-controller BLE device was intentionally or accidentally enrolled
- device address was reused or changed
- wake threshold is too permissive

**Fixes**

- remove the incorrect entry from the web UI
- rescan with the intended controller off, then on
- use the `NEW` badge and **Controllers first** sort mode
- confirm the MAC before saving
- raise `WAKE_RSSI_MIN` if distant devices are being accepted

---

### Symptom: controller is labeled correctly in the scanner but still cannot be used for gameplay

**Expected behavior**

The ESP does not pair with or proxy the controller.

It only uses BLE advertisements as a wake trigger.

The controller must separately pair with the BC-250 / Bazzite Bluetooth stack for gameplay.

---

### Symptom: wake worked once, then never again

**Likely causes**

- controller changed to a private/rotating address
- saved MAC no longer matches
- controller now reconnects without emitting the same startup advertisements
- controller battery state or wireless mode changed

**Fixes**

Run another before/after scan:

1. controller off → scan
2. controller on → scan
3. compare MAC and advertised name
4. update the saved controller if needed

If the MAC changes regularly, that controller may not be a reliable wake source.

---

### Symptom: wake triggers only when very close to the ESP

**Likely causes**

- RSSI threshold too high
- poor antenna orientation
- XIAO antenna blocked by the case
- external antenna not attached or poorly positioned

**Fixes**

- inspect the controller's RSSI in the scanner
- lower `WAKE_RSSI_MIN` modestly if appropriate
- improve antenna placement
- move the antenna away from metal

---

## Startup / shutdown

### Symptom: case button does nothing while the BC-250 is off

**Likely causes**

- physical button not wired from GPIO4 to GND
- wrong GPIO configured
- broken button or connector
- ESP is not powered from standby 5 V
- PSU PS_ON transistor circuit is not switching

**Fixes**

Verify:

```text
D2 / GPIO4 -> momentary button -> GND
```

and:

```python
PIN_CASE_BUTTON = 4
PIN_PS_ON = 5
```

Confirm the XIAO remains powered while the main PSU rails are off.

Then verify the GPIO5 / 2N2222A PS_ON circuit according to [`../hardware/wiring.md`](../hardware/wiring.md).

---

### Symptom: PSU turns on, but the BC-250 never reaches RUNNING

**Likely causes**

- BC-250 did not actually boot
- running-sense signal is wrong
- TPMS1 pin 9 is not connected correctly
- startup grace period expires before the sense signal changes
- PSU output is unstable

**Fixes**

Verify the tested running-sense point:

```text
TPMS1 pin 9
```

The firmware expects:

```text
LOW  = off
HIGH = running
```

Measure the signal and confirm it is safely compatible with ESP32-C3 input levels.

The default startup grace is:

```python
STARTUP_GRACE_MS = 10000
```

Do not increase it until the hardware sense line has been verified.

---

### Symptom: controller wake starts the PSU, then the system powers back off

**Likely causes**

- startup sense never changes
- sense changes too late
- BC-250 fails to boot
- TPMS1 pin 9 wiring is incorrect

**Fixes**

Observe the running-sense input during startup.

If the BC-250 visibly boots but GPIO3 never becomes active, troubleshoot the TPMS1 pin 9 connection before changing firmware timing.

---

### Symptom: OS shuts down, but the PSU stays on

**Likely causes**

- running-sense signal never falls
- GPIO3 is stuck high
- incorrect sense wiring
- firmware never sees the BC-250 transition to off

**Fixes**

After the OS has fully shut down, verify:

```text
TPMS1 pin 9 -> LOW
```

If the signal remains high, troubleshoot the board-side sense connection.

If the sense signal falls correctly but PS_ON remains asserted, verify the GPIO5 transistor stage and firmware state.

---

### Symptom: short case-button press immediately kills power

**Likely causes**

- long-press detection is triggering unexpectedly
- button input is bouncing or stuck low
- case button wiring is shorted
- force-off threshold was changed too low

**Fixes**

Verify:

```python
FORCE_OFF_HOLD_MS = 4000
DEBOUNCE_MS = 50
```

Check that GPIO4 returns high when the button is released.

A normal short press while running should pulse the BC-250 power-button interface, not directly remove PSU power.

---

### Symptom: short press while running does not request graceful shutdown

**Likely causes**

- BC-250 power-button transistor interface is not switching
- GPIO2 mapping is wrong
- BC-250 power-button signal is connected to the wrong board point
- OS is configured to ignore the hardware power button

**Fixes**

Verify:

```python
PIN_BC250_BUTTON = 2
BC250_PRESS_MS = 250
```

Then verify the tested 2N2222A interface:

```text
GPIO2 -> 1 kΩ -> base
10 kΩ base -> GND
emitter -> GND
collector -> BC-250 power-button signal
```

If the electrical pulse is correct but Bazzite ignores it, check the OS power-button handling.

---

### Symptom: long press does not force shutdown

**Likely causes**

- physical button input is not staying low
- `FORCE_OFF_HOLD_MS` is too high
- button bounce / wiring issue
- GPIO4 configuration is wrong

**Fixes**

Verify the physical button directly shorts GPIO4 to GND while held.

Default:

```python
FORCE_OFF_HOLD_MS = 4000
```

Do not reduce this substantially unless you intentionally want a shorter forced-off delay.

---

### Symptom: XIAO reboots or powers off when the BC-250 shuts down

**Likely cause**

The XIAO is powered from a switched main PSU rail instead of the always-on standby 5 V source.

**Fix**

Use the documented FSP500-30AS connector point:

```text
Latch on top
Bottom row pin 3 -> +5 V standby
Top row pin 4    -> GND
```

The XIAO must stay powered while the BC-250 is off or Bluetooth wake cannot work.

---

## If you are still stuck

Before changing firmware, verify the hardware in this order:

```text
1. XIAO standby power
2. physical case button
3. PSU PS_ON transistor stage
4. TPMS1 pin 9 running sense
5. BC-250 power-button transistor stage
6. Wi-Fi
7. BLE scanning
8. BLE wake
```

For web-scan issues, enable:

```python
WEB_UI_DEBUG = True
```

and capture the Scan Debug output.

For boot / power issues, serial output from the XIAO plus voltage measurements at the documented control points are usually more useful than changing timing values blindly.

---
